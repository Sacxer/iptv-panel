// Entrega de streams: validación de acceso, control de conexiones y redirección/proxy.
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { db, insertId } from '../db/index.js';
import {
  activeOutageFor, canAccessStream, clientIp, findUserByCredentials, sectionAllowed, userPackageIds, userStatus,
} from '../lib/access.js';
import { getSettings } from '../lib/settings.js';
import { bool, now, parseJson } from '../lib/util.js';
import { recordDeviceSeen } from './devices.js';
import {
  effectiveMode, pickServer, queueKill, signNodeToken,
} from './nodes.js';

/** Conexiones en modo proxy que se pueden cortar desde el panel. */
const activeProxies = new Map();

/** Modos en los que el servidor sabe con exactitud cuándo el cliente cierra. */
export const EXACT_MODES = ['proxy', 'node', 'app'];

export async function dropConnection(id) {
  const controller = activeProxies.get(id);
  if (controller) {
    controller.abort();
    activeProxies.delete(id);
  }
  const conn = await db('connections').where({ id }).first();
  if (conn?.server_id) queueKill(conn.server_id, id);
  await db('connections').where({ id }).del();
}

const NODE_TOKEN_TTL = 12 * 3600;

const KIND_TYPE = { live: 'live', movie: 'movie', series: 'episode' };
const STATUS_TEXT = {
  expired: 'Suscripción vencida',
  suspended: 'Servicio suspendido',
  disabled: 'Cuenta deshabilitada',
};

function deny(res, status, message) {
  res.status(status).type('text/plain; charset=utf-8').send(message);
}

/**
 * Atiende /live|movie|series/{u}/{p}/{id}.{ext}.
 * `kind` es 'live' | 'movie' | 'series'.
 */
export async function serveStream(req, res, { kind, username, password, streamId, ext }) {
  const user = await findUserByCredentials(username, password);
  if (!user) return deny(res, 401, 'Credenciales inválidas');

  if (req.method !== 'HEAD') await recordDeviceSeen(req, user, 'stream');
  const status = userStatus(user);
  if (status !== 'active') {
    return deny(res, 403, status === 'suspended' && user.suspension_reason ? user.suspension_reason : STATUS_TEXT[status]);
  }

  const packageIds = await userPackageIds(user.id);
  const outage = await activeOutageFor(packageIds);
  if (outage && bool(outage.block_playback)) {
    return deny(res, 403, `${outage.title}${outage.reason ? `: ${outage.reason}` : ''}`);
  }

  const stream = await db('streams').where({ id: streamId }).first();
  if (!stream || !bool(stream.enabled) || stream.type !== KIND_TYPE[kind]) return deny(res, 404, 'Contenido no encontrado');
  // Sección que no está en su plan: la misma respuesta que si no existiera
  if (!sectionAllowed(user, kind)) return deny(res, 404, 'Contenido no encontrado');

  const settings = await getSettings();
  const scope = packageIds.length ? packageIds : settings.allow_all_without_package ? null : [];
  if (!(await canAccessStream(stream, scope))) return deny(res, 403, 'El contenido no está incluido en tu plan');

  const t = now();
  const ip = clientIp(req);
  const userAgent = (req.get('user-agent') || '').slice(0, 500);
  const isHead = req.method === 'HEAD';

  const urls = [stream.source_url, ...(parseJson(stream.backup_urls, []) || [])].filter(Boolean);
  const isHls = ext === 'm3u8' || /\.m3u8(\?|$)/i.test(urls[0] || '');

  // 1) Decidir cómo se entrega: nodo (reenvío/transcodificación), directo, o el modo general de Ajustes.
  const mode = effectiveMode(stream);
  let server = null;
  let delivery; // node | direct | proxy | redirect | xtream_upstream
  if (mode === 'restream' || mode === 'transcode') {
    server = await pickServer(stream);
    if (server) delivery = 'node';
    else if (settings.node_fallback_direct && urls.length) delivery = 'redirect';
    else return deny(res, 503, 'No hay servidores de streaming disponibles para este canal');
  } else if (mode === 'direct') {
    delivery = 'redirect';
  } else if (settings.stream_mode === 'xtream_upstream' && settings.xtream_upstream_url && stream.xtream_id) {
    delivery = 'xtream_upstream';
  } else if (settings.stream_mode === 'proxy' && !isHls) {
    delivery = 'proxy';
  } else {
    delivery = 'redirect';
  }
  if (delivery !== 'xtream_upstream' && delivery !== 'node' && !urls.length) {
    return deny(res, 404, 'El contenido no tiene fuente configurada');
  }

  // 2) Control de conexiones.
  let connectionId = null;
  if (!isHead) {
    const timeout = Number(settings.connection_timeout_seconds) || 60;
    const active = await db('connections').where('user_id', user.id).where('last_seen_at', '>=', t - timeout);
    // El mismo dispositivo (IP + agente) que cambia de canal no cuenta como conexión nueva.
    const same = active.find((c) => c.ip === ip && c.user_agent === userAgent);
    const max = Number(user.max_connections);
    if (!same && max > 0 && active.length >= max) {
      return deny(res, 429, `Límite de conexiones alcanzado (${max})`);
    }
    const row = {
      stream_id: stream.id, stream_type: stream.type, last_seen_at: t, mode: delivery === 'node' ? 'node' : delivery,
      server_id: server?.id ?? null,
    };
    if (same && !EXACT_MODES.includes(same.mode) && !['proxy', 'node'].includes(delivery)) {
      await db('connections').where({ id: same.id }).update(row);
      connectionId = same.id;
    } else {
      // En modos exactos cada reproducción tiene su propia conexión; la anterior del mismo equipo se reemplaza.
      if (same) await dropConnection(same.id);
      connectionId = await insertId(db, 'connections', {
        ...row, user_id: user.id, ip, user_agent: userAgent, started_at: t,
      });
    }
    await db('users').where({ id: user.id }).update({ last_seen_at: t, last_ip: ip });
  }

  // 3) Entregar.
  if (delivery === 'node') {
    const token = signNodeToken({ s: stream.id, c: connectionId || 0, u: user.id, e: t + NODE_TOKEN_TTL }, server.token);
    const nodeExt = ext === 'm3u8' ? 'm3u8' : 'ts';
    return res.redirect(302, `${server.public_url.replace(/\/+$/, '')}/live/${stream.id}.${nodeExt}?token=${token}`);
  }
  if (delivery === 'xtream_upstream') {
    const upstream = settings.xtream_upstream_url.replace(/\/+$/, '');
    const e = encodeURIComponent;
    return res.redirect(302, `${upstream}/${kind}/${e(username)}/${e(password)}/${stream.xtream_id}.${ext}`);
  }
  if (delivery === 'proxy') {
    if (isHead) {
      res.status(200).type(kind === 'live' ? 'video/mp2t' : 'video/mp4').end();
      return undefined;
    }
    return proxyStream(req, res, urls, connectionId, settings);
  }
  return res.redirect(302, urls[0]);
}

async function proxyStream(req, res, urls, connectionId, settings) {
  const controller = new AbortController();
  activeProxies.set(connectionId, controller);
  const heartbeatMs = Math.max(5, Math.floor((Number(settings.connection_timeout_seconds) || 60) / 3)) * 1000;
  const heartbeat = setInterval(() => {
    db('connections').where({ id: connectionId }).update({ last_seen_at: now() }).catch(() => {});
  }, heartbeatMs);

  let closed = false;
  res.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    controller.abort();
    if (activeProxies.get(connectionId) === controller) activeProxies.delete(connectionId);
    db('connections').where({ id: connectionId }).del().catch(() => {});
  });

  for (const url of urls) {
    if (closed) return;
    try {
      const headers = { 'User-Agent': req.get('user-agent') || 'VLC/3.0.20 LibVLC/3.0.20' };
      if (req.headers.range) headers.Range = req.headers.range;
      const upstream = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel().catch(() => {});
        continue;
      }
      res.status(upstream.status);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      if (!upstream.headers.get('content-type')) res.setHeader('content-type', 'video/mp2t');
      await pipeline(Readable.fromWeb(upstream.body), res);
      return;
    } catch {
      if (closed || res.headersSent) {
        if (!res.writableEnded) res.destroy();
        return;
      }
      // Probar la siguiente fuente de respaldo.
    }
  }
  if (!res.headersSent) deny(res, 502, 'La fuente del canal no está disponible');
}
