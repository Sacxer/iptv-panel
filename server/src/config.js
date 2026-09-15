import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..');

const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

/** Versión del portal (package.json) y de dónde se instaló (commit de GitHub que deja el instalador). */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 8080),
  // Puertos adicionales, p. ej. 25461 (puerto por defecto de XtreamUI) para no cambiar la URL de los clientes.
  extraPorts: list(process.env.EXTRA_PORTS).map(Number).filter((p) => p > 0),
  host: process.env.HOST || '0.0.0.0',
  trustProxy: process.env.TRUST_PROXY === 'true',
  jwtSecret: process.env.JWT_SECRET || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminDist: process.env.ADMIN_DIST || path.resolve(ROOT_DIR, '..', 'admin', 'dist'),
  db: {
    client: process.env.DB_CLIENT || 'better-sqlite3',
    file: process.env.DB_FILE || path.join(ROOT_DIR, 'data', 'iptv.db'),
    url: process.env.DATABASE_URL || '',
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 0) || undefined,
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'iptv',
  },
  version: readJson(path.join(ROOT_DIR, 'package.json'))?.version || '0.0.0',
  buildInfoFile: process.env.BUILD_INFO_FILE || path.join(ROOT_DIR, 'build-info.json'),
  github: {
    // Repositorio fijo de donde salen las actualizaciones del panel y de la app.
    defaultRepo: 'Sacxer/iptv-panel',
    repoOverride: process.env.UPDATES_REPO || '', // solo para pruebas o un repositorio distinto
    branchOverride: process.env.UPDATES_BRANCH || '',
    apiUrl: (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
    token: process.env.GITHUB_TOKEN || '', // solo si el repositorio es privado
  },
  backupDir: process.env.BACKUP_DIR || path.join(ROOT_DIR, 'data', 'backups'),
  appReleasesDir: process.env.APP_RELEASES_DIR || path.join(ROOT_DIR, 'data', 'app-releases'),
  google: {
    // Sobrescribibles solo para pruebas con un Google simulado.
    oauthUrl: (process.env.GOOGLE_OAUTH_URL || 'https://oauth2.googleapis.com').replace(/\/+$/, ''),
    apiUrl: (process.env.GOOGLE_API_URL || 'https://www.googleapis.com').replace(/\/+$/, ''),
  },
};
