// La URL para clientes sigue a su interfaz de red: si tras un corte de luz el router (DHCP) le da otra IP
// al servidor, la URL se actualiza sola. Solo cuando la URL es una IP de la propia máquina
// (un dominio o una IP pública detrás de NAT no se tocan).
import os from 'node:os';
import { logAction } from '../lib/log.js';
import { getSettings, saveSettings } from '../lib/settings.js';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function splitUrl(url) {
  const m = /^(https?):\/\/(\[[^\]]+\]|[^/:]+)(:\d+)?(\/.*)?$/i.exec(String(url || '').trim());
  if (!m) return null;
  return {
    scheme: m[1], host: m[2].replace(/^\[|\]$/g, ''), port: m[3] || '', path: m[4] || '',
  };
}

const isIp = (host) => IPV4.test(host) || host.includes(':');

/** Interfaz (de os.networkInterfaces() o de la lista de un nodo) que tiene la IP de la URL, o null. */
export function interfaceOfUrl(url, ports) {
  const u = splitUrl(url);
  if (!u || !isIp(u.host)) return null;
  for (const p of ports) {
    if ((p.addresses || []).some((a) => a.address === u.host)) return p.name;
  }
  return null;
}

/** os.networkInterfaces() con la misma forma que la lista de puertos de red. */
export function localPorts(interfaces = os.networkInterfaces()) {
  return Object.entries(interfaces).map(([name, list]) => ({
    name,
    status: 'up',
    type: (list || []).some((a) => a.internal) ? 'loopback' : 'ethernet',
    addresses: (list || []).map((a) => ({
      address: a.address,
      family: a.family === 4 ? 'IPv4' : a.family === 6 ? 'IPv6' : a.family,
      scope: a.internal ? 'loopback' : /^fe80:/i.test(a.address) ? 'link-local' : 'private',
    })),
  }));
}

/**
 * Si la IP de la URL ya no está en ninguna interfaz, propone la IP actual de la misma interfaz
 * (o la mejor disponible). Devuelve { url, interface, from, to } o null si no hay que cambiar nada.
 * `rank` ordena direcciones (rankAddresses de network.js) y se inyecta para evitar dependencias circulares.
 */
export function followUrl(url, ports, iface, rank) {
  const u = splitUrl(url);
  if (!u || !isIp(u.host)) return null;
  if (ports.some((p) => (p.addresses || []).some((a) => a.address === u.host))) return null;
  const candidates = rank(ports).filter((a) => a.family === 'IPv4' || a.family === 4);
  const best = (iface && candidates.find((a) => a.interface === iface)) || candidates[0];
  if (!best || best.address === u.host) return null;
  return {
    url: `${u.scheme}://${best.address}${u.port}${u.path}`, interface: best.interface, from: u.host, to: best.address,
  };
}

/** Comprueba la URL para clientes del portal y la corrige si su IP cambió. */
export async function followPublicUrl({ interfaces, fullPorts } = {}) {
  const s = await getSettings();
  if (!s.public_url || !s.public_url_auto) return null;
  const quick = localPorts(interfaces);
  const u = splitUrl(s.public_url);
  if (!u || quick.some((p) => p.addresses.some((a) => a.address === u.host))) return null; // sigue igual (lo normal)
  const { listNetworkPorts, rankAddresses } = await import('./network.js');
  const ports = fullPorts || (interfaces ? quick : await listNetworkPorts());
  const change = followUrl(s.public_url, ports, s.public_url_interface, rankAddresses);
  if (!change) return null;
  const { toClientUrl } = await import('./listeners.js');
  change.url = toClientUrl(change.url);
  await saveSettings({ public_url: change.url, public_url_interface: change.interface });
  await logAction(null, 'system.public_url_follow', 'settings', null, change);
  console.log(`La IP del servidor cambió (${change.from} → ${change.to}): URL para clientes ${change.url}`);
  return change;
}

export function startIpFollow() {
  const run = () => followPublicUrl().catch((err) => console.warn('Revisión de IP:', err.message));
  const first = setTimeout(run, 5_000);
  first.unref();
  const timer = setInterval(run, 2 * 60_000);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
