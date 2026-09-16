// Identidad del portal y todas las direcciones por las que se le puede llegar.
// Los nodos y la app las guardan: si la dirección que usan deja de responder (cambio de IP, otra red),
// prueban las demás y buscan el portal en la red local reconociéndolo por su identificador.
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { interfaceOfUrl, localPorts } from './ipFollow.js';
import { activeClientPorts, currentPanelPort } from './listeners.js';

let cache = { at: 0, ports: null };

/** Identificador estable del portal (viaja en los backups: el servicio sigue siendo el mismo). */
export async function portalId() {
  const s = await getSettings();
  if (s.install_id) return s.install_id;
  const id = crypto.randomUUID();
  await saveSettings({ install_id: id });
  return id;
}

async function networkPorts() {
  if (cache.ports && Date.now() - cache.at < 5 * 60_000) return cache.ports;
  try {
    const { listNetworkPorts } = await import('./network.js');
    cache = { at: Date.now(), ports: await listNetworkPorts() };
  } catch {
    cache = { at: Date.now(), ports: localPorts() };
  }
  return cache.ports;
}

const clean = (u) => String(u || '').trim().replace(/\/+$/, '');

/**
 * Direcciones del portal, de la más recomendable a la menos: la que usó quien pregunta, la URL para clientes,
 * las alternativas de Ajustes y la IP de cada interfaz (sin locales ni virtuales) con los puertos abiertos.
 */
export async function portalAddresses({ requestBase = null, forApp = false } = {}) {
  const s = await getSettings();
  const clientPorts = activeClientPorts();
  const separated = forApp && Boolean(s.separate_ports) && clientPorts.length > 0;
  const panel = currentPanelPort();
  const urls = [];
  const add = (u) => {
    const v = clean(u);
    if (!/^https?:\/\/[^/]+$/i.test(v) || urls.includes(v)) return;
    if (separated && Number((/:(\d+)$/.exec(v) || [])[1]) === panel) return; // la app no usa el puerto del panel
    urls.push(v);
  };
  add(requestBase);
  add(s.public_url);
  for (const u of s.alternate_urls || []) add(u);
  const { rankAddresses } = await import('./network.js');
  const ports = separated ? clientPorts : [...new Set([...clientPorts, panel])];
  for (const a of rankAddresses(await networkPorts())) {
    if (a.family !== 'IPv4' || a.interface_type === 'virtual' || a.interface_type === 'loopback') continue;
    for (const port of ports) add(`http://${a.address}:${port}`);
  }
  return urls.slice(0, 24);
}

export async function portalIdentity(req = null, { forApp = false } = {}) {
  const s = await getSettings();
  const requestBase = req ? `${req.protocol}://${req.get('host')}` : null;
  return { id: await portalId(), name: s.server_name, urls: await portalAddresses({ requestBase, forApp }) };
}

/** Una sola vez: en un portal que ya tenía clientes la separación de puertos empieza apagada (no romper enlaces). */
export async function initPortSeparation() {
  if (await db('settings').where({ key: 'separate_ports' }).first()) return;
  const users = Number((await db('users').count({ c: '*' }).first()).c);
  if (users > 0) await saveSettings({ separate_ports: false });
  else await saveSettings({ separate_ports: true });
}

/**
 * Una sola vez: activa el seguimiento de IP en las URLs configuradas antes de que existiera,
 * si apuntan a una IP de una interfaz (del portal o del nodo).
 */
export async function backfillUrlFollow() {
  const marker = await db('settings').where({ key: 'url_follow_backfilled' }).first();
  if (marker) return;
  const s = await getSettings();
  if (s.public_url && !s.public_url_auto) {
    const iface = interfaceOfUrl(s.public_url, localPorts());
    if (iface) await saveSettings({ public_url_auto: true, public_url_interface: iface });
  }
  for (const row of await db('servers').whereNot('public_url', '').where('public_url_auto', false)) {
    let network = null;
    try { network = JSON.parse(row.network || 'null'); } catch { /* sin datos */ }
    const iface = network ? interfaceOfUrl(row.public_url, network.ports || []) : null;
    if (iface) await db('servers').where({ id: row.id }).update({ public_url_auto: true, public_url_interface: iface });
  }
  await db('settings').insert({ key: 'url_follow_backfilled', value: JSON.stringify(true) });
}
