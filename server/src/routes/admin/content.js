// Paquetes, categorías, canales/películas, series y episodios.
import { Router } from 'express';
import { db, whereSearch, insertId, insertManyIds, BATCH_SIZE } from '../../db/index.js';
import { adminOnly } from '../../lib/auth.js';
import { logAction } from '../../lib/log.js';
import { extensionOf, parseM3U } from '../../lib/m3u.js';
import { getSettings } from '../../lib/settings.js';
import { healthState, healthStatus, healthSummary, runHealthCheck } from '../../services/streamHealth.js';
import { DELIVERY_MODES } from '../../services/nodes.js';
import { EXACT_MODES } from '../../services/streaming.js';
import {
  serializeEpisode, serializeSeriesList, serializeStreams,
} from '../../lib/serialize.js';
import {
  HttpError, bool, chunk, idList, int, now, oneOf, paging, requireFields,
} from '../../lib/util.js';

const router = Router();

// Lectura permitida a revendedores (para asignar paquetes); escritura solo a administradores.
const writeGuard = (req, res, next) => (req.method === 'GET' ? next() : adminOnly(req, res, next));
router.use(writeGuard);

async function mustExist(table, id, label) {
  const row = await db(table).where({ id: int(id, 0) }).first();
  if (!row) throw new HttpError(404, `${label} no encontrado`);
  return row;
}

async function replaceLinks(trx, table, ownerCol, ownerId, itemCol, itemIds) {
  await trx(table).where({ [ownerCol]: ownerId }).del();
  for (const part of chunk(idList(itemIds), BATCH_SIZE)) {
    await trx(table).insert(part.map((id) => ({ [ownerCol]: ownerId, [itemCol]: id })));
  }
}

/* ---------------------------------- Paquetes --------------------------------- */

async function packageSummaries(ids = null) {
  const q = db('packages').orderBy('name');
  if (ids) q.whereIn('id', ids);
  const rows = await q;
  const count = async (table) => {
    const r = await db(table).groupBy('package_id').select('package_id').count({ c: '*' });
    return new Map(r.map((x) => [x.package_id, Number(x.c)]));
  };
  const [streams, series, users] = await Promise.all([
    count('package_streams'), count('package_series'), count('user_packages'),
  ]);
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description || '',
    stream_count: streams.get(p.id) || 0,
    series_count: series.get(p.id) || 0,
    user_count: users.get(p.id) || 0,
    xtream_id: p.xtream_id ?? null,
    created_at: Number(p.created_at),
  }));
}

async function packageDetail(id) {
  const [summary] = await packageSummaries([id]);
  if (!summary) throw new HttpError(404, 'Paquete no encontrado');
  summary.stream_ids = await db('package_streams').where({ package_id: id }).pluck('stream_id');
  summary.series_ids = await db('package_series').where({ package_id: id }).pluck('series_id');
  return summary;
}

router.get('/packages', async (_req, res) => res.json(await packageSummaries()));

router.post('/packages', async (req, res) => {
  requireFields(req.body, ['name']);
  const id = await db.transaction(async (trx) => {
    const pid = await insertId(trx, 'packages', {
      name: String(req.body.name).trim(), description: req.body.description || '', created_at: now(),
    });
    if (req.body.stream_ids) await replaceLinks(trx, 'package_streams', 'package_id', pid, 'stream_id', req.body.stream_ids);
    if (req.body.series_ids) await replaceLinks(trx, 'package_series', 'package_id', pid, 'series_id', req.body.series_ids);
    return pid;
  });
  await logAction(req.admin, 'package.create', 'package', id, { name: req.body.name });
  res.status(201).json(await packageDetail(id));
});

router.get('/packages/:id', async (req, res) => res.json(await packageDetail(int(req.params.id, 0))));

router.put('/packages/:id', async (req, res) => {
  const pkg = await mustExist('packages', req.params.id, 'Paquete');
  await db.transaction(async (trx) => {
    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.description !== undefined) patch.description = req.body.description;
    if (Object.keys(patch).length) await trx('packages').where({ id: pkg.id }).update(patch);
    if (req.body.stream_ids !== undefined) await replaceLinks(trx, 'package_streams', 'package_id', pkg.id, 'stream_id', req.body.stream_ids);
    if (req.body.series_ids !== undefined) await replaceLinks(trx, 'package_series', 'package_id', pkg.id, 'series_id', req.body.series_ids);
  });
  await logAction(req.admin, 'package.update', 'package', pkg.id, { name: req.body.name || pkg.name });
  res.json(await packageDetail(pkg.id));
});

router.delete('/packages/:id', async (req, res) => {
  const pkg = await mustExist('packages', req.params.id, 'Paquete');
  await db('packages').where({ id: pkg.id }).del();
  await logAction(req.admin, 'package.delete', 'package', pkg.id, { name: pkg.name });
  res.json({ ok: true });
});

/* --------------------------------- Categorías -------------------------------- */

const CATEGORY_TYPES = ['live', 'movie', 'series'];

function serializeCategory(c, counts) {
  return {
    id: c.id, name: c.name, type: c.type, sort_order: Number(c.sort_order || 0),
    item_count: counts.get(c.id) || 0, xtream_id: c.xtream_id ?? null,
  };
}

async function categoryCounts() {
  const s = await db('streams').whereNot('type', 'episode').whereNotNull('category_id')
    .groupBy('category_id').select('category_id').count({ c: '*' });
  const r = await db('series').whereNotNull('category_id').groupBy('category_id').select('category_id').count({ c: '*' });
  const map = new Map();
  for (const x of [...s, ...r]) map.set(x.category_id, (map.get(x.category_id) || 0) + Number(x.c));
  return map;
}

router.get('/categories', async (req, res) => {
  const q = db('categories').orderBy('type').orderBy('sort_order').orderBy('name');
  if (req.query.type) q.where('type', String(req.query.type));
  const counts = await categoryCounts();
  res.json((await q).map((c) => serializeCategory(c, counts)));
});

router.post('/categories', async (req, res) => {
  requireFields(req.body, ['name', 'type']);
  oneOf(req.body.type, CATEGORY_TYPES, 'type');
  const id = await insertId(db, 'categories', {
    name: String(req.body.name).trim(), type: req.body.type, sort_order: int(req.body.sort_order, 0), created_at: now(),
  });
  await logAction(req.admin, 'category.create', 'category', id, { name: req.body.name });
  res.status(201).json(serializeCategory(await db('categories').where({ id }).first(), new Map()));
});

/** Guarda el orden de las categorías (arrastrar y soltar). */
router.post('/categories/reorder', async (req, res) => {
  const ids = idList(req.body?.ids);
  if (!ids.length) throw new HttpError(400, 'Envía los ids en el orden deseado');
  await db.transaction(async (trx) => {
    for (let i = 0; i < ids.length; i++) await trx('categories').where({ id: ids[i] }).update({ sort_order: (i + 1) * 10 });
  });
  await logAction(req.admin, 'category.reorder', 'category', null, { count: ids.length });
  res.json({ ok: true, updated: ids.length });
});

router.put('/categories/:id', async (req, res) => {
  const cat = await mustExist('categories', req.params.id, 'Categoría');
  const patch = {};
  if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
  if (req.body.type !== undefined) patch.type = oneOf(req.body.type, CATEGORY_TYPES, 'type');
  if (req.body.sort_order !== undefined) patch.sort_order = int(req.body.sort_order, 0);
  if (Object.keys(patch).length) await db('categories').where({ id: cat.id }).update(patch);
  await logAction(req.admin, 'category.update', 'category', cat.id, patch);
  res.json(serializeCategory(await db('categories').where({ id: cat.id }).first(), await categoryCounts()));
});

router.delete('/categories/:id', async (req, res) => {
  const cat = await mustExist('categories', req.params.id, 'Categoría');
  await db('categories').where({ id: cat.id }).del();
  await logAction(req.admin, 'category.delete', 'category', cat.id, { name: cat.name });
  res.json({ ok: true });
});

/* ------------------------------ Canales y películas ------------------------------ */

function streamFields(body, { creating, type }) {
  const out = {};
  if (creating) requireFields(body, ['name', 'source_url']);
  if (body.name !== undefined) out.name = String(body.name).trim().slice(0, 512);
  if (body.category_id !== undefined) out.category_id = int(body.category_id);
  for (const f of ['logo', 'source_url', 'epg_channel_id', 'container_extension']) {
    if (body[f] !== undefined) out[f] = body[f] === null ? null : String(body[f]).trim();
  }
  if (body.epg_locked !== undefined) out.epg_locked = bool(body.epg_locked);
  else if (body.epg_channel_id !== undefined) out.epg_locked = Boolean(out.epg_channel_id);
  if (body.backup_urls !== undefined) {
    out.backup_urls = JSON.stringify((Array.isArray(body.backup_urls) ? body.backup_urls : []).map(String).filter(Boolean));
  }
  if (body.tv_archive_duration !== undefined) out.tv_archive_duration = int(body.tv_archive_duration, 0);
  if (body.sort_order !== undefined) out.sort_order = int(body.sort_order, 0);
  if (body.enabled !== undefined) out.enabled = bool(body.enabled);
  if (body.info !== undefined) out.info = JSON.stringify(body.info || {});
  if (body.delivery_mode !== undefined) out.delivery_mode = oneOf(body.delivery_mode, DELIVERY_MODES, 'delivery_mode');
  if (body.transcode_profile_id !== undefined) out.transcode_profile_id = int(body.transcode_profile_id);
  if (body.always_on !== undefined) out.always_on = bool(body.always_on);
  if (out.delivery_mode === 'transcode' && !out.transcode_profile_id && body.transcode_profile_id !== undefined) {
    throw new HttpError(400, 'Elige un perfil de transcodificación');
  }
  if (creating && !out.container_extension) {
    out.container_extension = extensionOf(out.source_url || '', type === 'live' ? 'ts' : 'mp4');
    if (type === 'live' && !['ts', 'm3u8'].includes(out.container_extension)) out.container_extension = 'ts';
  }
  return out;
}

async function setStreamServers(trx, streamId, serverIds) {
  await trx('stream_servers').where({ stream_id: streamId }).del();
  const ids = idList(serverIds);
  if (ids.length) {
    const valid = new Set(await trx('servers').whereIn('id', ids).pluck('id'));
    const rows = ids.filter((id) => valid.has(id)).map((server_id, priority) => ({ stream_id: streamId, server_id, priority }));
    if (rows.length) await trx('stream_servers').insert(rows);
  }
}

async function setStreamPackages(trx, streamId, packageIds) {
  await trx('package_streams').where({ stream_id: streamId }).del();
  const ids = idList(packageIds);
  if (ids.length) await trx('package_streams').insert(ids.map((package_id) => ({ package_id, stream_id: streamId })));
}

router.get('/streams', async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const q = db('streams').whereNot('type', 'episode');
  if (req.query.type) q.where('type', String(req.query.type));
  if (req.query.category_id) q.where('category_id', int(req.query.category_id, 0));
  if (req.query.enabled !== undefined && req.query.enabled !== '') q.where('enabled', bool(req.query.enabled));
  if (req.query.package_id) {
    q.whereIn('id', db('package_streams').where('package_id', int(req.query.package_id, 0)).select('stream_id'));
  }
  if (['online', 'offline', 'unknown'].includes(req.query.health)) q.where('health_status', req.query.health);
  if (DELIVERY_MODES.includes(req.query.delivery_mode)) q.where('delivery_mode', req.query.delivery_mode);
  if (req.query.server_id) q.whereIn('id', db('stream_servers').where('server_id', int(req.query.server_id, 0)).select('stream_id'));
  if (req.query.source) q.where('source', String(req.query.source));
  if (req.query.watching === 'true') {
    const settings = await getSettings();
    q.whereIn('id', db('connections').where('last_seen_at', '>=', now() - settings.connection_timeout_seconds).select('stream_id'));
  }
  whereSearch(q, ['name', 'epg_channel_id'], req.query.search);
  const total = Number((await q.clone().count({ c: '*' }).first()).c);
  const rows = await q.orderBy('sort_order').orderBy('name').limit(limit).offset(offset);
  res.json({ data: await serializeStreams(rows), total, page, limit });
});

router.post('/streams', async (req, res) => {
  const type = oneOf(req.body?.type, ['live', 'movie'], 'type');
  const fields = streamFields(req.body, { creating: true, type });
  const t = now();
  const id = await db.transaction(async (trx) => {
    const sid = await insertId(trx, 'streams', { ...fields, type, source: 'local', created_at: t, updated_at: t });
    if (req.body.package_ids) await setStreamPackages(trx, sid, req.body.package_ids);
    if (req.body.server_ids) await setStreamServers(trx, sid, req.body.server_ids);
    return sid;
  });
  await logAction(req.admin, 'stream.create', 'stream', id, { name: fields.name, type });
  const [out] = await serializeStreams([await db('streams').where({ id }).first()]);
  res.status(201).json(out);
});

router.post('/streams/bulk', async (req, res) => {
  const action = oneOf(req.body?.action,
    ['enable', 'disable', 'delete', 'set_category', 'add_to_package', 'remove_from_package', 'set_delivery'], 'action');
  if (action === 'set_delivery') {
    oneOf(req.body.delivery_mode, DELIVERY_MODES, 'delivery_mode');
    if (req.body.delivery_mode === 'transcode' && !int(req.body.transcode_profile_id)) {
      throw new HttpError(400, 'Elige un perfil de transcodificación');
    }
  }
  const ids = await db('streams').whereIn('id', idList(req.body.ids)).pluck('id');
  await db.transaction(async (trx) => {
    for (const part of chunk(ids, BATCH_SIZE)) {
      if (action === 'enable') await trx('streams').whereIn('id', part).update({ enabled: true });
      if (action === 'disable') await trx('streams').whereIn('id', part).update({ enabled: false });
      if (action === 'delete') await trx('streams').whereIn('id', part).del();
      if (action === 'set_delivery') {
        await trx('streams').whereIn('id', part).update({
          delivery_mode: req.body.delivery_mode,
          transcode_profile_id: req.body.delivery_mode === 'transcode' ? int(req.body.transcode_profile_id) : null,
          ...(req.body.always_on !== undefined ? { always_on: bool(req.body.always_on) } : {}),
        });
        if (req.body.server_ids !== undefined) {
          for (const id of part) await setStreamServers(trx, id, req.body.server_ids);
        }
      }
      if (action === 'set_category') {
        await trx('streams').whereIn('id', part).update({ category_id: int(req.body.category_id) });
      }
      const packageId = int(req.body.package_id);
      if (action === 'add_to_package' || action === 'remove_from_package') {
        if (!packageId || !(await trx('packages').where({ id: packageId }).first())) throw new HttpError(400, 'Paquete no válido');
        await trx('package_streams').where('package_id', packageId).whereIn('stream_id', part).del();
        if (action === 'add_to_package') {
          await trx('package_streams').insert(part.map((stream_id) => ({ package_id: packageId, stream_id })));
        }
      }
    }
  });
  await logAction(req.admin, `stream.bulk.${action}`, 'stream', null, { count: ids.length });
  res.json({ affected: ids.length });
});

/** Guarda el orden de los canales tal como llegan en `ids` (arrastrar y soltar). */
router.post('/streams/reorder', async (req, res) => {
  const ids = idList(req.body?.ids);
  if (!ids.length) throw new HttpError(400, 'Envía los ids en el orden deseado');
  const existing = new Set(await db('streams').whereIn('id', ids).pluck('id'));
  const start = Math.max(0, int(req.body?.start, 0));
  await db.transaction(async (trx) => {
    let pos = start;
    for (const id of ids) {
      if (!existing.has(id)) continue;
      pos += 10;
      await trx('streams').where({ id }).update({ sort_order: pos });
    }
  });
  await logAction(req.admin, 'stream.reorder', 'stream', null, { count: existing.size });
  res.json({ ok: true, updated: existing.size });
});

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const firstNumber = (name) => {
  const m = /\d+/.exec(String(name || ''));
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY;
};

/**
 * Ordena automáticamente: { type: live|movie, category_id?: id | null (sin categoría) | omitido (todos),
 *   mode: alpha | alpha_desc | number | added | added_desc | epg }
 */
router.post('/streams/sort', async (req, res) => {
  const body = req.body || {};
  const type = oneOf(body.type || 'live', ['live', 'movie'], 'type');
  const mode = oneOf(body.mode || 'alpha', ['alpha', 'alpha_desc', 'number', 'added', 'added_desc', 'epg'], 'mode');
  const q = db('streams').where({ type });
  if (body.category_id === null) q.whereNull('category_id');
  else if (body.category_id !== undefined) q.where('category_id', int(body.category_id, 0));
  const rows = await q.select('id', 'name', 'created_at', 'epg_channel_id');
  const cmp = {
    alpha: (a, b) => collator.compare(a.name, b.name),
    alpha_desc: (a, b) => collator.compare(b.name, a.name),
    number: (a, b) => (firstNumber(a.name) - firstNumber(b.name)) || collator.compare(a.name, b.name),
    added: (a, b) => (Number(a.created_at) - Number(b.created_at)) || (a.id - b.id),
    added_desc: (a, b) => (Number(b.created_at) - Number(a.created_at)) || (b.id - a.id),
    epg: (a, b) => (Number(!a.epg_channel_id) - Number(!b.epg_channel_id)) || collator.compare(a.name, b.name),
  }[mode];
  rows.sort(cmp);
  await db.transaction(async (trx) => {
    for (let i = 0; i < rows.length; i++) await trx('streams').where({ id: rows[i].id }).update({ sort_order: (i + 1) * 10 });
  });
  await logAction(req.admin, 'stream.sort', 'stream', null, { type, mode, category_id: body.category_id, count: rows.length });
  res.json({ ok: true, updated: rows.length });
});

router.get('/streams/health', async (_req, res) => {
  const settings = await getSettings();
  res.json({
    ...(await healthSummary()),
    ...(await healthStatus()),
    settings: {
      stream_check_enabled: settings.stream_check_enabled,
      stream_check_interval_minutes: settings.stream_check_interval_minutes,
      stream_check_batch: settings.stream_check_batch,
    },
  });
});

router.post('/streams/check', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? idList(req.body.ids) : null;
  if (ids && ids.length && ids.length <= 50) {
    const result = await runHealthCheck({ ids });
    if (!result.results) throw new HttpError(409, 'Ya hay una revisión en curso, inténtalo en unos minutos');
    await logAction(req.admin, 'stream.check', 'stream', null, { ids });
    return res.json(result);
  }
  if (healthState().running) throw new HttpError(409, 'Ya hay una revisión en curso');
  const types = ['live', 'movie'].includes(req.body?.type) ? [req.body.type] : ['live', 'movie'];
  runHealthCheck({ ids: ids && ids.length ? ids : null, types, limit: req.body?.all ? 1e9 : null })
    .catch((err) => console.error('Revisión de canales fallida:', err.message));
  await logAction(req.admin, 'stream.check', 'stream', null, { types, all: Boolean(req.body?.all) });
  res.status(202).json(healthState());
});

router.post('/streams/import-m3u', async (req, res) => {
  const body = req.body || {};
  let content = body.content;
  if (!content && body.url) {
    const resp = await fetch(String(body.url), { headers: { 'User-Agent': 'IPTV-Portal/1.0' }, signal: AbortSignal.timeout(60000) })
      .catch((err) => { throw new HttpError(400, `No se pudo descargar la lista: ${err.message}`); });
    if (!resp.ok) throw new HttpError(400, `No se pudo descargar la lista (HTTP ${resp.status})`);
    content = await resp.text();
  }
  if (!content) throw new HttpError(400, 'Envía "url" o "content"');
  const type = oneOf(body.type || 'auto', ['auto', 'live', 'movie'], 'type');
  const createCategories = body.create_categories !== false;
  const skipDuplicates = body.skip_duplicates !== false;
  const packageId = int(body.package_id);
  if (packageId && !(await db('packages').where({ id: packageId }).first())) throw new HttpError(400, 'Paquete no válido');

  const entries = parseM3U(content);
  if (!entries.length) throw new HttpError(400, 'La lista no contiene entradas válidas');

  const result = { created: 0, skipped: 0, categories_created: 0, total: entries.length };
  const t = now();
  await db.transaction(async (trx) => {
    const catMap = new Map();
    for (const c of await trx('categories').whereIn('type', ['live', 'movie'])) catMap.set(`${c.type}|${c.name}`, c.id);
    const existingUrls = new Set(skipDuplicates ? await trx('streams').whereNot('type', 'episode').pluck('source_url') : []);

    const rows = [];
    for (const e of entries) {
      const kind = type === 'auto' ? (e.kind === 'live' ? 'live' : 'movie') : type;
      if (existingUrls.has(e.url)) { result.skipped++; continue; }
      existingUrls.add(e.url);
      let categoryId = null;
      if (createCategories && e.group) {
        const key = `${kind}|${e.group}`;
        if (!catMap.has(key)) {
          catMap.set(key, await insertId(trx, 'categories', { name: e.group, type: kind, sort_order: 0, created_at: t }));
          result.categories_created++;
        }
        categoryId = catMap.get(key);
      }
      rows.push({
        type: kind, name: e.name.slice(0, 512), category_id: categoryId, logo: e.logo, source_url: e.url,
        backup_urls: '[]', epg_channel_id: e.epgId,
        container_extension: kind === 'live' ? (extensionOf(e.url, 'ts') === 'm3u8' ? 'm3u8' : 'ts') : extensionOf(e.url, 'mp4'),
        enabled: true, info: '{}', source: 'm3u', created_at: t, updated_at: t,
      });
    }
    for (const part of chunk(rows, BATCH_SIZE)) {
      const ids = await insertManyIds(trx, 'streams', part);
      if (packageId) await trx('package_streams').insert(ids.map((stream_id) => ({ package_id: packageId, stream_id })));
      result.created += part.length;
    }
  });
  await logAction(req.admin, 'stream.import_m3u', 'stream', null, result);
  res.json(result);
});

/** Conexiones activas de un canal (tiempo real). */
router.get('/streams/:id/connections', async (req, res) => {
  const row = await mustExist('streams', req.params.id, 'Contenido');
  const settings = await getSettings();
  const rows = await db('connections')
    .join('users', 'users.id', 'connections.user_id')
    .leftJoin('servers', 'servers.id', 'connections.server_id')
    .where('connections.stream_id', row.id)
    .where('connections.last_seen_at', '>=', now() - settings.connection_timeout_seconds)
    .select('connections.*', 'users.username', 'users.full_name', 'servers.name as server_name')
    .orderBy('connections.started_at', 'desc');
  res.json(rows.map((c) => ({
    id: c.id, user_id: c.user_id, username: c.username, full_name: c.full_name || '', ip: c.ip, user_agent: c.user_agent,
    mode: c.mode, tracking: EXACT_MODES.includes(c.mode) ? 'exact' : 'estimated', server_id: c.server_id ?? null,
    server_name: c.server_name || null, started_at: Number(c.started_at), last_seen_at: Number(c.last_seen_at),
  })));
});

router.get('/streams/:id', async (req, res) => {
  const row = await mustExist('streams', req.params.id, 'Contenido');
  res.json((await serializeStreams([row]))[0]);
});

router.put('/streams/:id', async (req, res) => {
  const row = await mustExist('streams', req.params.id, 'Contenido');
  const fields = streamFields(req.body || {}, { creating: false, type: row.type });
  await db.transaction(async (trx) => {
    if (Object.keys(fields).length) await trx('streams').where({ id: row.id }).update({ ...fields, updated_at: now() });
    if (req.body.package_ids !== undefined) await setStreamPackages(trx, row.id, req.body.package_ids);
    if (req.body.server_ids !== undefined) await setStreamServers(trx, row.id, req.body.server_ids);
  });
  await logAction(req.admin, 'stream.update', 'stream', row.id, { name: fields.name || row.name });
  res.json((await serializeStreams([await db('streams').where({ id: row.id }).first()]))[0]);
});

router.delete('/streams/:id', async (req, res) => {
  const row = await mustExist('streams', req.params.id, 'Contenido');
  await db('streams').where({ id: row.id }).del();
  await logAction(req.admin, 'stream.delete', 'stream', row.id, { name: row.name });
  res.json({ ok: true });
});

/* ------------------------------- Series y episodios ------------------------------- */

function seriesFields(body, creating) {
  if (creating) requireFields(body, ['name']);
  const out = {};
  const map = {
    name: 'name', cover: 'cover', plot: 'plot', cast: 'cast_list', director: 'director', genre: 'genre',
    release_date: 'release_date', rating: 'rating', backdrop: 'backdrop', youtube_trailer: 'youtube_trailer',
    episode_run_time: 'episode_run_time',
  };
  for (const [k, col] of Object.entries(map)) if (body[k] !== undefined) out[col] = body[k] === null ? null : String(body[k]);
  if (body.category_id !== undefined) out.category_id = int(body.category_id);
  if (body.enabled !== undefined) out.enabled = bool(body.enabled);
  return out;
}

router.get('/series', async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const q = db('series');
  if (req.query.category_id) q.where('category_id', int(req.query.category_id, 0));
  whereSearch(q, ['name'], req.query.search);
  const total = Number((await q.clone().count({ c: '*' }).first()).c);
  const rows = await q.orderBy('name').limit(limit).offset(offset);
  res.json({ data: await serializeSeriesList(rows), total, page, limit });
});

router.post('/series', async (req, res) => {
  const t = now();
  const id = await db.transaction(async (trx) => {
    const sid = await insertId(trx, 'series', { ...seriesFields(req.body || {}, true), source: 'local', created_at: t, updated_at: t });
    if (req.body.package_ids) await replaceLinks(trx, 'package_series', 'series_id', sid, 'package_id', req.body.package_ids);
    return sid;
  });
  await logAction(req.admin, 'series.create', 'series', id, { name: req.body.name });
  res.status(201).json((await serializeSeriesList([await db('series').where({ id }).first()]))[0]);
});

router.get('/series/:id', async (req, res) => {
  const row = await mustExist('series', req.params.id, 'Serie');
  res.json((await serializeSeriesList([row]))[0]);
});

router.put('/series/:id', async (req, res) => {
  const row = await mustExist('series', req.params.id, 'Serie');
  const fields = seriesFields(req.body || {}, false);
  await db.transaction(async (trx) => {
    if (Object.keys(fields).length) await trx('series').where({ id: row.id }).update({ ...fields, updated_at: now() });
    if (req.body.package_ids !== undefined) {
      await replaceLinks(trx, 'package_series', 'series_id', row.id, 'package_id', req.body.package_ids);
    }
  });
  await logAction(req.admin, 'series.update', 'series', row.id, { name: fields.name || row.name });
  res.json((await serializeSeriesList([await db('series').where({ id: row.id }).first()]))[0]);
});

router.delete('/series/:id', async (req, res) => {
  const row = await mustExist('series', req.params.id, 'Serie');
  await db('series').where({ id: row.id }).del();
  await logAction(req.admin, 'series.delete', 'series', row.id, { name: row.name });
  res.json({ ok: true });
});

router.get('/series/:id/episodes', async (req, res) => {
  const row = await mustExist('series', req.params.id, 'Serie');
  const eps = await db('streams').where({ series_id: row.id, type: 'episode' }).orderBy('season').orderBy('episode_num');
  res.json(eps.map(serializeEpisode));
});

function episodeFields(body, creating) {
  if (creating) requireFields(body, ['source_url']);
  const out = {};
  if (body.name !== undefined) out.name = String(body.name).slice(0, 512);
  if (body.season !== undefined) out.season = int(body.season, 1);
  if (body.episode_num !== undefined) out.episode_num = int(body.episode_num, 1);
  if (body.source_url !== undefined) out.source_url = String(body.source_url).trim();
  if (body.container_extension !== undefined) out.container_extension = String(body.container_extension);
  if (body.info !== undefined) out.info = JSON.stringify(body.info || {});
  if (body.enabled !== undefined) out.enabled = bool(body.enabled);
  return out;
}

router.post('/series/:id/episodes', async (req, res) => {
  const series = await mustExist('series', req.params.id, 'Serie');
  const fields = episodeFields(req.body || {}, true);
  const t = now();
  const id = await insertId(db, 'streams', {
    season: 1, episode_num: 1, ...fields,
    name: fields.name || `${series.name} T${fields.season || 1}E${fields.episode_num || 1}`,
    container_extension: fields.container_extension || extensionOf(fields.source_url, 'mp4'),
    type: 'episode', series_id: series.id, source: 'local', info: fields.info || '{}', created_at: t, updated_at: t,
  });
  await logAction(req.admin, 'episode.create', 'episode', id, { series: series.name });
  res.status(201).json(serializeEpisode(await db('streams').where({ id }).first()));
});

router.put('/episodes/:id', async (req, res) => {
  const ep = await db('streams').where({ id: int(req.params.id, 0), type: 'episode' }).first();
  if (!ep) throw new HttpError(404, 'Episodio no encontrado');
  const fields = episodeFields(req.body || {}, false);
  if (Object.keys(fields).length) await db('streams').where({ id: ep.id }).update({ ...fields, updated_at: now() });
  res.json(serializeEpisode(await db('streams').where({ id: ep.id }).first()));
});

router.delete('/episodes/:id', async (req, res) => {
  const ep = await db('streams').where({ id: int(req.params.id, 0), type: 'episode' }).first();
  if (!ep) throw new HttpError(404, 'Episodio no encontrado');
  await db('streams').where({ id: ep.id }).del();
  await logAction(req.admin, 'episode.delete', 'episode', ep.id, { name: ep.name });
  res.json({ ok: true });
});

export default router;
