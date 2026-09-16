// Cambia los puertos para clientes guardados en Ajustes (lo usa el instalador con --set-clients-port).
// El portal los aplica al reiniciar. Uso: node scripts/set-client-ports.js 25461[,80]
import { db } from '../src/db/index.js';
import { getSettings, saveSettings } from '../src/lib/settings.js';
import { movePublicUrl } from '../src/services/listeners.js';

try {
  const ports = [...new Set(String(process.argv[2] || '').split(',').map((p) => Number(p.trim())))];
  if (!ports.length || ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) {
    throw new Error('Uso: node scripts/set-client-ports.js <puerto>[,<puerto>…]');
  }
  const before = (await getSettings()).client_ports;
  await saveSettings({ client_ports: ports });
  console.log(`Puertos para clientes: ${before?.length ? before.join(', ') : '(los del .env)'} -> ${ports.join(', ')}`);
  const url = await movePublicUrl(ports);
  console.log(url ? `URL para clientes: ${url}` : 'La URL para clientes no cambió.');
} finally {
  await db.destroy();
}
