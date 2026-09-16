// Descubrimiento en la red local: la app envía "IPTV-DISCOVER" por difusión UDP y el portal responde
// con su nombre y la URL (IP de la interfaz que da a esa red + puerto). Así el cliente no tiene que
// escribir la IP ni el puerto al entrar con Xtream Codes.
import dgram from 'node:dgram';
import os from 'node:os';
import { config } from '../config.js';
import { getSettings } from '../lib/settings.js';
import { activeClientPorts } from './listeners.js';
import { classifyIp } from './network.js';

export const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT || 25460);
const MAGIC = 'IPTV-DISCOVER';
const LAN_SCOPES = new Set(['private', 'loopback', 'link-local', 'cgnat']);

const toInt = (ip) => ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);

/** IP de este equipo en la misma red que `remote` (o la primera IPv4 de LAN si no hay coincidencia). */
export function localAddressFor(remote, interfaces = os.networkInterfaces()) {
  const target = String(remote || '').replace(/^::ffff:/, '');
  const candidates = [];
  for (const list of Object.values(interfaces)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      candidates.push(a);
      if (/^\d+\.\d+\.\d+\.\d+$/.test(target) && a.netmask) {
        const mask = toInt(a.netmask);
        if ((toInt(a.address) & mask) === (toInt(target) & mask) && !a.internal) return a.address;
      }
    }
  }
  if (classifyIp(target) === 'loopback') return '127.0.0.1';
  return candidates.find((a) => !a.internal && classifyIp(a.address) === 'private')?.address
    || candidates.find((a) => !a.internal)?.address
    || '127.0.0.1';
}

/** Datos que se anuncian a la app. */
export async function discoveryInfo(localAddress) {
  const settings = await getSettings();
  const ports = [...new Set([config.port, ...activeClientPorts()])];
  return {
    type: 'iptv-portal',
    name: settings.server_name,
    version: config.version,
    url: `http://${localAddress}:${config.port}`,
    host: localAddress,
    port: config.port,
    ports,
    public_url: settings.public_url || null,
  };
}

export function startDiscovery({ port = DISCOVERY_PORT, log = console.log } = {}) {
  if (process.env.DISCOVERY_ENABLED === 'false') return () => {};
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const recent = new Map(); // ip -> [marcas de tiempo]: evita usar el portal para amplificar tráfico

  socket.on('message', async (msg, rinfo) => {
    if (!msg.toString('utf8', 0, MAGIC.length).startsWith(MAGIC)) return;
    // Solo se responde a equipos de redes locales (una IP pública podría ser falsificada).
    if (!LAN_SCOPES.has(classifyIp(rinfo.address))) return;
    const t = Date.now();
    const hits = (recent.get(rinfo.address) || []).filter((x) => t - x < 1000);
    if (hits.length >= 5) return;
    hits.push(t);
    recent.set(rinfo.address, hits);
    if (recent.size > 1000) recent.clear();
    try {
      const body = Buffer.from(JSON.stringify(await discoveryInfo(localAddressFor(rinfo.address))));
      socket.send(body, rinfo.port, rinfo.address);
    } catch { /* la respuesta es opcional */ }
  });
  socket.on('error', (err) => {
    log(`Descubrimiento en red local no disponible (UDP ${port}): ${err.message}`);
    try { socket.close(); } catch { /* ya cerrado */ }
  });
  socket.bind(port, () => {
    try { socket.setBroadcast(true); } catch { /* no crítico */ }
  });
  socket.unref();
  return () => {
    try { socket.close(); } catch { /* ya cerrado */ }
  };
}
