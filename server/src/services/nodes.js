// Servidores de streaming (nodos): elección de servidor por canal, firma de accesos y latidos (heartbeats).
import { followUrl, interfaceOfUrl } from './ipFollow.js';
import { logAction } from '../lib/log.js';
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { getSettings } from '../lib/settings.js';
import { bool, now, parseJson } from '../lib/util.js';
import { rankAddresses } from './network.js';

export const DELIVERY_MODES = ['default', 'direct', 'restream', 'transcode'];

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Token de acceso al nodo: payload firmado con el token del servidor (HMAC-SHA256). */
export function signNodeToken(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyNodeToken(token, secret) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (expected.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.e && payload.e < now() ? null : payload;
  } catch {
    return null;
  }
}

export const generateServerToken = () => crypto.randomBytes(32).toString('hex');

/** Asignaciones recientes aún no reflejadas en el heartbeat (reparte ráfagas de clientes). */
const pending = new Map(); // server_id → [{ at }]

function pendingCount(serverId) {
  const list = (pending.get(serverId) || []).filter((p) => p.at > Date.now() - 15_000);
  pending.set(serverId, list);
  return list.length;
}

export async function onlineServers() {
  const settings = await getSettings();
  const limit = now() - Math.max(10, Number(settings.node_offline_seconds) || 30);
  return db('servers').where('enabled', true).where('last_heartbeat_at', '>=', limit).whereNot('public_url', '');
}

/** URL del nodo con la IP de su interfaz principal (nunca loopback) y el puerto en el que escucha. */
const nodePorts = (network) => (network?.ports || []).map((p) => ({ ...p, type_label: p.type }));

/** URL del nodo con la IP de su interfaz principal: { url, interface } o null. */
export function nodeUrlFromNetwork(network) {
  const ranked = rankAddresses(nodePorts(network));
  const best = ranked.find((a) => a.family === 'IPv4') || ranked[0];
  if (!best) return null;
  const host = best.address.includes(':') ? `[${best.address}]` : best.address;
  return { url: `http://${host}:${Number(network.listen_port) || 8090}`, interface: best.interface };
}

/** Interfaz del nodo que tiene la IP de la URL (para que la URL la siga si cambia). */
export function nodeInterfaceOf(url, network) {
  return interfaceOfUrl(url, nodePorts(network));
}

/**
 * Elige el servidor para un canal que se reenvía o transcodifica:
 * 1) solo servidores asignados al canal (o todos si no tiene asignación) que estén en línea y con cupo;
 * 2) prefiere el que ya está emitiendo ese canal (reutiliza la conexión a la fuente);
 * 3) luego menor prioridad y menor carga relativa a su peso.
 */
export async function pickServer(stream) {
  const assigned = await db('stream_servers').where({ stream_id: stream.id }).select('server_id', 'priority');
  const priority = new Map(assigned.map((a) => [a.server_id, Number(a.priority)]));
  let candidates = await onlineServers();
  if (assigned.length) candidates = candidates.filter((s) => priority.has(s.id));

  const scored = candidates.map((s) => {
    const metrics = parseJson(s.metrics, {}) || {};
    const states = parseJson(s.stream_states, []) || [];
    const clients = Number(metrics.clients_total || 0) + pendingCount(s.id);
    const running = states.some((st) => Number(st.id) === stream.id && ['running', 'starting'].includes(st.state));
    return { server: s, clients, running, priority: priority.get(s.id) ?? 0, load: clients / Math.max(1, Number(s.weight) || 1) };
  }).filter((c) => !Number(c.server.max_clients) || c.clients < Number(c.server.max_clients));

  scored.sort((a, b) => (Number(b.running) - Number(a.running)) || (a.priority - b.priority) || (a.load - b.load));
  const chosen = scored[0]?.server || null;
  if (chosen) {
    const list = pending.get(chosen.id) || [];
    list.push({ at: Date.now() });
    pending.set(chosen.id, list);
  }
  return chosen;
}

/** Modo efectivo de entrega de un canal. */
export function effectiveMode(stream) {
  const mode = stream.delivery_mode || 'default';
  if (mode === 'transcode' && !stream.transcode_profile_id) return 'restream';
  return mode;
}

/** Sesiones a expulsar por servidor (se envían en la respuesta del siguiente heartbeat). */
const killQueue = new Map(); // server_id → Set(conn ids)

export function queueKill(serverId, connectionId) {
  if (!serverId) return;
  const set = killQueue.get(serverId) || new Set();
  set.add(connectionId);
  killQueue.set(serverId, set);
}

export function serializeProfile(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    hw: p.hw,
    video_codec: p.video_codec,
    preset: p.preset || '',
    resolution: p.resolution,
    video_bitrate_kbps: Number(p.video_bitrate_kbps),
    max_bitrate_kbps: p.max_bitrate_kbps ? Number(p.max_bitrate_kbps) : null,
    fps: p.fps ? Number(p.fps) : null,
    gop: Number(p.gop),
    deinterlace: bool(p.deinterlace),
    audio_codec: p.audio_codec,
    audio_bitrate_kbps: Number(p.audio_bitrate_kbps),
    audio_channels: p.audio_channels ? Number(p.audio_channels) : null,
    extra_args: p.extra_args || '',
  };
}

/** Configuración que el nodo necesita para arrancar un canal. */
export async function nodeStreamConfig(server, streamId) {
  const stream = await db('streams').where({ id: streamId }).first();
  if (!stream || !bool(stream.enabled)) return null;
  const mode = effectiveMode(stream);
  if (!['restream', 'transcode'].includes(mode)) return null;
  const assigned = await db('stream_servers').where({ stream_id: stream.id }).pluck('server_id');
  if (assigned.length && !assigned.includes(server.id)) return null;
  const profile = mode === 'transcode' ? await db('transcode_profiles').where({ id: stream.transcode_profile_id }).first() : null;
  return {
    id: stream.id,
    name: stream.name,
    mode,
    sources: [stream.source_url, ...(parseJson(stream.backup_urls, []) || [])].filter(Boolean),
    profile: serializeProfile(profile),
    always_on: bool(stream.always_on),
  };
}

/** Procesa el heartbeat de un nodo y devuelve las instrucciones para él. */
export async function handleHeartbeat(server, body, ip) {
  const t = now();
  const streams = Array.isArray(body.streams) ? body.streams.slice(0, 5000) : [];
  const sessions = Array.isArray(body.sessions) ? body.sessions.slice(0, 50000) : [];
  const networkPatch = {};
  if (body.network && Array.isArray(body.network.ports)) {
    networkPatch.network = JSON.stringify({ ...body.network, reported_at: t });
    // Servidor creado sin URL: se toma la IP de la interfaz principal del nodo.
    if (!server.public_url) {
      const found = nodeUrlFromNetwork(body.network);
      if (found) Object.assign(networkPatch, { public_url: found.url, public_url_auto: true, public_url_interface: found.interface });
    } else if (bool(server.public_url_auto)) {
      // La IP del nodo cambió (p. ej. DHCP tras un corte de luz): la URL sigue a su interfaz.
      const change = followUrl(server.public_url, nodePorts(body.network), server.public_url_interface, rankAddresses);
      if (change) {
        Object.assign(networkPatch, { public_url: change.url, public_url_interface: change.interface });
        await logAction(null, 'server.ip_follow', 'server', server.id, change);
      }
    }
  }
  await db('servers').where({ id: server.id }).update({
    ...networkPatch,
    status: 'online',
    last_heartbeat_at: t,
    last_ip: ip,
    version: String(body.version || '').slice(0, 32),
    hardware: JSON.stringify(body.hardware || {}),
    metrics: JSON.stringify({ ...(body.metrics || {}), clients_total: sessions.length }),
    stream_states: JSON.stringify(streams),
    updated_at: t,
  });
  pending.set(server.id, []);

  // Mantener vivas las conexiones que el nodo sigue sirviendo.
  const connIds = sessions.map((s) => Number(s.conn)).filter((n) => n > 0);
  for (let i = 0; i < connIds.length; i += 500) {
    await db('connections').whereIn('id', connIds.slice(i, i + 500)).where({ server_id: server.id }).update({ last_seen_at: t });
  }
  // Las que el nodo ya no reporta se cerraron. Margen de 15 s para clientes que aún están llegando al nodo tras la redirección.
  const closed = db('connections').where({ server_id: server.id, mode: 'node' }).where('started_at', '<', t - 15);
  if (connIds.length) closed.whereNotIn('id', connIds);
  await closed.del();

  // El estado real del proceso FFmpeg alimenta la salud del canal.
  for (const st of streams) {
    const id = Number(st.id);
    if (!id) continue;
    if (st.state === 'running') {
      await db('streams').where({ id }).whereNot('health_status', 'online')
        .update({ health_status: 'online', health_checked_at: t, health_error: null, health_fail_count: 0, health_down_since: null });
    } else if (st.state === 'error') {
      await db('streams').where({ id }).whereNot('health_status', 'offline')
        .update({ health_status: 'offline', health_checked_at: t, health_error: `${server.name}: ${String(st.last_error || 'error').slice(0, 200)}`, health_down_since: t });
    }
  }

  const alwaysOn = await db('streams').where({ always_on: true, enabled: true })
    .whereIn('delivery_mode', ['restream', 'transcode'])
    .where((w) => w.whereIn('id', db('stream_servers').where({ server_id: server.id }).select('stream_id'))
      .orWhereNotExists(db('stream_servers').whereRaw('stream_servers.stream_id = streams.id')))
    .pluck('id');

  const kill = [...(killQueue.get(server.id) || [])];
  killQueue.delete(server.id);
  return { ok: true, server_id: server.id, name: server.name, always_on: alwaysOn, kill, time: t };
}

/** Marca como fuera de línea los servidores sin heartbeat reciente. */
export async function markOfflineServers() {
  const settings = await getSettings();
  const limit = now() - Math.max(10, Number(settings.node_offline_seconds) || 30);
  await db('servers').where('status', 'online').where('last_heartbeat_at', '<', limit).update({ status: 'offline' });
}
