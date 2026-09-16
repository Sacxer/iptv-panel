// Registro automático de dispositivos, alertas y revisión periódica de inactividad.
import crypto from 'node:crypto';
import { db, insertId } from '../db/index.js';
import { clientIp } from '../lib/access.js';
import { detectDevice } from '../lib/deviceDetect.js';
import { getSettings } from '../lib/settings.js';
import { bool, now } from '../lib/util.js';

export const TYPE_LABEL = {
  tvbox: 'TV Box', smart_tv: 'Smart TV', mobile: 'Celular', tablet: 'Tablet', pc: 'PC', stb: 'Decodificador', unknown: 'Desconocido',
};

const WRITE_THROTTLE_MS = Number(process.env.DEVICE_THROTTLE_MS ?? 60_000);
const MERGE_WINDOW_SECONDS = 15 * 60;
const lastWrite = new Map(); // firma → timestamp de la última escritura

function describe(device) {
  const label = device.name || [device.brand, device.model].filter(Boolean).join(' ') || TYPE_LABEL[device.type] || 'Dispositivo';
  return `${label} (${TYPE_LABEL[device.type] || device.type})`;
}

const sha1 = (value) => crypto.createHash('sha1').update(String(value)).digest('hex');

/** User-Agent sin números de versión ni compilación: una actualización de la app no crea otro equipo. */
export function normalizeUserAgent(ua) {
  return String(ua || '').toLowerCase()
    .replace(/build\/[^;)\s]+/g, '')
    .replace(/\d+(?:[._]\d+)+[a-z]?/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

const normModel = (m) => String(m || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const SPECIFIC_TYPES = ['tvbox', 'smart_tv', 'mobile', 'tablet', 'stb'];

/** ¿El equipo registrado solo se conoce por una firma genérica (app o reproductor, sin modelo)? */
function isGenericDevice(device) {
  if (device.source === 'manual' || String(device.uid || '').startsWith('id:')) return false;
  if (device.model) return false;
  if (device.type === 'pc' && /windows|mac|chrome/i.test(device.os || '')) return false;
  return !SPECIFIC_TYPES.includes(device.type) || device.type === 'tvbox' && /tivimate/i.test(device.app || '');
}

/**
 * ¿Una nueva firma puede pertenecer a este equipo? Evita mezclar, por ejemplo, un celular y un TV Box
 * del mismo cliente en la misma red, pero une las peticiones genéricas (API, lista, reproductor) al equipo real.
 */
export function isCompatible(device, info) {
  if (info.uid && String(device.uid || '').startsWith('id:')) return false; // dos equipos con la app propia nunca se unen
  const infoGeneric = info.confidence === 'low' && !info.model;
  if (infoGeneric || isGenericDevice(device)) return true;
  if (info.model && device.model) return normModel(info.model) === normModel(device.model);
  return info.type === device.type;
}

async function addAlias(uid, deviceId, t) {
  if (!uid) return;
  try {
    const existing = await db('device_aliases').where({ uid }).first();
    if (!existing) await db('device_aliases').insert({ uid, device_id: deviceId, created_at: t });
    else if (existing.device_id !== deviceId) await db('device_aliases').where({ uid }).update({ device_id: deviceId });
  } catch {
    // alias ya creado por otra petición simultánea
  }
}

async function findByUid(uid) {
  if (!uid) return null;
  const direct = await db('devices').where({ uid }).first();
  if (direct) return direct;
  const alias = await db('device_aliases').where({ uid }).first();
  return alias ? db('devices').where({ id: alias.device_id }).first() : null;
}

/** Crea una alerta si no hay otra abierta del mismo tipo para el dispositivo. */
export async function raiseAlert(device, type, message, userId = null) {
  const open = await db('device_alerts').where({ device_id: device.id, type, status: 'open' }).first();
  if (open) return null;
  return insertId(db, 'device_alerts', {
    device_id: device.id, user_id: userId ?? device.user_id ?? null, type, message, status: 'open', created_at: now(),
  });
}

/**
 * Registra que un cliente se conectó desde un equipo. Se llama desde player_api, get.php, las URLs de
 * reproducción y la API de cliente. Nunca lanza errores: el control de dispositivos no debe cortar el servicio.
 *
 * Cómo se reconoce el equipo (en orden):
 *   1) X-Device-Id de la app propia            → "id:<id>"
 *   2) cliente + User-Agent sin versión         → "ua:<cliente>:<hash>" (o un alias ya aprendido)
 *   3) firma antigua con la versión completa    → equipos registrados antes de este cambio
 *   4) MAC enviada por la app propia            → equipos registrados a mano
 *   5) mismo cliente, misma IP, visto hace poco y compatible → se une y se recuerda el alias
 */
export async function recordDeviceSeen(req, user, activity) {
  try {
    const userAgent = (req.get('user-agent') || '').slice(0, 500);
    // El reproductor de vídeo de un televisor no puede enviar cabeceras: su ID llega como ?did= en la URL.
    const did = typeof req.query?.did === 'string' ? req.query.did.trim().slice(0, 100) : '';
    const viaQuery = Boolean(did && !req.get('x-device-id'));
    const headers = viaQuery ? { ...req.headers, 'x-device-id': did } : req.headers;
    const info = detectDevice(userAgent, headers);
    if (!info.uid && !userAgent) return null;
    const uid = info.uid ? `id:${info.uid}`.slice(0, 128) : `ua:${user.id}:${sha1(normalizeUserAgent(userAgent))}`;
    const ip = clientIp(req);

    const throttleKey = `${uid}|${user.id}|${ip}`;
    const last = lastWrite.get(throttleKey);
    if (WRITE_THROTTLE_MS > 0 && last && Date.now() - last < WRITE_THROTTLE_MS) return null;
    lastWrite.set(throttleKey, Date.now());
    if (lastWrite.size > 50_000) lastWrite.clear();

    const t = now();
    let device = await findByUid(uid);
    if (!device && !info.uid) {
      device = await findByUid(`ua:${user.id}:${sha1(userAgent)}`);
      if (device) await addAlias(uid, device.id, t);
    }
    if (!device && info.mac) {
      device = await db('devices').whereNull('uid').where('mac', info.mac).first();
      if (device) await db('devices').where({ id: device.id }).update({ uid });
    }
    if (!device) {
      const recent = await db('devices')
        .where((w) => w.where('user_id', user.id).orWhere('last_user_id', user.id))
        .where('last_ip', ip)
        .where('last_seen_at', '>=', t - MERGE_WINDOW_SECONDS)
        .whereNot('inventory_status', 'retired')
        .orderBy('last_seen_at', 'desc');
      device = recent.find((d) => isCompatible(d, info)) || null;
      if (device) {
        if (info.uid && !String(device.uid || '').startsWith('id:')) {
          // La app propia se identificó: su ID pasa a ser la firma principal del equipo.
          if (device.uid) await addAlias(device.uid, device.id, t);
          await db('devices').where({ id: device.id }).update({ uid });
          device.uid = uid;
        } else {
          await addAlias(uid, device.id, t);
        }
      }
    }
    const settings = await getSettings();

    if (!device) {
      const ownership = info.type === 'tvbox' ? settings.tvbox_default_ownership : 'client';
      const id = await insertId(db, 'devices', {
        uid,
        type: info.type,
        brand: info.brand || null,
        model: info.model || null,
        os: info.os || null,
        app: info.app || null,
        app_version: info.appVersion || null,
        app_build: info.appBuild ?? null,
        app_distribution: info.appDistribution || null,
        mac: info.mac || null,
        user_agent: userAgent,
        ownership,
        inventory_status: 'assigned',
        user_id: user.id,
        last_user_id: user.id,
        source: 'auto',
        last_ip: ip,
        last_activity: activity,
        first_seen_at: t,
        last_seen_at: t,
        created_at: t,
        updated_at: t,
      });
      device = await db('devices').where({ id }).first();
      if (info.type === 'tvbox' && info.confidence === 'high' && settings.device_alert_new_tvbox) {
        await raiseAlert(device, 'new_tvbox',
          `Nuevo TV Box detectado para el cliente ${user.username}: ${describe(device)}. Verifica si es un equipo de la empresa y regístralo.`,
          user.id);
      }
      return device;
    }

    const patch = { last_seen_at: t, last_ip: ip, last_activity: activity, last_user_id: user.id, updated_at: t };
    if (!device.first_seen_at) patch.first_seen_at = t;
    // Con ?did= el User-Agent es el del reproductor, no el del equipo: no cambia sus datos.
    const specific = !viaQuery && (info.confidence === 'high' || Boolean(info.model));
    // Una firma más específica (con modelo/tipo) mejora los datos de un equipo que solo se conocía por la app.
    if (specific || !device.user_agent) patch.user_agent = userAgent;
    if (!bool(device.type_locked) && info.type !== 'unknown' && (specific || device.type === 'unknown')) patch.type = info.type;
    for (const k of ['brand', 'model', 'os', 'mac']) if (info[k] && !device[k]) patch[k] = info[k];
    if (info.app && (!device.app || (specific && info.app !== 'Navegador'))) patch.app = info.app;
    if (info.appVersion) Object.assign(patch, { app_version: info.appVersion, app_build: info.appBuild ?? null, app_distribution: info.appDistribution || null });
    if (!device.user_id && device.inventory_status !== 'retired') {
      patch.user_id = user.id;
      if (device.inventory_status === 'available') patch.inventory_status = 'assigned';
    }
    await db('devices').where({ id: device.id }).update(patch);

    // Volvió a conectarse: se cierran sus alertas de inactividad.
    await db('device_alerts').where({ device_id: device.id, type: 'inactive', status: 'open' })
      .update({ status: 'resolved', resolution: 'El dispositivo volvió a conectarse', resolved_at: t });

    if (device.ownership === 'company' && device.user_id && device.user_id !== user.id) {
      const owner = await db('users').where({ id: device.user_id }).select('username').first();
      await raiseAlert(device, 'foreign_user',
        `El equipo de la empresa ${describe(device)} asignado a ${owner?.username || 'otro cliente'} se está usando con la cuenta ${user.username}.`,
        user.id);
    }
    return { ...device, ...patch };
  } catch (err) {
    console.error('No se pudo registrar el dispositivo:', err.message);
    return null;
  }
}

/* --------------------------------- Duplicados y fusión --------------------------------- */

/** Puntaje para elegir qué registro conservar al fusionar. */
function keepScore(d) {
  return (d.source === 'manual' ? 1000 : 0) + (d.ownership === 'company' ? 500 : 0)
    + (String(d.uid || '').startsWith('id:') ? 300 : 0) + (d.model ? 100 : 0) + (SPECIFIC_TYPES.includes(d.type) ? 50 : 0)
    + (d.name ? 20 : 0) + Number(d.last_seen_at || 0) / 1e10;
}

/** Grupos de dispositivos que parecen ser el mismo equipo. */
export async function findDuplicateGroups() {
  const devices = await db('devices').whereNot('inventory_status', 'retired');
  const groups = new Map();
  const owner = (d) => (d.user_id ?? d.last_user_id ?? null);
  const push = (key, reason, d) => {
    if (!groups.has(key)) groups.set(key, { key, reason, ids: new Set() });
    groups.get(key).ids.add(d.id);
  };
  // 1) Misma app/equipo (User-Agent sin versión) con el mismo cliente, o sin cliente pero desde la misma IP.
  for (const d of devices) {
    if (String(d.uid || '').startsWith('id:') || !d.user_agent) continue;
    const who = owner(d) ?? `ip:${d.last_ip || '?'}`;
    push(`ua|${who}|${sha1(normalizeUserAgent(d.user_agent))}|${normModel(d.model)}`, 'same_signature', d);
  }
  // 2) Firma genérica (solo la app) junto a un equipo concreto del mismo cliente y la misma IP.
  const byOwnerIp = new Map();
  for (const d of devices) {
    const who = owner(d);
    if (!who || !d.last_ip) continue;
    const key = `${who}|${d.last_ip}`;
    if (!byOwnerIp.has(key)) byOwnerIp.set(key, []);
    byOwnerIp.get(key).push(d);
  }
  for (const [key, list] of byOwnerIp) {
    const generic = list.filter(isGenericDevice);
    const concrete = list.filter((d) => !isGenericDevice(d));
    if (generic.length && concrete.length === 1) {
      for (const d of [...generic, concrete[0]]) push(`session|${key}`, 'same_session', d);
    }
  }
  // Unir grupos que comparten dispositivos.
  const merged = [];
  for (const g of groups.values()) {
    if (g.ids.size < 2) continue;
    const overlap = merged.find((m) => [...g.ids].some((id) => m.ids.has(id)));
    if (overlap) {
      g.ids.forEach((id) => overlap.ids.add(id));
      if (overlap.reason !== g.reason) overlap.reason = 'mixed';
    } else merged.push({ ...g, ids: new Set(g.ids) });
  }
  const byId = new Map(devices.map((d) => [d.id, d]));
  return merged.map((g) => {
    const list = [...g.ids].map((id) => byId.get(id)).sort((a, b) => keepScore(b) - keepScore(a));
    return { key: g.key, reason: g.reason, target_id: list[0].id, device_ids: list.map((d) => d.id) };
  });
}

/** Fusiona `sourceIds` en `targetId`: completa datos, mueve alertas y firmas, y borra los repetidos. */
export async function mergeDevices(targetId, sourceIds) {
  const ids = [...new Set(sourceIds.map(Number))].filter((id) => id && id !== Number(targetId));
  const target = await db('devices').where({ id: targetId }).first();
  if (!target) throw new Error('Dispositivo destino no encontrado');
  const sources = ids.length ? await db('devices').whereIn('id', ids) : [];
  if (!sources.length) return { merged: 0 };
  const t = now();
  await db.transaction(async (trx) => {
    const all = [target, ...sources];
    const newest = all.reduce((a, b) => (Number(b.last_seen_at || 0) > Number(a.last_seen_at || 0) ? b : a));
    const specificUa = all.filter((d) => d.model || SPECIFIC_TYPES.includes(d.type)).sort((a, b) => Number(b.last_seen_at || 0) - Number(a.last_seen_at || 0))[0];
    const patch = { updated_at: t };
    for (const k of ['name', 'brand', 'model', 'os', 'app', 'mac', 'serial', 'user_id', 'last_user_id']) {
      if (!target[k]) {
        const found = sources.find((s) => s[k]);
        if (found) patch[k] = found[k];
      }
    }
    if (!bool(target.type_locked) && (target.type === 'unknown' || isGenericDevice(target))) {
      const better = sources.find((s) => SPECIFIC_TYPES.includes(s.type) || s.model);
      if (better) patch.type = better.type;
    }
    const firsts = all.map((d) => Number(d.first_seen_at || 0)).filter(Boolean);
    if (firsts.length) patch.first_seen_at = Math.min(...firsts);
    patch.last_seen_at = newest.last_seen_at;
    patch.last_ip = newest.last_ip;
    patch.last_activity = newest.last_activity;
    patch.user_agent = (specificUa || newest).user_agent;
    const notes = all.map((d) => d.notes).filter(Boolean);
    if (notes.length > 1) patch.notes = [...new Set(notes)].join('\n');
    await trx('devices').where({ id: target.id }).update(patch);

    for (const s of sources) {
      if (s.uid) {
        await trx('device_aliases').where({ uid: s.uid }).del();
        await trx('device_aliases').insert({ uid: s.uid, device_id: target.id, created_at: t });
      }
    }
    await trx('device_aliases').whereIn('device_id', ids).update({ device_id: target.id });
    await trx('device_alerts').whereIn('device_id', ids).update({ device_id: target.id });
    // Una sola alerta abierta por tipo.
    const open = await trx('device_alerts').where({ device_id: target.id, status: 'open' }).orderBy('created_at');
    const seenTypes = new Set();
    for (const a of open) {
      if (seenTypes.has(a.type)) {
        await trx('device_alerts').where({ id: a.id }).update({ status: 'resolved', resolution: 'Unificada al fusionar dispositivos', resolved_at: t });
      }
      seenTypes.add(a.type);
    }
    await trx('devices').whereIn('id', ids).del();
  });
  return { merged: sources.length };
}

/** Equipos detectados automáticamente cuyo cliente ya no existe (no toca los de la empresa ni los registrados a mano). */
export function orphanDevicesQuery() {
  return db('devices').where({ source: 'auto' }).whereNot('ownership', 'company')
    .whereNull('user_id').whereNull('last_user_id');
}

/** Borra los equipos detectados automáticamente de clientes que se eliminan. */
export async function deleteAutoDevicesOf(trx, userIds) {
  if (!userIds.length) return 0;
  return trx('devices').where({ source: 'auto' }).whereNot('ownership', 'company')
    .where((w) => w.whereIn('user_id', userIds).orWhere((x) => x.whereNull('user_id').whereIn('last_user_id', userIds)))
    .del();
}

let lastCheckAt = null;
export const lastDeviceCheck = () => lastCheckAt;

/** Revisa dispositivos sin actividad y genera alertas (y opcionalmente un mensaje al cliente). */
export async function runInactivityCheck() {
  const settings = await getSettings();
  const t = now();
  const limit = t - Math.max(1, Number(settings.device_inactive_days) || 30) * 86400;
  lastCheckAt = t;

  const stale = await db('devices')
    .whereNot('inventory_status', 'retired')
    .whereNot('inventory_status', 'available')
    .where((w) => w.where('last_seen_at', '<', limit).orWhere((x) => x.whereNull('last_seen_at').where('created_at', '<', limit)))
    .whereNotExists(db('device_alerts').whereRaw('device_alerts.device_id = devices.id')
      .where({ type: 'inactive', status: 'open' }));

  let created = 0;
  for (const device of stale) {
    const days = Math.floor((t - Number(device.last_seen_at || device.created_at)) / 86400);
    const client = device.user_id ? await db('users').where({ id: device.user_id }).select('id', 'username').first() : null;
    const seen = device.last_seen_at ? `sin conexión hace ${days} días` : `nunca se ha conectado (registrado hace ${days} días)`;
    const id = await raiseAlert(device,
      'inactive',
      `Revisar ${describe(device)}${client ? ` del cliente ${client.username}` : ''}: ${seen}.`,
      client?.id ?? null);
    if (!id) continue;
    created++;
    if (settings.device_inactive_message_client && client) {
      await db('messages').insert({
        title: 'Revisión de tu equipo',
        body: `Hemos notado que tu equipo ${describe(device)} no se conecta desde hace ${days} días. `
          + 'Si tienes algún problema con el servicio, comunícate con nosotros.',
        target: 'user',
        user_id: client.id,
        expires_at: t + 30 * 86400,
        created_at: t,
      });
    }
  }
  return { checked_at: t, inactive_found: stale.length, alerts_created: created };
}

/** Programa la revisión periódica según `device_check_interval_minutes`. */
export function startDeviceMonitor() {
  let running = false;
  const tick = async () => {
    if (running) return;
    const settings = await getSettings().catch(() => null);
    if (!settings) return;
    const every = Math.max(5, Number(settings.device_check_interval_minutes) || 60) * 60;
    if (lastCheckAt && now() - lastCheckAt < every) return;
    running = true;
    try {
      await runInactivityCheck();
    } catch (err) {
      console.error('Revisión de dispositivos fallida:', err.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  setTimeout(tick, 5_000).unref();
  return () => clearInterval(timer);
}
