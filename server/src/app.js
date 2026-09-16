import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import adminRoutes from './routes/admin/index.js';
import clientRoutes from './routes/client.js';
import legalRoutes from './routes/legal.js';
import nodeRoutes from './routes/node.js';
import xtreamRoutes from './routes/xtream.js';
import { handleWebhook } from './services/billingSync.js';
import { portGuard } from './lib/portGuard.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  // Las apps de TV (Tizen/webOS) hacen peticiones desde file://, por eso CORS abierto para la API pública.
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, version: config.version }));
  app.use(portGuard); // panel y clientes separados por puerto
  app.use(legalRoutes); // /privacidad y /eliminar-datos (Google Play)

  app.use('/api/admin', adminRoutes);
  app.use('/api/client', clientRoutes);
  app.use('/api/node', nodeRoutes);
  // Webhook para que la plataforma de facturación avise de cortes y pagos al instante.
  app.post('/api/integrations/billing/webhook/:token', async (req, res) => {
    res.json(await handleWebhook(req.params.token, req.body));
  });

  // Portal web de administración (build de admin/).
  const indexHtml = path.join(config.adminDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use('/admin', express.static(config.adminDist, { index: false, maxAge: '1h' }));
    app.get(/^\/admin(\/.*)?$/, (_req, res) => res.sendFile(indexHtml));
    app.get('/', (_req, res) => res.redirect('/admin/'));
  } else {
    app.get(/^\/admin(\/.*)?$/, (_req, res) => {
      res.status(503).type('text').send('El portal no está compilado. Ejecuta "npm run build" en la carpeta admin/.');
    });
  }

  app.use(xtreamRoutes);

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada' });
    res.status(404).type('text').send('No encontrado');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    const status = err.status || err.statusCode || 500;
    if (status >= 500 && !err.expose) console.error(`[${req.method} ${req.originalUrl}]`, err);
    else if (status >= 500) console.warn(`[${req.method} ${req.originalUrl}] ${err.message}`);
    if (res.headersSent) return res.destroy();
    const message = status >= 500 && !err.expose ? 'Error interno del servidor' : err.message;
    if (req.path.startsWith('/api/') || req.accepts(['json', 'text']) === 'json') {
      return res.status(status).json({ error: message });
    }
    res.status(status).type('text').send(message);
  });

  return app;
}
