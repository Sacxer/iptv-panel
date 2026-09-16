// Red del servidor: interfaces (puertos de red) con sus IPs, puerta de enlace, puertos TCP a la escucha
// y la URL que usan los clientes. Muchos servidores no tienen IP pública: se usa la IP de la interfaz principal.
import { activeClientPorts, configuredClientPorts } from './listeners.js';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { config } from '../config.js';
import { getSettings } from '../lib/settings.js';

const run = (cmd, args, timeout = 8000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
});

/* ------------------------------------ Clasificación ------------------------------------ */

/** loopback | private | cgnat | link-local | public (IPv4 e IPv6). */
export function classifyIp(address) {
  const ip = String(address || '').replace(/^::ffff:/, '').split('%')[0];
  if (!ip) return 'unknown';
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return 'loopback';
    if (/^fe[89ab]/.test(lower)) return 'link-local';
    if (lower.startsWith('fc') || lower.startsWith('fd')) return 'private';
    return 'public';
  }
  const [a, b] = ip.split('.').map(Number);
  if (a === 127 || a === 0) return 'loopback';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  if (a === 169 && b === 254) return 'link-local';
  return 'public';
}

export const isPublicIp = (ip) => classifyIp(ip) === 'public';

/** Tipo de interfaz por su nombre/descripción: ethernet | wifi | vpn | virtual | loopback. */
export function interfaceType(name, description = '') {
  const text = `${name} ${description}`;
  if (/^lo$|loopback/i.test(text)) return 'loopback';
  if (/zerotier|^zt|tailscale|wireguard|^wg\d|^tun\d|^tap\d|openvpn|vpn|ppp/i.test(text)) return 'vpn';
  if (/docker|^veth|^br-|virbr|vethernet|hyper-v|virtualbox|vmware|host-only|vboxnet|^cni|flannel|^kube|^lxc|^lxd/i.test(text)) return 'virtual';
  if (/wi-?fi|wlan|^wl|wireless|802\.11/i.test(text)) return 'wifi';
  return 'ethernet';
}

const TYPE_LABEL = { ethernet: 'Ethernet', wifi: 'Wi-Fi', vpn: 'VPN', virtual: 'Virtual', loopback: 'Local (loopback)' };

function cidrOf(netmask) {
  if (!netmask) return null;
  if (netmask.includes(':')) return null;
  return netmask.split('.').reduce((n, part) => n + (Number(part).toString(2).match(/1/g) || []).length, 0);
}

/* ------------------------------ Datos del sistema operativo ------------------------------ */

/** Linux: estado, velocidad, si es física (tiene "device") y rutas por defecto. */
async function linuxDetails() {
  const details = new Map();
  let names = [];
  try {
    names = await fs.readdir('/sys/class/net');
  } catch {
    return { details, gateways: new Map() };
  }
  for (const name of names) {
    const base = `/sys/class/net/${name}`;
    const read = (f) => fs.readFile(`${base}/${f}`, 'utf8').then((x) => x.trim()).catch(() => null);
    const speed = Number(await read('speed'));
    const physical = await fs.access(`${base}/device`).then(() => true).catch(() => false);
    const wireless = await fs.access(`${base}/wireless`).then(() => true).catch(() => false);
    details.set(name, {
      status: (await read('operstate')) || 'unknown',
      speed_mbps: speed > 0 && speed < 1_000_000 ? speed : null,
      mac: await read('address'),
      physical,
      wireless,
      carrier: (await read('carrier')) === '1',
    });
  }
  const gateways = new Map();
  try {
    for (const line of (await fs.readFile('/proc/net/route', 'utf8')).split('\n').slice(1)) {
      const [iface, dest, gw, , , , metric] = line.trim().split(/\s+/);
      if (dest !== '00000000' || !gw) continue;
      const ip = [gw.slice(6, 8), gw.slice(4, 6), gw.slice(2, 4), gw.slice(0, 2)].map((h) => parseInt(h, 16)).join('.');
      if (!gateways.has(iface) || Number(metric) < gateways.get(iface).metric) gateways.set(iface, { gateway: ip, metric: Number(metric) });
    }
  } catch {
    // sin /proc
  }
  return { details, gateways };
}

/** Windows: Get-NetAdapter (estado, velocidad, descripción) y rutas por defecto. */
async function windowsDetails() {
  const details = new Map();
  const gateways = new Map();
  const ps = (cmd) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${cmd} | ConvertTo-Json -Compress`], 12000);
  const parse = (text) => {
    try {
      const v = JSON.parse(text || 'null');
      return Array.isArray(v) ? v : v ? [v] : [];
    } catch {
      return [];
    }
  };
  for (const a of parse(await ps('Get-NetAdapter | Select-Object Name,InterfaceDescription,Status,LinkSpeed,MacAddress'))) {
    const speed = /([\d.]+)\s*(G|M)bps/i.exec(a.LinkSpeed || '');
    details.set(a.Name, {
      status: String(a.Status || '').toLowerCase() === 'up' ? 'up' : String(a.Status || 'unknown').toLowerCase(),
      speed_mbps: speed ? Math.round(Number(speed[1]) * (speed[2].toUpperCase() === 'G' ? 1000 : 1)) : null,
      mac: a.MacAddress ? String(a.MacAddress).replace(/-/g, ':').toLowerCase() : null,
      description: a.InterfaceDescription || '',
      physical: !/virtual|hyper-v|zerotier|vpn|tap|tun|loopback|wan miniport|bluetooth/i.test(a.InterfaceDescription || ''),
    });
  }
  for (const r of parse(await ps("Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object InterfaceAlias,NextHop,RouteMetric"))) {
    const metric = Number(r.RouteMetric) || 0;
    if (!gateways.has(r.InterfaceAlias) || metric < gateways.get(r.InterfaceAlias).metric) {
      gateways.set(r.InterfaceAlias, { gateway: r.NextHop, metric });
    }
  }
  return { details, gateways };
}

/**
 * Puertos de red del servidor con sus IPs.
 * [{ name, type, type_label, status, speed_mbps, mac, physical, default_route, gateway,
 *    addresses: [{ address, family, cidr, scope }] }]
 */
export async function listNetworkPorts() {
  const { details, gateways } = process.platform === 'win32' ? await windowsDetails() : await linuxDetails();
  const ifaces = os.networkInterfaces();
  const names = new Set([...Object.keys(ifaces), ...details.keys()]);
  const defaultIface = [...gateways.entries()].sort((a, b) => a[1].metric - b[1].metric)[0]?.[0] || null;
  const ports = [];
  for (const name of names) {
    const d = details.get(name) || {};
    const addresses = (ifaces[name] || []).map((a) => ({
      address: a.address,
      family: a.family === 6 || a.family === 'IPv6' ? 'IPv6' : 'IPv4',
      cidr: a.cidr ? Number(a.cidr.split('/')[1]) : cidrOf(a.netmask),
      scope: classifyIp(a.address),
    }));
    let type = interfaceType(name, d.description);
    if (d.wireless && type === 'ethernet') type = 'wifi';
    if (type === 'ethernet' && d.physical === false && process.platform !== 'win32') type = 'virtual';
    ports.push({
      name,
      description: d.description || '',
      type,
      type_label: TYPE_LABEL[type],
      status: addresses.length && (!d.status || d.status === 'unknown') ? 'up' : (d.status || (addresses.length ? 'up' : 'down')),
      speed_mbps: d.speed_mbps ?? null,
      mac: d.mac || (ifaces[name] || []).find((a) => a.mac && a.mac !== '00:00:00:00:00:00')?.mac || null,
      physical: d.physical ?? null,
      default_route: name === defaultIface,
      gateway: gateways.get(name)?.gateway || null,
      addresses,
    });
  }
  const typeRank = { ethernet: 0, wifi: 1, vpn: 2, virtual: 3, loopback: 4 };
  return ports.sort((a, b) => (Number(b.default_route) - Number(a.default_route))
    || (Number(b.status === 'up') - Number(a.status === 'up')) || (typeRank[a.type] - typeRank[b.type]) || a.name.localeCompare(b.name));
}

/** Compatibilidad: lista plana de direcciones. */
export function listInterfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      out.push({ name, address: a.address, family: a.family === 6 || a.family === 'IPv6' ? 'IPv6' : 'IPv4', mac: a.mac, scope: classifyIp(a.address) });
    }
  }
  return out;
}

/* -------------------------------------- IP pública -------------------------------------- */

let publicIpCache = null;

/** IP con la que el servidor sale a internet (solo si se pide; puede no existir o no ser alcanzable desde fuera). */
export async function detectPublicIp({ force = false } = {}) {
  if (!force && publicIpCache && Date.now() - publicIpCache.at < 10 * 60_000) return publicIpCache.value;
  let lastError = null;
  for (const url of ['https://api.ipify.org?format=json', 'https://ifconfig.me/ip', 'https://icanhazip.com']) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'curl/8' } });
      const text = (await res.text()).trim();
      const ip = text.startsWith('{') ? JSON.parse(text).ip : text;
      if (/^[0-9a-f.:]+$/i.test(ip)) {
        const value = { address: ip, source: new URL(url).hostname, scope: classifyIp(ip), error: null };
        publicIpCache = { at: Date.now(), value };
        return value;
      }
    } catch (err) {
      lastError = err.cause?.code || err.message;
    }
  }
  return { address: null, source: null, scope: null, error: `No se pudo detectar la IP de salida a internet (${lastError || 'sin respuesta'})` };
}

/* ----------------------------------- Puertos TCP a la escucha ----------------------------------- */

const KNOWN_PORTS = {
  22: 'SSH', 25: 'SMTP', 53: 'DNS', 80: 'HTTP (web / Nginx)', 443: 'HTTPS', 1935: 'RTMP', 3000: 'Aplicación web',
  3306: 'MySQL / MariaDB', 5432: 'PostgreSQL', 6379: 'Redis', 7999: 'MySQL (XtreamUI)', 8000: 'Astra (interfaz web)',
  8080: 'HTTP alternativo', 8090: 'Nodo de streaming', 8100: 'Astra (salida HTTP)', 25461: 'Xtream (clientes)',
  25462: 'Xtream (RTMP)', 25463: 'Xtream (HTTPS)', 25500: 'XtreamUI (panel)',
};

function hexToIpv4(hex) {
  return [hex.slice(6, 8), hex.slice(4, 6), hex.slice(2, 4), hex.slice(0, 2)].map((h) => parseInt(h, 16)).join('.');
}

async function listenFromProc() {
  const out = [];
  for (const [file, v6] of [['/proc/net/tcp', false], ['/proc/net/tcp6', true]]) {
    try {
      for (const line of (await fs.readFile(file, 'utf8')).split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 4 || cols[3] !== '0A') continue;
        const [ipHex, portHex] = cols[1].split(':');
        out.push({ ip: v6 ? (/^0+$/.test(ipHex) ? '::' : 'IPv6') : hexToIpv4(ipHex), port: parseInt(portHex, 16), process: null });
      }
    } catch {
      // no es Linux
    }
  }
  return out;
}

/** Puertos TCP a la escucha, con la IP en la que escuchan y, si se puede, el proceso. */
export async function listListeningPorts() {
  let entries = [];
  if (process.platform === 'win32') {
    const text = `${(await run('netstat', ['-ano', '-p', 'TCP'])) || ''}\n${(await run('netstat', ['-ano', '-p', 'TCPv6'])) || ''}`;
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+(LISTENING|ESCUCHANDO)\s+(\d+)/i.exec(line);
      if (m) entries.push({ ip: m[1].replace(/^\[|\]$/g, ''), port: Number(m[2]), process: `PID ${m[4]}` });
    }
  } else {
    const text = await run('ss', ['-H', '-tlnp']);
    if (text) {
      for (const line of text.split('\n')) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 4) continue;
        const local = cols[3];
        const idx = local.lastIndexOf(':');
        const ip = local.slice(0, idx).replace(/^\[|\]$/g, '').replace(/%.*$/, '');
        entries.push({ ip: ip === '*' ? '0.0.0.0' : ip, port: Number(local.slice(idx + 1)), process: (/users:\(\("([^"]+)"/.exec(line) || [])[1] || null });
      }
    } else {
      entries = await listenFromProc();
    }
  }
  const portalPorts = new Set([config.port, ...activeClientPorts()]);
  const seen = new Set();
  return entries
    .filter((e) => e.port > 0 && !seen.has(`${e.ip}|${e.port}`) && seen.add(`${e.ip}|${e.port}`))
    .map((e) => ({
      ...e,
      all_interfaces: ['0.0.0.0', '::', '*'].includes(e.ip),
      scope: ['0.0.0.0', '::', '*'].includes(e.ip) ? 'all' : classifyIp(e.ip),
      service: portalPorts.has(e.port) ? 'Portal IPTV' : KNOWN_PORTS[e.port] || null,
      portal: portalPorts.has(e.port),
    }))
    .sort((a, b) => (Number(b.portal) - Number(a.portal)) || (a.port - b.port));
}

/* ------------------------------------ URL para clientes ------------------------------------ */

async function portalResponds(ip, port) {
  const host = ip.includes(':') ? `[${ip}]` : ip;
  try {
    const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

function urlFor(ip, port) {
  const host = ip.includes(':') ? `[${ip}]` : ip;
  return `http://${host}${Number(port) === 80 ? '' : `:${port}`}`;
}

/** IPs utilizables (no loopback ni link-local) ordenadas: pública > interfaz con puerta de enlace > Ethernet > Wi-Fi > VPN > virtual. */
export function rankAddresses(ports) {
  const typeScore = { ethernet: 20, wifi: 12, vpn: 6, virtual: -40, loopback: -100 };
  const out = [];
  for (const p of ports) {
    if (p.status === 'down') continue;
    for (const a of p.addresses) {
      if (['loopback', 'link-local', 'unknown'].includes(a.scope)) continue;
      const score = (a.scope === 'public' ? 100 : 0) + (p.default_route ? 50 : 0) + (typeScore[p.type] ?? 0) + (a.family === 'IPv4' ? 10 : 0);
      out.push({ ...a, interface: p.name, interface_type: p.type, interface_label: p.type_label, default_route: p.default_route, score });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

/** URLs candidatas: cada IP de cada puerto de red × puertos del portal (25461 primero, luego 80 si hay proxy). */
export async function suggestPublicUrls({ networkPorts = null, listening = null, external = false } = {}) {
  const ports = networkPorts || await listNetworkPorts();
  const tcp = listening || await listListeningPorts();
  const portalPorts = [...new Set([config.port, ...activeClientPorts()])];
  const candidatePorts = [...portalPorts];
  if (tcp.some((p) => p.port === 80) && !candidatePorts.includes(80)) candidatePorts.push(80);
  const weight = (port) => (port === 25461 ? 0 : port === 80 ? 1 : 2);
  candidatePorts.sort((a, b) => weight(a) - weight(b));

  const suggestions = [];
  for (const addr of rankAddresses(ports)) {
    for (const port of candidatePorts) {
      suggestions.push({
        url: urlFor(addr.address, port),
        ip: addr.address,
        port,
        interface: addr.interface,
        interface_type: addr.interface_type,
        scope: addr.scope,
        default_route: addr.default_route,
        reason: [
          `${addr.interface_label} «${addr.interface}»`,
          addr.default_route ? 'interfaz principal (puerta de enlace)' : null,
          addr.scope === 'public' ? 'IP pública' : addr.scope === 'private' ? 'IP de red privada' : addr.scope === 'cgnat' ? 'IP de operador (CGNAT)' : null,
          port === 25461 ? 'puerto Xtream habitual' : port === 80 ? 'puerto web' : 'puerto del portal',
        ].filter(Boolean).join(' · '),
        responds: await portalResponds(addr.address, port),
      });
    }
  }
  let publicIp = null;
  if (external) {
    publicIp = await detectPublicIp();
    if (publicIp.address && !suggestions.some((s) => s.ip === publicIp.address)) {
      for (const port of candidatePorts) {
        suggestions.push({
          url: urlFor(publicIp.address, port), ip: publicIp.address, port, interface: null, interface_type: 'nat', scope: publicIp.scope,
          default_route: false, reason: 'IP de salida a internet (el router debe redirigir el puerto a este servidor)', responds: null,
        });
      }
    }
  }
  return { suggestions, public_ip: publicIp };
}

/** URL base para enlaces del panel (M3U de clientes, instalación de nodos). Nunca localhost/127.0.0.1 si hay otra opción. */
export async function publicBaseUrl(req) {
  const settings = await getSettings();
  if (settings.public_url) return settings.public_url.replace(/\/+$/, '');
  const host = req?.get?.('host') || '';
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (host && hostname !== 'localhost' && classifyIp(hostname) !== 'loopback') return `${req.protocol}://${host}`;
  const best = rankAddresses(await listNetworkPorts())[0];
  if (best) {
    const port = activeClientPorts()[0] || config.port;
    return urlFor(best.address, port);
  }
  return host ? `${req.protocol}://${host}` : `http://localhost:${config.port}`;
}

/** En el primer arranque, deja la URL para clientes con la IP de la interfaz principal (o PUBLIC_URL si se definió). */
export async function autoConfigurePublicUrl(saveSettings, log = console.log) {
  const settings = await getSettings();
  if (settings.public_url) return null;
  if (process.env.PUBLIC_URL) {
    await saveSettings({ public_url: process.env.PUBLIC_URL.replace(/\/+$/, '') });
    log(`URL para clientes configurada desde PUBLIC_URL: ${process.env.PUBLIC_URL}`);
    return process.env.PUBLIC_URL;
  }
  if (process.env.AUTO_PUBLIC_URL === 'false') return null;
  const best = rankAddresses(await listNetworkPorts()).find((a) => a.family === 'IPv4');
  if (!best) return null;
  const url = urlFor(best.address, (await configuredClientPorts())[0] || config.port);
  await saveSettings({ public_url: url });
  log(`URL para clientes configurada: ${url} (${best.interface_label} «${best.interface}»). Puedes cambiarla en Ajustes → Red.`);
  return url;
}
