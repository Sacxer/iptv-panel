// Arranca un nodo de streaming local para desarrollo, registrado en el portal local.
// Uso: node scripts/dev-node.js   (requiere el portal en http://localhost:8080 con admin/admin12345)
// Usa FFmpeg real si existe; si no, un FFmpeg simulado que emite MPEG-TS de prueba.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startNode } from '../../node/iptv-node.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN = process.env.MAIN_URL || 'http://localhost:8080';
const PORT = Number(process.env.PORT || 8090);

async function api(method, url, body, token) {
  const res = await fetch(`${MAIN}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${url}: ${data.error || res.status}`);
  return data;
}

let ffmpeg = 'ffmpeg';
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  ffmpeg = path.join(here, '..', 'test', 'fixtures', 'fake-ffmpeg.js');
  console.log('FFmpeg no está instalado: se usa el FFmpeg simulado.');
}

const { token } = await api('POST', '/api/admin/auth/login', {
  username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASSWORD || 'admin12345',
});
const servers = await api('GET', '/api/admin/servers', null, token);
let server = servers.find((s) => s.name === 'Nodo local (demo)');
if (!server) {
  server = await api('POST', '/api/admin/servers', { name: 'Nodo local (demo)', public_url: `http://127.0.0.1:${PORT}`, weight: 1 }, token);
}
const node = await startNode({ mainUrl: MAIN, token: server.token, port: PORT, host: '0.0.0.0', ffmpeg });
console.log(`Nodo "${server.name}" escuchando en :${node.port} y conectado a ${MAIN}`);
