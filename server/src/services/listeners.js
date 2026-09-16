// Puertos HTTP del portal: el principal (panel y API) y los de clientes (Xtream Codes / M3U).
// Los de clientes se abren y cierran en caliente desde el panel, sin reiniciar. Si uno está ocupado
// (p. ej. por XtreamUI), se reintenta solo hasta que quede libre.
import http from 'node:http';
import { config } from '../config.js';
import { getSettings, saveSettings } from '../lib/settings.js';

const servers = new Map(); // puerto -> { server, role, status: 'listening'|'waiting'|'error', error, since }
let app = null;
let retryTimer = null;
let desiredClients = [];
let panelPort = config.port;

/** Rol de un puerto local: 'panel', 'clients' o null (gestor sin iniciar, p. ej. en pruebas). */
export function portRole(port) {
  if (!app || !port) return null;
  if (port === panelPort) return 'panel';
  return servers.get(port)?.role === 'clients' ? 'clients' : null;
}

export const currentPanelPort = () => panelPort;

function makeServer() {
  const server = http.createServer(app);
  server.requestTimeout = 0; // los streams en modo proxy son conexiones largas
  server.headersTimeout = 60_000;
  return server;
}

function errorText(err) {
  if (err.code === 'EADDRINUSE') return 'Ocupado por otro programa';
  if (err.code === 'EACCES') return 'Sin permiso para usar este puerto';
  return err.message;
}

function listen(port, role) {
  return new Promise((resolve) => {
    const server = makeServer();
    const onError = (err) => {
      server.removeAllListeners('listening');
      servers.set(port, { server: null, role, status: err.code === 'EADDRINUSE' ? 'waiting' : 'error', error: errorText(err), since: Date.now() });
      resolve({ port, ok: false, code: err.code, error: errorText(err) });
    };
    server.once('error', onError);
    server.once('listening', () => {
      server.removeListener('error', onError);
      server.on('error', (err) => console.error(`Puerto ${port}:`, err.message));
      servers.set(port, { server, role, status: 'listening', error: null, since: Date.now() });
      console.log(`Portal IPTV escuchando en http://${config.host}:${port}${role === 'clients' ? ' (clientes)' : ''}`);
      resolve({ port, ok: true });
    });
    server.listen(port, config.host);
  });
}

function close(port) {
  const entry = servers.get(port);
  servers.delete(port);
  if (!entry?.server) return Promise.resolve();
  return new Promise((resolve) => {
    entry.server.close(() => resolve());
    entry.server.closeAllConnections?.();
  });
}

/** Puertos de clientes deseados: los del panel o, si no hay, los de EXTRA_PORTS del .env. */
export async function configuredClientPorts() {
  const saved = (await getSettings()).client_ports;
  const list = Array.isArray(saved) && saved.length ? saved : config.extraPorts;
  return [...new Set(list.map(Number).filter((p) => p > 0 && p !== panelPort))];
}

/** Puertos de clientes abiertos ahora mismo (o los configurados si el gestor no se inició, p. ej. en pruebas). */
export function activeClientPorts() {
  if (!app) return config.extraPorts;
  return [...servers.entries()].filter(([, e]) => e.role === 'clients' && e.status === 'listening').map(([p]) => p);
}

export function listenerStatus() {
  return [...servers.entries()]
    .map(([port, e]) => ({ port, role: e.role, status: e.status, error: e.error, since: e.since }))
    .sort((a, b) => (a.role === b.role ? a.port - b.port : a.role === 'panel' ? -1 : 1));
}

/** Abre los puertos de clientes pedidos y cierra los que ya no están. Devuelve el resultado de cada uno. */
export async function applyClientPorts(ports) {
  desiredClients = [...new Set(ports.map(Number))].filter((p) => p !== panelPort);
  const results = [];
  for (const [port, e] of [...servers.entries()]) {
    if (e.role === 'clients' && !desiredClients.includes(port)) {
      await close(port);
      results.push({ port, ok: true, closed: true });
    }
  }
  for (const port of desiredClients) {
    const e = servers.get(port);
    if (e?.status === 'listening') results.push({ port, ok: true, already: true });
    else results.push(await listen(port, 'clients'));
  }
  return results;
}

/** Comprueba si un puerto se puede usar (sin quedarse con él). */
export async function probePort(port) {
  if (servers.get(port)?.status === 'listening') return { port, available: true, in_use_by_portal: true };
  return new Promise((resolve) => {
    const s = http.createServer();
    s.once('error', (err) => resolve({ port, available: false, code: err.code, error: errorText(err) }));
    s.once('listening', () => s.close(() => resolve({ port, available: true, in_use_by_portal: false })));
    s.listen(port, config.host);
  });
}

/** Arranque: puerto principal (si falla, el proceso termina) y puertos de clientes. */
export async function startListeners(expressApp, { panelPort: port = config.port } = {}) {
  app = expressApp;
  panelPort = port;
  const main = await listen(panelPort, 'panel');
  if (!main.ok) throw new Error(`No se pudo abrir el puerto principal ${panelPort}: ${main.error}`);
  const results = await applyClientPorts(await configuredClientPorts());
  for (const r of results) {
    if (!r.ok) console.error(`El puerto ${r.port} no se pudo abrir (${r.error}). Se reintentará cada 30 s.`);
  }
  retryTimer = setInterval(async () => {
    for (const port of desiredClients) {
      const e = servers.get(port);
      if (e && e.status === 'waiting') await listen(port, 'clients');
    }
  }, 30_000);
  retryTimer.unref();
}

export async function stopListeners() {
  if (retryTimer) clearInterval(retryTimer);
  await Promise.all([...servers.keys()].map((p) => close(p)));
}

/** Si la URL para clientes usa un puerto que ya no está abierto, la pasa al primero de la lista. */
export async function movePublicUrl(ports) {
  const current = (await getSettings()).public_url || '';
  const m = /^(https?:\/\/[^/]+?):(\d+)(\/.*)?$/.exec(current);
  const port = m ? Number(m[2]) : null;
  if (!m || ports.includes(port) || port === panelPort) return null;
  const next = `${m[1]}:${ports[0]}${m[3] || ''}`;
  await saveSettings({ public_url: next });
  return next;
}

/** Si el gestor no se inició con startListeners (p. ej. en pruebas), usa la app de la petición. */
export function ensureApp(expressApp) {
  if (!app) app = expressApp;
}
