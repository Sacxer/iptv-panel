// EPG: fuentes XMLTV, emparejamiento de canales y guía combinada.
import { Router } from 'express';
import { db, insertId, whereSearch } from '../../db/index.js';
import { adminOnly } from '../../lib/auth.js';
import { logAction } from '../../lib/log.js';
import {
  HttpError, bool, int, now, paging, parseJson, requireFields,
} from '../../lib/util.js';
import {
  buildGuide, guideStatus, isRefreshing, matchStreams, normalizeChannelName, refreshAll, refreshSource,
} from '../../services/epg.js';

const router = Router();
router.use(adminOnly);

const intOrNull = (v) => int(v, null);

function serializeSource(s) {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    enabled: bool(s.enabled),
    priority: Number(s.priority),
    status: isRefreshing(s.id) ? 'refreshing' : s.status,
    last_error: s.last_error || null,
    channel_count: Number(s.channel_count),
    programme_count: Number(s.programme_count),
    first_programme_at: intOrNull(s.first_programme_at),
    last_programme_at: intOrNull(s.last_programme_at),
    current_programmes: Number(s.current_programmes || 0),
    // outdated: la guía no cubre el momento actual (sirve para emparejar canales, pero no muestra la programación de hoy)
    outdated: Number(s.programme_count) > 0 && (!s.last_programme_at || Number(s.last_programme_at) < now()),
    last_fetch_at: intOrNull(s.last_fetch_at),
    created_at: Number(s.created_at),
  };
}

function sourceFields(body, creating) {
  if (creating) requireFields(body, ['url']);
  const out = {};
  if (body.url !== undefined) {
    const url = String(body.url).trim();
    if (!/^https?:\/\//i.test(url)) throw new HttpError(400, 'La URL de la guía debe empezar por http:// o https://');
    out.url = url;
  }
  if (body.name !== undefined || creating) {
    out.name = String(body.name || '').trim().slice(0, 100) || (() => {
      try {
        return new URL(out.url).hostname;
      } catch {
        return 'Guía EPG';
      }
    })();
  }
  if (body.enabled !== undefined) out.enabled = bool(body.enabled);
  if (body.priority !== undefined) out.priority = int(body.priority, 0);
  return out;
}

async function status() {
  const sources = await db('epg_sources').orderBy('priority').orderBy('id');
  const count = async (q) => Number((await q.count({ c: '*' }).first()).c);
  const live = () => db('streams').where({ type: 'live' });
  return {
    sources: sources.map(serializeSource),
    guide: guideStatus(),
    streams: {
      live: await count(live()),
      with_epg: await count(live().whereNotNull('epg_channel_id').whereNot('epg_channel_id', '')),
      without_epg: await count(live().where((w) => w.whereNull('epg_channel_id').orWhere('epg_channel_id', ''))),
      locked: await count(live().where('epg_locked', true)),
    },
    epg_channels: await count(db('epg_channels')),
  };
}

router.get('/epg/status', async (_req, res) => res.json(await status()));

router.post('/epg/sources', async (req, res) => {
  const t = now();
  const id = await insertId(db, 'epg_sources', { ...sourceFields(req.body || {}, true), created_at: t, updated_at: t });
  const source = await db('epg_sources').where({ id }).first();
  await logAction(req.admin, 'epg.source.create', 'epg', id, { name: source.name });
  if (bool(req.query.wait)) {
    await refreshSource(source).catch(() => {}); // el error queda guardado en la fuente (status/last_error)
    return res.status(201).json(serializeSource(await db('epg_sources').where({ id }).first()));
  }
  refreshSource(source).catch(() => {}); // en segundo plano: una guía puede tardar
  return res.status(201).json(serializeSource({ ...source, status: 'refreshing' }));
});

router.put('/epg/sources/:id', async (req, res) => {
  const row = await db('epg_sources').where({ id: int(req.params.id, 0) }).first();
  if (!row) throw new HttpError(404, 'Fuente EPG no encontrada');
  const fields = sourceFields(req.body || {}, false);
  if (Object.keys(fields).length) await db('epg_sources').where({ id: row.id }).update({ ...fields, updated_at: now() });
  await logAction(req.admin, 'epg.source.update', 'epg', row.id, fields);
  res.json(serializeSource(await db('epg_sources').where({ id: row.id }).first()));
});

router.delete('/epg/sources/:id', async (req, res) => {
  const row = await db('epg_sources').where({ id: int(req.params.id, 0) }).first();
  if (!row) throw new HttpError(404, 'Fuente EPG no encontrada');
  await db('epg_sources').where({ id: row.id }).del();
  await logAction(req.admin, 'epg.source.delete', 'epg', row.id, { name: row.name });
  res.json({ ok: true });
});

/** Actualiza una fuente. Con ?wait=true espera el resultado (útil para fuentes pequeñas y pruebas). */
router.post('/epg/sources/:id/refresh', async (req, res) => {
  const row = await db('epg_sources').where({ id: int(req.params.id, 0) }).first();
  if (!row) throw new HttpError(404, 'Fuente EPG no encontrada');
  if (bool(req.query.wait)) {
    const result = await refreshSource(row);
    return res.json({ ...result, source: serializeSource(await db('epg_sources').where({ id: row.id }).first()) });
  }
  refreshSource(row).catch(() => {});
  return res.status(202).json(serializeSource({ ...row, status: 'refreshing' }));
});

router.post('/epg/refresh-all', async (req, res) => {
  if (bool(req.query.wait)) return res.json(await refreshAll({ admin: req.admin }));
  refreshAll({ admin: req.admin }).catch((err) => console.error('EPG:', err.message));
  return res.status(202).json({ ok: true });
});

router.get('/epg/channels', async (req, res) => {
  const { page, limit, offset } = paging(req.query, 50);
  const q = db('epg_channels').join('epg_sources', 'epg_sources.id', 'epg_channels.source_id');
  if (req.query.source_id) q.where('epg_channels.source_id', int(req.query.source_id, 0));
  if (req.query.search) {
    const term = String(req.query.search);
    q.where((w) => {
      whereSearch(w, ['epg_channels.xmltv_id', 'epg_channels.display_names'], term);
      w.orWhere('epg_channels.search_text', 'like', `%${normalizeChannelName(term)}%`);
    });
  }
  const total = Number((await q.clone().count({ c: '*' }).first()).c);
  const rows = await q.select('epg_channels.*', 'epg_sources.name as source_name').orderBy('epg_channels.xmltv_id').limit(limit).offset(offset);
  const used = new Map((await db('streams').whereIn('epg_channel_id', rows.map((r) => r.xmltv_id))
    .groupBy('epg_channel_id').select('epg_channel_id').count({ c: '*' })).map((u) => [u.epg_channel_id, Number(u.c)]));
  res.json({
    data: rows.map((r) => ({
      id: r.id, xmltv_id: r.xmltv_id, display_names: parseJson(r.display_names, []), icon: r.icon || '', country: r.country || '',
      source_id: r.source_id, source_name: r.source_name, used_by: used.get(r.xmltv_id) || 0,
    })),
    total, page, limit,
  });
});

/** Empareja canales con la guía (simulación o aplicado). */
router.post('/epg/match', async (req, res) => {
  res.json(await matchStreams(req.body || {}, req.admin));
});

/** Asigna a mano (o quita con xmltv_id null) el ID EPG de un canal; queda bloqueado frente al emparejamiento automático. */
router.post('/epg/assign', async (req, res) => {
  const streamId = int(req.body?.stream_id, 0);
  const stream = await db('streams').where({ id: streamId }).first();
  if (!stream) throw new HttpError(404, 'Canal no encontrado');
  const xmltvId = req.body?.xmltv_id ? String(req.body.xmltv_id).trim().slice(0, 255) : null;
  const patch = {
    epg_channel_id: xmltvId || '', epg_locked: req.body?.locked === undefined ? Boolean(xmltvId) : bool(req.body.locked),
    epg_match_score: xmltvId ? 100 : null, epg_matched_at: now(), updated_at: now(),
  };
  if (xmltvId && bool(req.body?.fill_logo) && !stream.logo) {
    const ch = await db('epg_channels').where({ xmltv_id: xmltvId }).whereNotNull('icon').first();
    if (ch?.icon) patch.logo = ch.icon;
  }
  await db('streams').where({ id: stream.id }).update(patch);
  await logAction(req.admin, 'epg.assign', 'stream', stream.id, { xmltv_id: xmltvId });
  res.json({ ok: true, stream_id: stream.id, epg_channel_id: patch.epg_channel_id, epg_locked: patch.epg_locked });
});

router.post('/epg/guide/build', async (req, res) => {
  if (bool(req.query.wait)) return res.json(await buildGuide());
  buildGuide().catch((err) => console.error('EPG guía:', err.message));
  return res.status(202).json(guideStatus());
});

export default router;
