import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { db } from './db/index.js';
import { DISCOVERY_PORT, startDiscovery } from './services/discovery.js';
import { startListeners, stopListeners } from './services/listeners.js';

await bootstrap();
const app = createApp();

await startListeners(app);

// La app encuentra el portal en la red local sin escribir IP ni puerto.
const stopDiscovery = startDiscovery();
console.log(`Descubrimiento en red local: UDP ${DISCOVERY_PORT}`);

async function shutdown(signal) {
  stopDiscovery();
  console.log(`${signal} recibido, cerrando…`);
  await stopListeners();
  await db.destroy();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
