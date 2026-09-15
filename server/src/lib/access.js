// Reglas de acceso de los usuarios finales (líneas): estado, paquetes, cortes y conexiones.
import { db } from '../db/index.js';
import { getSettings } from './settings.js';
import { bool, now } from './util.js';

/** Estado calculado: suspended > disabled > expired > active. */
export function userStatus(user, at = now()) {
  if (bool(user.suspended)) return 'suspended';
  if (!bool(user.enabled)) return 'disabled';
  if (user.exp_date && Number(user.exp_date) <= at) return 'expired';
  return 'active';
}

export async function findUserByCredentials(username, password) {
  if (!username || password === undefined || password === null) return null;
  const user = await db('users').where({ username: String(username) }).first();
  if (!user || user.password !== String(password)) return null;
  return user;
}

export async function userPackageIds(userId) {
  const rows = await db('user_packages').where({ user_id: userId }).select('package_id');
  return rows.map((r) => r.package_id);
}

/** Corte activo que afecta al usuario (el primero que bloquea la reproducción tiene prioridad). */
export async function activeOutageFor(packageIds, at = now()) {
  const rows = await db('outages')
    .where('starts_at', '<=', at)
    .andWhere((w) => w.whereNull('ends_at').orWhere('ends_at', '>', at))
    .andWhere((w) => {
      w.where('scope', 'global');
      if (packageIds.length) w.orWhere((x) => x.where('scope', 'package').whereIn('package_id', packageIds));
    })
    .orderBy('block_playback', 'desc')
    .orderBy('starts_at', 'desc');
  return rows[0] || null;
}

/**
 * Restricción de contenido para un usuario. Devuelve `null` si puede ver todo,
 * o los ids de paquete a los que está limitado.
 */
export async function contentScope(user) {
  const packageIds = await userPackageIds(user.id);
  if (packageIds.length) return packageIds;
  const settings = await getSettings();
  return settings.allow_all_without_package ? null : [];
}

/** Aplica a una consulta sobre `streams` el filtro de paquetes del usuario. */
export function scopeStreams(qb, packageIds, alias = 'streams') {
  if (packageIds === null) return qb;
  return qb.whereIn(
    `${alias}.id`,
    db('package_streams').whereIn('package_id', packageIds.length ? packageIds : [-1]).select('stream_id'),
  );
}

export function scopeSeries(qb, packageIds, alias = 'series') {
  if (packageIds === null) return qb;
  return qb.whereIn(
    `${alias}.id`,
    db('package_series').whereIn('package_id', packageIds.length ? packageIds : [-1]).select('series_id'),
  );
}

export async function canAccessStream(stream, packageIds) {
  if (packageIds === null) return true;
  if (!packageIds.length) return false;
  if (stream.type === 'episode') {
    const row = await db('package_series')
      .whereIn('package_id', packageIds)
      .where('series_id', stream.series_id)
      .first();
    return Boolean(row);
  }
  const row = await db('package_streams').whereIn('package_id', packageIds).where('stream_id', stream.id).first();
  return Boolean(row);
}

export async function activeConnectionCount(userId, timeoutSeconds) {
  const row = await db('connections')
    .where('user_id', userId)
    .andWhere('last_seen_at', '>=', now() - timeoutSeconds)
    .count({ c: '*' })
    .first();
  return Number(row?.c || 0);
}

/** Borra conexiones caducadas. */
export async function purgeStaleConnections() {
  const settings = await getSettings();
  await db('connections')
    .where('last_seen_at', '<', now() - Math.max(15, Number(settings.connection_timeout_seconds) || 60))
    .del();
}

export const clientIp = (req) => (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
