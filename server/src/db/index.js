import fs from 'node:fs';
import path from 'node:path';
import knexLib from 'knex';
import { config } from '../config.js';
import { migrationSource } from './schema.js';

function buildKnexConfig() {
  const c = config.db;
  if (c.client === 'better-sqlite3' || c.client === 'sqlite') {
    fs.mkdirSync(path.dirname(c.file), { recursive: true });
    return {
      client: 'better-sqlite3',
      connection: { filename: c.file },
      useNullAsDefault: true,
      pool: {
        afterCreate(conn, done) {
          conn.pragma('journal_mode = WAL');
          conn.pragma('foreign_keys = ON');
          conn.pragma('busy_timeout = 5000');
          done();
        },
      },
    };
  }
  const connection = c.url || {
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: c.database,
  };
  if (c.client === 'pg' || c.client === 'postgres') {
    return { client: 'pg', connection, pool: { min: 0, max: 10 } };
  }
  if (c.client === 'mysql' || c.client === 'mysql2') {
    return {
      client: 'mysql2',
      connection: typeof connection === 'string' ? connection : { ...connection, charset: 'utf8mb4' },
      pool: { min: 0, max: 10 },
    };
  }
  throw new Error(`DB_CLIENT no soportado: ${c.client}`);
}

export const knexConfig = buildKnexConfig();

if (knexConfig.client === 'pg') {
  // Postgres devuelve BIGINT y COUNT(*) como string; los convertimos a número.
  const pg = await import('pg');
  pg.default.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
}

export const db = knexLib(knexConfig);
export const dialect = knexConfig.client;

export async function migrate() {
  await db.migrate.latest({ migrationSource });
}

/** Tras insertar filas con id explícito, Postgres necesita ajustar su secuencia. */
export async function fixSequence(table, trx = db) {
  if (dialect !== 'pg') return;
  await trx.raw(
    `SELECT setval(pg_get_serial_sequence(?, 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ??), 1))`,
    [table, table],
  );
}

/** Tamaño de lote seguro para inserciones múltiples según el motor. */
export const BATCH_SIZE = dialect === 'better-sqlite3' ? 200 : 500;

/** Filtro de búsqueda insensible a mayúsculas sobre varias columnas. */
export function whereSearch(qb, columns, term) {
  if (!term || !String(term).trim()) return qb;
  const value = `%${String(term).trim()}%`;
  const op = dialect === 'pg' ? 'ilike' : 'like';
  return qb.where((w) => {
    for (const col of columns) w.orWhere(col, op, value);
  });
}

/** Inserta una fila y devuelve su id en cualquier motor (pg/sqlite devuelven objetos, mysql números). */
export async function insertId(trx, table, row) {
  const [res] = await trx(table).insert(row).returning('id');
  return typeof res === 'object' && res !== null ? res.id : res;
}

/** Inserta varias filas y devuelve sus ids en orden. */
export async function insertManyIds(trx, table, rows) {
  if (!rows.length) return [];
  if (dialect === 'mysql2') {
    const ids = [];
    for (const row of rows) ids.push(await insertId(trx, table, row));
    return ids;
  }
  const res = await trx(table).insert(rows).returning('id');
  return res.map((r) => (typeof r === 'object' ? r.id : r));
}
