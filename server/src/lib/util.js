import crypto from 'node:crypto';

export const now = () => Math.floor(Date.now() / 1000);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true; // mensaje pensado para el usuario: se muestra aunque sea un error 5xx
  }
}

export const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';

export function int(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function parseJson(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function randomString(length = 10, alphabet = 'abcdefghjkmnpqrstuvwxyz23456789') {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function addDuration(baseSeconds, amount, unit) {
  const d = new Date(baseSeconds * 1000);
  const n = int(amount, 0);
  if (unit === 'months') d.setMonth(d.getMonth() + n);
  else if (unit === 'years') d.setFullYear(d.getFullYear() + n);
  else if (unit === 'hours') d.setHours(d.getHours() + n);
  else d.setDate(d.getDate() + n);
  return Math.floor(d.getTime() / 1000);
}

export function paging(query, defaultLimit = 50) {
  const page = Math.max(1, int(query.page, 1));
  const limit = Math.min(1000, Math.max(1, int(query.limit, defaultLimit)));
  return { page, limit, offset: (page - 1) * limit };
}

/** Devuelve solo las claves presentes (no undefined) de `keys`. */
export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function idList(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => int(x)).filter((x) => x !== null && x > 0))];
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function requireFields(body, fields) {
  for (const f of fields) {
    if (body?.[f] === undefined || body[f] === null || String(body[f]).trim() === '') {
      throw new HttpError(400, `El campo "${f}" es obligatorio`);
    }
  }
}

export function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new HttpError(400, `Valor inválido para "${field}". Permitidos: ${allowed.join(', ')}`);
  }
  return value;
}
