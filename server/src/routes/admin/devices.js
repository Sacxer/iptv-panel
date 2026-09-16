// Dispositivos: inventario, detección automática, asignación a clientes y alertas.
import { Router } from 'express';
import { db, insertId, whereSearch } from '../../db/index.js';
import { adminOnly, isReseller } from '../../lib/auth.js';
import { DEVICE_TYPES } from '../../lib/deviceDetect.js';
import { logAction } from '../../lib/log.js';
import { getSettings } from '../../lib/settings.js';
import {
  HttpError, bool, int, now, oneOf, paging,
} from '../../lib/util.js';
import {
  TYPE_LABEL, findDuplicateGroups, lastDeviceCheck, mergeDevices, orphanDevicesQuery, runInactivityCheck,
} from '../../services/devices.js';

const router = Router();
const OWNERSHIP = ['company', 'client', 'unknown'];
const INVENTORY = ['available', 'assigned', 'review', 'retired'];

const intOrNull = (v) => int(v, null);

/** Dispositivos visibles: los revendedores solo ven los de sus clientes. */
function visibleDevices(req) {
  const q = db('devices');
  if (isReseller(req)) q.whereIn('devices.user_id', db('users').where('owner_id', req.admin.id).select('id'));
  return q;
}

async function serializeDevices(rows) {
  if (!rows.length) return [];
  const settings = await getSettings();
  const onlineSince = now() - Math.max(1, Number(settings.device_online_minutes) || 10) * 60;
  const inactiveSince = now() - Math.max(1, Number(settings.device_inactive_days) || 30) * 86400;
  const userIds = [...new Set(rows.flatMap((d) => [d.user_id, d.last_user_id]).filter(Boolean))];
  const users = new Map((userIds.length ? await db('users').whereIn('id', userIds).select('id', 'username', 'full_name') : [])
    .map((u) => [u.id, u]));
  const alerts = await db('device_alerts').whereIn('device_id', rows.map((d) => d.id)).where('status', 'open')
    .groupBy('device_id').select('device_id').count({ c: '*' });
  const alertMap = new Map(alerts.map((a) => [a.device_id, Number(a.c)]));

  return rows.map((d) => {
    const lastSeen = intOrNull(d.last_seen_at);
    const owner = users.get(d.user_id);
    return {
      id: d.id,
      name: d.name || '',
      display_name: d.name || [d.brand, d.model].filter(Boolean).join(' ') || TYPE_LABEL[d.type],
      type: d.type,
      type_label: TYPE_LABEL[d.type] || d.type,
      type_locked: bool(d.type_locked),
      brand: d.brand || '',
      model: d.model || '',
      os: d.os || '',
      app: d.app || '',
      app_version: d.app_version || '',
      app_build: intOrNull(d.app_build),
      app_distribution: d.app_distribution || '',
      mac: d.mac || '',
      serial: d.serial || '',
      device_id: d.uid?.startsWith('id:') ? d.uid.slice(3) : '',
      user_agent: d.user_agent || '',
      ownership: d.ownership,
      inventory_status: d.inventory_status,
      user_id: intOrNull(d.user_id),
      username: owner?.username || null,
      client_name: owner?.full_name || null,
      last_user_id: intOrNull(d.last_user_id),
      last_username: users.get(d.last_user_id)?.username || null,
      source: d.source,
      notes: d.notes || '',
      last_ip: d.last_ip || null,
      last_activity: d.last_activity || null,
      first_seen_at: intOrNull(d.first_seen_at),
      last_seen_at: lastSeen,
      online: lastSeen !== null && lastSeen >= onlineSince,
      inactive: d.inventory_status !== 'retired' && d.inventory_status !== 'available'
        && Number(lastSeen ?? d.created_at) < inactiveSince,
      open_alerts: alertMap.get(d.id) || 0,
      created_at: Number(d.created_at),
    };
  });
}

async function loadDevice(req, id) {
  const device = await visibleDevices(req).where('devices.id', int(id, 0)).first();
  if (!device) throw new HttpError(404, 'Dispositivo no encontrado');
  return device;
}

async function deviceFields(body, current = null) {
  const out = {};
  for (const f of ['name', 'brand', 'model', 'os', 'serial', 'notes']) {
    if (body[f] !== undefined) out[f] = body[f] === null ? null : String(body[f]).trim().slice(0, f === 'notes' ? 5000 : 255);
  }
  if (body.mac !== undefined) {
    const mac = String(body.mac || '').trim().toUpperCase();
    if (mac && !/^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/.test(mac)) throw new HttpError(400, 'MAC inválida (formato AA:BB:CC:DD:EE:FF)');
    out.mac = mac ? mac.replace(/-/g, ':') : null;
  }
  if (body.device_id !== undefined) {
    const value = String(body.device_id || '').trim();
    out.uid = value ? `id:${value}`.slice(0, 128) : (current?.uid?.startsWith('id:') ? null : current?.uid ?? null);
    if (out.uid) {
      const clash = await db('devices').where({ uid: out.uid }).first();
      if (clash && clash.id !== current?.id) throw new HttpError(409, `Ese ID ya pertenece al dispositivo #${clash.id}`);
    }
  }
  if (body.type !== undefined) {
    out.type = oneOf(body.type, DEVICE_TYPES, 'type');
    out.type_locked = true; // un tipo elegido a mano no lo cambia la detección automática
  }
  if (body.ownership !== undefined) out.ownership = oneOf(body.ownership, OWNERSHIP, 'ownership');
  if (body.inventory_status !== undefined) out.inventory_status = oneOf(body.inventory_status, INVENTORY, 'inventory_status');
  if (body.user_id !== undefined) {
    const userId = intOrNull(body.user_id);
    if (userId !== null && !(await db('users').where({ id: userId }).first())) throw new HttpError(400, 'Cliente no válido');
    out.user_id = userId;
    if (out.inventory_status === undefined) {
      const status = current?.inventory_status;
      if (userId && (!status || status === 'available')) out.inventory_status = 'assigned';
      if (!userId && status === 'assigned') out.inventory_status = 'available';
    }
  }
  return out;
}

/* ------------------------------------ Listado ------------------------------------ */

/** Aplica los filtros del listado (los mismos para listar, obtener IDs y acciones en lote por filtro). */
function applyDeviceFilters(q, query, settings) {
  const t = now();
  if (query.search && String(query.search).trim()) {
    const term = String(query.search).trim();
    q.where((w) => {
      whereSearch(w, ['devices.name', 'devices.brand', 'devices.model', 'devices.mac', 'devices.serial', 'devices.last_ip', 'devices.app', 'devices.uid'], term);
      w.orWhereIn('devices.user_id', whereSearch(db('users').select('id'), ['username', 'full_name'], term));
    });
  }
  if (query.type) q.where('devices.type', String(query.type));
  if (query.ownership) q.where('devices.ownership', String(query.ownership));
  if (query.inventory_status) q.where('devices.inventory_status', String(query.inventory_status));
  if (query.user_id) q.where('devices.user_id', int(query.user_id, 0));
  if (String(query.unassigned) === 'true') q.whereNull('devices.user_id');
  if (query.source) q.where('devices.source', String(query.source));
  if (String(query.online) === 'true') q.where('devices.last_seen_at', '>=', t - settings.device_online_minutes * 60);
  if (String(query.inactive) === 'true') {
    const limitTs = t - settings.device_inactive_days * 86400;
    q.whereNotIn('devices.inventory_status', ['retired', 'available'])
      .where((w) => w.where('devices.last_seen_at', '<', limitTs)
        .orWhere((x) => x.whereNull('devices.last_seen_at').where('devices.created_at', '<', limitTs)));
  }
  if (String(query.with_alerts) === 'true') {
    q.whereExists(db('device_alerts').whereRaw('device_alerts.device_id = devices.id').where('status', 'open'));
  }
  return q;
}

router.get('/devices', async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const settings = await getSettings();
  const q = applyDeviceFilters(visibleDevices(req), req.query, settings);
  const total = Number((await q.clone().count({ c: '*' }).first()).c);
  const sort = ['last_seen_at', 'created_at', 'type'].includes(req.query.sort) ? req.query.sort : 'last_seen_at';
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  const rows = await q.select('devices.*').orderByRaw(`devices.${sort} IS NULL`).orderBy(`devices.${sort}`, order)
    .orderBy('devices.id', 'desc').limit(limit).offset(offset);
  res.json({ data: await serializeDevices(rows), total, page, limit });
});

const MAX_SELECTION = 50000;

/** IDs de todos los dispositivos que coinciden con los filtros (para "seleccionar todos"). */
router.get('/devices/ids', async (req, res) => {
  const settings = await getSettings();
  const q = applyDeviceFilters(visibleDevices(req), req.query, settings);
  const total = Number((await q.clone().count({ c: '*' }).first()).c);
  const ids = await q.orderBy('devices.id').limit(MAX_SELECTION).pluck('devices.id');
  res.json({ ids, total, truncated: total > ids.length });
});

/**
 * Acciones en lote sobre `ids` o sobre todos los que coinciden con `filter` (mismos parámetros que el listado).
 * action: delete | set_ownership | set_inventory | set_type | unassign | resolve_alerts
 */
router.post('/devices/bulk', adminOnly, async (req, res) => {
  const body = req.body || {};
  const action = oneOf(body.action, ['delete', 'set_ownership', 'set_inventory', 'set_type', 'unassign', 'resolve_alerts'], 'action');
  const settings = await getSettings();
  let ids;
  if (body.filter && typeof body.filter === 'object') {
    ids = await applyDeviceFilters(visibleDevices(req), body.filter, settings).limit(MAX_SELECTION).pluck('devices.id');
  } else {
    const wanted = Array.isArray(body.ids) ? body.ids.map((x) => int(x, 0)).filter(Boolean) : [];
    if (!wanted.length) throw new HttpError(400, 'Envía ids o filter');
    ids = await visibleDevices(req).whereIn('devices.id', wanted.slice(0, MAX_SELECTION)).pluck('devices.id');
  }
  if (!ids.length) return res.json({ affected: 0 });
  let patch = null;
  if (action === 'set_ownership') patch = { ownership: oneOf(body.value, OWNERSHIP, 'value') };
  if (action === 'set_inventory') patch = { inventory_status: oneOf(body.value, INVENTORY, 'value') };
  if (action === 'set_type') patch = { type: oneOf(body.value, DEVICE_TYPES, 'value'), type_locked: true };

  const t = now();
  let affected = 0;
  await db.transaction(async (trx) => {
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      if (action === 'delete') affected += await trx('devices').whereIn('id', part).del();
      else if (action === 'unassign') {
        affected += await trx('devices').whereIn('id', part).update({ user_id: null, updated_at: t });
        await trx('devices').whereIn('id', part).where('inventory_status', 'assigned').update({ inventory_status: 'available' });
      } else if (action === 'resolve_alerts') {
        affected += await trx('device_alerts').whereIn('device_id', part).where('status', 'open')
          .update({ status: 'resolved', resolution: String(body.value || 'Revisado en lote').slice(0, 255), resolved_by: req.admin.id, resolved_at: t });
      } else {
        affected += await trx('devices').whereIn('id', part).update({ ...patch, updated_at: t });
      }
    }
  });
  await logAction(req.admin, `device.bulk.${action}`, 'device', null, {
    count: ids.length, affected, value: body.value, by_filter: Boolean(body.filter),
  });
  res.json({ affected, selected: ids.length });
});

router.get('/devices/stats', async (req, res) => {
  const settings = await getSettings();
  const t = now();
  const count = async (fn) => Number((await fn(visibleDevices(req)).count({ c: '*' }).first()).c);
  const byType = await visibleDevices(req).whereNot('inventory_status', 'retired')
    .groupBy('type').select('type').count({ c: '*' });
  const limitTs = t - settings.device_inactive_days * 86400;
  const alertsQ = db('device_alerts').where('status', 'open');
  if (isReseller(req)) alertsQ.whereIn('device_id', visibleDevices(req).select('id'));
  res.json({
    total: await count((q) => q.whereNot('inventory_status', 'retired')),
    online: await count((q) => q.where('last_seen_at', '>=', t - settings.device_online_minutes * 60)),
    inactive: await count((q) => q.whereNotIn('inventory_status', ['retired', 'available'])
      .where((w) => w.where('last_seen_at', '<', limitTs).orWhere((x) => x.whereNull('last_seen_at').where('created_at', '<', limitTs)))),
    company_tvbox: await count((q) => q.where({ type: 'tvbox', ownership: 'company' }).whereNot('inventory_status', 'retired')),
    in_stock: await count((q) => q.where('inventory_status', 'available')),
    unassigned: await count((q) => q.whereNull('user_id').whereNot('inventory_status', 'retired')),
    open_alerts: Number((await alertsQ.count({ c: '*' }).first()).c),
    by_type: Object.fromEntries(DEVICE_TYPES.map((type) => [type, Number(byType.find((r) => r.type === type)?.c || 0)])),
    last_check_at: lastDeviceCheck(),
    settings: {
      device_online_minutes: settings.device_online_minutes,
      device_inactive_days: settings.device_inactive_days,
      device_check_interval_minutes: settings.device_check_interval_minutes,
    },
  });
});

router.post('/devices/check', adminOnly, async (req, res) => {
  const result = await runInactivityCheck();
  await logAction(req.admin, 'device.check', 'device', null, result);
  res.json(result);
});

/* ------------------------------- Duplicados y limpieza ------------------------------- */

router.get('/devices/duplicates', adminOnly, async (_req, res) => {
  const groups = await findDuplicateGroups();
  const ids = [...new Set(groups.flatMap((g) => g.device_ids))];
  const rows = ids.length ? await db('devices').whereIn('id', ids) : [];
  const serialized = new Map((await serializeDevices(rows)).map((d) => [d.id, d]));
  const orphans = Number((await orphanDevicesQuery().count({ c: '*' }).first()).c);
  res.json({
    groups: groups.map((g) => ({ ...g, devices: g.device_ids.map((id) => serialized.get(id)).filter(Boolean) })),
    duplicate_devices: groups.reduce((n, g) => n + g.device_ids.length - 1, 0),
    orphans,
  });
});

router.post('/devices/merge', adminOnly, async (req, res) => {
  const targetId = int(req.body?.target_id, 0);
  const sourceIds = Array.isArray(req.body?.source_ids) ? req.body.source_ids.map((x) => int(x, 0)).filter(Boolean) : [];
  if (!targetId || !sourceIds.length) throw new HttpError(400, 'Indica target_id y source_ids');
  await loadDevice(req, targetId);
  const result = await mergeDevices(targetId, sourceIds);
  await logAction(req.admin, 'device.merge', 'device', targetId, { source_ids: sourceIds, ...result });
  res.json({ ...result, device: (await serializeDevices([await db('devices').where({ id: targetId }).first()]))[0] });
});

/** Fusiona automáticamente todos los grupos de duplicados (conservando el registro más completo). */
router.post('/devices/dedupe', adminOnly, async (req, res) => {
  const groups = await findDuplicateGroups();
  const dryRun = bool(req.body?.dry_run);
  let merged = 0;
  if (!dryRun) {
    for (const g of groups) merged += (await mergeDevices(g.target_id, g.device_ids.filter((id) => id !== g.target_id))).merged;
    await logAction(req.admin, 'device.dedupe', 'device', null, { groups: groups.length, merged });
  }
  res.json({ dry_run: dryRun, groups: groups.length, merged: dryRun ? groups.reduce((n, g) => n + g.device_ids.length - 1, 0) : merged });
});

/** Borra equipos detectados automáticamente cuyo cliente ya no existe. */
router.post('/devices/cleanup-orphans', adminOnly, async (req, res) => {
  const dryRun = bool(req.body?.dry_run);
  const count = Number((await orphanDevicesQuery().count({ c: '*' }).first()).c);
  let deleted = 0;
  if (!dryRun && count) {
    deleted = await orphanDevicesQuery().del();
    await logAction(req.admin, 'device.cleanup_orphans', 'device', null, { deleted });
  }
  res.json({ dry_run: dryRun, orphans: count, deleted });
});

/* ------------------------------------- Alertas ------------------------------------- */

router.get('/devices/alerts', async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const q = db('device_alerts').join('devices', 'devices.id', 'device_alerts.device_id')
    .leftJoin('users', 'users.id', 'device_alerts.user_id');
  if (isReseller(req)) q.whereIn('device_alerts.device_id', visibleDevices(req).select('id'));
  if (req.query.status !== 'all') q.where('device_alerts.status', req.query.status === 'resolved' ? 'resolved' : 'open');
  if (req.query.type) q.where('device_alerts.type', String(req.query.type));
  if (req.query.device_id) q.where('device_alerts.device_id', int(req.query.device_id, 0));
  const total = Number((await q.clone().count({ c: '*' }).first()).c);
  const rows = await q.select(
    'device_alerts.*', 'users.username', 'devices.name as device_name', 'devices.brand', 'devices.model', 'devices.type as device_type',
  ).orderBy('device_alerts.created_at', 'desc').orderBy('device_alerts.id', 'desc').limit(limit).offset(offset);
  res.json({
    data: rows.map((a) => ({
      id: a.id,
      device_id: a.device_id,
      device_name: a.device_name || [a.brand, a.model].filter(Boolean).join(' ') || TYPE_LABEL[a.device_type],
      device_type: a.device_type,
      user_id: intOrNull(a.user_id),
      username: a.username || null,
      type: a.type,
      message: a.message || '',
      status: a.status,
      resolution: a.resolution || null,
      created_at: Number(a.created_at),
      resolved_at: intOrNull(a.resolved_at),
    })),
    total, page, limit,
  });
});

router.post('/devices/alerts/:id/resolve', adminOnly, async (req, res) => {
  const alert = await db('device_alerts').where({ id: int(req.params.id, 0) }).first();
  if (!alert) throw new HttpError(404, 'Alerta no encontrada');
  await db('device_alerts').where({ id: alert.id }).update({
    status: 'resolved', resolution: String(req.body?.resolution || 'Revisado').slice(0, 255),
    resolved_by: req.admin.id, resolved_at: now(),
  });
  await logAction(req.admin, 'device.alert.resolve', 'device', alert.device_id, { alert: alert.id, type: alert.type });
  res.json({ ok: true });
});

/* ------------------------------- CRUD de dispositivos ------------------------------- */

router.post('/devices', adminOnly, async (req, res) => {
  const body = req.body || {};
  const fields = await deviceFields(body);
  if (!fields.name && !fields.model && !fields.mac && !fields.serial && !fields.uid) {
    throw new HttpError(400, 'Indica al menos nombre, modelo, MAC, serial o ID del dispositivo');
  }
  const t = now();
  const id = await insertId(db, 'devices', {
    type: 'tvbox',
    ownership: 'company',
    inventory_status: fields.user_id ? 'assigned' : 'available',
    ...fields,
    type_locked: true,
    source: 'manual',
    created_at: t,
    updated_at: t,
  });
  await logAction(req.admin, 'device.create', 'device', id, { name: fields.name, user_id: fields.user_id });
  res.status(201).json((await serializeDevices([await db('devices').where({ id }).first()]))[0]);
});

router.get('/devices/:id', async (req, res) => {
  res.json((await serializeDevices([await loadDevice(req, req.params.id)]))[0]);
});

router.put('/devices/:id', adminOnly, async (req, res) => {
  const device = await loadDevice(req, req.params.id);
  const fields = await deviceFields(req.body || {}, device);
  if (Object.keys(fields).length) await db('devices').where({ id: device.id }).update({ ...fields, updated_at: now() });
  await logAction(req.admin, 'device.update', 'device', device.id, { ...fields, notes: undefined });
  res.json((await serializeDevices([await db('devices').where({ id: device.id }).first()]))[0]);
});

router.post('/devices/:id/assign', adminOnly, async (req, res) => {
  const device = await loadDevice(req, req.params.id);
  const fields = await deviceFields({ user_id: req.body?.user_id ?? null }, device);
  await db('devices').where({ id: device.id }).update({ ...fields, updated_at: now() });
  if (fields.user_id) {
    await db('device_alerts').where({ device_id: device.id, status: 'open' }).whereIn('type', ['new_tvbox', 'foreign_user'])
      .update({ status: 'resolved', resolution: 'Dispositivo asignado', resolved_by: req.admin.id, resolved_at: now() });
  }
  await logAction(req.admin, fields.user_id ? 'device.assign' : 'device.unassign', 'device', device.id, { user_id: fields.user_id });
  res.json((await serializeDevices([await db('devices').where({ id: device.id }).first()]))[0]);
});

router.delete('/devices/:id', adminOnly, async (req, res) => {
  const device = await loadDevice(req, req.params.id);
  await db('devices').where({ id: device.id }).del();
  await logAction(req.admin, 'device.delete', 'device', device.id, { name: device.name, model: device.model });
  res.json({ ok: true });
});

export default router;
