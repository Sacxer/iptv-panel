// Cambia el puerto de la URL para clientes guardada en Ajustes (lo usa el instalador con --set-clients-port).
// Uso: node scripts/set-public-port.js <puerto-anterior> <puerto-nuevo>
import { db } from '../src/db/index.js';
import { getSettings, saveSettings } from '../src/lib/settings.js';

const [oldPort, newPort] = process.argv.slice(2).map(Number);
try {
  if (!oldPort || !newPort) throw new Error('Uso: node scripts/set-public-port.js <puerto-anterior> <puerto-nuevo>');
  const current = (await getSettings()).public_url || '';
  const m = /^(https?:\/\/[^/]+?):(\d+)(\/.*)?$/.exec(current);
  if (m && Number(m[2]) === oldPort) {
    const next = `${m[1]}:${newPort}${m[3] || ''}`;
    await saveSettings({ public_url: next });
    console.log(`URL para clientes: ${current} -> ${next}`);
  } else {
    console.log(`La URL para clientes (${current || 'vacía'}) no usa el puerto ${oldPort}: no se cambió.`);
  }
} finally {
  await db.destroy();
}
