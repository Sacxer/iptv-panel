// API compatible con Xtream Codes para apps de terceros (IPTV Smarters, TiviMate, XCIPTV…).
import { Router } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { db } from '../db/index.js';
import {
  activeConnectionCount, contentScope, findUserByCredentials, scopeSeries, scopeStreams, sectionAllowed, userStatus,
} from '../lib/access.js';
import { streamInfo } from '../lib/serialize.js';
import { getSettings } from '../lib/settings.js';
import { int, now, parseJson } from '../lib/util.js';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { recordDeviceSeen } from '../services/devices.js';
import { GUIDE_FILE, programmesFor } from '../services/epg.js';
import { safeZone, zoneParts } from '../lib/time.js';
import { serveStream } from '../services/streaming.js';

const router = Router();

const STATUS_LABEL = { active: 'Active', expired: 'Expired', suspended: 'Banned', disabled: 'Disabled' };
const UNCATEGORIZED = { id: 0, name: 'Sin categoría' };
const str = (v) => (v === null || v === undefined ? '' : String(v));

function params(req) {
  return { ...(req.body && typeof req.body === 'object' ? req.body : {}), ...req.query };
}

/** Host y puerto con los que el cliente llegó (las apps construyen URLs a partir de esto). */
function requestOrigin(req) {
  const proto = req.protocol;
  const host = req.get('host') || 'localhost';
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host);
  const hostname = m ? m[1] : host;
  const port = m?.[2] || (proto === 'https' ? '443' : '80');
  return { proto, hostname, port, base: `${proto}://${host}` };
}

async function userInfo(user, req) {
  const settings = await getSettings();
  const status = userStatus(user);
  const origin = requestOrigin(req);
  const t = now();
  const date = new Date(t * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  let message = '';
  if (status === 'suspended') message = user.suspension_reason || 'Servicio suspendido';
  return {
    user_info: {
      username: user.username,
      password: user.password,
      message,
      auth: 1,
      status: STATUS_LABEL[status],
      exp_date: user.exp_date ? String(user.exp_date) : null,
      is_trial: user.is_trial ? '1' : '0',
      active_cons: String(await activeConnectionCount(user.id, settings.connection_timeout_seconds)),
      created_at: str(user.created_at),
      max_connections: String(user.max_connections),
      allowed_output_formats: ['m3u8', 'ts'],
    },
    server_info: {
      url: origin.hostname,
      port: origin.proto === 'https' ? '80' : origin.port,
      https_port: origin.proto === 'https' ? origin.port : '443',
      server_protocol: origin.proto,
      rtmp_port: '0',
      timezone: settings.timezone || 'UTC',
      timestamp_now: t,
      time_now: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
      process: true,
    },
  };
}

/* ---------------------------- Consultas de catálogo ---------------------------- */

function liveOrVodQuery(type, scope, categoryId) {
  const q = db('streams').where('streams.type', type).where('streams.enabled', true);
  scopeStreams(q, scope);
  if (categoryId !== undefined && categoryId !== '' && categoryId !== null) {
    if (int(categoryId) === 0) q.whereNull('streams.category_id');
    else q.where('streams.category_id', int(categoryId, -1));
  }
  return q;
}

function seriesQuery(scope, categoryId) {
  const q = db('series').where('series.enabled', true);
  scopeSeries(q, scope);
  if (categoryId !== undefined && categoryId !== '' && categoryId !== null) {
    if (int(categoryId) === 0) q.whereNull('series.category_id');
    else q.where('series.category_id', int(categoryId, -1));
  }
  return q;
}

async function categoriesFor(type, scope) {
  const base = type === 'series' ? seriesQuery(scope) : liveOrVodQuery(type, scope);
  const table = type === 'series' ? 'series' : 'streams';
  const used = await base.distinct(`${table}.category_id`).pluck(`${table}.category_id`);
  const ids = used.filter((x) => x !== null);
  const cats = ids.length
    ? await db('categories').whereIn('id', ids).orderBy('sort_order').orderBy('name')
    : [];
  const out = cats.map((c) => ({ category_id: String(c.id), category_name: c.name, parent_id: 0 }));
  if (used.some((x) => x === null)) {
    out.push({ category_id: String(UNCATEGORIZED.id), category_name: UNCATEGORIZED.name, parent_id: 0 });
  }
  return out;
}

const categoryIdStr = (v) => String(v ?? UNCATEGORIZED.id);

/** Orden de las categorías y, dentro de cada una, el orden de los canales (y luego el nombre). */
function orderedByCategory(q) {
  return q.leftJoin('categories as cat_ord', 'cat_ord.id', 'streams.category_id')
    .select('streams.*')
    .orderByRaw('CASE WHEN cat_ord.id IS NULL THEN 1 ELSE 0 END')
    .orderBy('cat_ord.sort_order')
    .orderBy('cat_ord.name')
    .orderBy('streams.sort_order')
    .orderBy('streams.name');
}

function seriesItem(s, num) {
  const rating = Number.parseFloat(s.rating) || 0;
  return {
    num,
    name: s.name,
    series_id: s.id,
    cover: s.cover || '',
    plot: s.plot || '',
    cast: s.cast_list || '',
    director: s.director || '',
    genre: s.genre || '',
    releaseDate: s.release_date || '',
    last_modified: str(s.updated_at),
    rating: s.rating || '',
    rating_5based: Math.round((rating / 2) * 10) / 10,
    backdrop_path: s.backdrop ? [s.backdrop] : [],
    youtube_trailer: s.youtube_trailer || '',
    episode_run_time: s.episode_run_time || '',
    category_id: categoryIdStr(s.category_id),
  };
}

const b64 = (s) => Buffer.from(String(s || ''), 'utf8').toString('base64');

async function epgListings(p, scope, { limit = null, full = false } = {}) {
  const stream = await liveOrVodQuery('live', scope).where('streams.id', int(p.stream_id, 0))
    .select('streams.id', 'streams.epg_channel_id').first();
  if (!stream?.epg_channel_id) return [];
  const settings = await getSettings();
  const tz = safeZone(settings.timezone);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (ts) => {
    const z = zoneParts(ts, tz);
    return `${z.year}-${pad(z.month)}-${pad(z.day)} ${pad(z.hour)}:${pad(z.minute)}:${pad(z.second)}`;
  };
  const t = now();
  // Tabla completa: desde el inicio del día anterior; corta: lo que está en emisión y lo que sigue.
  const rows = await programmesFor(stream.epg_channel_id, full ? { since: t - 86400 } : { from: t, limit });
  return rows.map((r) => ({
    id: String(r.id),
    epg_id: String(stream.id),
    title: b64(r.title),
    lang: r.lang || '',
    start: fmt(Number(r.start)),
    end: fmt(Number(r.stop)),
    description: b64(r.description),
    channel_id: stream.epg_channel_id,
    start_timestamp: String(r.start),
    stop_timestamp: String(r.stop),
    ...(full ? { now_playing: Number(r.start) <= t && Number(r.stop) > t ? 1 : 0, has_archive: 0 } : {}),
  }));
}

const actions = {
  async get_live_categories(_p, scope) {
    return categoriesFor('live', scope);
  },
  async get_vod_categories(_p, scope) {
    return categoriesFor('movie', scope);
  },
  async get_series_categories(_p, scope) {
    return categoriesFor('series', scope);
  },

  async get_live_streams(p, scope) {
    const rows = await orderedByCategory(liveOrVodQuery('live', scope, p.category_id));
    return rows.map((s, i) => ({
      num: i + 1,
      name: s.name,
      stream_type: 'live',
      stream_id: s.id,
      stream_icon: s.logo || '',
      epg_channel_id: s.epg_channel_id || null,
      added: str(s.created_at),
      category_id: categoryIdStr(s.category_id),
      custom_sid: '',
      tv_archive: s.tv_archive_duration > 0 ? 1 : 0,
      direct_source: '',
      tv_archive_duration: Number(s.tv_archive_duration) || 0,
    }));
  },

  async get_vod_streams(p, scope) {
    const rows = await orderedByCategory(liveOrVodQuery('movie', scope, p.category_id));
    return rows.map((s, i) => {
      const info = streamInfo(s);
      const rating = Number.parseFloat(info.rating) || 0;
      return {
        num: i + 1,
        name: s.name,
        stream_type: 'movie',
        stream_id: s.id,
        stream_icon: s.logo || info.cover || '',
        rating: info.rating || '',
        rating_5based: Math.round((rating / 2) * 10) / 10,
        added: str(s.created_at),
        category_id: categoryIdStr(s.category_id),
        container_extension: s.container_extension || 'mp4',
        custom_sid: '',
        direct_source: '',
      };
    });
  },

  async get_vod_info(p, scope) {
    const s = await liveOrVodQuery('movie', scope).where('streams.id', int(p.vod_id, 0)).select('streams.*').first();
    if (!s) return { info: [], movie_data: [] };
    const info = streamInfo(s);
    return {
      info: {
        ...info,
        movie_image: info.cover || s.logo || '',
        plot: info.plot,
        genre: info.genre,
        releasedate: info.releasedate,
        rating: info.rating,
        duration: info.duration,
        duration_secs: Number(info.duration_secs) || 0,
      },
      movie_data: {
        stream_id: s.id,
        name: s.name,
        added: str(s.created_at),
        category_id: categoryIdStr(s.category_id),
        container_extension: s.container_extension || 'mp4',
        custom_sid: '',
        direct_source: '',
      },
    };
  },

  async get_series(p, scope) {
    const rows = await seriesQuery(scope, p.category_id).select('series.*').orderBy('series.name');
    return rows.map((s, i) => seriesItem(s, i + 1));
  },

  async get_series_info(p, scope) {
    const s = await seriesQuery(scope).where('series.id', int(p.series_id, 0)).select('series.*').first();
    if (!s) return { seasons: [], info: [], episodes: [] };
    const eps = await db('streams')
      .where({ series_id: s.id, type: 'episode', enabled: true })
      .orderBy('season').orderBy('episode_num');
    const episodes = {};
    for (const e of eps) {
      const season = Number(e.season) || 1;
      const info = parseJson(e.info, {}) || {};
      (episodes[season] ||= []).push({
        id: String(e.id),
        episode_num: Number(e.episode_num) || 1,
        title: e.name,
        container_extension: e.container_extension || 'mp4',
        info: { ...info, plot: info.plot || '', duration: info.duration || '', movie_image: info.cover || '' },
        custom_sid: '',
        added: str(e.created_at),
        season,
        direct_source: '',
      });
    }
    const seasons = Object.keys(episodes).map((n) => ({
      season_number: Number(n),
      name: `Temporada ${n}`,
      episode_count: episodes[n].length,
      cover: s.cover || '',
      air_date: '',
    }));
    return { seasons, info: seriesItem(s, 1), episodes };
  },

  async get_short_epg(p, scope) {
    return { epg_listings: await epgListings(p, scope, { limit: Math.max(1, Math.min(50, int(p.limit, 4))) }) };
  },
  async get_simple_data_table(p, scope) {
    return { epg_listings: await epgListings(p, scope, { full: true }) };
  },
};

/** Sección de cada acción: si el cliente no la tiene, la respuesta es vacía (como si no existiera). */
const ACTION_SECTION = {
  get_live_categories: 'live', get_live_streams: 'live', get_short_epg: 'live', get_simple_data_table: 'live',
  get_vod_categories: 'movies', get_vod_streams: 'movies', get_vod_info: 'movies',
  get_series_categories: 'series', get_series: 'series', get_series_info: 'series',
};
const EMPTY_ANSWER = {
  get_short_epg: { epg_listings: [] },
  get_simple_data_table: { epg_listings: [] },
  get_vod_info: { info: [], movie_data: [] },
  get_series_info: { seasons: [], info: [], episodes: [] },
};

router.all('/player_api.php', async (req, res) => {
  const p = params(req);
  const user = await findUserByCredentials(p.username, p.password);
  if (!user) return res.json({ user_info: { auth: 0 } });
  await recordDeviceSeen(req, user, 'xtream_api');
  if (!p.action) return res.json(await userInfo(user, req));

  const handler = actions[p.action];
  if (!handler) return res.json([]);
  if (userStatus(user) !== 'active' || !sectionAllowed(user, ACTION_SECTION[p.action])) {
    return res.json(EMPTY_ANSWER[p.action] ?? []);
  }
  res.json(await handler(p, await contentScope(user)));
});

/* ------------------------------------ get.php ------------------------------------ */

const attr = (v) => String(v ?? '').replace(/"/g, "'").replace(/[\r\n]+/g, ' ');

router.get('/get.php', async (req, res) => {
  const p = params(req);
  const user = await findUserByCredentials(p.username, p.password);
  if (!user) return res.status(401).type('text/plain').send('Credenciales inválidas');
  await recordDeviceSeen(req, user, 'm3u');
  if (userStatus(user) !== 'active') return res.status(403).type('text/plain').send('Cuenta no activa');

  const scope = await contentScope(user);
  const plus = p.type !== 'm3u';
  const liveExt = p.output === 'm3u8' || p.output === 'hls' ? 'm3u8' : 'ts';
  const { base } = requestOrigin(req);
  const e = encodeURIComponent;
  const creds = `${e(user.username)}/${e(user.password)}`;
  const catNames = new Map((await db('categories').select('id', 'name')).map((c) => [c.id, c.name]));

  const live = sectionAllowed(user, 'live') ? await orderedByCategory(liveOrVodQuery('live', scope)) : [];
  // Dirección de la guía en la cabecera: TiviMate, OTT Navigator, Kodi, Perfect Player… la cargan solos.
  const settingsForEpg = await getSettings();
  const hasGuide = live.length > 0 && (fs.existsSync(GUIDE_FILE) || Boolean(settingsForEpg.epg_url));
  const epgUrl = `${base}/xmltv.php?username=${e(user.username)}&password=${e(user.password)}`;
  const lines = [plus && hasGuide ? `#EXTM3U url-tvg="${epgUrl}" x-tvg-url="${epgUrl}"` : '#EXTM3U'];
  const push = (name, url, { epg = '', logo = '', group = '' } = {}) => {
    lines.push(plus
      ? `#EXTINF:-1 tvg-id="${attr(epg)}" tvg-name="${attr(name)}" tvg-logo="${attr(logo)}" group-title="${attr(group)}",${name}`
      : `#EXTINF:-1,${name}`);
    lines.push(url);
  };

  for (const s of live) {
    push(s.name, `${base}/live/${creds}/${s.id}.${liveExt}`, {
      epg: s.epg_channel_id, logo: s.logo, group: catNames.get(s.category_id) || UNCATEGORIZED.name,
    });
  }
  const movies = sectionAllowed(user, 'movies') ? await orderedByCategory(liveOrVodQuery('movie', scope)) : [];
  for (const s of movies) {
    push(s.name, `${base}/movie/${creds}/${s.id}.${s.container_extension || 'mp4'}`, {
      logo: s.logo || streamInfo(s).cover, group: catNames.get(s.category_id) || UNCATEGORIZED.name,
    });
  }
  const seriesRows = sectionAllowed(user, 'series')
    ? await seriesQuery(scope).select('series.id', 'series.name', 'series.cover', 'series.category_id')
    : [];
  if (seriesRows.length) {
    const seriesMap = new Map(seriesRows.map((s) => [s.id, s]));
    const eps = await db('streams').where({ type: 'episode', enabled: true })
      .whereIn('series_id', seriesRows.map((s) => s.id))
      .orderBy('series_id').orderBy('season').orderBy('episode_num');
    for (const ep of eps) {
      const s = seriesMap.get(ep.series_id);
      const label = `${s.name} S${String(ep.season || 1).padStart(2, '0')} E${String(ep.episode_num || 1).padStart(2, '0')}`;
      push(label, `${base}/series/${creds}/${ep.id}.${ep.container_extension || 'mp4'}`, {
        logo: s.cover, group: catNames.get(s.category_id) || s.name,
      });
    }
  }

  res.setHeader('Content-Disposition', 'attachment; filename="playlist.m3u"');
  res.type('audio/x-mpegurl; charset=utf-8').send(lines.join('\n') + '\n');
});

/* ------------------------------------ xmltv.php ------------------------------------ */

router.get('/xmltv.php', async (req, res) => {
  const p = params(req);
  const user = await findUserByCredentials(p.username, p.password);
  if (!user) return res.status(401).type('text/plain').send('Credenciales inválidas');
  if (!sectionAllowed(user, 'live')) {
    // Sin canales en su plan: una guía vacía (el cliente no ve que existen)
    return res.type('application/xml; charset=utf-8').send('<?xml version="1.0" encoding="UTF-8"?>\n<tv></tv>\n');
  }
  if (fs.existsSync(GUIDE_FILE)) {
    res.type('application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=900');
    if (/\bgzip\b/.test(req.get('accept-encoding') || '')) {
      res.setHeader('Content-Encoding', 'gzip');
      return pipeline(fs.createReadStream(GUIDE_FILE), res).catch(() => res.destroy());
    }
    return pipeline(fs.createReadStream(GUIDE_FILE), zlib.createGunzip(), res).catch(() => res.destroy());
  }
  const settings = await getSettings();
  if (!settings.epg_url) return res.status(404).type('text/plain').send('Guía EPG no configurada');
  const upstream = await fetch(settings.epg_url, { signal: AbortSignal.timeout(120000) }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return res.status(502).type('text/plain').send('No se pudo obtener la guía EPG');
  res.type(upstream.headers.get('content-type') || 'application/xml');
  await pipeline(Readable.fromWeb(upstream.body), res).catch(() => res.destroy());
});

/* ------------------------------- URLs de reproducción ------------------------------- */

const FILE_RE = /^(\d+)(?:\.([A-Za-z0-9]{2,5}))?$/;

for (const kind of ['live', 'movie', 'series']) {
  router.get(`/${kind}/:username/:password/:file`, async (req, res, next) => {
    const m = FILE_RE.exec(req.params.file);
    if (!m) return next();
    await serveStream(req, res, {
      kind, username: req.params.username, password: req.params.password,
      streamId: Number(m[1]), ext: (m[2] || (kind === 'live' ? 'ts' : 'mp4')).toLowerCase(),
    });
  });
}

// Formato antiguo de Xtream: /{usuario}/{contraseña}/{id} (en vivo).
router.get('/:username/:password/:file', async (req, res, next) => {
  const m = FILE_RE.exec(req.params.file);
  if (!m || ['api', 'admin'].includes(req.params.username)) return next();
  await serveStream(req, res, {
    kind: 'live', username: req.params.username, password: req.params.password,
    streamId: Number(m[1]), ext: (m[2] || 'ts').toLowerCase(),
  });
});

export default router;
