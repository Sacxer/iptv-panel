// Fuentes Astra: conexión, canales disponibles, importación y sincronización.
import { Router } from 'express';
import { db, insertId, whereSearch } from '../../db/index.js';
import { adminOnly } from '../../lib/auth.js';
import { logAction } from '../../lib/log.js';
import {
  HttpError, bool, idList, int, now, oneOf, paging, parseJson, requireFields,
} from '../../lib/util.js';
import {
  deleteImportedChannels, importChannels, importDefaults, loadAstraChannels, pollAstraStatus, syncAstraSource,
} from '../../services/astra.js';
import { DELIVERY_MODES } from '../../services/nodes.js';

const router = Router();
router.use(adminOnly);

const intOrNull = (v) => int(v, null);

async function serializeSource(s) {
  const count = async (q) => Number((await q.count({ c: '*' }).first()).c);
  return {
    id: s.id,
    name: s.name,
    api_url: s.api_url,
    username: s.username || '',
    password_set: Boolean(s.password),
    play_url: s.play_url || '',
    url_mode: s.url_mode,
    play_path: s.play_path,
    enabled: bool(s.enabled),
    sync_interval_minutes: Number(s.sync_interval_minutes),
    status_poll: bool(s.status_poll),
    status_interval_minutes: Number(s.status_interval_minutes),
    auto_import_new: bool(s.auto_import_new),
    disable_removed: bool(s.disable_removed),
    sync_names: bool(s.sync_names),
    import_defaults: importDefaults(s),
    last_sync_at: intOrNull(s.last_sync_at),
    last_status_at: intOrNull(s.last_status_at),
    last_error: s.last_error || null,
    counts: {
      channels: await count(db('astra_channels').where({ source_id: s.id, removed: false })),
      imported: await count(db('astra_channels').where({ source_id: s.id, removed: false }).whereNotNull('stream_id')),
      not_imported: await count(db('astra_channels').where({ source_id: s.id, removed: false }).whereNull('stream_id')),
      removed: await count(db('astra_channels').where({ source_id: s.id, removed: true })),
      onair: await count(db('astra_channels').where({ source_id: s.id, removed: false, onair: true })),
      offair: await count(db('astra_channels').where({ source_id: s.id, removed: false, onair: false })),
    },
    created_at: Number(s.created_at),
  };
}

function sourceFields(body, creating) {
  if (creating) requireFields(body, ['name', 'api_url']);
  const out = {};
  if (body.name !== undefined) out.name = String(body.name).trim().slice(0, 100);
  for (const k of ['api_url', 'play_url']) {
    if (body[k] !== undefined) {
      const url = String(body[k] || '').trim().replace(/\/+$/, '');
      if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, `"${k}" debe empezar por http:// o https://`);
      out[k] = url;
    }
  }
  if (body.username !== undefined) out.username = String(body.username || '').slice(0, 100);
  if (body.password) out.password = String(body.password);
  if (body.url_mode !== undefined) out.url_mode = oneOf(body.url_mode, ['play', 'output'], 'url_mode');
  if (body.play_path !== undefined) out.play_path = String(body.play_path || '/play/{id}').slice(0, 100);
  for (const k of ['enabled', 'status_poll', 'auto_import_new', 'disable_removed', 'sync_names']) {
    if (body[k] !== undefined) out[k] = bool(body[k]);
  }
  if (body.sync_interval_minutes !== undefined) out.sync_interval_minutes = Math.max(5, Math.min(1440, int(body.sync_interval_minutes, 30)));
  if (body.status_interval_minutes !== undefined) out.status_interval_minutes = Math.max(1, Math.min(1440, int(body.status_interval_minutes, 5)));
  if (body.import_defaults !== undefined) out.import_defaults = JSON.stringify(importOptions(body.import_defaults || {}));
  return out;
}

function importOptions(o) {
  const out = {};
  if (o.category_mode !== undefined) out.category_mode = oneOf(o.category_mode, ['group', 'fixed'], 'category_mode');
  if (o.category_id !== undefined) out.category_id = intOrNull(o.category_id);
  if (o.delivery_mode !== undefined) out.delivery_mode = oneOf(o.delivery_mode, DELIVERY_MODES, 'delivery_mode');
  if (o.transcode_profile_id !== undefined) out.transcode_profile_id = intOrNull(o.transcode_profile_id);
  if (o.server_ids !== undefined) out.server_ids = idList(o.server_ids);
  if (o.package_id !== undefined) out.package_id = intOrNull(o.package_id);
  if (o.always_on !== undefined) out.always_on = bool(o.always_on);
  if (out.delivery_mode === 'transcode' && !out.transcode_profile_id) {
    throw new HttpError(400, 'Elige un perfil de transcodificación');
  }
  return out;
}

async function loadSource(id) {
  const row = await db('astra_sources').where({ id: int(id, 0) }).first();
  if (!row) throw new HttpError(404, 'Fuente Astra no encontrada');
  return row;
}

router.get('/astra/sources', async (_req, res) => {
  const rows = await db('astra_sources').orderBy('name');
  res.json(await Promise.all(rows.map(serializeSource)));
});

/** Prueba de conexión sin guardar: devuelve cuántos canales ve y una muestra con su URL. */
router.post('/astra/test', async (req, res) => {
  const body = req.body || {};
  const saved = body.id ? await loadSource(body.id) : {};
  const source = { url_mode: 'play', play_path: '/play/{id}', ...saved, ...sourceFields(body, false) };
  if (!source.api_url) throw new HttpError(400, 'Indica la URL de Astra');
  const channels = await loadAstraChannels(source);
  res.json({
    ok: true,
    total: channels.length,
    enabled: channels.filter((c) => c.enabled).length,
    groups: [...new Set(channels.map((c) => c.group).filter(Boolean))],
    sample: channels.slice(0, 10).map(({ astra_id: id, name, enabled, group, play_url: url, outputs }) => ({
      astra_id: id, name, enabled, group, play_url: url, outputs,
    })),
  });
});

router.post('/astra/sources', async (req, res) => {
  const t = now();
  const id = await insertId(db, 'astra_sources', { ...sourceFields(req.body || {}, true), created_at: t, updated_at: t });
  await logAction(req.admin, 'astra.source.create', 'astra', id, { name: req.body.name });
  const source = await db('astra_sources').where({ id }).first();
  let sync = null;
  let error = null;
  try {
    sync = await syncAstraSource(source, req.admin);
  } catch (err) {
    error = err.message;
  }
  res.status(201).json({ source: await serializeSource(await db('astra_sources').where({ id }).first()), sync, error });
});

router.get('/astra/sources/:id', async (req, res) => res.json(await serializeSource(await loadSource(req.params.id))));

router.put('/astra/sources/:id', async (req, res) => {
  const row = await loadSource(req.params.id);
  const fields = sourceFields(req.body || {}, false);
  if (Object.keys(fields).length) await db('astra_sources').where({ id: row.id }).update({ ...fields, updated_at: now() });
  await logAction(req.admin, 'astra.source.update', 'astra', row.id, { ...fields, password: fields.password ? '***' : undefined });
  res.json(await serializeSource(await loadSource(row.id)));
});

/** Elimina la fuente. Con ?delete_streams=true borra también los canales que se importaron de ella. */
router.delete('/astra/sources/:id', async (req, res) => {
  const row = await loadSource(req.params.id);
  let removed = { deleted: 0, categories_deleted: 0 };
  if (bool(req.query.delete_streams)) {
    removed = await deleteImportedChannels(row, { removeEmptyCategories: bool(req.query.remove_empty_categories) }, req.admin);
  }
  await db('astra_sources').where({ id: row.id }).del();
  await logAction(req.admin, 'astra.source.delete', 'astra', row.id, { name: row.name, streams_deleted: removed.deleted });
  res.json({ ok: true, ...removed });
});

/**
 * Elimina canales importados: { all: true } | { group: "Deportes" } | { channel_ids: [...] }
 * + remove_empty_categories. Los canales siguen en Astra y se pueden volver a importar.
 */
router.post('/astra/sources/:id/delete-imported', async (req, res) => {
  const row = await loadSource(req.params.id);
  const body = req.body || {};
  const channelIds = Array.isArray(body.channel_ids) ? idList(body.channel_ids) : null;
  if (!bool(body.all) && !body.group && !(channelIds && channelIds.length)) {
    throw new HttpError(400, 'Indica all: true, un grupo o los canales a eliminar');
  }
  res.json(await deleteImportedChannels(row, {
    channelIds: bool(body.all) ? null : channelIds,
    group: bool(body.all) ? null : body.group || null,
    removeEmptyCategories: bool(body.remove_empty_categories),
  }, req.admin));
});

router.post('/astra/sources/:id/sync', async (req, res) => {
  const row = await loadSource(req.params.id);
  res.json(await syncAstraSource(row, req.admin));
});

router.post('/astra/sources/:id/status', async (req, res) => {
  const row = await loadSource(req.params.id);
  res.json(await pollAstraStatus(row));
});

router.get('/astra/sources/:id/channels', async (req, res) => {
  const row = await loadSource(req.params.id);
  const { page, limit, offset } = paging(req.query, 100);
  const q = db('astra_channels').leftJoin('streams', 'streams.id', 'astra_channels.stream_id')
    .where('astra_channels.source_id', row.id);
  whereSearch(q, ['astra_channels.name', 'astra_channels.astra_id', 'astra_channels.group_name'], req.query.search);
  if (req.query.imported === 'true') q.whereNotNull('astra_channels.stream_id');
  if (req.query.imported === 'false') q.whereNull('astra_channels.stream_id');
  if (req.query.removed === 'true') q.where('astra_channels.removed', true);
  else if (req.query.removed !== 'all') q.where('astra_channels.removed', false);
  if (req.query.group) q.where('astra_channels.group_name', String(req.query.group));
  if (req.query.onair === 'true') q.where('astra_channels.onair', true);
  if (req.query.onair === 'false') q.where('astra_channels.onair', false);
  const total = Number((await q.clone().count({ c: '*' }).first()).c);
  const rows = await q.select('astra_channels.*', 'streams.name as stream_name', 'streams.enabled as stream_enabled',
    'streams.delivery_mode as stream_delivery_mode').orderBy('astra_channels.group_name').orderBy('astra_channels.name')
    .limit(limit).offset(offset);
  const groups = await db('astra_channels').where({ source_id: row.id, removed: false }).whereNotNull('group_name')
    .whereNot('group_name', '').distinct('group_name').pluck('group_name');
  res.json({
    data: rows.map((c) => ({
      id: c.id,
      astra_id: c.astra_id,
      name: c.name,
      enabled: bool(c.enabled),
      group: c.group_name || '',
      inputs: parseJson(c.inputs, []),
      outputs: parseJson(c.outputs, []),
      play_url: c.play_url,
      removed: bool(c.removed),
      stream_id: intOrNull(c.stream_id),
      stream_name: c.stream_name || null,
      stream_enabled: c.stream_id ? bool(c.stream_enabled) : null,
      stream_delivery_mode: c.stream_delivery_mode || null,
      onair: c.onair === null || c.onair === undefined ? null : bool(c.onair),
      bitrate_kbps: intOrNull(c.bitrate_kbps),
      cc_errors: intOrNull(c.cc_errors),
      sessions: intOrNull(c.sessions),
      status_checked_at: intOrNull(c.status_checked_at),
      synced_at: Number(c.synced_at),
    })),
    groups: groups.sort(),
    total,
    page,
    limit,
  });
});

/** Importa canales: { channel_ids: [...] } o { all_not_imported: true, group? } + opciones de entrega. */
router.post('/astra/sources/:id/import', async (req, res) => {
  const row = await loadSource(req.params.id);
  const body = req.body || {};
  let ids = idList(body.channel_ids);
  if (bool(body.all_not_imported)) {
    const q = db('astra_channels').where({ source_id: row.id, removed: false }).whereNull('stream_id');
    if (body.group) q.where('group_name', String(body.group));
    ids = await q.pluck('id');
  }
  if (!ids.length) throw new HttpError(400, 'Selecciona al menos un canal');
  const options = importOptions(body.options || {});
  if (bool(body.save_as_default)) {
    await db('astra_sources').where({ id: row.id }).update({ import_defaults: JSON.stringify({ ...importDefaults(row), ...options }) });
  }
  res.json(await importChannels(row, ids, options, req.admin));
});

export default router;
