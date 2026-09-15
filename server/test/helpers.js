// Arranque común para pruebas: base SQLite temporal, servidor en puerto libre y cliente HTTP.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function startTestServer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-test-'));
  process.env.DB_FILE = path.join(tmp, 'test.db');
  process.env.BACKUP_DIR = path.join(tmp, 'backups'); // nunca la carpeta real de backups
  process.env.APP_RELEASES_DIR = path.join(tmp, 'app-releases');
  process.env.UPDATES_CHECK = process.env.UPDATES_CHECK || 'false'; // sin consultas a GitHub en pruebas
  process.env.BUILD_INFO_FILE = process.env.BUILD_INFO_FILE || path.join(tmp, 'build-info.json');
  process.env.ADMIN_PASSWORD = 'admin12345';
  process.env.JWT_SECRET = 'test-secret';
  process.env.ADMIN_DIST = path.join(tmp, 'no-admin');
  process.env.DEVICE_THROTTLE_MS = '0'; // en pruebas se registran todas las conexiones
  process.env.AUTO_PUBLIC_URL = 'false';

  const { createApp } = await import('../src/app.js');
  const { bootstrap } = await import('../src/bootstrap.js');
  const { db } = await import('../src/db/index.js');

  await bootstrap({ quiet: true });
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let token = null;

  async function api(method, url, body, { auth = true, raw = false, headers = {} } = {}) {
    const res = await fetch(base + url, {
      method,
      redirect: 'manual',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (raw) return res;
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }

  token = (await api('POST', '/api/admin/auth/login', { username: 'admin', password: 'admin12345' })).data.token;

  async function stop() {
    server.closeAllConnections();
    server.close();
    await db.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  return { api, db, stop, base };
}
