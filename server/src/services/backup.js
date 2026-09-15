// Copias de seguridad de toda la base de datos en un archivo portable (sirve entre SQLite, PostgreSQL y MySQL),
// comprimido y, si se quiere, cifrado con contraseña. Restauración, limpieza automática, copias programadas
// y envío a Google Drive.
//
// Formato del archivo (.iptvbak):
//   "IPTVBAK1\n" + JSON de metadatos + "\n" + contenido
//   contenido = gzip de líneas JSON ({type:"table"}, {type:"rows"}, …, {type:"end"})
//   cifrado: AES-256-GCM(contenido gzip) + etiqueta de 16 bytes, clave derivada con scrypt.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import zlib from 'node:zlib';
import { config } from '../config.js';
import {
  BATCH_SIZE, db, dialect, fixSequence, insertId,
} from '../db/index.js';
import { migrationSource } from '../db/schema.js';
import { logAction } from '../lib/log.js';
import {
  PRESERVED_SETTING_KEYS, getSettings, invalidateSettings, saveSettings,
} from '../lib/settings.js';
import {
  addCalendarDays, parseTime, safeZone, zoneParts, zonedToUnix,
} from '../lib/time.js';
import {
  HttpError, bool, now, parseJson, randomString,
} from '../lib/util.js';
import * as drive from './googleDrive.js';

const MAGIC = 'IPTVBAK1\n';
const FORMAT_VERSION = 1;
const ROWS_PER_LINE = 500;
const KDF = { N: 32768, r: 8, p: 1 };
export const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;

// Nunca se exportan: control de migraciones, el propio registro de backups y las sesiones en vivo.
const NEVER = new Set(['knex_migrations', 'knex_migrations_lock', 'backups', 'connections']);
// Se vacían al restaurar aunque no vengan en el backup (los reproductores las vuelven a registrar).
const CLEAR_ON_RESTORE = ['connections'];
const isInternal = (name) => NEVER.has(name) || name.startsWith('sqlite_');

const state = { running: null }; // { kind: 'backup' | 'restore', id, started_at }
const uploading = new Set();
let lastDriveRetry = 0;

export const backupRunning = () => state.running;

/* --------------------------------- Utilidades --------------------------------- */

const quoteSqlite = (n) => `"${String(n).replace(/"/g, '""')}"`;

function encodeValue(v) {
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return { $b64: v.toString('base64') };
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : String(v);
  return v;
}

function decodeValue(v, isBool) {
  if (v && typeof v === 'object' && typeof v.$b64 === 'string') return Buffer.from(v.$b64, 'base64');
  if (v === null || v === undefined) return null;
  if (isBool) {
    const b = v === true || v === 1 || v === '1' || v === 't' || v === 'true';
    return dialect === 'pg' ? b : (b ? 1 : 0);
  }
  if (typeof v === 'boolean') return dialect === 'pg' ? v : (v ? 1 : 0);
  return v;
}

/** Orden de tablas con las referenciadas (padres) primero. */
function parentFirst(tables, edges) {
  const set = new Set(tables);
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const [child, parent] of edges) {
    if (set.has(child) && set.has(parent) && child !== parent) deps.get(child).add(parent);
  }
  const out = [];
  const done = new Set();
  const visiting = new Set();
  const visit = (t) => {
    if (done.has(t) || visiting.has(t)) return;
    visiting.add(t);
    for (const p of [...deps.get(t)].sort()) visit(p);
    visiting.delete(t);
    done.add(t);
    out.push(t);
  };
  for (const t of [...tables].sort()) visit(t);
  return out;
}

/** Filas que no se exportan de una tabla (ajustes propios de este servidor). */
const filterFor = (table) => (table === 'settings' ? { column: 'key', notIn: PRESERVED_SETTING_KEYS } : null);

async function listTables(conn) {
  let names;
  if (dialect === 'better-sqlite3') {
    names = (await conn.raw("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
  } else if (dialect === 'pg') {
    names = (await conn.raw(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'",
    )).rows.map((r) => r.name);
  } else {
    names = (await conn.raw(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
    ))[0].map((r) => r.name ?? r.NAME ?? r.TABLE_NAME);
  }
  return names.filter((n) => !isInternal(n));
}

async function foreignKeys(conn, tables) {
  if (dialect === 'better-sqlite3') {
    const edges = [];
    for (const t of tables) {
      for (const fk of await conn.raw(`PRAGMA foreign_key_list(${quoteSqlite(t)})`)) edges.push([t, fk.table]);
    }
    return edges;
  }
  if (dialect === 'pg') {
    const r = await conn.raw(`SELECT tc.table_name AS child, ccu.table_name AS parent
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()`);
    return r.rows.map((x) => [x.child, x.parent]);
  }
  const [rows] = await conn.raw(`SELECT TABLE_NAME AS child, REFERENCED_TABLE_NAME AS parent
    FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`);
  return rows.map((x) => [x.child, x.parent]);
}

/* --------------------------- Lectura consistente (instantánea) --------------------------- */

/**
 * Abre una instantánea de lectura de toda la base. En SQLite usa una conexión aparte en modo lectura
 * (WAL): no bloquea al portal mientras se copia.
 */
async function openSnapshot() {
  if (dialect === 'better-sqlite3') {
    const { default: Database } = await import('better-sqlite3');
    const conn = new Database(config.db.file, { readonly: true, fileMustExist: true });
    conn.pragma('busy_timeout = 5000');
    conn.exec('BEGIN');
    conn.prepare('SELECT COUNT(*) FROM sqlite_master').get(); // fija la instantánea
    const where = (f) => (f ? { sql: ` WHERE ${quoteSqlite(f.column)} NOT IN (${f.notIn.map(() => '?').join(',')})`, params: f.notIn } : { sql: '', params: [] });
    return {
      async tables() {
        return conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name).filter((n) => !isInternal(n));
      },
      async edges(tables) {
        const edges = [];
        for (const t of tables) for (const fk of conn.pragma(`foreign_key_list(${quoteSqlite(t)})`)) edges.push([t, fk.table]);
        return edges;
      },
      async count(table) {
        const w = where(filterFor(table));
        return Number(conn.prepare(`SELECT COUNT(*) AS c FROM ${quoteSqlite(table)}${w.sql}`).get(...w.params).c);
      },
      async* rows(table) {
        const w = where(filterFor(table));
        const stmt = conn.prepare(`SELECT * FROM ${quoteSqlite(table)}${w.sql}`).raw(true);
        yield { columns: stmt.columns().map((c) => c.name) };
        let batch = [];
        for (const row of stmt.iterate(...w.params)) {
          batch.push(row);
          if (batch.length >= ROWS_PER_LINE) {
            yield { rows: batch };
            batch = [];
          }
        }
        if (batch.length) yield { rows: batch };
      },
      close() {
        try { conn.exec('COMMIT'); } catch { /* ya cerrada */ }
        conn.close();
      },
    };
  }

  const trx = await db.transaction();
  if (dialect === 'pg') await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const scoped = (table) => {
    const q = trx(table);
    const f = filterFor(table);
    if (f) q.whereNotIn(f.column, f.notIn);
    return q;
  };
  return {
    tables: () => listTables(trx),
    edges: (tables) => foreignKeys(trx, tables),
    async count(table) {
      return Number((await scoped(table).count({ c: '*' }).first()).c);
    },
    async* rows(table) {
      const columns = Object.keys(await trx(table).columnInfo());
      yield { columns };
      const hasId = columns.includes('id');
      let offset = 0;
      let lastId = null;
      for (;;) {
        const q = scoped(table).select(columns).limit(ROWS_PER_LINE);
        if (hasId) {
          q.orderBy('id');
          if (lastId !== null) q.where('id', '>', lastId);
        } else {
          q.orderBy(columns[0]).offset(offset);
        }
        const rows = await q;
        if (!rows.length) break;
        yield { rows: rows.map((r) => columns.map((c) => r[c])) };
        offset += rows.length;
        if (hasId) lastId = rows[rows.length - 1].id;
        if (rows.length < ROWS_PER_LINE) break;
      }
    },
    close() {
      trx.commit().catch(() => {});
    },
  };
}

/* --------------------------------- Cifrado --------------------------------- */

function deriveKey(password, salt, params = KDF) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, 32, { ...params, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const checkValue = (key) => crypto.createHmac('sha256', key).update('iptv-backup-check').digest('base64').slice(0, 24);

/** Clave del backup cifrado a partir de la contraseña; error claro si no coincide. */
export async function unlockKey(meta, password) {
  if (!meta.encryption) return null;
  if (!password) throw new HttpError(400, 'Este backup está cifrado: escribe su contraseña');
  const e = meta.encryption;
  const key = await deriveKey(password, Buffer.from(e.salt, 'base64'), { N: e.N, r: e.r, p: e.p });
  if (checkValue(key) !== e.check) throw new HttpError(400, 'La contraseña del backup no es correcta');
  return key;
}

/* --------------------------------- Escritura --------------------------------- */

async function writeBackupFile(filePath, { includeLogs, includeEpg, password, serverName }) {
  const snap = await openSnapshot();
  try {
    const all = await snap.tables();
    const tables = all.filter((t) => (includeLogs || t !== 'logs') && (includeEpg || t !== 'epg_programmes'));
    const ordered = parentFirst(tables, await snap.edges(tables));
    const counts = {};
    for (const t of ordered) counts[t] = await snap.count(t);

    const meta = {
      format: 'iptv-backup',
      format_version: FORMAT_VERSION,
      app_version: config.version,
      created_at: now(),
      server_name: serverName,
      source_dialect: dialect,
      migrations: await migrationSource.getMigrations(),
      tables: counts,
      total_rows: Object.values(counts).reduce((a, b) => a + b, 0),
      options: { include_logs: includeLogs, include_epg: includeEpg },
      encryption: null,
    };
    let cipher = null;
    if (password) {
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const key = await deriveKey(password, salt);
      meta.encryption = {
        alg: 'aes-256-gcm', kdf: 'scrypt', ...KDF, salt: salt.toString('base64'), iv: iv.toString('base64'), check: checkValue(key),
      };
      cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    }

    fs.writeFileSync(filePath, MAGIC + JSON.stringify(meta) + '\n');
    async function* lines() {
      for (const table of ordered) {
        for await (const part of snap.rows(table)) {
          const entry = part.columns
            ? { type: 'table', name: table, columns: part.columns }
            : { type: 'rows', table, rows: part.rows.map((r) => r.map(encodeValue)) };
          yield Buffer.from(`${JSON.stringify(entry)}\n`);
        }
      }
      yield Buffer.from(`${JSON.stringify({ type: 'end', tables: counts })}\n`);
    }
    await pipeline(
      Readable.from(lines()),
      zlib.createGzip({ level: 6 }),
      ...(cipher ? [cipher] : []),
      fs.createWriteStream(filePath, { flags: 'a' }),
    );
    if (cipher) fs.appendFileSync(filePath, cipher.getAuthTag());
    return meta;
  } finally {
    snap.close();
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

/* --------------------------------- Lectura --------------------------------- */

/** Metadatos del backup sin leer el contenido (no hace falta la contraseña). */
export function readMeta(filePath) {
  const size = fs.statSync(filePath).size;
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(Math.min(size, 1024 * 1024));
    fs.readSync(fd, head, 0, head.length, 0);
    if (head.subarray(0, MAGIC.length).toString('latin1') !== MAGIC) {
      throw new HttpError(400, 'El archivo no es un backup de este portal (.iptvbak)');
    }
    const nl = head.indexOf(0x0a, MAGIC.length);
    let meta = null;
    try {
      meta = nl > 0 ? JSON.parse(head.subarray(MAGIC.length, nl).toString('utf8')) : null;
    } catch { /* abajo */ }
    if (!meta || meta.format !== 'iptv-backup' || typeof meta.tables !== 'object') {
      throw new HttpError(400, 'El backup está dañado: no se pueden leer sus datos');
    }
    if (Number(meta.format_version) > FORMAT_VERSION) {
      throw new HttpError(400, 'El backup se hizo con una versión más nueva del portal. Actualiza el portal antes de restaurarlo.');
    }
    return { meta, payloadOffset: nl + 1, size };
  } finally {
    fs.closeSync(fd);
  }
}

/** Recorre las entradas del backup llamando a onEntry (espera cada una). */
async function readEntries(filePath, key, onEntry) {
  const { meta, payloadOffset, size } = readMeta(filePath);
  const streams = [];
  if (meta.encryption) {
    if (size - payloadOffset < 16) throw new HttpError(400, 'El backup está incompleto o dañado');
    const tag = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, tag, 0, 16, size - 16);
    fs.closeSync(fd);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(meta.encryption.iv, 'base64'));
    decipher.setAuthTag(tag);
    streams.push(fs.createReadStream(filePath, { start: payloadOffset, end: size - 17 }), decipher);
  } else {
    streams.push(fs.createReadStream(filePath, { start: payloadOffset }));
  }
  try {
    await pipeline(...streams, zlib.createGunzip(), async (source) => {
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      for await (const chunk of source) {
        buffer += decoder.write(chunk);
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line) await onEntry(JSON.parse(line));
        }
      }
      buffer += decoder.end();
      if (buffer.trim()) await onEntry(JSON.parse(buffer));
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (/unsupported state|authenticate/i.test(err.message)) throw new HttpError(400, 'El backup cifrado está dañado o fue modificado');
    if (err.code === 'Z_DATA_ERROR' || err.code === 'Z_BUF_ERROR' || err instanceof SyntaxError) {
      throw new HttpError(400, 'El backup está incompleto o dañado');
    }
    throw err;
  }
}

/* --------------------------------- Restauración --------------------------------- */

function compatibility(meta, current) {
  const known = new Set(current);
  const newer = (meta.migrations || []).filter((m) => !known.has(m));
  if (newer.length) {
    throw new HttpError(400, 'El backup es de una versión más nueva del portal. Actualiza el portal antes de restaurarlo.');
  }
  const warnings = [];
  const missing = current.filter((m) => !(meta.migrations || []).includes(m));
  if (missing.length) warnings.push('El backup es de una versión anterior del portal: lo que se agregó después queda con valores por defecto.');
  return warnings;
}

async function restoreFromFile(filePath, key, meta) {
  const warnings = compatibility(meta, await migrationSource.getMigrations());
  const restored = {};
  let sawEnd = false;

  await db.transaction(async (trx) => {
    if (dialect === 'better-sqlite3') await trx.raw('PRAGMA defer_foreign_keys = ON');
    if (dialect === 'mysql2') await trx.raw('SET FOREIGN_KEY_CHECKS = 0');

    const existing = await listTables(trx);
    const inBackup = Object.keys(meta.tables);
    const toClear = existing.filter((t) => inBackup.includes(t) || (t === 'epg_programmes' && !inBackup.includes(t)));
    for (const t of CLEAR_ON_RESTORE) if (await trx.schema.hasTable(t)) toClear.push(t);
    for (const t of inBackup.filter((x) => !existing.includes(x))) warnings.push(`La tabla "${t}" ya no existe en esta versión y se omitió.`);
    if (!inBackup.includes('logs') && existing.includes('logs')) warnings.push('El backup no incluía el registro de actividad: se conservó el actual.');

    const childFirst = parentFirst(toClear, await foreignKeys(trx, toClear)).reverse();
    for (const t of childFirst) {
      const q = trx(t);
      const f = filterFor(t);
      if (f) q.whereNotIn(f.column, f.notIn);
      await q.del();
    }

    let current = null; // { name, keep: [idx], names: [col], bools: Set(idx), skip }
    await readEntries(filePath, key, async (entry) => {
      if (entry.type === 'table') {
        if (!existing.includes(entry.name)) {
          current = { skip: true };
          return;
        }
        const info = await trx(entry.name).columnInfo();
        const keep = [];
        const dropped = [];
        entry.columns.forEach((c, i) => (c in info ? keep.push(i) : dropped.push(c)));
        if (dropped.length) warnings.push(`Se omitieron columnas que ya no existen en "${entry.name}": ${dropped.join(', ')}.`);
        const bools = new Set(keep.filter((i) => /bool/i.test(String(info[entry.columns[i]].type))));
        current = { name: entry.name, columns: entry.columns, keep, bools, skip: false };
        restored[entry.name] = 0;
        return;
      }
      if (entry.type === 'rows') {
        if (!current || current.skip || entry.table !== current.name) return;
        const f = filterFor(current.name);
        const objects = [];
        for (const row of entry.rows) {
          const obj = {};
          for (const i of current.keep) obj[current.columns[i]] = decodeValue(row[i], current.bools.has(i));
          if (f && f.notIn.includes(obj[f.column])) continue;
          objects.push(obj);
        }
        const perInsert = Math.max(1, Math.min(BATCH_SIZE, Math.floor(30000 / Math.max(1, current.keep.length))));
        for (let i = 0; i < objects.length; i += perInsert) await trx(current.name).insert(objects.slice(i, i + perInsert));
        restored[current.name] += objects.length;
        return;
      }
      if (entry.type === 'end') sawEnd = true;
    });

    if (!sawEnd) throw new HttpError(400, 'El backup está incompleto o dañado');
    for (const [t, expected] of Object.entries(meta.tables)) {
      if (existing.includes(t) && restored[t] !== expected) {
        throw new HttpError(400, `El backup está incompleto: "${t}" tiene ${restored[t] ?? 0} de ${expected} filas`);
      }
    }
    for (const t of Object.keys(restored)) {
      if ('id' in (await trx(t).columnInfo())) await fixSequence(t, trx);
    }
    if (dialect === 'mysql2') await trx.raw('SET FOREIGN_KEY_CHECKS = 1');
  });

  return { restored, warnings };
}

/* --------------------------------- Registro de copias --------------------------------- */

const localFile = (row) => path.join(config.backupDir, path.basename(row.filename));

function hasLocalFile(row) {
  return row.status === 'ok' && !row.local_deleted_at && fs.existsSync(localFile(row));
}

export function serializeBackup(row) {
  const meta = parseJson(row.meta, {}) || {};
  return {
    id: row.id,
    filename: row.filename,
    size: Number(row.size || 0),
    sha256: row.sha256 || null,
    status: row.status,
    error: row.error || null,
    trigger: row.trigger,
    note: row.note || '',
    encrypted: bool(row.encrypted),
    pinned: bool(row.pinned),
    app_version: row.app_version || meta.app_version || null,
    server_name: meta.server_name || '',
    backup_created_at: meta.created_at ? Number(meta.created_at) : Number(row.created_at),
    tables: meta.tables || {},
    total_rows: Number(meta.total_rows || 0),
    options: meta.options || {},
    created_by: row.created_by || 'sistema',
    created_at: Number(row.created_at),
    finished_at: row.finished_at ? Number(row.finished_at) : null,
    local: hasLocalFile(row),
    drive: {
      status: row.drive_status || 'none',
      file_id: row.drive_file_id || null,
      error: row.drive_error || null,
      uploaded_at: row.drive_uploaded_at ? Number(row.drive_uploaded_at) : null,
      attempts: Number(row.drive_attempts || 0),
    },
    restored_at: row.restored_at ? Number(row.restored_at) : null,
  };
}

const metaSummary = (meta) => JSON.stringify({
  created_at: meta.created_at,
  server_name: meta.server_name,
  app_version: meta.app_version,
  source_dialect: meta.source_dialect,
  migrations: meta.migrations,
  tables: meta.tables,
  total_rows: meta.total_rows ?? Object.values(meta.tables).reduce((a, b) => a + Number(b), 0),
  options: meta.options,
});

function slug(s) {
  return String(s || 'iptv').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'iptv';
}

function uniqueFilename(base) {
  let name = `${base}.iptvbak`;
  for (let i = 2; fs.existsSync(path.join(config.backupDir, name)); i++) name = `${base}-${i}.iptvbak`;
  return name;
}

function backupFilename(serverName, ts, tz) {
  const p = zoneParts(ts, safeZone(tz));
  const pad = (n) => String(n).padStart(2, '0');
  return uniqueFilename(`backup-${slug(serverName)}-${p.year}-${pad(p.month)}-${pad(p.day)}_${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`);
}

/**
 * Inicia una copia. Devuelve { id, promise }; la promesa termina con la copia serializada
 * (incluida la subida a Drive si corresponde).
 */
export async function createBackup({
  trigger = 'manual', admin = null, note = '', upload = null,
} = {}) {
  if (state.running) {
    throw new HttpError(409, state.running.kind === 'restore' ? 'Se está restaurando un backup, espera a que termine' : 'Ya hay una copia de seguridad en curso');
  }
  const settings = await getSettings();
  const b = settings.backup;
  if (b.encrypt && !b.password) throw new HttpError(400, 'El cifrado está activado pero no hay contraseña guardada');
  fs.mkdirSync(config.backupDir, { recursive: true });

  const t = now();
  const filename = backupFilename(settings.server_name, t, settings.timezone);
  state.running = { kind: 'backup', id: null, started_at: t };
  let id;
  try {
    id = await insertId(db, 'backups', {
      filename,
      status: 'running',
      trigger,
      note: String(note || '').slice(0, 255) || null,
      encrypted: Boolean(b.encrypt),
      app_version: config.version,
      created_by: admin?.username || 'sistema',
      created_at: t,
    });
  } catch (err) {
    state.running = null;
    throw err;
  }
  state.running.id = id;

  const promise = (async () => {
    const file = path.join(config.backupDir, filename);
    try {
      const meta = await writeBackupFile(file, {
        includeLogs: bool(b.include_logs),
        includeEpg: bool(b.include_epg),
        password: b.encrypt ? b.password : '',
        serverName: settings.server_name,
      });
      await db('backups').where({ id }).update({
        status: 'ok',
        size: fs.statSync(file).size,
        sha256: await sha256File(file),
        encrypted: Boolean(meta.encryption),
        meta: metaSummary(meta),
        finished_at: now(),
      });
      await logAction(admin, 'backup.create', 'backup', id, { filename, trigger, rows: meta.total_rows });
    } catch (err) {
      fs.rmSync(file, { force: true });
      await db('backups').where({ id }).update({ status: 'error', error: String(err.message).slice(0, 2000), finished_at: now() });
      await logAction(admin, 'backup.error', 'backup', id, { trigger, error: err.message });
      throw err;
    } finally {
      state.running = null;
    }
    await applyLocalRetention().catch(() => {});
    const wantsUpload = upload ?? (bool(b.google_drive.auto_upload) && trigger !== 'pre_restore');
    if (wantsUpload && (await drive.isConnected())) await uploadToDrive(id).catch(() => {});
    return serializeBackup(await db('backups').where({ id }).first());
  })();
  promise.catch(() => {}); // el error ya queda en la fila; quien espere la promesa lo recibe igual
  return { id, promise };
}

/** Registra un archivo .iptvbak (subido desde el navegador o bajado de Drive). */
export async function registerFile(tmpPath, originalName, {
  trigger = 'upload', admin = null, driveFileId = null, existing = null,
} = {}) {
  const { meta, size } = readMeta(tmpPath);
  fs.mkdirSync(config.backupDir, { recursive: true });
  if (existing) {
    fs.renameSync(tmpPath, localFile(existing));
    await db('backups').where({ id: existing.id }).update({ local_deleted_at: null, size });
    return serializeBackup(await db('backups').where({ id: existing.id }).first());
  }
  const base = path.basename(String(originalName || 'backup')).replace(/\.iptvbak$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 100) || 'backup';
  const filename = uniqueFilename(base);
  fs.renameSync(tmpPath, path.join(config.backupDir, filename));
  const t = now();
  const id = await insertId(db, 'backups', {
    filename,
    size,
    sha256: await sha256File(path.join(config.backupDir, filename)),
    status: 'ok',
    trigger,
    note: trigger === 'drive' ? 'Descargada de Google Drive' : 'Subida desde un archivo',
    encrypted: Boolean(meta.encryption),
    app_version: meta.app_version || null,
    meta: metaSummary(meta),
    created_by: admin?.username || 'sistema',
    created_at: t,
    finished_at: t,
    drive_file_id: driveFileId,
    drive_status: driveFileId ? 'ok' : 'none',
    drive_uploaded_at: driveFileId ? t : null,
  });
  await logAction(admin, trigger === 'drive' ? 'backup.drive_import' : 'backup.upload', 'backup', id, { filename });
  return serializeBackup(await db('backups').where({ id }).first());
}

export function uploadTempPath() {
  fs.mkdirSync(config.backupDir, { recursive: true });
  return path.join(config.backupDir, `.subida-${randomString(10)}.part`);
}

/** Restaura un backup: primero guarda una copia de seguridad del estado actual (si se pide). */
export async function restoreBackup(id, { password = '', safetyBackup = true, admin = null } = {}) {
  if (state.running) throw new HttpError(409, 'Hay una copia o restauración en curso, espera a que termine');
  const row = await db('backups').where({ id }).first();
  if (!row) throw new HttpError(404, 'Backup no encontrado');
  if (!hasLocalFile(row)) {
    throw new HttpError(400, row.drive_file_id ? 'La copia solo está en Google Drive: descárgala primero al servidor' : 'El archivo de esta copia ya no existe');
  }
  const file = localFile(row);
  const { meta } = readMeta(file);
  compatibility(meta, await migrationSource.getMigrations());
  const saved = (await getSettings()).backup.password;
  let key = null;
  if (meta.encryption) {
    if (password) key = await unlockKey(meta, password);
    else {
      key = await unlockKey(meta, saved).catch(() => {
        throw new HttpError(400, saved ? 'Este backup está cifrado con otra contraseña: escríbela' : 'Este backup está cifrado: escribe su contraseña');
      });
    }
  }

  let safety = null;
  if (safetyBackup) {
    const job = await createBackup({ trigger: 'pre_restore', admin, note: `Antes de restaurar ${row.filename}`, upload: false });
    safety = await job.promise;
  }

  state.running = { kind: 'restore', id, started_at: now() };
  let result;
  try {
    result = await restoreFromFile(file, key, meta);
  } finally {
    state.running = null;
    invalidateSettings();
  }
  await db('backups').where({ id }).update({ restored_at: now() });
  await logAction(admin, 'backup.restore', 'backup', id, { filename: row.filename, safety_backup_id: safety?.id ?? null });

  if (!meta.options?.include_epg) {
    // La programación no venía en el backup: se vuelve a descargar en segundo plano.
    import('./epg.js').then((m) => m.refreshAll()).catch(() => {});
  }
  const stillAdmin = admin
    ? await db('admins').where({ id: admin.id, username: admin.username }).first()
    : null;
  return {
    ok: true,
    backup: serializeBackup(await db('backups').where({ id }).first()),
    safety_backup: safety,
    tables: result.restored,
    total_rows: Object.values(result.restored).reduce((a, b) => a + b, 0),
    warnings: result.warnings,
    relogin_required: Boolean(admin) && (!stillAdmin || !bool(stillAdmin.enabled)),
  };
}

/** Comprueba la contraseña de un backup cifrado sin restaurarlo. */
export async function checkPassword(id, password) {
  const row = await db('backups').where({ id }).first();
  if (!row) throw new HttpError(404, 'Backup no encontrado');
  if (!hasLocalFile(row)) throw new HttpError(400, 'El archivo de esta copia no está en el servidor');
  const { meta } = readMeta(localFile(row));
  if (!meta.encryption) return { ok: true, encrypted: false };
  await unlockKey(meta, password);
  return { ok: true, encrypted: true };
}

/* --------------------------------- Google Drive --------------------------------- */

export async function uploadToDrive(id) {
  if (uploading.has(id)) throw new HttpError(409, 'Esta copia ya se está subiendo a Drive');
  const row = await db('backups').where({ id }).first();
  if (!row) throw new HttpError(404, 'Backup no encontrado');
  if (!hasLocalFile(row)) throw new HttpError(400, 'El archivo de esta copia ya no está en el servidor');
  if (!(await drive.isConnected())) throw new HttpError(400, 'Google Drive no está conectado');
  uploading.add(id);
  await db('backups').where({ id }).update({
    drive_status: 'uploading', drive_error: null, drive_attempts: Number(row.drive_attempts || 0) + 1,
  });
  try {
    const settings = await getSettings();
    const meta = parseJson(row.meta, {}) || {};
    const res = await drive.uploadFile(localFile(row), row.filename, {
      appProperties: {
        iptv_backup: '1',
        backup_id: String(id),
        encrypted: bool(row.encrypted) ? '1' : '0',
        server_name: String(settings.server_name || '').slice(0, 60),
      },
      description: `Backup del portal IPTV "${settings.server_name}" · ${meta.total_rows ?? '?'} filas`,
    });
    if (row.drive_file_id && row.drive_file_id !== res.id) await drive.trashFile(row.drive_file_id).catch(() => {});
    await db('backups').where({ id }).update({
      drive_status: 'ok', drive_file_id: res.id, drive_uploaded_at: now(), drive_error: null,
    });
    await logAction(null, 'backup.drive_upload', 'backup', id, { filename: row.filename });
  } catch (err) {
    await db('backups').where({ id }).update({ drive_status: 'error', drive_error: String(err.message).slice(0, 2000) });
    await logAction(null, 'backup.drive_error', 'backup', id, { error: err.message });
    throw err;
  } finally {
    uploading.delete(id);
  }
  await applyDriveRetention().catch(() => {});
  return serializeBackup(await db('backups').where({ id }).first());
}

/** Descarga un backup de Drive al servidor para poder restaurarlo. */
export async function importFromDrive(fileId, admin = null) {
  const files = await drive.listFiles();
  const file = files.find((f) => f.id === fileId);
  if (!file) throw new HttpError(404, 'El archivo no está en la carpeta de backups de Drive');
  const existing = await db('backups').where({ drive_file_id: fileId }).first();
  if (existing && hasLocalFile(existing)) return serializeBackup(existing);
  const tmp = uploadTempPath();
  try {
    await drive.downloadFile(fileId, tmp);
    return await registerFile(tmp, file.name, {
      trigger: 'drive', admin, driveFileId: fileId, existing: existing || null,
    });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export async function driveFiles() {
  const files = await drive.listFiles();
  const rows = await db('backups').whereIn('drive_file_id', files.map((f) => f.id)).select('id', 'drive_file_id', 'filename', 'status', 'local_deleted_at', 'pinned');
  const byFile = new Map(rows.map((r) => [r.drive_file_id, r]));
  return files.map((f) => {
    const row = byFile.get(f.id);
    return {
      ...f,
      local_backup_id: row ? row.id : null,
      local: row ? hasLocalFile(row) : false,
      pinned: row ? bool(row.pinned) : false,
    };
  });
}

/* --------------------------------- Limpieza --------------------------------- */

export async function deleteBackup(id, { from = 'server', admin = null } = {}) {
  const row = await db('backups').where({ id }).first();
  if (!row) throw new HttpError(404, 'Backup no encontrado');
  if (row.status === 'running' || state.running?.id === id) throw new HttpError(409, 'La copia está en curso');
  if (uploading.has(id)) throw new HttpError(409, 'La copia se está subiendo a Drive');
  const fromServer = from === 'server' || from === 'all';
  const fromDrive = (from === 'drive' || from === 'all') && row.drive_file_id;
  if (fromDrive) {
    await drive.trashFile(row.drive_file_id);
    await db('backups').where({ id }).update({ drive_file_id: null, drive_status: 'none', drive_error: null });
  }
  if (fromServer) fs.rmSync(localFile(row), { force: true });
  const after = await db('backups').where({ id }).first();
  const keepsDrive = after.drive_file_id && after.drive_status === 'ok';
  if (fromServer && !keepsDrive) await db('backups').where({ id }).del();
  else if (fromServer) await db('backups').where({ id }).update({ local_deleted_at: now() });
  else if (!hasLocalFile(after) && !after.drive_file_id) await db('backups').where({ id }).del();
  await logAction(admin, 'backup.delete', 'backup', id, { filename: row.filename, from });
  const left = await db('backups').where({ id }).first();
  return { deleted: !left, backup: left ? serializeBackup(left) : null };
}

/** Deja en el servidor solo las N copias más nuevas (las fijadas no cuentan ni se borran). */
export async function applyLocalRetention() {
  const keep = Math.max(1, Number((await getSettings()).backup.keep_local) || 10);
  const rows = await db('backups').where('status', 'ok').whereNull('local_deleted_at').where('pinned', false)
    .orderBy('created_at', 'desc').orderBy('id', 'desc');
  for (const row of rows.slice(keep)) {
    if (uploading.has(row.id)) continue;
    fs.rmSync(localFile(row), { force: true });
    if (row.drive_file_id && row.drive_status === 'ok') await db('backups').where({ id: row.id }).update({ local_deleted_at: now() });
    else await db('backups').where({ id: row.id }).del();
  }
  // Historial de fallos: solo los 20 más recientes.
  const errors = await db('backups').where('status', 'error').orderBy('created_at', 'desc').select('id');
  if (errors.length > 20) await db('backups').whereIn('id', errors.slice(20).map((r) => r.id)).del();
}

/** Deja en Drive solo las N copias más nuevas (0 = no borrar nunca). */
export async function applyDriveRetention() {
  const keep = Number((await getSettings()).backup.google_drive.keep) || 0;
  if (keep <= 0 || !(await drive.isConnected())) return;
  const files = await drive.listFiles();
  const pinned = new Set((await db('backups').where('pinned', true).whereNotNull('drive_file_id').select('drive_file_id')).map((r) => r.drive_file_id));
  for (const f of files.filter((x) => !pinned.has(x.id)).slice(keep)) {
    await drive.trashFile(f.id);
    const row = await db('backups').where({ drive_file_id: f.id }).first();
    if (!row) continue;
    if (hasLocalFile(row)) await db('backups').where({ id: row.id }).update({ drive_file_id: null, drive_status: 'none' });
    else await db('backups').where({ id: row.id }).del();
  }
}

/* --------------------------------- Programación --------------------------------- */

/** Próxima copia programada (unix) o null si está desactivada. */
export function nextScheduledRun(b, tz, from = now()) {
  if (!bool(b.schedule_enabled)) return null;
  const base = Number(b.last_scheduled_at) || from;
  if (b.frequency === 'hours') {
    const every = Math.max(1, Math.min(168, Number(b.every_hours) || 12)) * 3600;
    return base + every;
  }
  const zone = safeZone(tz);
  const { hour, minute } = parseTime(b.time, '03:00');
  const days = b.frequency === 'weekly'
    ? (Array.isArray(b.weekdays) && b.weekdays.length ? b.weekdays.map(Number) : [7])
    : [1, 2, 3, 4, 5, 6, 7];
  const start = zoneParts(base, zone);
  for (let i = 0; i <= 8; i++) {
    const ts = zonedToUnix({ ...addCalendarDays(start, i), hour, minute }, zone);
    if (ts > base && days.includes(zoneParts(ts, zone).weekday)) return ts;
  }
  return null;
}

/** Una vuelta del programador: copia programada vencida y reintentos de subida a Drive. */
export async function backupTick(t = now()) {
  const settings = await getSettings();
  const b = settings.backup;
  const next = nextScheduledRun(b, settings.timezone, t);
  if (next !== null && next <= t && !state.running) {
    await saveSettings({ backup: { last_scheduled_at: t } });
    const job = await createBackup({ trigger: 'scheduled', note: 'Copia automática' });
    await job.promise.catch(() => {});
  }
  if (t - lastDriveRetry >= 15 * 60 && (await drive.isConnected())) {
    lastDriveRetry = t;
    const failed = await db('backups').where('status', 'ok').where('drive_status', 'error').where('drive_attempts', '<', 5)
      .whereNull('local_deleted_at').orderBy('created_at', 'desc').limit(3);
    for (const row of failed) await uploadToDrive(row.id).catch(() => {});
  }
}

export async function markInterruptedBackups() {
  await db('backups').where('status', 'running').update({ status: 'error', error: 'Interrumpida: el servidor se reinició', finished_at: now() });
  await db('backups').where('drive_status', 'uploading').update({ drive_status: 'error', drive_error: 'Interrumpida: el servidor se reinició' });
  for (const f of fs.existsSync(config.backupDir) ? fs.readdirSync(config.backupDir) : []) {
    if (f.startsWith('.subida-')) fs.rmSync(path.join(config.backupDir, f), { force: true });
  }
}

export function startBackupScheduler() {
  const tick = () => backupTick().catch((err) => console.error('Backups:', err.message));
  const first = setTimeout(tick, 30_000);
  first.unref();
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/** Resumen para el panel y la página de backups. */
export async function backupOverview() {
  const settings = await getSettings();
  const last = await db('backups').whereIn('status', ['ok', 'error']).whereNot('trigger', 'pre_restore').orderBy('created_at', 'desc').first();
  const lastOk = await db('backups').where('status', 'ok').orderBy('created_at', 'desc').first();
  return {
    last_status: last?.status || null,
    last_at: last ? Number(last.created_at) : null,
    last_error: last?.status === 'error' ? last.error : null,
    last_ok_at: lastOk ? Number(lastOk.created_at) : null,
    next_run_at: nextScheduledRun(settings.backup, settings.timezone),
    schedule_enabled: bool(settings.backup.schedule_enabled),
    drive_connected: Boolean(settings.backup.google_drive.refresh_token),
    running: state.running,
  };
}

/** Uso de disco de las copias en el servidor. */
export async function storageInfo() {
  const rows = await db('backups').where('status', 'ok').whereNull('local_deleted_at').select('filename', 'size', 'status', 'local_deleted_at');
  let used = 0;
  for (const r of rows) if (hasLocalFile(r)) used += Number(r.size || 0);
  let free = null;
  try {
    fs.mkdirSync(config.backupDir, { recursive: true });
    const s = fs.statfsSync(config.backupDir);
    free = Number(s.bavail) * Number(s.bsize);
  } catch { /* no disponible */ }
  return { dir: config.backupDir, used_bytes: used, free_bytes: free };
}

/** Descarga: flujo del archivo local. */
export async function backupFileFor(id) {
  const row = await db('backups').where({ id }).first();
  if (!row) throw new HttpError(404, 'Backup no encontrado');
  if (!hasLocalFile(row)) throw new HttpError(404, 'El archivo de esta copia no está en el servidor');
  return { path: localFile(row), filename: row.filename, size: Number(row.size || 0) };
}

