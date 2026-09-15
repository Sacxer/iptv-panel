// Versión instalada y actualizaciones desde GitHub (panel y app).
import { Router } from 'express';
import { adminOnly } from '../../lib/auth.js';
import { logAction } from '../../lib/log.js';
import { getSettings, saveSettings } from '../../lib/settings.js';
import { HttpError, bool, int } from '../../lib/util.js';
import {
  checkUpdates, currentBuild, importAppRelease, lastCheck, updatesState,
} from '../../services/githubUpdates.js';
import { config } from '../../config.js';

const router = Router();
router.use('/updates', adminOnly);

async function overview() {
  return {
    current: currentBuild(),
    settings: (await getSettings()).updates,
    default_repo: config.github.defaultRepo,
    last: lastCheck(),
    ...updatesState(),
  };
}

router.get('/updates', async (_req, res) => res.json(await overview()));

router.post('/updates/check', async (_req, res) => {
  await checkUpdates();
  res.json(await overview());
});

router.post('/updates/app/import', async (req, res) => {
  const body = req.body || {};
  const result = await importAppRelease({
    tag: body.tag ? String(body.tag) : null,
    admin: req.admin,
    publish: body.publish === undefined ? null : bool(body.publish),
  });
  await checkUpdates().catch(() => {});
  res.json({ ...result, overview: await overview() });
});

router.put('/updates/settings', async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.github_repo !== undefined) {
    const repo = String(b.github_repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new HttpError(400, 'Escribe el repositorio como usuario/repositorio');
    patch.github_repo = repo;
  }
  if (b.branch !== undefined) {
    const branch = String(b.branch || '').trim();
    if (branch && !/^[\w./-]{1,100}$/.test(branch)) throw new HttpError(400, 'Rama no válida');
    patch.branch = branch;
  }
  if (b.check_enabled !== undefined) patch.check_enabled = bool(b.check_enabled);
  if (b.check_hours !== undefined) patch.check_hours = Math.max(1, Math.min(168, int(b.check_hours, 6)));
  if (b.auto_import_app !== undefined) patch.auto_import_app = bool(b.auto_import_app);
  if (b.auto_publish_app !== undefined) patch.auto_publish_app = bool(b.auto_publish_app);
  await saveSettings({ updates: patch });
  await logAction(req.admin, 'updates.settings', 'settings', null, patch);
  res.json(await overview());
});

export default router;
