import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { HttpError, bool } from './util.js';

let secret = null;
export const setJwtSecret = (s) => {
  secret = s;
};

export const hashPassword = (plain) => bcrypt.hash(String(plain), 10);
export const verifyPassword = (plain, hash) => bcrypt.compare(String(plain), hash);

export function signToken(admin) {
  return jwt.sign({ sub: admin.id, role: admin.role }, secret, { expiresIn: '12h' });
}

/** Token corto para un solo uso concreto (p. ej. descargar un backup con un enlace normal). */
export function signScopedToken(payload, audience, expiresIn = '10m') {
  return jwt.sign(payload, secret, { audience, expiresIn });
}

export function verifyScopedToken(token, audience) {
  try {
    return jwt.verify(String(token || ''), secret, { audience });
  } catch {
    throw new HttpError(401, 'El enlace caducó o no es válido');
  }
}

/** Middleware: exige un token de administrador válido y carga `req.admin`. */
export async function requireAdmin(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'No autenticado');
  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch {
    throw new HttpError(401, 'Sesión caducada, vuelve a iniciar sesión');
  }
  const admin = await db('admins').where({ id: payload.sub }).first();
  if (!admin || !bool(admin.enabled)) throw new HttpError(401, 'Cuenta deshabilitada');
  req.admin = { id: admin.id, username: admin.username, role: admin.role };
  next();
}

/** Middleware: solo rol admin (los revendedores reciben 403). */
export function adminOnly(req, _res, next) {
  if (req.admin?.role !== 'admin') throw new HttpError(403, 'Solo disponible para administradores');
  next();
}

export const isReseller = (req) => req.admin?.role === 'reseller';

/** Limitador simple en memoria de intentos fallidos por clave (IP). */
export function createAttemptLimiter({ max = 8, windowSeconds = 900 } = {}) {
  const attempts = new Map();
  return {
    check(key) {
      const entry = attempts.get(key);
      if (entry && entry.until > Date.now() && entry.count >= max) {
        throw new HttpError(429, 'Demasiados intentos fallidos. Inténtalo más tarde.');
      }
    },
    fail(key) {
      const entry = attempts.get(key);
      if (!entry || entry.until < Date.now()) {
        attempts.set(key, { count: 1, until: Date.now() + windowSeconds * 1000 });
      } else entry.count++;
    },
    reset(key) {
      attempts.delete(key);
    },
  };
}
