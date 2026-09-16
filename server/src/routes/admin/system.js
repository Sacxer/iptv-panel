// Sesión, panel, conexiones, administradores, ajustes y registro.
import { Router } from 'express';
import { db, insertId } from '../../db/index.js';
import {
  adminOnly, createAttemptLimiter, hashPassword, isReseller, requireAdmin, signToken, verifyPassword,
} from '../../lib/auth.js';
import { clientIp } from '../../lib/access.js';
import { EXACT_MODES, dropConnection } from '../../services/streaming.js';
import { logAction } from '../../lib/log.js';
import { serializeUsers } from '../../lib/serialize.js';
import { getSettings, publicSettings, saveSettings } from '../../lib/settings.js';
import { healthStatus, healthSummary } from '../../services/streamHealth.js';
import { getMetrics } from '../../services/systemMetrics.js';
import { backupOverview } from '../../services/backup.js';
import { activeClientPorts } from '../../services/listeners.js';
import { currentBuild, lastCheck } from '../../services/githubUpdates.js';
import { interfaceOfUrl, localPorts } from '../../services/ipFollow.js';
import {
  detectPublicIp, listListeningPorts, listNetworkPorts, publicBaseUrl, suggestPublicUrls,
} from '../../services/network.js';
import { config as appConfig } from '../../config.js';
import {
  HttpError, bool, int, now, oneOf, paging, requireFields,
} from '../../lib/util.js';

export const authRouter = Router();
const loginLimiter = createAttemptLimiter({ max: 8, windowSeconds: 900 });

authRouter.post('/login', async (req, res) => {
  requireFields(req.body, ['username', 'password']);
  const ip = clientIp(req);
  loginLimiter.check(ip);
  const admin = await db('admins').where({ username: String(req.body.username) }).first();
  if (!admin || !bool(admin.enabled) || !(await verifyPassword(req.body.password, admin.password_hash))) {
    loginLimiter.fail(ip);
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }
  loginLimiter.reset(ip);
  await logAction(admin, 'auth.login', 'admin', admin.id, { ip });
  res.json({ token: signToken(admin), admin: { id: admin.id, username: admin.username, role: admin.role } });
});

authRouter.get('/me', requireAdmin, (req, res) => res.json(req.admin));

authRouter.post('/password', requireAdmin, async (req, res) => {
  requireFields(req.body, ['current_password', 'new_password']);
  const admin = await db('admins').where({ id: req.admin.id }).first();
  if (!(await verifyPassword(req.body.current_password, admin.password_hash))) {
    throw new HttpError(400, 'La contraseña actual no es correcta');
  }
  if (String(req.body.new_password).length < 8) throw new HttpError(400, 'La nueva contraseña debe tener al menos 8 caracteres');
  await db('admins').where({ id: admin.id }).update({ password_hash: await hashPassword(req.body.new_password) });
  await logAction(req.admin, 'auth.password_change', 'admin', admin.id);
  res.json({ ok: true });
});

export const systemRouter = Router();

/* ------------------------------------ Panel ------------------------------------ */

systemRouter.get('/dashboard', async (req, res) => {
  const t = now();
  const settings = await getSettings();
  const users = () => {
    const q = db('users');
    if (isReseller(req)) q.where('owner_id', req.admin.id);
    return q;
  };
  const count = async (q) => Number((await q.count({ c: '*' }).first()).c);
  const active = (q) => q.where('suspended', false).where('enabled', true);

  const [total, activeCount, expired, suspended, disabled, trial, expiring] = await Promise.all([
    count(users()),
    count(active(users()).where((w) => w.whereNull('exp_date').orWhere('exp_date', '>', t))),
    count(active(users()).whereNotNull('exp_date').where('exp_date', '<=', t)),
    count(users().where('suspended', true)),
    count(users().where('suspended', false).where('enabled', false)),
    count(users().where('is_trial', true)),
    count(active(users()).where('exp_date', '>', t).where('exp_date', '<=', t + 7 * 86400)),
  ]);
  const byType = await db('streams').groupBy('type').select('type').count({ c: '*' });
  const typeCount = Object.fromEntries(byType.map((r) => [r.type, Number(r.c)]));

  const connQ = db('connections').where('last_seen_at', '>=', t - settings.connection_timeout_seconds);
  if (isReseller(req)) connQ.whereIn('user_id', users().select('id'));

  const expiringRows = await active(users())
    .where('exp_date', '>', t).where('exp_date', '<=', t + 7 * 86400).orderBy('exp_date').limit(10);

  res.json({
    users: { total, active: activeCount, expired, suspended, disabled, trial, expiring_7d: expiring },
    content: {
      live: typeCount.live || 0,
      movie: typeCount.movie || 0,
      episodes: typeCount.episode || 0,
      series: await count(db('series')),
      categories: await count(db('categories')),
      packages: await count(db('packages')),
    },
    active_connections: await count(connQ),
    devices: {
      online: await count(db('devices').where('last_seen_at', '>=', t - settings.device_online_minutes * 60)
        .modify((q) => { if (isReseller(req)) q.whereIn('user_id', users().select('id')); })),
      total: await count(db('devices').whereNot('inventory_status', 'retired')
        .modify((q) => { if (isReseller(req)) q.whereIn('user_id', users().select('id')); })),
      open_alerts: await count(db('device_alerts').where('status', 'open')
        .modify((q) => { if (isReseller(req)) q.whereIn('device_id', db('devices').whereIn('user_id', users().select('id')).select('id')); })),
    },
    content_health: await healthSummary(),
    stream_check: await healthStatus().then((h) => ({ running: h.running, last_result: h.last_result })),
    offline_streams: (await db('streams').leftJoin('categories', 'categories.id', 'streams.category_id')
      .whereIn('streams.type', ['live', 'movie']).where('streams.enabled', true).where('streams.health_status', 'offline')
      .orderBy('streams.health_down_since', 'desc').limit(8)
      .select('streams.id', 'streams.type', 'streams.name', 'streams.logo', 'streams.health_error', 'streams.health_checked_at',
        'streams.health_down_since', 'categories.name as category_name'))
      .map((s) => ({
        id: s.id, type: s.type, name: s.name, logo: s.logo || '', category_name: s.category_name || null,
        health_error: s.health_error || null, health_checked_at: s.health_checked_at ? Number(s.health_checked_at) : null,
        down_since: s.health_down_since ? Number(s.health_down_since) : null,
      })),
    active_outages: await count(
      db('outages').where('starts_at', '<=', t).where((w) => w.whereNull('ends_at').orWhere('ends_at', '>', t)),
    ),
    expiring_soon: await serializeUsers(expiringRows),
    backups: isReseller(req) ? null : await backupOverview(),
    updates: isReseller(req) ? null : await (async () => {
      const last = await lastCheck();
      return {
        version: currentBuild().version,
        checked_at: last?.checked_at || null,
        panel_update_available: last?.panel?.update_available ?? null,
        app_latest: last?.app?.latest?.version_name || null,
        app_update_pending: Boolean(last?.app?.latest && !last?.app?.imported),
      };
    })(),
    recent_logs: isReseller(req) ? [] : (await db('logs').orderBy('id', 'desc').limit(6)).map(serializeLog),
  });
});

/* ---------------------------------- Conexiones ---------------------------------- */

systemRouter.get('/connections', async (req, res) => {
  const settings = await getSettings();
  const q = db('connections')
    .join('users', 'users.id', 'connections.user_id')
    .leftJoin('streams', 'streams.id', 'connections.stream_id')
    .leftJoin('servers', 'servers.id', 'connections.server_id')
    .where('connections.last_seen_at', '>=', now() - settings.connection_timeout_seconds)
    .select('connections.*', 'users.username', 'streams.name as stream_name', 'servers.name as server_name')
    .orderBy('connections.started_at', 'desc');
  if (isReseller(req)) q.where('users.owner_id', req.admin.id);
  res.json((await q).map((c) => ({
    id: c.id, user_id: c.user_id, username: c.username, stream_id: c.stream_id, stream_name: c.stream_name,
    stream_type: c.stream_type, ip: c.ip, user_agent: c.user_agent, mode: c.mode,
    tracking: EXACT_MODES.includes(c.mode) ? 'exact' : 'estimated',
    server_id: c.server_id ?? null, server_name: c.server_name || null,
    started_at: Number(c.started_at), last_seen_at: Number(c.last_seen_at),
  })));
});

systemRouter.delete('/connections/:id', async (req, res) => {
  const conn = await db('connections').join('users', 'users.id', 'connections.user_id')
    .where('connections.id', int(req.params.id, 0)).select('connections.*', 'users.owner_id', 'users.username').first();
  if (!conn || (isReseller(req) && conn.owner_id !== req.admin.id)) throw new HttpError(404, 'Conexión no encontrada');
  await dropConnection(conn.id);
  await logAction(req.admin, 'connection.kick', 'user', conn.user_id, { username: conn.username, ip: conn.ip });
  res.json({ ok: true });
});

/* ------------------------------- Administradores ------------------------------- */

async function serializeAdmins(rows) {
  const counts = await db('users').whereNotNull('owner_id').groupBy('owner_id').select('owner_id').count({ c: '*' });
  const map = new Map(counts.map((c) => [c.owner_id, Number(c.c)]));
  return rows.map((a) => ({
    id: a.id, username: a.username, role: a.role, enabled: bool(a.enabled),
    user_count: map.get(a.id) || 0, created_at: Number(a.created_at),
  }));
}

systemRouter.get('/admins', adminOnly, async (_req, res) => {
  res.json(await serializeAdmins(await db('admins').orderBy('username')));
});

systemRouter.post('/admins', adminOnly, async (req, res) => {
  requireFields(req.body, ['username', 'password']);
  const username = String(req.body.username).trim();
  if (!/^[A-Za-z0-9._@-]{3,64}$/.test(username)) throw new HttpError(400, 'Nombre de usuario no válido');
  if (String(req.body.password).length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
  if (await db('admins').where({ username }).first()) throw new HttpError(409, 'Ese usuario ya existe');
  const id = await insertId(db, 'admins', {
    username,
    password_hash: await hashPassword(req.body.password),
    role: oneOf(req.body.role || 'reseller', ['admin', 'reseller'], 'role'),
    enabled: req.body.enabled === undefined ? true : bool(req.body.enabled),
    created_at: now(),
  });
  await logAction(req.admin, 'admin.create', 'admin', id, { username, role: req.body.role });
  res.status(201).json((await serializeAdmins([await db('admins').where({ id }).first()]))[0]);
});

systemRouter.put('/admins/:id', adminOnly, async (req, res) => {
  const row = await db('admins').where({ id: int(req.params.id, 0) }).first();
  if (!row) throw new HttpError(404, 'Administrador no encontrado');
  const patch = {};
  if (req.body.username !== undefined) {
    const username = String(req.body.username).trim();
    const clash = await db('admins').where({ username }).whereNot({ id: row.id }).first();
    if (clash) throw new HttpError(409, 'Ese usuario ya existe');
    patch.username = username;
  }
  if (req.body.password) {
    if (String(req.body.password).length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
    patch.password_hash = await hashPassword(req.body.password);
  }
  if (req.body.role !== undefined) patch.role = oneOf(req.body.role, ['admin', 'reseller'], 'role');
  if (req.body.enabled !== undefined) patch.enabled = bool(req.body.enabled);
  if (row.id === req.admin.id && (patch.role === 'reseller' || patch.enabled === false)) {
    throw new HttpError(400, 'No puedes quitarte el rol de administrador ni deshabilitar tu propia cuenta');
  }
  if (Object.keys(patch).length) await db('admins').where({ id: row.id }).update(patch);
  await logAction(req.admin, 'admin.update', 'admin', row.id, { username: patch.username || row.username });
  res.json((await serializeAdmins([await db('admins').where({ id: row.id }).first()]))[0]);
});

systemRouter.delete('/admins/:id', adminOnly, async (req, res) => {
  const row = await db('admins').where({ id: int(req.params.id, 0) }).first();
  if (!row) throw new HttpError(404, 'Administrador no encontrado');
  if (row.id === req.admin.id) throw new HttpError(400, 'No puedes eliminar tu propia cuenta');
  // Los usuarios del revendedor pasan al administrador que lo elimina.
  await db('users').where({ owner_id: row.id }).update({ owner_id: req.admin.id });
  await db('admins').where({ id: row.id }).del();
  await logAction(req.admin, 'admin.delete', 'admin', row.id, { username: row.username });
  res.json({ ok: true });
});

/* ----------------------------------- Ajustes ----------------------------------- */

systemRouter.get('/settings', adminOnly, async (_req, res) => res.json(publicSettings(await getSettings())));

systemRouter.put('/settings', adminOnly, async (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (body.server_name !== undefined) patch.server_name = String(body.server_name).slice(0, 100);
  if (body.public_url !== undefined) {
    patch.public_url = String(body.public_url).trim().replace(/\/+$/, '');
    // Si es una IP de este servidor, la URL sigue a esa interfaz cuando la IP cambie.
    const iface = interfaceOfUrl(patch.public_url, localPorts());
    patch.public_url_interface = iface || '';
    patch.public_url_auto = body.public_url_auto === undefined ? Boolean(iface) : bool(body.public_url_auto);
  } else if (body.public_url_auto !== undefined) {
    patch.public_url_auto = bool(body.public_url_auto);
  }
  if (body.stream_mode !== undefined) patch.stream_mode = oneOf(body.stream_mode, ['redirect', 'proxy', 'xtream_upstream'], 'stream_mode');
  if (body.xtream_upstream_url !== undefined) patch.xtream_upstream_url = String(body.xtream_upstream_url).trim().replace(/\/+$/, '');
  if (body.epg_url !== undefined) patch.epg_url = String(body.epg_url).trim();
  if (body.timezone !== undefined) patch.timezone = String(body.timezone);
  if (body.allow_all_without_package !== undefined) patch.allow_all_without_package = bool(body.allow_all_without_package);
  if (body.connection_timeout_seconds !== undefined) {
    patch.connection_timeout_seconds = Math.max(15, Math.min(3600, int(body.connection_timeout_seconds, 60)));
  }
  const clamp = (v, min, max, def) => Math.max(min, Math.min(max, int(v, def)));
  if (body.device_online_minutes !== undefined) patch.device_online_minutes = clamp(body.device_online_minutes, 1, 1440, 10);
  if (body.device_inactive_days !== undefined) patch.device_inactive_days = clamp(body.device_inactive_days, 1, 365, 30);
  if (body.device_check_interval_minutes !== undefined) {
    patch.device_check_interval_minutes = clamp(body.device_check_interval_minutes, 5, 1440, 60);
  }
  if (body.tvbox_default_ownership !== undefined) {
    patch.tvbox_default_ownership = oneOf(body.tvbox_default_ownership, ['company', 'client', 'unknown'], 'tvbox_default_ownership');
  }
  if (body.device_alert_new_tvbox !== undefined) patch.device_alert_new_tvbox = bool(body.device_alert_new_tvbox);
  if (body.device_inactive_message_client !== undefined) patch.device_inactive_message_client = bool(body.device_inactive_message_client);
  if (body.cut_mode !== undefined) patch.cut_mode = oneOf(body.cut_mode, ['manual', 'external', 'both'], 'cut_mode');
  if (body.epg_refresh_hours !== undefined) patch.epg_refresh_hours = clamp(body.epg_refresh_hours, 1, 168, 12);
  if (body.epg_auto_match !== undefined) patch.epg_auto_match = bool(body.epg_auto_match);
  if (body.epg_min_score !== undefined) patch.epg_min_score = clamp(body.epg_min_score, 50, 100, 85);
  if (body.epg_country !== undefined) patch.epg_country = String(body.epg_country || '').trim().toLowerCase().slice(0, 8);
  if (body.epg_fill_logos !== undefined) patch.epg_fill_logos = bool(body.epg_fill_logos);
  if (body.notices_carousel_enabled !== undefined) patch.notices_carousel_enabled = bool(body.notices_carousel_enabled);
  if (body.notices_carousel_seconds !== undefined) patch.notices_carousel_seconds = clamp(body.notices_carousel_seconds, 3, 120, 8);
  for (const k of ['company_name', 'app_name', 'support_phone']) {
    if (body[k] !== undefined) patch[k] = String(body[k] ?? '').trim().slice(0, 120);
  }
  if (body.support_email !== undefined) {
    const email = String(body.support_email ?? '').trim().slice(0, 160);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'El correo de soporte no es válido');
    patch.support_email = email;
  }
  if (body.node_fallback_direct !== undefined) patch.node_fallback_direct = bool(body.node_fallback_direct);
  if (body.node_offline_seconds !== undefined) patch.node_offline_seconds = clamp(body.node_offline_seconds, 10, 600, 30);
  if (body.stream_check_enabled !== undefined) patch.stream_check_enabled = bool(body.stream_check_enabled);
  if (body.stream_check_interval_minutes !== undefined) {
    patch.stream_check_interval_minutes = clamp(body.stream_check_interval_minutes, 5, 1440, 30);
  }
  if (body.stream_check_batch !== undefined) patch.stream_check_batch = clamp(body.stream_check_batch, 10, 20000, 500);
  if (body.stream_check_concurrency !== undefined) patch.stream_check_concurrency = clamp(body.stream_check_concurrency, 1, 50, 10);
  if (body.stream_check_timeout_seconds !== undefined) {
    patch.stream_check_timeout_seconds = clamp(body.stream_check_timeout_seconds, 2, 60, 8);
  }
  if (body.xtream_db && typeof body.xtream_db === 'object') {
    const x = body.xtream_db;
    patch.xtream_db = {};
    for (const k of ['host', 'user', 'database']) if (x[k] !== undefined) patch.xtream_db[k] = String(x[k]).trim();
    if (x.port !== undefined) patch.xtream_db.port = int(x.port, 3306);
    if (x.password) patch.xtream_db.password = String(x.password);
  }
  if (patch.stream_mode === 'xtream_upstream' && !(patch.xtream_upstream_url ?? (await getSettings()).xtream_upstream_url)) {
    throw new HttpError(400, 'Indica la URL del servidor XtreamUI para el modo xtream_upstream');
  }
  const saved = await saveSettings(patch);
  const { xtream_db: _omit, billing_integration: _omit2, ...logged } = patch;
  await logAction(req.admin, 'settings.update', 'settings', null, logged);
  res.json(publicSettings(saved));
});

/* ------------------------------- Consumo del servidor ------------------------------- */

systemRouter.get('/system/metrics', adminOnly, async (_req, res) => res.json(await getMetrics()));

/** Red del servidor: puertos de red con sus IPs, puertos TCP a la escucha y URLs sugeridas para clientes. */
systemRouter.get('/system/network', adminOnly, async (req, res) => {
  const external = bool(req.query.external);
  const [networkPorts, listening] = await Promise.all([listNetworkPorts(), listListeningPorts()]);
  const { suggestions, public_ip: detected } = await suggestPublicUrls({ networkPorts, listening, external });
  const settings = await getSettings();
  res.json({
    network_ports: networkPorts,
    public_ip: external ? detected : null,
    listening,
    portal_ports: [...new Set([appConfig.port, ...activeClientPorts()])],
    suggestions,
    current_public_url: settings.public_url || null,
    effective_base_url: await publicBaseUrl(req),
  });
});

systemRouter.get('/system/public-ip', adminOnly, async (_req, res) => res.json(await detectPublicIp({ force: true })));

/* ---------------------------------- Registro ---------------------------------- */

function serializeLog(l) {
  return {
    id: l.id, admin_id: l.admin_id, admin_username: l.admin_username, action: l.action,
    entity: l.entity, entity_id: l.entity_id, details: l.details, created_at: Number(l.created_at),
  };
}

systemRouter.get('/logs', adminOnly, async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const total = Number((await db('logs').count({ c: '*' }).first()).c);
  const rows = await db('logs').orderBy('id', 'desc').limit(limit).offset(offset);
  res.json({ data: rows.map(serializeLog), total, page, limit });
});
