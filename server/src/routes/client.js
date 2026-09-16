// API de cliente del portal: mensajes, avisos y cortes para las apps propias.
import { Router } from 'express';
import { db } from '../db/index.js';
import {
  activeOutageFor, findUserByCredentials, userPackageIds, userStatus,
} from '../lib/access.js';
import { config } from '../config.js';
import { getSettings } from '../lib/settings.js';
import { HttpError, bool, int, now } from '../lib/util.js';
import { recordDeviceSeen } from '../services/devices.js';
import { clientIp } from '../lib/access.js';
import { insertId } from '../db/index.js';
import { renderPlaceholders } from '../services/reminders.js';
import { checkUpdate, countDownload, releaseFile } from '../services/appReleases.js';
import { activeClientPorts } from '../services/listeners.js';
import { portalId, portalIdentity } from '../services/portalAddresses.js';

const router = Router();

function credentials(req) {
  const src = { ...(req.body || {}), ...req.query };
  return { username: src.username, password: src.password };
}

async function authUser(req) {
  const { username, password } = credentials(req);
  const user = await findUserByCredentials(username, password);
  if (!user) throw new HttpError(401, 'Credenciales inválidas');
  return user;
}

function visibleMessages(user, packageIds, at) {
  return db('messages')
    .where((w) => w.whereNull('expires_at').orWhere('expires_at', '>', at))
    .andWhere((w) => {
      w.where('target', 'all').orWhere((x) => x.where('target', 'user').where('user_id', user.id));
      if (packageIds.length) w.orWhere((x) => x.where('target', 'package').whereIn('package_id', packageIds));
    });
}

/** Sin credenciales: la app lo usa para comprobar la URL y para buscar el servidor en la red local. */
router.get('/ping', async (req, res) => {
  const settings = await getSettings();
  res.json({
    portal: true,
    type: 'iptv-portal',
    id: await portalId(),
    name: settings.server_name,
    version: config.version,
    url: `${req.protocol}://${req.get('host')}`,
    public_url: settings.public_url || null,
    ports: [...new Set([...activeClientPorts(), config.port])],
    client_ports: activeClientPorts(),
  });
});

/**
 * Actualización de la app propia (versión repartida desde el portal). Sin credenciales: debe funcionar
 * incluso antes de iniciar sesión o con la cuenta cortada.
 */
router.get('/app-update', async (req, res) => {
  const q = req.query;
  res.json(await checkUpdate({
    package: q.package,
    version_code: q.version_code,
    version_name: q.version_name,
    abis: q.abis,
    device_type: q.device_type || req.get('x-device-type'),
    device_id: q.device_id || req.get('x-device-id'),
    channel: q.channel,
    sdk: q.sdk,
    ip: clientIp(req),
  }));
});

router.get('/app-update/download/:fileId', async (req, res) => {
  const { file, path } = await releaseFile(int(req.params.fileId, 0));
  // Las descargas reanudadas (Range) no cuentan otra vez.
  if (!req.headers.range || /^bytes=0-/.test(req.headers.range)) await countDownload(file.id);
  res.download(path, file.filename, { headers: { 'Content-Type': 'application/vnd.android.package-archive' } });
});

router.get('/info', async (req, res) => {
  const user = await authUser(req);
  await recordDeviceSeen(req, user, 'app');
  const at = now();
  const settings = await getSettings();
  const packageIds = await userPackageIds(user.id);

  const outage = await activeOutageFor(packageIds, at);
  const notices = await db('notices')
    .where('active', true)
    .where((w) => w.whereNull('starts_at').orWhere('starts_at', '<=', at))
    .where((w) => w.whereNull('ends_at').orWhere('ends_at', '>', at))
    .where((w) => {
      w.where('target', 'all');
      if (packageIds.length) w.orWhere((x) => x.where('target', 'package').whereIn('package_id', packageIds));
    })
    .orderBy('sort_order')
    .orderBy('created_at', 'desc');
  const levelRank = { critical: 0, warning: 1, info: 2 };
  notices.sort((a, b) => (levelRank[a.level] ?? 3) - (levelRank[b.level] ?? 3));

  const messages = await visibleMessages(user, packageIds, at).orderBy('created_at', 'desc').limit(50);
  const readIds = new Set(
    messages.length
      ? await db('message_reads').where('user_id', user.id).whereIn('message_id', messages.map((m) => m.id)).pluck('message_id')
      : [],
  );

  res.json({
    portal: true,
    server_name: settings.server_name,
    // Identidad y direcciones del portal: la app las guarda para reconectarse si cambia la IP.
    server: await portalIdentity(req, { forApp: true }),
    user: {
      username: user.username,
      exp_date: user.exp_date ? Number(user.exp_date) : null,
      max_connections: Number(user.max_connections),
      is_trial: bool(user.is_trial),
      status: userStatus(user, at),
      suspension_reason: bool(user.suspended) ? user.suspension_reason || 'Servicio suspendido' : null,
    },
    outage: outage
      ? {
        id: outage.id,
        title: outage.title,
        reason: outage.reason || '',
        starts_at: Number(outage.starts_at),
        ends_at: outage.ends_at ? Number(outage.ends_at) : null,
        block_playback: bool(outage.block_playback),
      }
      : null,
    notice_settings: {
      carousel: Boolean(settings.notices_carousel_enabled),
      interval_seconds: Math.max(3, Number(settings.notices_carousel_seconds) || 8),
    },
    notices: notices.map((n) => ({
      id: n.id,
      title: renderPlaceholders(n.title, user, settings),
      body: renderPlaceholders(n.body || '', user, settings),
      level: n.level,
      display: n.display,
      duration_seconds: n.duration_seconds ? Number(n.duration_seconds) : null,
      starts_at: n.starts_at ? Number(n.starts_at) : null,
      ends_at: n.ends_at ? Number(n.ends_at) : null,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      title: renderPlaceholders(m.title, user, settings),
      body: renderPlaceholders(m.body || '', user, settings),
      kind: m.kind || 'general',
      display: m.display || 'inbox',
      created_at: Number(m.created_at),
      read: readIds.has(m.id),
    })),
    unread_messages: messages.filter((m) => !readIds.has(m.id)).length,
  });
});

/**
 * La app propia avisa cada 30 s mientras reproduce. Así la conexión se mantiene visible (y cuenta para el
 * límite) hasta que el cliente cierra, aunque el video vaya directo a la fuente.
 */
router.post('/playing', async (req, res) => {
  const user = await authUser(req);
  const settings = await getSettings();
  const streamId = int(req.body?.stream_id, 0);
  if (!streamId) throw new HttpError(400, 'Falta stream_id');
  const stream = await db('streams').where({ id: streamId }).select('id', 'type').first();
  if (!stream) throw new HttpError(404, 'Contenido no encontrado');
  const t = now();
  const ip = clientIp(req);
  const userAgent = String(req.get('x-device-id') || req.get('user-agent') || '').slice(0, 500);
  const timeout = Number(settings.connection_timeout_seconds) || 60;
  const active = await db('connections').where('user_id', user.id).where('last_seen_at', '>=', t - timeout);
  const connId = int(req.body?.connection_id, 0);
  const same = active.find((c) => c.id === connId)
    || active.find((c) => c.ip === ip && (c.user_agent === userAgent || c.stream_id === streamId) && !['proxy', 'node'].includes(c.mode));
  const max = Number(user.max_connections);
  if (!same && max > 0 && active.length >= max) throw new HttpError(429, `Límite de conexiones alcanzado (${max})`);
  let id;
  if (same) {
    id = same.id;
    const patch = { last_seen_at: t, stream_id: stream.id, stream_type: stream.type };
    if (!['proxy', 'node'].includes(same.mode)) patch.mode = 'app';
    await db('connections').where({ id }).update(patch);
  } else {
    id = await insertId(db, 'connections', {
      user_id: user.id, stream_id: stream.id, stream_type: stream.type, ip, user_agent: userAgent, mode: 'app', started_at: t, last_seen_at: t,
    });
  }
  res.json({ ok: true, connection_id: id, interval_seconds: Math.max(10, Math.floor(timeout / 2)) });
});

router.post('/stopped', async (req, res) => {
  const user = await authUser(req);
  const connId = int(req.body?.connection_id, 0);
  const q = db('connections').where({ user_id: user.id, mode: 'app' });
  if (connId) q.where({ id: connId });
  else q.where({ ip: clientIp(req) });
  const deleted = await q.del();
  res.json({ ok: true, closed: deleted });
});

router.post('/messages/:id/read', async (req, res) => {
  const user = await authUser(req);
  const packageIds = await userPackageIds(user.id);
  const message = await visibleMessages(user, packageIds, now()).where('id', int(req.params.id, 0)).first();
  if (!message) throw new HttpError(404, 'Mensaje no encontrado');
  const exists = await db('message_reads').where({ message_id: message.id, user_id: user.id }).first();
  if (!exists) await db('message_reads').insert({ message_id: message.id, user_id: user.id, read_at: now() });
  res.json({ ok: true });
});

export default router;
