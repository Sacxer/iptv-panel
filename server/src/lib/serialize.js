import { db } from '../db/index.js';
import { parseSections, userStatus } from './access.js';
import { bool, int, now, parseJson } from './util.js';
import { getSettings } from './settings.js';

const intOrNull = (v) => int(v, null);

/** Agrupa filas `{[key]: id, [value]: id}` en un Map id → [ids]. */
async function groupIds(table, keyCol, valueCol, keys) {
  const map = new Map(keys.map((k) => [k, []]));
  if (!keys.length) return map;
  const rows = await db(table).whereIn(keyCol, keys).select(keyCol, valueCol);
  for (const r of rows) map.get(r[keyCol])?.push(r[valueCol]);
  return map;
}

export async function serializeUsers(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const settings = await getSettings();
  const packages = await groupIds('user_packages', 'user_id', 'package_id', ids);
  const conns = await db('connections')
    .whereIn('user_id', ids)
    .andWhere('last_seen_at', '>=', now() - settings.connection_timeout_seconds)
    .groupBy('user_id')
    .select('user_id')
    .count({ c: '*' });
  const connMap = new Map(conns.map((c) => [c.user_id, Number(c.c)]));
  const devices = await db('devices').whereIn('user_id', ids).whereNot('inventory_status', 'retired')
    .groupBy('user_id').select('user_id').count({ c: '*' });
  const deviceMap = new Map(devices.map((d) => [d.user_id, Number(d.c)]));
  const services = await db('external_clients').whereIn('user_id', ids).select('user_id', 'external_id', 'status', 'plan');
  const serviceMap = new Map();
  for (const s of services) {
    if (!serviceMap.has(s.user_id)) serviceMap.set(s.user_id, []);
    serviceMap.get(s.user_id).push({ external_id: s.external_id, status: s.status || '', plan: s.plan || '' });
  }
  const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter(Boolean))];
  const owners = ownerIds.length ? await db('admins').whereIn('id', ownerIds).select('id', 'username') : [];
  const ownerMap = new Map(owners.map((o) => [o.id, o.username]));
  const at = now();
  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    password: u.password,
    full_name: u.full_name || '',
    email: u.email || '',
    phone: u.phone || '',
    exp_date: intOrNull(u.exp_date),
    max_connections: int(u.max_connections, 1),
    enabled: bool(u.enabled),
    suspended: bool(u.suspended),
    suspension_reason: u.suspension_reason || null,
    suspension_source: u.suspension_source || null,
    document_id: u.document_id || '',
    external_id: u.external_id || null,
    external_status: u.external_status || null,
    external_synced_at: intOrNull(u.external_synced_at),
    external_services: serviceMap.get(u.id) || [],
    is_trial: bool(u.is_trial),
    status: userStatus(u, at),
    notes: u.notes || '',
    owner_id: intOrNull(u.owner_id),
    owner_username: ownerMap.get(u.owner_id) || null,
    source: u.source,
    xtream_id: intOrNull(u.xtream_id),
    package_ids: packages.get(u.id) || [],
    // Vacío = automático (según sus paquetes)
    content_sections: parseSections(u.content_sections) || [],
    active_connections: connMap.get(u.id) || 0,
    device_count: deviceMap.get(u.id) || 0,
    last_seen_at: intOrNull(u.last_seen_at),
    last_ip: u.last_ip || null,
    created_at: int(u.created_at),
    updated_at: int(u.updated_at),
  }));
}

export const serializeUser = async (row) => (await serializeUsers([row]))[0];

export function streamInfo(row) {
  const info = parseJson(row.info, {}) || {};
  return {
    plot: info.plot || '',
    genre: info.genre || '',
    rating: info.rating ? String(info.rating) : '',
    releasedate: info.releasedate || '',
    duration: info.duration || '',
    cover: info.cover || '',
    ...info,
  };
}

export async function serializeStreams(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const packages = await groupIds('package_streams', 'stream_id', 'package_id', ids);
  const settings = await getSettings();
  const conns = await db('connections').whereIn('stream_id', ids)
    .where('last_seen_at', '>=', now() - settings.connection_timeout_seconds)
    .groupBy('stream_id').select('stream_id').count({ c: '*' });
  const connMap = new Map(conns.map((c) => [c.stream_id, Number(c.c)]));
  const serverRows = await db('stream_servers').join('servers', 'servers.id', 'stream_servers.server_id')
    .whereIn('stream_servers.stream_id', ids).orderBy('stream_servers.priority')
    .select('stream_servers.stream_id', 'servers.id', 'servers.name');
  const serverMap = new Map();
  for (const r of serverRows) {
    if (!serverMap.has(r.stream_id)) serverMap.set(r.stream_id, []);
    serverMap.get(r.stream_id).push({ id: r.id, name: r.name });
  }
  const profileIds = [...new Set(rows.map((r) => r.transcode_profile_id).filter(Boolean))];
  const profiles = new Map((profileIds.length ? await db('transcode_profiles').whereIn('id', profileIds).select('id', 'name') : [])
    .map((p) => [p.id, p.name]));
  const catIds = [...new Set(rows.map((r) => r.category_id).filter(Boolean))];
  const cats = catIds.length ? await db('categories').whereIn('id', catIds).select('id', 'name') : [];
  const catMap = new Map(cats.map((c) => [c.id, c.name]));
  return rows.map((s) => ({
    id: s.id,
    type: s.type,
    name: s.name,
    category_id: intOrNull(s.category_id),
    category_name: catMap.get(s.category_id) || null,
    logo: s.logo || '',
    source_url: s.source_url || '',
    backup_urls: parseJson(s.backup_urls, []) || [],
    epg_channel_id: s.epg_channel_id || '',
    container_extension: s.container_extension || (s.type === 'live' ? 'ts' : 'mp4'),
    tv_archive_duration: int(s.tv_archive_duration, 0),
    sort_order: int(s.sort_order, 0),
    enabled: bool(s.enabled),
    info: streamInfo(s),
    package_ids: packages.get(s.id) || [],
    source: s.source,
    xtream_id: intOrNull(s.xtream_id),
    health_status: s.health_status || 'unknown',
    health_checked_at: intOrNull(s.health_checked_at),
    health_ms: intOrNull(s.health_ms),
    health_error: s.health_error || null,
    health_down_since: intOrNull(s.health_down_since),
    epg_match_score: intOrNull(s.epg_match_score),
    epg_locked: bool(s.epg_locked),
    delivery_mode: s.delivery_mode || 'default',
    transcode_profile_id: intOrNull(s.transcode_profile_id),
    transcode_profile_name: profiles.get(s.transcode_profile_id) || null,
    always_on: bool(s.always_on),
    server_ids: (serverMap.get(s.id) || []).map((x) => x.id),
    servers: serverMap.get(s.id) || [],
    active_connections: connMap.get(s.id) || 0,
    created_at: int(s.created_at),
  }));
}

export function serializeEpisode(s) {
  const info = parseJson(s.info, {}) || {};
  return {
    id: s.id,
    series_id: intOrNull(s.series_id),
    season: int(s.season, 1),
    episode_num: int(s.episode_num, 1),
    name: s.name,
    source_url: s.source_url || '',
    container_extension: s.container_extension || 'mp4',
    info: { plot: info.plot || '', duration: info.duration || '', ...info },
    enabled: bool(s.enabled),
  };
}

export async function serializeSeriesList(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const packages = await groupIds('package_series', 'series_id', 'package_id', ids);
  const counts = await db('streams')
    .whereIn('series_id', ids)
    .where('type', 'episode')
    .groupBy('series_id')
    .select('series_id')
    .count({ c: '*' });
  const countMap = new Map(counts.map((c) => [c.series_id, Number(c.c)]));
  const catIds = [...new Set(rows.map((r) => r.category_id).filter(Boolean))];
  const cats = catIds.length ? await db('categories').whereIn('id', catIds).select('id', 'name') : [];
  const catMap = new Map(cats.map((c) => [c.id, c.name]));
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    category_id: intOrNull(s.category_id),
    category_name: catMap.get(s.category_id) || null,
    cover: s.cover || '',
    plot: s.plot || '',
    cast: s.cast_list || '',
    director: s.director || '',
    genre: s.genre || '',
    release_date: s.release_date || '',
    rating: s.rating || '',
    backdrop: s.backdrop || '',
    youtube_trailer: s.youtube_trailer || '',
    episode_run_time: s.episode_run_time || '',
    enabled: bool(s.enabled),
    episode_count: countMap.get(s.id) || 0,
    package_ids: packages.get(s.id) || [],
    source: s.source,
    xtream_id: intOrNull(s.xtream_id),
    created_at: int(s.created_at),
  }));
}
