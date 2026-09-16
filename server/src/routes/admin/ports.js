// Puertos del portal: ver cuáles están abiertos y cambiar los de clientes sin reiniciar
// (p. ej. pasar al 25461 o al 80 después de apagar XtreamUI / XUI.one).
import fs from 'node:fs';
import { Router } from 'express';
import { adminOnly } from '../../lib/auth.js';
import { logAction } from '../../lib/log.js';
import { getSettings, saveSettings } from '../../lib/settings.js';
import { HttpError, bool, int } from '../../lib/util.js';
import {
  FIREWALL_HELPER, applyClientPorts, configuredClientPorts, currentPanelPort, ensureApp, listenerStatus, movePublicUrl, normalizeStoredClientUrl,
  openFirewall, probePort,
} from '../../services/listeners.js';
import { DISCOVERY_PORT } from '../../services/discovery.js';

const RESERVED = new Set([22, 25, 53, 3306, 5432]);

const router = Router();
router.use('/system/ports', adminOnly);

function xtreamOnServer() {
  if (fs.existsSync('/home/xtreamcodes/iptv_xtream_codes')) return 'XtreamUI';
  if (fs.existsSync('/home/xui')) return 'XUI.one';
  return null;
}

async function overview() {
  const settings = await getSettings();
  const xtream = xtreamOnServer();
  const original = Number(settings.xtream_db?.broadcast_port) || null;
  return {
    panel_port: currentPanelPort(),
    separate_ports: Boolean(settings.separate_ports),
    separation_active: Boolean(settings.separate_ports) && listenerStatus().some((l) => l.role === 'clients' && l.status === 'listening'),
    client_ports: await configuredClientPorts(),
    source: settings.client_ports?.length ? 'panel' : 'env',
    listeners: listenerStatus(),
    discovery_port: DISCOVERY_PORT,
    public_url: settings.public_url || '',
    firewall_helper: fs.existsSync(FIREWALL_HELPER),
    xtream: {
      on_server: xtream,
      migrated_from: settings.xtream_db?.host ? 'XtreamUI' : null,
      // Puerto que usaban los clientes en XtreamUI/XUI.one: el recomendado para que no cambien nada.
      suggested_port: original || (xtream === 'XUI.one' ? 80 : settings.xtream_db?.host || xtream ? 25461 : null),
      original_port: original,
    },
  };
}

function parsePorts(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'Envía la lista de puertos para clientes');
  const ports = [...new Set(list.map((p) => int(p, NaN)))];
  if (!ports.length) throw new HttpError(400, 'Deja al menos un puerto para los clientes');
  if (ports.length > 10) throw new HttpError(400, 'Máximo 10 puertos para clientes');
  for (const p of ports) {
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new HttpError(400, `Puerto no válido: ${p}`);
    if (p === currentPanelPort()) throw new HttpError(400, `El ${p} es el puerto del panel: usa uno distinto para los clientes`);
    if (RESERVED.has(p)) throw new HttpError(400, `El ${p} está reservado para otro servicio (SSH, correo, DNS o bases de datos)`);
  }
  return ports;
}

/** Con la separación activa, una URL para clientes que apunte al puerto del panel pasa al de clientes. */
async function moveUrlOffPanel(clientPort) {
  const current = (await getSettings()).public_url || '';
  const m = /^(https?:\/\/[^/]+?):(\d+)(\/.*)?$/.exec(current);
  if (!m || Number(m[2]) !== currentPanelPort()) return null;
  const next = `${m[1]}:${clientPort}${m[3] || ''}`;
  await saveSettings({ public_url: next });
  return next;
}

router.get('/system/ports', async (_req, res) => res.json(await overview()));

router.post('/system/ports/check', async (req, res) => {
  ensureApp(req.app);
  const port = int(req.body?.port, NaN);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'Puerto no válido');
  if (port === currentPanelPort()) return res.json({ port, available: false, in_use_by_portal: true, panel: true, error: 'Es el puerto del panel' });
  res.json(await probePort(port));
});

router.put('/system/ports', async (req, res) => {
  ensureApp(req.app);
  const body = req.body || {};
  if (body.client_ports === undefined && body.separate_ports !== undefined) {
    // Solo activar/desactivar la separación.
    const separate = bool(body.separate_ports);
    let movedUrl = null;
    if (separate) {
      const clients = listenerStatus().filter((l) => l.role === 'clients' && l.status === 'listening').map((l) => l.port);
      if (!clients.length) throw new HttpError(400, 'Abre primero al menos un puerto para clientes');
      movedUrl = await moveUrlOffPanel(clients[0]);
    }
    await saveSettings({ separate_ports: separate });
    await logAction(req.admin, 'system.ports_separation', 'settings', null, { separate, public_url: movedUrl });
    return res.json({ ...(await overview()), public_url_changed: movedUrl });
  }
  const ports = parsePorts(body.client_ports);
  const before = await configuredClientPorts();
  const results = await applyClientPorts(ports);
  await saveSettings({ client_ports: ports });
  if (body.separate_ports !== undefined) await saveSettings({ separate_ports: bool(body.separate_ports) });

  // URL para clientes: si su puerto deja de estar abierto, pasa al primero de la lista nueva.
  let publicUrl = null;
  if (body.update_public_url === undefined || bool(body.update_public_url)) {
    publicUrl = await movePublicUrl(ports);
  }
  publicUrl = (await normalizeStoredClientUrl()) || publicUrl;

  const opened = results.filter((r) => r.ok && !r.closed && !r.already).map((r) => r.port);
  const firewall = [];
  for (const p of opened) firewall.push(await openFirewall(p));

  await logAction(req.admin, 'system.ports', 'settings', null, { before, after: ports, public_url: publicUrl });
  res.json({ ...(await overview()), results, public_url_changed: publicUrl, firewall });
});

export default router;
