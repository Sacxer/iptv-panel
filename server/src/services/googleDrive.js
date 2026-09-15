// Google Drive para los backups. Conexión por "código en otro dispositivo" (OAuth device flow):
// funciona aunque el portal no tenga dominio ni IP pública. Permiso drive.file: la app solo ve
// los archivos que ella misma crea, nunca el resto del Drive.
import fs from 'node:fs';
import { config } from '../config.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { HttpError, now } from '../lib/util.js';

const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
// Múltiplo de 256 KiB, como pide la subida reanudable (las pruebas lo reducen para probar varias partes).
const CHUNK = Number(process.env.GOOGLE_UPLOAD_CHUNK) || 8 * 1024 * 1024;

const oauth = (p) => `${config.google.oauthUrl}${p}`;
const api = (p) => `${config.google.apiUrl}${p}`;

let pending = null; // conexión en curso { user_code, verification_url, expires_at, interval, status, error }
let pollTimer = null;
let tokenCache = null; // { token, exp, refresh }

async function postForm(url, fields) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function oauthError(data) {
  const code = data?.error;
  if (code === 'invalid_client') return 'Google no reconoce el ID o el secreto de cliente. Revísalos en Google Cloud.';
  if (code === 'unauthorized_client') {
    return 'Ese cliente OAuth no admite este tipo de conexión: créalo con el tipo "TV y dispositivos de entrada limitada".';
  }
  if (code === 'invalid_scope') return 'El cliente OAuth no permite acceso a Google Drive. Activa la API de Google Drive en el proyecto.';
  if (code === 'access_denied') return 'Se rechazó el permiso en la cuenta de Google.';
  if (code === 'expired_token') return 'El código caducó antes de aprobarlo. Vuelve a intentarlo.';
  if (code === 'invalid_grant') return 'Google revocó el acceso. Vuelve a conectar la cuenta.';
  return data?.error_description || code || 'Google respondió con un error';
}

function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    return payload.email || '';
  } catch {
    return '';
  }
}

/* ------------------------------- Conexión ------------------------------- */

export function connectionState() {
  if (!pending) return { status: 'idle' };
  const { device_code: _omit, client_secret: _omit2, ...rest } = pending;
  return rest;
}

export function cancelConnect() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  pending = null;
}

/** Pide a Google un código para que el administrador lo apruebe en google.com/device. */
export async function startConnect({ clientId, clientSecret } = {}) {
  const gd = (await getSettings()).backup.google_drive;
  const client_id = String(clientId || gd.client_id || '').trim();
  const client_secret = String(clientSecret || gd.client_secret || '').trim();
  if (!client_id || !client_secret) throw new HttpError(400, 'Indica el ID y el secreto de cliente de Google');

  cancelConnect();
  let r;
  try {
    r = await postForm(oauth('/device/code'), { client_id, scope: SCOPE });
  } catch (err) {
    throw new HttpError(502, `No se pudo contactar a Google: ${err.message}`);
  }
  if (r.status >= 400 || !r.data.device_code) throw new HttpError(400, oauthError(r.data));

  await saveSettings({ backup: { google_drive: { client_id, client_secret } } });
  const interval = Math.max(0.2, Number(r.data.interval) || 5);
  pending = {
    status: 'pending',
    user_code: r.data.user_code,
    verification_url: r.data.verification_url || r.data.verification_uri || 'https://www.google.com/device',
    expires_at: now() + (Number(r.data.expires_in) || 1800),
    interval,
    error: null,
    account_email: null,
    device_code: r.data.device_code,
    client_id,
    client_secret,
  };
  schedulePoll(interval);
  return connectionState();
}

function schedulePoll(seconds) {
  pollTimer = setTimeout(() => poll().catch((err) => {
    if (pending) Object.assign(pending, { status: 'error', error: err.message });
  }), seconds * 1000);
  pollTimer.unref();
}

async function poll() {
  const p = pending;
  if (!p || p.status !== 'pending') return;
  if (now() > p.expires_at) {
    Object.assign(p, { status: 'expired', error: oauthError({ error: 'expired_token' }) });
    return;
  }
  const r = await postForm(oauth('/token'), {
    client_id: p.client_id,
    client_secret: p.client_secret,
    device_code: p.device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (pending !== p) return; // se canceló mientras tanto
  const code = r.data.error;
  if (code === 'authorization_pending') return schedulePoll(p.interval);
  if (code === 'slow_down') {
    p.interval += 5;
    return schedulePoll(p.interval);
  }
  if (code || !r.data.refresh_token) {
    Object.assign(p, { status: code === 'access_denied' ? 'denied' : 'error', error: oauthError(r.data) });
    return;
  }
  tokenCache = { token: r.data.access_token, exp: now() + (Number(r.data.expires_in) || 3600) - 60, refresh: r.data.refresh_token };
  let email = emailFromIdToken(r.data.id_token);
  if (!email) email = (await about(r.data.access_token).catch(() => null))?.user?.emailAddress || '';
  await saveSettings({
    backup: {
      google_drive: {
        refresh_token: r.data.refresh_token, account_email: email, connected_at: now(), folder_id: '',
      },
    },
  });
  Object.assign(p, { status: 'connected', account_email: email, error: null });
  await ensureFolder().catch(() => {});
}

export async function disconnect() {
  cancelConnect();
  const gd = (await getSettings()).backup.google_drive;
  if (gd.refresh_token) await postForm(oauth('/revoke'), { token: gd.refresh_token }).catch(() => {});
  tokenCache = null;
  await saveSettings({ backup: { google_drive: { refresh_token: '', account_email: '', connected_at: null, folder_id: '' } } });
}

export async function isConnected() {
  return Boolean((await getSettings()).backup.google_drive.refresh_token);
}

/* ------------------------------- API de Drive ------------------------------- */

async function accessToken(force = false) {
  const gd = (await getSettings()).backup.google_drive;
  if (!gd.refresh_token) throw new HttpError(400, 'Google Drive no está conectado');
  if (!force && tokenCache && tokenCache.refresh === gd.refresh_token && tokenCache.exp > now()) return tokenCache.token;
  const r = await postForm(oauth('/token'), {
    client_id: gd.client_id, client_secret: gd.client_secret, refresh_token: gd.refresh_token, grant_type: 'refresh_token',
  });
  if (r.data.error === 'invalid_grant') {
    await saveSettings({ backup: { google_drive: { refresh_token: '', folder_id: '' } } });
    throw new HttpError(400, oauthError(r.data));
  }
  if (r.status >= 400 || !r.data.access_token) throw new HttpError(502, oauthError(r.data));
  tokenCache = { token: r.data.access_token, exp: now() + (Number(r.data.expires_in) || 3600) - 60, refresh: gd.refresh_token };
  return tokenCache.token;
}

async function driveFetch(url, options = {}, { retry = true, timeoutMs = 60_000 } = {}) {
  const token = await accessToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    signal: options.signal || AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 && retry) {
    tokenCache = null;
    return driveFetch(url, options, { retry: false, timeoutMs });
  }
  return res;
}

async function driveJson(url, options, what) {
  const res = await driveFetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 403 && /quota|storage/i.test(msg)) throw new HttpError(507, 'No queda espacio en Google Drive');
    throw new HttpError(502, `Google Drive (${what}): ${msg}`);
  }
  return data;
}

async function about(token) {
  const res = await fetch(api('/drive/v3/about?fields=user(emailAddress,displayName),storageQuota(limit,usage)'), {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Carpeta de backups: la guardada, una con el mismo nombre creada por la app, o una nueva. */
export async function ensureFolder() {
  const gd = (await getSettings()).backup.google_drive;
  if (gd.folder_id) {
    const res = await driveFetch(api(`/drive/v3/files/${encodeURIComponent(gd.folder_id)}?fields=id,name,trashed`));
    if (res.ok) {
      const f = await res.json();
      if (!f.trashed && f.name === gd.folder_name) return { id: f.id, name: f.name };
    }
  }
  const name = gd.folder_name || 'Backups IPTV';
  const found = await driveJson(
    api(`/drive/v3/files?q=${encodeURIComponent(`mimeType='${FOLDER_MIME}' and name='${q(name)}' and trashed=false`)}&fields=files(id,name)&pageSize=10`),
    {}, 'buscar carpeta',
  );
  let folder = found.files?.[0];
  if (!folder) {
    folder = await driveJson(api('/drive/v3/files?fields=id,name'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    }, 'crear carpeta');
  }
  await saveSettings({ backup: { google_drive: { folder_id: folder.id } } });
  return { id: folder.id, name: folder.name };
}

/** Prueba la conexión: cuenta, espacio y carpeta. */
export async function testDrive() {
  const token = await accessToken(true);
  const info = await about(token).catch((err) => { throw new HttpError(502, `Google Drive: ${err.message}`); });
  const folder = await ensureFolder();
  const limit = info.storageQuota?.limit ? Number(info.storageQuota.limit) : null;
  const usage = info.storageQuota?.usage ? Number(info.storageQuota.usage) : null;
  return {
    ok: true,
    account_email: info.user?.emailAddress || (await getSettings()).backup.google_drive.account_email,
    folder_id: folder.id,
    folder_name: folder.name,
    storage: { limit, usage, free: limit !== null && usage !== null ? Math.max(0, limit - usage) : null },
  };
}

/** Sube un archivo con subida reanudable por partes. Devuelve { id, size }. */
export async function uploadFile(filePath, name, { appProperties = {}, description = '' } = {}) {
  const folder = await ensureFolder();
  const size = fs.statSync(filePath).size;
  const start = await driveFetch(api('/upload/drive/v3/files?uploadType=resumable&fields=id,name,size'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/octet-stream',
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name, parents: [folder.id], appProperties, description }),
  });
  const session = start.headers.get('location');
  if (!start.ok || !session) {
    const data = await start.json().catch(() => ({}));
    throw new HttpError(502, `Google Drive (iniciar subida): ${data?.error?.message || `HTTP ${start.status}`}`);
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    let offset = 0;
    for (;;) {
      const length = Math.min(CHUNK, size - offset);
      const chunk = Buffer.alloc(length);
      if (length) fs.readSync(fd, chunk, 0, length, offset);
      const end = offset + length - 1;
      const res = await driveFetch(session, {
        method: 'PUT',
        redirect: 'manual', // 308 = "sigue enviando", no es una redirección
        headers: { 'Content-Range': size === 0 ? 'bytes */0' : `bytes ${offset}-${end}/${size}` },
        body: chunk,
      }, { timeoutMs: 300_000 });
      if (res.status === 200 || res.status === 201) {
        const data = await res.json();
        return { id: data.id, size: Number(data.size ?? size) };
      }
      if (res.status !== 308) {
        const data = await res.json().catch(() => ({}));
        const msg = data?.error?.message || `HTTP ${res.status}`;
        if (res.status === 403 && /quota|storage/i.test(msg)) throw new HttpError(507, 'No queda espacio en Google Drive');
        throw new HttpError(502, `Google Drive (subida): ${msg}`);
      }
      const range = res.headers.get('range'); // bytes=0-N: lo que Google ya recibió
      offset = range ? Number(range.split('-')[1]) + 1 : end + 1;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Backups en la carpeta de Drive (solo los que creó la app), del más nuevo al más viejo. */
export async function listFiles() {
  const folder = await ensureFolder();
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${q(folder.id)}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,size,createdTime,appProperties,description)',
      orderBy: 'createdTime desc',
      pageSize: '200',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await driveJson(api(`/drive/v3/files?${params}`), {}, 'listar');
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files
    .filter((f) => f.appProperties?.iptv_backup === '1')
    .map((f) => ({
      id: f.id,
      name: f.name,
      size: Number(f.size || 0),
      created_at: f.createdTime ? Math.floor(Date.parse(f.createdTime) / 1000) : null,
      encrypted: f.appProperties?.encrypted === '1',
      server_name: f.appProperties?.server_name || '',
      backup_id: f.appProperties?.backup_id ? Number(f.appProperties.backup_id) : null,
    }));
}

export async function downloadFile(fileId, dest) {
  const res = await driveFetch(api(`/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`), {}, { timeoutMs: 600_000 });
  if (res.status === 404) throw new HttpError(404, 'El archivo ya no está en Google Drive');
  if (!res.ok) throw new HttpError(502, `Google Drive (descarga): HTTP ${res.status}`);
  const out = fs.createWriteStream(dest);
  for await (const chunk of res.body) {
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
}

/** Manda un backup a la papelera de Drive (Google lo vacía solo a los 30 días). */
export async function trashFile(fileId) {
  const res = await driveFetch(api(`/drive/v3/files/${encodeURIComponent(fileId)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  if (!res.ok && res.status !== 404) throw new HttpError(502, `Google Drive (papelera): HTTP ${res.status}`);
}
