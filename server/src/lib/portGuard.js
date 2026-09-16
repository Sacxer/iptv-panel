// Separación de puertos: el panel no se sirve por los puertos de clientes y los clientes no usan el del panel.
// Así un problema en uno (tráfico de streams, bloqueos, ataques al puerto público) no afecta al otro.
// Los nodos (/api/node), /health y las páginas legales responden en todos.
import { activeClientPorts, portRole } from '../services/listeners.js';
import { getSettings } from './settings.js';

const PANEL_PATHS = /^\/(admin(\/|$)|api\/admin(\/|$))/;
const CLIENT_PATHS = /^\/(player_api\.php|get\.php|xmltv\.php|(live|movie|series)\/|api\/client\/)/;
const LEGACY_STREAM = /^\/[^/]+\/[^/]+\/\d+(\.[A-Za-z0-9]{2,5})?$/;

export async function separationActive() {
  return Boolean((await getSettings()).separate_ports) && activeClientPorts().length > 0;
}

export async function portGuard(req, res, next) {
  const role = portRole(req.socket?.localPort);
  if (!role || !(await separationActive())) return next();
  if (role === 'clients' && (PANEL_PATHS.test(req.path) || req.path === '/')) {
    return res.status(404).type('text').send('Portal IPTV');
  }
  if (role === 'panel' && (CLIENT_PATHS.test(req.path) || (LEGACY_STREAM.test(req.path) && !req.path.startsWith('/api/')))) {
    const port = activeClientPorts()[0];
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: `Este es el puerto del panel. Los clientes usan el puerto ${port}.` });
    return res.status(404).type('text').send(`Este es el puerto del panel. Los clientes usan el puerto ${port}.`);
  }
  return next();
}
