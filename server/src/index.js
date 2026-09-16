import http from 'node:http';
import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { config } from './config.js';
import { db } from './db/index.js';
import { DISCOVERY_PORT, startDiscovery } from './services/discovery.js';

await bootstrap();
const app = createApp();

const ports = [...new Set([config.port, ...config.extraPorts])];
const servers = ports.map((port) => {
  const server = http.createServer(app);
  server.requestTimeout = 0; // los streams en modo proxy son conexiones largas
  server.headersTimeout = 60_000;
  server.on('error', (err) => {
    // Un puerto adicional ocupado (p. ej. XtreamUI en 25461) no debe tumbar el portal.
    if (port !== config.port && err.code === 'EADDRINUSE') {
      console.error(`El puerto ${port} está ocupado por otro programa (¿XtreamUI?): los clientes no podrán usarlo hasta liberarlo.`);
      return;
    }
    throw err;
  });
  server.listen(port, config.host, () => console.log(`Portal IPTV escuchando en http://${config.host}:${port}`));
  return server;
});

// La app encuentra el portal en la red local sin escribir IP ni puerto.
const stopDiscovery = startDiscovery();
console.log(`Descubrimiento en red local: UDP ${DISCOVERY_PORT}`);

async function shutdown(signal) {
  stopDiscovery();
  console.log(`${signal} recibido, cerrando…`);
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  await db.destroy();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
