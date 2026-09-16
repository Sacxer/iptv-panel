// Migración desde la base MySQL de XtreamUI / Xtream Codes (y variantes XUI).
// Conserva IDs, credenciales, vencimientos y paquetes para que los clientes no pierdan el acceso.
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { db, fixSequence, insertId, BATCH_SIZE } from '../db/index.js';
import { hashPassword } from '../lib/auth.js';
import { logAction } from '../lib/log.js';
import { HttpError, chunk, int, now, parseJson, randomString } from '../lib/util.js';

const PAGE = 5000;

export async function openXtream(conn) {
  if (!conn?.host || !conn?.user || !conn?.database) {
    throw new HttpError(400, 'Completa host, usuario y base de datos de XtreamUI');
  }
  try {
    return await mysql.createConnection({
      host: conn.host,
      port: int(conn.port, 3306),
      user: conn.user,
      password: conn.password || '',
      database: conn.database,
      connectTimeout: 15000,
      charset: 'utf8mb4',
      supportBigNumbers: true,
      bigNumberStrings: false,
      dateStrings: true,
    });
  } catch (err) {
    throw new HttpError(400, `No se pudo conectar a MySQL: ${err.message}`);
  }
}

async function columnsOf(my, table) {
  const [rows] = await my.query(
    'SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table],
  );
  return rows.length ? new Set(rows.map((r) => r.c)) : null;
}

async function scalar(my, sql, params = []) {
  const [rows] = await my.query(sql, params);
  return Number(Object.values(rows[0] || { c: 0 })[0]) || 0;
}

/** Mapa type_id → 'live' | 'movie' | 'episode' según la tabla streams_types. */
async function streamTypeMap(my) {
  const map = new Map([[1, 'live'], [2, 'movie'], [3, 'live'], [4, 'live'], [5, 'episode']]);
  if (await columnsOf(my, 'streams_types')) {
    const [rows] = await my.query('SELECT type_id, type_key FROM streams_types');
    for (const r of rows) {
      const key = String(r.type_key || '').toLowerCase();
      if (key === 'movie') map.set(Number(r.type_id), 'movie');
      else if (key === 'series') map.set(Number(r.type_id), 'episode');
      else map.set(Number(r.type_id), 'live');
    }
  }
  return map;
}

function idsOfType(typeMap, kind) {
  return [...typeMap.entries()].filter(([, v]) => v === kind).map(([k]) => k);
}

/** Lista de IDs guardada como JSON ('["1","2"]', '[1,2]') o CSV. */
function jsonIds(v) {
  const parsed = parseJson(v, null);
  const arr = Array.isArray(parsed) ? parsed : typeof v === 'string' ? v.split(',') : [];
  return arr.map((x) => int(x)).filter((x) => x !== null && x > 0);
}

function firstCategory(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && v.trim().startsWith('[')) return jsonIds(v)[0] ?? null;
  return int(v);
}

function sourceList(v) {
  const parsed = parseJson(v, null);
  if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  return v ? [String(v)] : [];
}

function containerOf(v, fallback) {
  const parsed = parseJson(v, null);
  if (Array.isArray(parsed)) return String(parsed[0] || fallback);
  if (typeof v === 'string' && v && !v.startsWith('[')) return v;
  return fallback;
}

function movieInfo(row) {
  const props = parseJson(row.movie_propeties ?? row.movie_properties, {}) || {};
  const backdrop = Array.isArray(props.backdrop_path) ? props.backdrop_path[0] : props.backdrop_path;
  return {
    plot: props.plot || props.description || '',
    genre: props.genre || '',
    rating: props.rating ? String(props.rating) : '',
    releasedate: props.releasedate || props.release_date || '',
    duration: props.duration || '',
    duration_secs: int(props.duration_secs, 0),
    cover: props.movie_image || props.cover_big || '',
    backdrop: backdrop || '',
    cast: props.cast || props.actors || '',
    director: props.director || '',
    youtube_trailer: props.youtube_trailer || '',
    tmdb_id: props.tmdb_id || '',
  };
}

export async function testXtream(conn) {
  const my = await openXtream(conn);
  try {
    const userCols = await columnsOf(my, 'users');
    if (!userCols || !userCols.has('username') || !userCols.has('password')) {
      throw new HttpError(400, 'No se encontró la tabla "users" de XtreamUI en esa base de datos');
    }
    const typeMap = await streamTypeMap(my);
    const inList = (ids) => (ids.length ? ids.join(',') : '-1');
    const has = async (t) => Boolean(await columnsOf(my, t));
    // Puerto HTTP que usan hoy los clientes (servidor principal de XtreamUI / XUI.one).
    let broadcastPort = null;
    for (const table of ['streaming_servers', 'servers']) {
      const cols = await columnsOf(my, table);
      if (!cols?.has('http_broadcast_port')) continue;
      const [rows] = await my.query(`SELECT http_broadcast_port AS p FROM ${table}${cols.has('is_main') ? ' ORDER BY is_main DESC' : ''} LIMIT 1`);
      broadcastPort = Number(rows[0]?.p) || null;
      break;
    }
    return {
      ok: true,
      broadcast_port: broadcastPort,
      counts: {
        users: await scalar(my, 'SELECT COUNT(*) c FROM users'),
        resellers: (await has('reg_users')) ? await scalar(my, 'SELECT COUNT(*) c FROM reg_users') : 0,
        bouquets: (await has('bouquets')) ? await scalar(my, 'SELECT COUNT(*) c FROM bouquets') : 0,
        categories: (await has('stream_categories')) ? await scalar(my, 'SELECT COUNT(*) c FROM stream_categories') : 0,
        live: await scalar(my, `SELECT COUNT(*) c FROM streams WHERE type IN (${inList(idsOfType(typeMap, 'live'))})`),
        movie: await scalar(my, `SELECT COUNT(*) c FROM streams WHERE type IN (${inList(idsOfType(typeMap, 'movie'))})`),
        series: (await has('series')) ? await scalar(my, 'SELECT COUNT(*) c FROM series') : 0,
        episodes: (await has('series_episodes')) ? await scalar(my, 'SELECT COUNT(*) c FROM series_episodes') : 0,
      },
    };
  } finally {
    await my.end().catch(() => {});
  }
}

/* ------------------------------ Importador genérico ------------------------------ */

class TableImporter {
  constructor(table, { overwrite, matchUsername = false }) {
    this.table = table;
    this.overwrite = overwrite;
    this.matchUsername = matchUsername;
    this.byXtream = new Map(); // xtream_id → id local
    this.byUsername = new Map();
    this.usedIds = new Set();
    this.map = new Map(); // xtream_id → id local (todos los procesados)
    this.changed = new Set(); // ids locales creados o actualizados (sus relaciones se reemplazan)
    this.stat = { created: 0, updated: 0, skipped: 0 };
    this.explicitIds = false;
  }

  async load() {
    const cols = ['id', 'xtream_id', ...(this.matchUsername ? ['username'] : [])];
    for (const r of await db(this.table).select(cols)) {
      this.usedIds.add(r.id);
      if (r.xtream_id !== null && r.xtream_id !== undefined) this.byXtream.set(Number(r.xtream_id), r.id);
      if (this.matchUsername) this.byUsername.set(r.username, r.id);
    }
    return this;
  }

  /** Importa filas ya transformadas (deben incluir xtream_id). */
  async importBatch(trx, rows) {
    const explicit = [];
    for (const row of rows) {
      const xid = row.xtream_id;
      let localId = this.byXtream.get(xid);
      if (localId === undefined && this.matchUsername) localId = this.byUsername.get(row.username);
      if (localId !== undefined) {
        this.map.set(xid, localId);
        this.byXtream.set(xid, localId);
        if (this.overwrite) {
          await trx(this.table).where({ id: localId }).update(row);
          this.stat.updated++;
          this.changed.add(localId);
        } else {
          this.stat.skipped++;
        }
        continue;
      }
      let id;
      if (!this.usedIds.has(xid)) {
        id = xid; // se conserva el ID original: las URLs de los clientes siguen funcionando
        explicit.push({ id, ...row });
        this.explicitIds = true;
      } else {
        // Antes de un id automático, volcar los explícitos pendientes para evitar colisiones.
        for (const part of chunk(explicit.splice(0), BATCH_SIZE)) await trx(this.table).insert(part);
        if (this.explicitIds) await fixSequence(this.table, trx);
        id = await insertId(trx, this.table, row);
      }
      this.usedIds.add(id);
      this.map.set(xid, id);
      this.byXtream.set(xid, id);
      if (this.matchUsername) this.byUsername.set(row.username, id);
      this.changed.add(id);
      this.stat.created++;
    }
    for (const part of chunk(explicit, BATCH_SIZE)) await trx(this.table).insert(part);
  }

  async finish(trx) {
    if (this.explicitIds) await fixSequence(this.table, trx);
  }
}

async function replaceLinks(trx, table, ownerCol, ownerId, itemCol, itemIds) {
  await trx(table).where({ [ownerCol]: ownerId }).del();
  const unique = [...new Set(itemIds)];
  for (const part of chunk(unique, BATCH_SIZE)) {
    await trx(table).insert(part.map((id) => ({ [ownerCol]: ownerId, [itemCol]: id })));
  }
}

/* ---------------------------------- Trabajos ---------------------------------- */

const jobs = new Map();

function jobRow(job) {
  return {
    id: job.id,
    status: job.status,
    progress: JSON.stringify(job.progress),
    stats: JSON.stringify(job.stats),
    log: JSON.stringify(job.log.slice(-500)),
    error: job.error,
    reseller_credentials: JSON.stringify(job.reseller_credentials),
    started_at: job.started_at,
    finished_at: job.finished_at,
  };
}

function jobFromRow(r) {
  return {
    id: r.id,
    status: r.status,
    progress: parseJson(r.progress, {}),
    stats: parseJson(r.stats, {}),
    log: parseJson(r.log, []),
    error: r.error,
    reseller_credentials: parseJson(r.reseller_credentials, []),
    started_at: Number(r.started_at),
    finished_at: r.finished_at ? Number(r.finished_at) : null,
  };
}

async function persist(job) {
  const row = jobRow(job);
  const exists = await db('xtream_jobs').where({ id: job.id }).first();
  if (exists) await db('xtream_jobs').where({ id: job.id }).update(row);
  else await db('xtream_jobs').insert(row);
}

export async function markInterruptedJobs() {
  await db('xtream_jobs').where({ status: 'running' })
    .update({ status: 'error', error: 'Interrumpida por reinicio del servidor', finished_at: now() });
}

export async function listJobs() {
  const rows = await db('xtream_jobs').orderBy('started_at', 'desc').limit(20);
  return rows.map((r) => {
    const job = jobs.get(r.id) || jobFromRow(r);
    const { log: _log, reseller_credentials: _rc, ...rest } = job;
    return rest;
  });
}

export async function getJob(id) {
  if (jobs.has(id)) return jobs.get(id);
  const row = await db('xtream_jobs').where({ id }).first();
  return row ? jobFromRow(row) : null;
}

/** `connection` permite inyectar una conexión MySQL ya abierta (usado en pruebas). */
export async function startMigration(admin, conn, options, { connection } = {}) {
  if ([...jobs.values()].some((j) => j.status === 'running')) {
    throw new HttpError(409, 'Ya hay una migración en curso');
  }
  const opts = {
    categories: true, packages: true, streams: true, series: true, users: true, resellers: false, overwrite: false,
    ...options,
  };
  // Conectar antes de crear el trabajo para devolver errores de conexión inmediatamente.
  const my = connection || (await openXtream(conn));
  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    status: 'running',
    progress: { step: 'connect', current: 0, total: 0 },
    stats: {},
    log: [],
    error: null,
    reseller_credentials: [],
    started_at: now(),
    finished_at: null,
  };
  jobs.set(job.id, job);
  await persist(job);
  await logAction(admin, 'xtream.migrate.start', 'xtream', job.id, opts);

  const ticker = setInterval(() => persist(job).catch(() => {}), 3000);
  runMigration(job, my, admin, opts)
    .then(() => {
      job.status = 'done';
      job.progress = { step: 'done', current: 1, total: 1 };
      addLog(job, 'Migración completada.');
    })
    .catch((err) => {
      job.status = 'error';
      job.error = err.message;
      addLog(job, `ERROR: ${err.message}`);
      console.error('Migración XtreamUI fallida:', err);
    })
    .finally(async () => {
      clearInterval(ticker);
      job.finished_at = now();
      await my.end().catch(() => {});
      await persist(job).catch(() => {});
      await logAction(admin, `xtream.migrate.${job.status}`, 'xtream', job.id, job.stats);
      setTimeout(() => jobs.delete(job.id), 10 * 60 * 1000).unref();
    });
  return job;
}

function addLog(job, line) {
  const d = new Date();
  job.log.push(`[${d.toLocaleTimeString('es')}] ${line}`);
  if (job.log.length > 1000) job.log.splice(0, job.log.length - 1000);
}

/** Recorre una tabla MySQL por páginas de id. */
async function* pages(my, sqlBase, idColumn = 'id', keyField = 'id') {
  let lastId = 0;
  for (;;) {
    const where = sqlBase.includes(' WHERE ') ? ' AND ' : ' WHERE ';
    const [rows] = await my.query(`${sqlBase}${where}${idColumn} > ? ORDER BY ${idColumn} LIMIT ${PAGE}`, [lastId]);
    if (!rows.length) return;
    lastId = Number(rows[rows.length - 1][keyField]);
    yield rows;
    if (rows.length < PAGE) return;
  }
}

async function runMigration(job, my, admin, opts) {
  addLog(job, 'Conectado a MySQL de XtreamUI.');
  const t = now();
  const typeMap = await streamTypeMap(my);
  const overwrite = Boolean(opts.overwrite);

  /* ---- Categorías ---- */
  const categories = await new TableImporter('categories', { overwrite }).load();
  job.stats.categories = categories.stat;
  const catCols = await columnsOf(my, 'stream_categories');
  if (catCols) {
    const [rows] = await my.query('SELECT * FROM stream_categories ORDER BY id');
    if (opts.categories || opts.streams || opts.series) {
      job.progress = { step: 'categories', current: 0, total: rows.length };
      addLog(job, `Importando ${rows.length} categorías…`);
      const typeOf = (v) => (v === 'movie' ? 'movie' : v === 'series' ? 'series' : 'live');
      await db.transaction(async (trx) => {
        await categories.importBatch(trx, rows.map((r) => ({
          name: String(r.category_name || 'Sin nombre').slice(0, 255),
          type: typeOf(r.category_type),
          sort_order: int(r.cat_order, 0),
          xtream_id: Number(r.id),
          created_at: t,
        })));
        await categories.finish(trx);
      });
      job.progress.current = rows.length;
    }
  }
  const catLocal = (xid) => (xid === null ? null : categories.map.get(xid) ?? categories.byXtream.get(xid) ?? null);

  /* ---- Paquetes (bouquets) ---- */
  const packages = await new TableImporter('packages', { overwrite }).load();
  job.stats.packages = packages.stat;
  const bouquetCols = await columnsOf(my, 'bouquets');
  let bouquets = [];
  if (bouquetCols) {
    [bouquets] = await my.query('SELECT * FROM bouquets ORDER BY id');
    if (opts.packages) {
      job.progress = { step: 'packages', current: 0, total: bouquets.length };
      addLog(job, `Importando ${bouquets.length} paquetes (bouquets)…`);
      await db.transaction(async (trx) => {
        await packages.importBatch(trx, bouquets.map((b) => ({
          name: String(b.bouquet_name || `Paquete ${b.id}`).slice(0, 255),
          description: 'Importado de XtreamUI',
          xtream_id: Number(b.id),
          created_at: t,
        })));
        await packages.finish(trx);
      });
    }
  }

  /* ---- Canales y películas ---- */
  const streams = await new TableImporter('streams', { overwrite }).load();
  job.stats.streams = streams.stat;
  if (opts.streams) {
    const types = [...idsOfType(typeMap, 'live'), ...idsOfType(typeMap, 'movie')];
    const total = await scalar(my, `SELECT COUNT(*) c FROM streams WHERE type IN (${types.join(',') || -1})`);
    job.progress = { step: 'streams', current: 0, total };
    addLog(job, `Importando ${total} canales y películas…`);
    for await (const rows of pages(my, `SELECT * FROM streams WHERE type IN (${types.join(',') || -1})`)) {
      await db.transaction(async (trx) => {
        await streams.importBatch(trx, rows.map((r) => {
          const kind = typeMap.get(Number(r.type)) === 'movie' ? 'movie' : 'live';
          const sources = sourceList(r.stream_source);
          const info = kind === 'movie' ? movieInfo(r) : {};
          return {
            type: kind,
            name: String(r.stream_display_name || `Canal ${r.id}`).slice(0, 512),
            category_id: catLocal(firstCategory(r.category_id)),
            logo: r.stream_icon || info.cover || '',
            source_url: sources[0] || '',
            backup_urls: JSON.stringify(sources.slice(1)),
            epg_channel_id: r.channel_id || '',
            container_extension: kind === 'movie' ? containerOf(r.target_container, 'mp4') : 'ts',
            tv_archive_duration: int(r.tv_archive_duration, 0),
            sort_order: int(r.order, 0),
            enabled: true,
            info: JSON.stringify(info),
            source: 'xtreamui',
            xtream_id: Number(r.id),
            created_at: int(r.added, t) || t,
            updated_at: t,
          };
        }));
      });
      job.progress.current += rows.length;
    }
    await db.transaction((trx) => streams.finish(trx));
    const noSource = await db('streams').where({ source: 'xtreamui' }).where((w) => w.whereNull('source_url').orWhere('source_url', '')).count({ c: '*' }).first();
    if (Number(noSource.c)) {
      addLog(job, `Aviso: ${noSource.c} contenidos sin URL de origen (canales "creados" en XtreamUI). Usa el modo xtream_upstream o edítalos.`);
    }
  }

  /* ---- Series y episodios ---- */
  const series = await new TableImporter('series', { overwrite }).load();
  job.stats.series = series.stat;
  const episodes = streams; // los episodios viven en la tabla streams
  job.stats.episodes = { created: 0, updated: 0, skipped: 0 };
  if (opts.series && (await columnsOf(my, 'series'))) {
    const [rows] = await my.query('SELECT * FROM series ORDER BY id');
    job.progress = { step: 'series', current: 0, total: rows.length };
    addLog(job, `Importando ${rows.length} series…`);
    for (const part of chunk(rows, PAGE)) {
      await db.transaction(async (trx) => {
        await series.importBatch(trx, part.map((r) => {
          const backdrop = parseJson(r.backdrop_path, []);
          return {
            name: String(r.title || `Serie ${r.id}`).slice(0, 512),
            category_id: catLocal(firstCategory(r.category_id)),
            cover: r.cover || r.cover_big || '',
            plot: r.plot || '',
            cast_list: r.cast || '',
            director: r.director || '',
            genre: r.genre || '',
            release_date: r.releaseDate || r.release_date || '',
            rating: r.rating ? String(r.rating) : '',
            backdrop: Array.isArray(backdrop) ? backdrop[0] || '' : String(backdrop || ''),
            youtube_trailer: r.youtube_trailer || '',
            episode_run_time: r.episode_run_time ? String(r.episode_run_time) : '',
            enabled: true,
            source: 'xtreamui',
            xtream_id: Number(r.id),
            created_at: int(r.last_modified, t) || t,
            updated_at: t,
          };
        }));
      });
      job.progress.current += part.length;
    }
    await db.transaction((trx) => series.finish(trx));

    if (await columnsOf(my, 'series_episodes')) {
      const total = await scalar(my, 'SELECT COUNT(*) c FROM series_episodes');
      job.progress = { step: 'episodes', current: 0, total };
      addLog(job, `Importando ${total} episodios…`);
      const before = { ...episodes.stat };
      const sql = 'SELECT e.id AS episode_row_id, e.season_num, e.series_id AS x_series_id, e.sort, s.* '
        + 'FROM series_episodes e JOIN streams s ON s.id = e.stream_id';
      for await (const rows of pages(my, sql, 'e.id', 'episode_row_id')) {
        const mapped = [];
        for (const r of rows) {
          const seriesId = series.map.get(Number(r.x_series_id)) ?? series.byXtream.get(Number(r.x_series_id));
          if (!seriesId) continue;
          const sources = sourceList(r.stream_source);
          const info = movieInfo(r);
          mapped.push({
            type: 'episode',
            name: String(r.stream_display_name || `Episodio ${r.sort}`).slice(0, 512),
            series_id: seriesId,
            season: int(r.season_num, 1),
            episode_num: int(r.sort, 1),
            logo: info.cover || '',
            source_url: sources[0] || '',
            backup_urls: JSON.stringify(sources.slice(1)),
            container_extension: containerOf(r.target_container, 'mp4'),
            enabled: true,
            info: JSON.stringify(info),
            source: 'xtreamui',
            xtream_id: Number(r.id),
            created_at: int(r.added, t) || t,
            updated_at: t,
          });
        }
        await db.transaction((trx) => episodes.importBatch(trx, mapped));
        job.progress.current += rows.length;
      }
      await db.transaction((trx) => episodes.finish(trx));
      for (const k of Object.keys(before)) job.stats.episodes[k] = episodes.stat[k] - before[k];
      for (const k of Object.keys(before)) streams.stat[k] = before[k];
    }
  }

  /* ---- Contenido de los paquetes ---- */
  if (opts.packages && bouquets.length) {
    job.progress = { step: 'package_links', current: 0, total: bouquets.length };
    addLog(job, 'Asignando contenido a los paquetes…');
    const streamLocal = new Map(await db('streams').whereNotNull('xtream_id').whereNot('type', 'episode')
      .select('id', 'xtream_id').then((rows) => rows.map((r) => [Number(r.xtream_id), r.id])));
    const seriesLocal = new Map(await db('series').whereNotNull('xtream_id')
      .select('id', 'xtream_id').then((rows) => rows.map((r) => [Number(r.xtream_id), r.id])));
    await db.transaction(async (trx) => {
      for (const b of bouquets) {
        const pid = packages.map.get(Number(b.id));
        if (!pid || !packages.changed.has(pid)) continue;
        const channelIds = [
          ...jsonIds(b.bouquet_channels), ...jsonIds(b.bouquet_movies), ...jsonIds(b.bouquet_radios),
        ].map((x) => streamLocal.get(x)).filter(Boolean);
        const seriesIds = jsonIds(b.bouquet_series).map((x) => seriesLocal.get(x)).filter(Boolean);
        await replaceLinks(trx, 'package_streams', 'package_id', pid, 'stream_id', channelIds);
        await replaceLinks(trx, 'package_series', 'package_id', pid, 'series_id', seriesIds);
        job.progress.current++;
      }
    });
  }

  /* ---- Revendedores ---- */
  const resellerMap = new Map(); // reg_users.id → admins.id
  job.stats.resellers = { created: 0, updated: 0, skipped: 0 };
  const regCols = await columnsOf(my, 'reg_users');
  if (regCols) {
    const hasGroups = Boolean(await columnsOf(my, 'member_groups'));
    const [regs] = await my.query(hasGroups
      ? 'SELECT r.*, g.is_admin AS g_is_admin, g.is_reseller AS g_is_reseller FROM reg_users r LEFT JOIN member_groups g ON g.group_id = r.member_group_id'
      : 'SELECT r.* FROM reg_users r');
    const existing = await db('admins').select('id', 'username', 'xtream_id');
    for (const a of existing) if (a.xtream_id) resellerMap.set(Number(a.xtream_id), a.id);
    if (opts.resellers) {
      addLog(job, `Revisando ${regs.length} cuentas de panel (revendedores)…`);
      for (const r of regs) {
        const isAdmin = hasGroups ? Number(r.g_is_admin) === 1 : Number(r.member_group_id) === 1;
        if (isAdmin) continue;
        const match = existing.find((a) => Number(a.xtream_id) === Number(r.id) || a.username === r.username);
        if (match) {
          resellerMap.set(Number(r.id), match.id);
          if (!match.xtream_id) await db('admins').where({ id: match.id }).update({ xtream_id: Number(r.id) });
          job.stats.resellers.skipped++;
          continue;
        }
        const password = randomString(12);
        const id = await insertId(db, 'admins', {
          username: String(r.username).slice(0, 64),
          password_hash: await hashPassword(password),
          role: 'reseller',
          enabled: Number(r.status ?? 1) === 1,
          xtream_id: Number(r.id),
          created_at: t,
        });
        resellerMap.set(Number(r.id), id);
        job.reseller_credentials.push({ username: r.username, password });
        job.stats.resellers.created++;
      }
    }
  }

  /* ---- Usuarios (líneas) ---- */
  const users = await new TableImporter('users', { overwrite, matchUsername: true }).load();
  job.stats.users = users.stat;
  if (opts.users) {
    const packageLocal = new Map(await db('packages').whereNotNull('xtream_id')
      .select('id', 'xtream_id').then((rows) => rows.map((r) => [Number(r.xtream_id), r.id])));
    const total = await scalar(my, 'SELECT COUNT(*) c FROM users');
    job.progress = { step: 'users', current: 0, total };
    addLog(job, `Importando ${total} usuarios…`);
    let magCount = 0;
    for await (const rows of pages(my, 'SELECT * FROM users')) {
      const bouquetsByXid = new Map();
      const mapped = rows.map((r) => {
        if (Number(r.is_mag) === 1 || Number(r.is_e2) === 1) magCount++;
        const banned = r.admin_enabled !== undefined && Number(r.admin_enabled) === 0;
        const exp = int(r.exp_date, 0);
        const notes = [r.admin_notes, r.reseller_notes].filter((x) => x && String(x).trim()).join('\n');
        bouquetsByXid.set(Number(r.id), jsonIds(r.bouquet));
        return {
          username: String(r.username),
          password: String(r.password ?? ''),
          exp_date: exp > 0 ? exp : null,
          max_connections: Math.max(0, int(r.max_connections, 1)),
          enabled: r.enabled === undefined ? true : Number(r.enabled) === 1,
          suspended: banned,
          suspension_reason: banned ? 'Bloqueado en XtreamUI' : null,
          is_trial: Number(r.is_trial) === 1,
          notes: notes || null,
          owner_id: resellerMap.get(Number(r.member_id)) ?? admin.id,
          source: 'xtreamui',
          xtream_id: Number(r.id),
          created_at: int(r.created_at, t) || t,
          updated_at: t,
        };
      });
      await db.transaction(async (trx) => {
        await users.importBatch(trx, mapped);
        for (const [xid, bouquetIds] of bouquetsByXid) {
          const uid = users.map.get(xid);
          if (!uid || !users.changed.has(uid)) continue;
          const pkgIds = bouquetIds.map((b) => packageLocal.get(b)).filter(Boolean);
          await replaceLinks(trx, 'user_packages', 'user_id', uid, 'package_id', pkgIds);
        }
      });
      job.progress.current += rows.length;
    }
    await db.transaction((trx) => users.finish(trx));
    if (magCount) {
      addLog(job, `Aviso: ${magCount} líneas eran MAG/Enigma2. Se importaron, pero esos equipos deben configurarse con URL de lista M3U o Xtream.`);
    }
  }

  addLog(job, `Resumen: ${JSON.stringify(job.stats)}`);
}
