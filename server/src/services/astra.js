// Integración con Cesbo Astra: importar y sincronizar canales por su API y vigilar su señal (onair).
//   POST {api_url}/control/  {"cmd":"load"}           → configuración completa (streams en "make_stream")
//   GET  {api_url}/api/stream-status/{id}?t=0         → { onair, bitrate, cc_error, sessions, … }
import { db, insertId, insertManyIds } from '../db/index.js';
import { logAction } from '../lib/log.js';
import { HttpError, bool, chunk, int, now, parseJson } from '../lib/util.js';

function authHeaders(source) {
  const headers = { Accept: 'application/json' };
  if (source.username) {
    headers.Authorization = `Basic ${Buffer.from(`${source.username}:${source.password || ''}`).toString('base64')}`;
  }
  return headers;
}

const base = (url) => String(url || '').replace(/\/+$/, '');

async function astraRequest(source, pathname, { method = 'GET', body = null, timeout = 20000 } = {}) {
  let res;
  try {
    res = await fetch(`${base(source.api_url)}${pathname}`, {
      method,
      headers: { ...authHeaders(source), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw new HttpError(502, `No se pudo conectar con Astra (${source.api_url}): ${err.cause?.code || err.message}`);
  }
  if (res.status === 401 || res.status === 403) throw new HttpError(400, 'Astra rechazó el usuario o la contraseña');
  if (!res.ok) throw new HttpError(502, `Astra respondió HTTP ${res.status} en ${pathname}`);
  try {
    return await res.json();
  } catch {
    throw new HttpError(502, 'Astra no devolvió JSON. Revisa que la URL sea la de la interfaz web (p. ej. http://ip:8000)');
  }
}

/** Extrae los canales de la configuración de Astra. */
export function parseAstraConfig(cfg) {
  const list = Array.isArray(cfg?.make_stream) ? cfg.make_stream : Array.isArray(cfg?.streams) ? cfg.streams : null;
  if (!list) throw new HttpError(502, 'La respuesta de Astra no contiene la lista de canales ("make_stream")');
  const groupNames = new Map();
  for (const cat of Array.isArray(cfg.categories) ? cfg.categories : []) {
    for (const g of cat.groups || []) groupNames.set(`${cat.name}|${g.name}`, g.name);
  }
  return list.filter((s) => s && s.id !== undefined).map((s) => {
    let group = '';
    if (s.groups && typeof s.groups === 'object') {
      const [first] = Object.entries(s.groups);
      if (first) group = groupNames.get(`${first[0]}|${first[1]}`) || String(first[1]);
    }
    return {
      astra_id: String(s.id),
      name: String(s.name || s.id),
      enabled: s.enable !== false,
      type: s.type || 'spts',
      group,
      inputs: (Array.isArray(s.input) ? s.input : []).map(String),
      outputs: (Array.isArray(s.output) ? s.output : []).map(String),
    };
  });
}

/** URL por la que el portal/nodos/clientes toman el canal de Astra. */
export function playUrlFor(source, channel) {
  const host = (() => {
    try {
      return new URL(source.play_url || source.api_url).hostname;
    } catch {
      return 'localhost';
    }
  })();
  if (source.url_mode === 'output') {
    const out = channel.outputs.find((o) => /^https?:\/\//i.test(o));
    if (out) {
      // Astra suele declarar la salida como http://0:8100/ruta o http://0.0.0.0:8100/ruta
      return out.replace(/^(https?:\/\/)(0|0\.0\.0\.0|127\.0\.0\.1|localhost)(?=[:/])/i, `$1${host}`).split('#')[0];
    }
  }
  const path = (source.play_path || '/play/{id}').replace('{id}', encodeURIComponent(channel.astra_id));
  return `${base(source.play_url || source.api_url)}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function loadAstraChannels(source) {
  const cfg = await astraRequest(source, '/control/', { method: 'POST', body: { cmd: 'load' } });
  return parseAstraConfig(cfg).map((c) => ({ ...c, play_url: playUrlFor(source, c) }));
}

export function importDefaults(source) {
  return {
    category_mode: 'group', // group (grupo de Astra) | fixed
    category_id: null,
    delivery_mode: 'default',
    transcode_profile_id: null,
    server_ids: [],
    package_id: null,
    always_on: false,
    ...(parseJson(source.import_defaults, {}) || {}),
  };
}

/** Crea canales IPTV a partir de canales de Astra. */
export async function importChannels(source, channelIds, options = {}, admin = null) {
  const opts = { ...importDefaults(source), ...options };
  const rows = await db('astra_channels').where({ source_id: source.id }).whereIn('id', channelIds).whereNull('stream_id');
  if (!rows.length) return { created: 0, categories_created: 0 };
  const t = now();
  const result = { created: 0, categories_created: 0 };

  await db.transaction(async (trx) => {
    const catMap = new Map((await trx('categories').where({ type: 'live' })).map((c) => [c.name, c.id]));
    const newStreams = [];
    for (const ch of rows) {
      let categoryId = opts.category_mode === 'fixed' ? int(opts.category_id) : null;
      if (opts.category_mode !== 'fixed') {
        const name = ch.group_name || source.name;
        if (!catMap.has(name)) {
          catMap.set(name, await insertId(trx, 'categories', { name, type: 'live', sort_order: 0, created_at: t }));
          result.categories_created++;
        }
        categoryId = catMap.get(name);
      }
      newStreams.push({
        ch,
        row: {
          type: 'live', name: ch.name, category_id: categoryId, logo: '', source_url: ch.play_url, backup_urls: '[]',
          epg_channel_id: '', container_extension: 'ts', enabled: bool(ch.enabled), info: '{}', source: 'astra',
          delivery_mode: opts.delivery_mode || 'default',
          transcode_profile_id: opts.delivery_mode === 'transcode' ? int(opts.transcode_profile_id) : null,
          always_on: bool(opts.always_on), created_at: t, updated_at: t,
        },
      });
    }
    for (const part of chunk(newStreams, 200)) {
      const ids = await insertManyIds(trx, 'streams', part.map((p) => p.row));
      for (let i = 0; i < ids.length; i++) {
        await trx('astra_channels').where({ id: part[i].ch.id }).update({ stream_id: ids[i] });
      }
      const serverIds = (opts.server_ids || []).map(Number).filter(Boolean);
      if (serverIds.length && ['restream', 'transcode'].includes(opts.delivery_mode)) {
        await trx('stream_servers').insert(ids.flatMap((sid) => serverIds.map((server_id, priority) => ({ stream_id: sid, server_id, priority }))));
      }
      if (opts.package_id) {
        await trx('package_streams').insert(ids.map((stream_id) => ({ package_id: int(opts.package_id), stream_id })));
      }
      result.created += ids.length;
    }
  });
  await logAction(admin, 'astra.import', 'astra', source.id, { ...result, source: source.name });
  return result;
}

/**
 * Elimina del portal canales importados de una fuente Astra.
 * scope: { channel_ids?: [...] } | { group?: '...' } | {} (todos). Los canales de Astra quedan como "sin importar".
 * Con remove_empty_categories, borra las categorías que queden vacías.
 */
export async function deleteImportedChannels(source, { channelIds = null, group = null, removeEmptyCategories = false } = {}, admin = null) {
  const q = db('astra_channels').where({ source_id: source.id }).whereNotNull('stream_id');
  if (channelIds) q.whereIn('id', channelIds);
  if (group) q.where('group_name', group);
  const rows = await q.select('id', 'stream_id');
  const streamIds = rows.map((r) => r.stream_id);
  const result = { deleted: 0, categories_deleted: 0 };
  if (!streamIds.length) return result;

  await db.transaction(async (trx) => {
    const categoryIds = removeEmptyCategories
      ? [...new Set((await trx('streams').whereIn('id', streamIds).whereNotNull('category_id').pluck('category_id')))]
      : [];
    for (const part of chunk(streamIds, 200)) {
      await trx('connections').whereIn('stream_id', part).del();
      result.deleted += await trx('streams').whereIn('id', part).del();
    }
    await trx('astra_channels').whereIn('id', rows.map((r) => r.id)).update({ stream_id: null });
    for (const categoryId of categoryIds) {
      const used = await trx('streams').where({ category_id: categoryId }).first()
        || await trx('series').where({ category_id: categoryId }).first();
      if (!used) result.categories_deleted += await trx('categories').where({ id: categoryId }).del();
    }
  });
  await logAction(admin, 'astra.delete_imported', 'astra', source.id, {
    ...result, source: source.name, group: group || undefined, selected: channelIds ? channelIds.length : undefined,
  });
  return result;
}

/** Sincroniza la lista de canales con Astra: altas, bajas y cambios de URL. */
export async function syncAstraSource(source, admin = null) {
  const t = now();
  const stats = { total: 0, new: 0, updated: 0, removed: 0, restored: 0, streams_updated: 0, streams_disabled: 0, imported: 0 };
  let channels;
  try {
    channels = await loadAstraChannels(source);
  } catch (err) {
    await db('astra_sources').where({ id: source.id }).update({ last_error: err.message, updated_at: t });
    throw err;
  }
  stats.total = channels.length;
  const existing = new Map((await db('astra_channels').where({ source_id: source.id })).map((c) => [c.astra_id, c]));
  const seen = new Set();
  const newIds = [];

  for (const ch of channels) {
    seen.add(ch.astra_id);
    const data = {
      name: ch.name.slice(0, 255), enabled: ch.enabled, group_name: ch.group.slice(0, 255),
      inputs: JSON.stringify(ch.inputs), outputs: JSON.stringify(ch.outputs), play_url: ch.play_url.slice(0, 512),
      removed: false, synced_at: t,
    };
    const prev = existing.get(ch.astra_id);
    if (!prev) {
      newIds.push(await insertId(db, 'astra_channels', { source_id: source.id, astra_id: ch.astra_id, ...data }));
      stats.new++;
      continue;
    }
    if (bool(prev.removed)) stats.restored++;
    await db('astra_channels').where({ id: prev.id }).update(data);
    if (prev.play_url !== data.play_url || prev.name !== data.name || bool(prev.enabled) !== ch.enabled) stats.updated++;
    if (prev.stream_id) {
      const stream = await db('streams').where({ id: prev.stream_id }).first();
      if (stream) {
        const patch = {};
        if (stream.source_url !== data.play_url) patch.source_url = data.play_url;
        if (bool(source.sync_names) && stream.name !== data.name) patch.name = data.name;
        if (bool(prev.removed) && !bool(stream.enabled) && ch.enabled) patch.enabled = true;
        if (Object.keys(patch).length) {
          await db('streams').where({ id: stream.id }).update({ ...patch, updated_at: t });
          stats.streams_updated++;
        }
      }
    }
  }

  for (const [astraId, prev] of existing) {
    if (seen.has(astraId) || bool(prev.removed)) continue;
    await db('astra_channels').where({ id: prev.id }).update({ removed: true, synced_at: t });
    stats.removed++;
    if (prev.stream_id && bool(source.disable_removed)) {
      await db('streams').where({ id: prev.stream_id }).update({
        enabled: false, health_status: 'offline', health_error: 'Canal eliminado en Astra', health_down_since: t, updated_at: t,
      });
      stats.streams_disabled++;
    }
  }

  if (bool(source.auto_import_new) && newIds.length) {
    stats.imported = (await importChannels(source, newIds, {}, admin)).created;
  }
  await db('astra_sources').where({ id: source.id }).update({ last_sync_at: t, last_error: null, updated_at: t });
  if (stats.new || stats.removed || stats.streams_updated || stats.imported) {
    await logAction(admin, 'astra.sync', 'astra', source.id, { ...stats, source: source.name });
  }
  return stats;
}

/** Consulta el estado en vivo de los canales importados y lo refleja en la salud del canal. */
export async function pollAstraStatus(source) {
  const rows = await db('astra_channels').where({ source_id: source.id, removed: false }).whereNotNull('stream_id');
  const t = now();
  let online = 0;
  let offline = 0;
  let index = 0;
  const worker = async () => {
    while (index < rows.length) {
      const ch = rows[index++];
      let st = null;
      let error = null;
      try {
        st = await astraRequest(source, `/api/stream-status/${encodeURIComponent(ch.astra_id)}?t=0`, { timeout: 8000 });
      } catch (err) {
        error = err.message;
      }
      const onair = st ? Boolean(st.onair) : null;
      await db('astra_channels').where({ id: ch.id }).update({
        onair, bitrate_kbps: st ? int(st.bitrate, 0) : null, cc_errors: st ? int(st.cc_error, 0) : null,
        sessions: st ? int(st.sessions, 0) : null, status_checked_at: t,
      });
      if (onair === true) {
        online++;
        await db('streams').where({ id: ch.stream_id }).update({
          health_status: 'online', health_checked_at: t, health_error: null, health_fail_count: 0, health_down_since: null,
        });
      } else {
        offline++;
        const stream = await db('streams').where({ id: ch.stream_id }).select('health_status').first();
        await db('streams').where({ id: ch.stream_id }).update({
          health_status: 'offline', health_checked_at: t,
          health_error: error ? `Astra: ${error}`.slice(0, 255) : 'Astra: sin señal (onair = false)',
          ...(stream?.health_status !== 'offline' ? { health_down_since: t } : {}),
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(10, rows.length || 1) }, worker));
  await db('astra_sources').where({ id: source.id }).update({ last_status_at: t });
  return { checked: rows.length, online, offline };
}

export function startAstraScheduler() {
  const busy = new Set();
  const tick = async () => {
    const sources = await db('astra_sources').where({ enabled: true }).catch(() => []);
    const t = now();
    for (const s of sources) {
      if (busy.has(s.id)) continue;
      busy.add(s.id);
      try {
        if (t - Number(s.last_sync_at || 0) >= Math.max(5, Number(s.sync_interval_minutes) || 30) * 60) {
          await syncAstraSource(s).catch((err) => console.error(`Astra "${s.name}": ${err.message}`));
        }
        if (bool(s.status_poll) && t - Number(s.last_status_at || 0) >= Math.max(1, Number(s.status_interval_minutes) || 5) * 60) {
          await pollAstraStatus(s).catch((err) => console.error(`Astra "${s.name}" estado: ${err.message}`));
        }
      } finally {
        busy.delete(s.id);
      }
    }
  };
  const timer = setInterval(() => tick().catch(() => {}), 60_000);
  timer.unref();
  setTimeout(() => tick().catch(() => {}), 15_000).unref();
  return () => clearInterval(timer);
}
