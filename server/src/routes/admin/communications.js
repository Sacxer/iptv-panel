// Mensajes, avisos y cortes programados.
import { Router } from 'express';
import { db, insertId } from '../../db/index.js';
import { adminOnly } from '../../lib/auth.js';
import { MESSAGE_KINDS } from '../../services/reminders.js';
import { logAction } from '../../lib/log.js';
import {
  HttpError, bool, int, now, oneOf, paging, requireFields,
} from '../../lib/util.js';

const router = Router();
router.use((req, res, next) => (req.method === 'GET' ? next() : adminOnly(req, res, next)));

const intOrNull = (v) => int(v, null);

async function mustExist(table, id, label) {
  const row = await db(table).where({ id: int(id, 0) }).first();
  if (!row) throw new HttpError(404, `${label} no encontrado`);
  return row;
}

async function checkTarget(target, body) {
  if (target === 'user') {
    const userId = int(body.user_id);
    if (!userId || !(await db('users').where({ id: userId }).first())) throw new HttpError(400, 'Usuario destino no válido');
  }
  if (target === 'package') {
    const packageId = int(body.package_id);
    if (!packageId || !(await db('packages').where({ id: packageId }).first())) throw new HttpError(400, 'Paquete destino no válido');
  }
}

/* ---------------------------------- Mensajes ---------------------------------- */

async function serializeMessages(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const reads = await db('message_reads').whereIn('message_id', ids).groupBy('message_id').select('message_id').count({ c: '*' });
  const readMap = new Map(reads.map((r) => [r.message_id, Number(r.c)]));
  const userIds = rows.map((r) => r.user_id).filter(Boolean);
  const pkgIds = rows.map((r) => r.package_id).filter(Boolean);
  const users = new Map((userIds.length ? await db('users').whereIn('id', userIds).select('id', 'username') : []).map((u) => [u.id, u.username]));
  const pkgs = new Map((pkgIds.length ? await db('packages').whereIn('id', pkgIds).select('id', 'name') : []).map((p) => [p.id, p.name]));
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    body: m.body || '',
    target: m.target,
    user_id: intOrNull(m.user_id),
    package_id: intOrNull(m.package_id),
    target_label: m.target === 'user' ? `Cliente: ${users.get(m.user_id) || '?'}`
      : m.target === 'package' ? `Paquete: ${pkgs.get(m.package_id) || '?'}` : 'Todos los clientes',
    expires_at: intOrNull(m.expires_at),
    kind: m.kind || 'general',
    display: m.display || 'inbox',
    reminder_id: intOrNull(m.reminder_id),
    read_count: readMap.get(m.id) || 0,
    created_at: Number(m.created_at),
  }));
}

async function messageFields(body, creating) {
  if (creating) requireFields(body, ['title']);
  const out = {};
  if (body.title !== undefined) out.title = String(body.title).slice(0, 255);
  if (body.body !== undefined) out.body = String(body.body ?? '');
  if (body.expires_at !== undefined) out.expires_at = intOrNull(body.expires_at);
  if (body.kind !== undefined || creating) out.kind = oneOf(body.kind || 'general', MESSAGE_KINDS, 'kind');
  if (body.display !== undefined || creating) out.display = oneOf(body.display || 'inbox', ['inbox', 'popup'], 'display');
  if (body.target !== undefined || creating) {
    out.target = oneOf(body.target || 'all', ['all', 'user', 'package'], 'target');
    await checkTarget(out.target, body);
    out.user_id = out.target === 'user' ? int(body.user_id) : null;
    out.package_id = out.target === 'package' ? int(body.package_id) : null;
  }
  return out;
}

router.get('/messages', async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const base = () => {
    const q = db('messages');
    if (req.query.kind) q.where('kind', String(req.query.kind));
    if (req.query.reminder_id) q.where('reminder_id', int(req.query.reminder_id, 0));
    if (req.query.source === 'reminder') q.whereNotNull('reminder_id');
    if (req.query.source === 'manual') q.whereNull('reminder_id');
    return q;
  };
  const total = Number((await base().count({ c: '*' }).first()).c);
  const rows = await base().orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).offset(offset);
  res.json({ data: await serializeMessages(rows), total, page, limit });
});

router.post('/messages', async (req, res) => {
  const fields = await messageFields(req.body || {}, true);
  const id = await insertId(db, 'messages', { ...fields, created_by: req.admin.id, created_at: now() });
  await logAction(req.admin, 'message.create', 'message', id, { title: fields.title, target: fields.target });
  res.status(201).json((await serializeMessages([await db('messages').where({ id }).first()]))[0]);
});

router.put('/messages/:id', async (req, res) => {
  const row = await mustExist('messages', req.params.id, 'Mensaje');
  const fields = await messageFields({ ...row, ...req.body }, false);
  await db('messages').where({ id: row.id }).update(fields);
  await logAction(req.admin, 'message.update', 'message', row.id, { title: fields.title });
  res.json((await serializeMessages([await db('messages').where({ id: row.id }).first()]))[0]);
});

router.delete('/messages/:id', async (req, res) => {
  const row = await mustExist('messages', req.params.id, 'Mensaje');
  await db('messages').where({ id: row.id }).del();
  await logAction(req.admin, 'message.delete', 'message', row.id, { title: row.title });
  res.json({ ok: true });
});

/* ----------------------------------- Avisos ----------------------------------- */

function serializeNotice(n) {
  return {
    id: n.id,
    title: n.title,
    body: n.body || '',
    level: n.level,
    display: n.display,
    target: n.target,
    package_id: intOrNull(n.package_id),
    starts_at: intOrNull(n.starts_at),
    ends_at: intOrNull(n.ends_at),
    sort_order: int(n.sort_order, 0),
    duration_seconds: intOrNull(n.duration_seconds),
    active: bool(n.active),
    created_at: Number(n.created_at),
  };
}

async function noticeFields(body, creating) {
  if (creating) requireFields(body, ['title']);
  const out = {};
  if (body.title !== undefined) out.title = String(body.title).slice(0, 255);
  if (body.body !== undefined) out.body = String(body.body ?? '');
  if (body.level !== undefined || creating) out.level = oneOf(body.level || 'info', ['info', 'warning', 'critical'], 'level');
  if (body.display !== undefined || creating) out.display = oneOf(body.display || 'banner', ['banner', 'popup', 'ticker'], 'display');
  if (body.target !== undefined || creating) {
    out.target = oneOf(body.target || 'all', ['all', 'package'], 'target');
    await checkTarget(out.target, body);
    out.package_id = out.target === 'package' ? int(body.package_id) : null;
  }
  if (body.starts_at !== undefined) out.starts_at = intOrNull(body.starts_at);
  if (body.ends_at !== undefined) out.ends_at = intOrNull(body.ends_at);
  if (body.active !== undefined) out.active = bool(body.active);
  if (body.sort_order !== undefined) out.sort_order = int(body.sort_order, 0);
  if (body.duration_seconds !== undefined) {
    out.duration_seconds = body.duration_seconds === null || body.duration_seconds === '' ? null : Math.max(3, Math.min(300, int(body.duration_seconds, 8)));
  }
  return out;
}

router.get('/notices', async (_req, res) => {
  res.json((await db('notices').orderBy('sort_order').orderBy('created_at', 'desc')).map(serializeNotice));
});

router.post('/notices', async (req, res) => {
  const fields = await noticeFields(req.body || {}, true);
  const id = await insertId(db, 'notices', { active: true, ...fields, created_at: now() });
  await logAction(req.admin, 'notice.create', 'notice', id, { title: fields.title });
  res.status(201).json(serializeNotice(await db('notices').where({ id }).first()));
});

router.put('/notices/:id', async (req, res) => {
  const row = await mustExist('notices', req.params.id, 'Aviso');
  const body = { ...req.body };
  if (body.package_id === undefined) body.package_id = row.package_id;
  const fields = await noticeFields(body, false);
  await db('notices').where({ id: row.id }).update(fields);
  await logAction(req.admin, 'notice.update', 'notice', row.id, { title: fields.title || row.title });
  res.json(serializeNotice(await db('notices').where({ id: row.id }).first()));
});

router.delete('/notices/:id', async (req, res) => {
  const row = await mustExist('notices', req.params.id, 'Aviso');
  await db('notices').where({ id: row.id }).del();
  await logAction(req.admin, 'notice.delete', 'notice', row.id, { title: row.title });
  res.json({ ok: true });
});

/* ----------------------------------- Cortes ----------------------------------- */

function serializeOutage(o, at = now()) {
  const startsAt = Number(o.starts_at);
  const endsAt = intOrNull(o.ends_at);
  return {
    id: o.id,
    title: o.title,
    reason: o.reason || '',
    scope: o.scope,
    package_id: intOrNull(o.package_id),
    starts_at: startsAt,
    ends_at: endsAt,
    block_playback: bool(o.block_playback),
    active_now: startsAt <= at && (endsAt === null || endsAt > at),
    created_at: Number(o.created_at),
  };
}

async function outageFields(body, creating) {
  if (creating) requireFields(body, ['title']);
  const out = {};
  if (body.title !== undefined) out.title = String(body.title).slice(0, 255);
  if (body.reason !== undefined) out.reason = String(body.reason ?? '');
  if (body.scope !== undefined || creating) {
    out.scope = oneOf(body.scope || 'global', ['global', 'package'], 'scope');
    await checkTarget(out.scope, body);
    out.package_id = out.scope === 'package' ? int(body.package_id) : null;
  }
  if (body.starts_at !== undefined || creating) out.starts_at = int(body.starts_at, now());
  if (body.ends_at !== undefined) out.ends_at = intOrNull(body.ends_at);
  if (out.ends_at && out.starts_at && out.ends_at <= out.starts_at) {
    throw new HttpError(400, 'La fecha de fin debe ser posterior al inicio');
  }
  if (body.block_playback !== undefined) out.block_playback = bool(body.block_playback);
  return out;
}

router.get('/outages', async (_req, res) => {
  const at = now();
  res.json((await db('outages').orderBy('starts_at', 'desc')).map((o) => serializeOutage(o, at)));
});

router.post('/outages', async (req, res) => {
  const fields = await outageFields(req.body || {}, true);
  const id = await insertId(db, 'outages', { block_playback: true, ...fields, created_at: now() });
  await logAction(req.admin, 'outage.create', 'outage', id, { title: fields.title, scope: fields.scope });
  res.status(201).json(serializeOutage(await db('outages').where({ id }).first()));
});

router.put('/outages/:id', async (req, res) => {
  const row = await mustExist('outages', req.params.id, 'Corte');
  const body = { ...req.body };
  if (body.package_id === undefined) body.package_id = row.package_id;
  const fields = await outageFields(body, false);
  const merged = { ...row, ...fields };
  if (merged.ends_at && Number(merged.ends_at) <= Number(merged.starts_at)) {
    throw new HttpError(400, 'La fecha de fin debe ser posterior al inicio');
  }
  await db('outages').where({ id: row.id }).update(fields);
  await logAction(req.admin, 'outage.update', 'outage', row.id, { title: fields.title || row.title });
  res.json(serializeOutage(await db('outages').where({ id: row.id }).first()));
});

router.delete('/outages/:id', async (req, res) => {
  const row = await mustExist('outages', req.params.id, 'Corte');
  await db('outages').where({ id: row.id }).del();
  await logAction(req.admin, 'outage.delete', 'outage', row.id, { title: row.title });
  res.json({ ok: true });
});

export default router;
