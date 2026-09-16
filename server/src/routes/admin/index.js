import { Router } from 'express';
import { adminOnly, requireAdmin } from '../../lib/auth.js';
import { logAction } from '../../lib/log.js';
import { getSettings, saveSettings } from '../../lib/settings.js';
import { HttpError, int } from '../../lib/util.js';
import {
  getJob, listJobs, startMigration, testXtream,
} from '../../services/xtreamMigrator.js';
import communications from './communications.js';
import content from './content.js';
import devices from './devices.js';
import integrations from './integrations.js';
import astra from './astra.js';
import backups, { backupPublicRouter } from './backups.js';
import appReleases from './appReleases.js';
import updates from './updates.js';
import ports from './ports.js';
import epg from './epg.js';
import servers from './servers.js';
import reminders from './reminders.js';
import { authRouter, systemRouter } from './system.js';
import users from './users.js';

const router = Router();

router.use('/auth', authRouter);
router.use(backupPublicRouter); // enlaces de descarga firmados
router.use(requireAdmin);
router.use('/users', users);
router.use(systemRouter);
router.use(devices);
router.use('/integrations', integrations);
router.use(reminders);
router.use(servers);
router.use(astra);
router.use(epg);
router.use(backups);
router.use(appReleases);
router.use(updates);
router.use(ports);
router.use(content);
router.use(communications);

/* ------------------------------ Migración XtreamUI ------------------------------ */

const xtream = Router();
xtream.use(adminOnly);

xtream.post('/test', async (req, res) => {
  const saved = (await getSettings()).xtream_db;
  const body = req.body || {};
  const conn = {
    host: body.host ?? saved.host,
    port: int(body.port, saved.port || 3306),
    user: body.user ?? saved.user,
    password: body.password || saved.password,
    database: body.database || saved.database,
  };
  const result = await testXtream(conn);
  if (body.save !== false) {
    await saveSettings({ xtream_db: { ...conn, broadcast_port: result.broadcast_port ?? saved.broadcast_port ?? null } });
  }
  await logAction(req.admin, 'xtream.test', 'xtream', null, { host: conn.host, counts: result.counts });
  res.json(result);
});

xtream.post('/migrate', async (req, res) => {
  const conn = (await getSettings()).xtream_db;
  if (!conn.host) throw new HttpError(400, 'Primero prueba y guarda la conexión con XtreamUI');
  const job = await startMigration(req.admin, conn, req.body?.options || {});
  res.status(202).json({ job_id: job.id });
});

xtream.get('/jobs', async (_req, res) => res.json(await listJobs()));

xtream.get('/jobs/:id', async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) throw new HttpError(404, 'Trabajo no encontrado');
  res.json(job);
});

router.use('/xtream', xtream);

router.use((_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));

export default router;
