// Copias de seguridad: crear, descargar, subir, restaurar, programar y enviar a Google Drive.
import fs from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { db } from '../../db/index.js';
import { adminOnly, signScopedToken, verifyScopedToken } from '../../lib/auth.js';
import { logAction } from '../../lib/log.js';
import { getSettings, publicBackupSettings, saveSettings } from '../../lib/settings.js';
import {
  HttpError, bool, int, now, oneOf,
} from '../../lib/util.js';
import {
  MAX_UPLOAD_BYTES, applyDriveRetention, applyLocalRetention, backupFileFor, backupOverview, checkPassword, createBackup,
  deleteBackup, driveFiles, importFromDrive, nextScheduledRun, registerFile, restoreBackup, serializeBackup,
  storageInfo, uploadTempPath, uploadToDrive,
} from '../../services/backup.js';
import * as drive from '../../services/googleDrive.js';

const DOWNLOAD_AUDIENCE = 'backup-download';

/** Descarga con enlace firmado (sin cabecera Authorization): se monta antes de exigir sesión. */
export const backupPublicRouter = Router();

backupPublicRouter.get('/backups/file/:token', async (req, res) => {
  const payload = verifyScopedToken(req.params.token, DOWNLOAD_AUDIENCE);
  const file = await backupFileFor(int(payload.bid));
  res.download(file.path, file.filename, { headers: { 'Content-Type': 'application/octet-stream' } });
});

const router = Router();
router.use('/backups', adminOnly);

async function overview() {
  const settings = await getSettings();
  const rows = await db('backups').orderBy('created_at', 'desc').orderBy('id', 'desc');
  return {
    items: rows.map(serializeBackup),
    ...(await backupOverview()),
    settings: publicBackupSettings(settings.backup),
    timezone: settings.timezone,
    drive: {
      connected: Boolean(settings.backup.google_drive.refresh_token),
      account_email: settings.backup.google_drive.account_email || null,
      folder_name: settings.backup.google_drive.folder_name,
      connection: drive.connectionState(),
    },
    storage: await storageInfo(),
  };
}

const findRow = async (id) => {
  const row = await db('backups').where({ id: int(id) }).first();
  if (!row) throw new HttpError(404, 'Backup no encontrado');
  return row;
};

router.get('/backups', async (_req, res) => res.json(await overview()));

router.post('/backups', async (req, res) => {
  const body = req.body || {};
  const job = await createBackup({
    trigger: 'manual',
    admin: req.admin,
    note: body.note,
    upload: body.upload_drive === undefined ? null : bool(body.upload_drive),
  });
  if (bool(req.query.wait)) return res.status(201).json(await job.promise);
  res.status(202).json(serializeBackup(await db('backups').where({ id: job.id }).first()));
});

/* ------------------------------- Ajustes ------------------------------- */

router.put('/backups/settings', async (req, res) => {
  const body = req.body || {};
  const current = (await getSettings()).backup;
  const patch = {};
  const clamp = (v, min, max, def) => Math.max(min, Math.min(max, int(v, def)));

  if (body.schedule_enabled !== undefined) {
    patch.schedule_enabled = bool(body.schedule_enabled);
    // Al activar, la primera copia será en el próximo horario (no una copia inmediata).
    if (patch.schedule_enabled && !bool(current.schedule_enabled)) patch.last_scheduled_at = now();
  }
  if (body.frequency !== undefined) patch.frequency = oneOf(body.frequency, ['daily', 'weekly', 'hours'], 'frequency');
  if (body.time !== undefined) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(body.time).trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new HttpError(400, 'La hora debe tener el formato HH:MM');
    patch.time = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  if (body.weekdays !== undefined) {
    const days = [...new Set((Array.isArray(body.weekdays) ? body.weekdays : []).map(Number).filter((d) => d >= 1 && d <= 7))].sort();
    if (!days.length) throw new HttpError(400, 'Elige al menos un día de la semana');
    patch.weekdays = days;
  }
  if (body.every_hours !== undefined) patch.every_hours = clamp(body.every_hours, 1, 168, 12);
  if (body.keep_local !== undefined) patch.keep_local = clamp(body.keep_local, 1, 365, 10);
  if (body.include_logs !== undefined) patch.include_logs = bool(body.include_logs);
  if (body.include_epg !== undefined) patch.include_epg = bool(body.include_epg);
  if (body.password !== undefined && body.password !== null && body.password !== '') {
    if (String(body.password).length < 8) throw new HttpError(400, 'La contraseña de cifrado debe tener al menos 8 caracteres');
    patch.password = String(body.password);
  }
  if (bool(body.clear_password)) {
    patch.password = '';
    patch.encrypt = false;
  }
  if (body.encrypt !== undefined && !bool(body.clear_password)) patch.encrypt = bool(body.encrypt);
  const password = patch.password ?? current.password;
  if ((patch.encrypt ?? current.encrypt) && !password) throw new HttpError(400, 'Escribe una contraseña para cifrar las copias');

  const g = body.google_drive;
  if (g && typeof g === 'object') {
    patch.google_drive = {};
    if (g.auto_upload !== undefined) patch.google_drive.auto_upload = bool(g.auto_upload);
    if (g.keep !== undefined) patch.google_drive.keep = clamp(g.keep, 0, 1000, 30);
    if (g.folder_name !== undefined) {
      const name = String(g.folder_name).trim().slice(0, 100);
      if (!name) throw new HttpError(400, 'Escribe el nombre de la carpeta de Drive');
      if (name !== current.google_drive.folder_name) Object.assign(patch.google_drive, { folder_name: name, folder_id: '' });
    }
    if (g.client_id !== undefined && String(g.client_id).trim()) patch.google_drive.client_id = String(g.client_id).trim();
    if (g.client_secret) patch.google_drive.client_secret = String(g.client_secret).trim();
  }

  await saveSettings({ backup: patch });
  const { password: _p, google_drive: gd, ...logged } = patch;
  await logAction(req.admin, 'backup.settings', 'backup', null, {
    ...logged, ...(patch.password !== undefined ? { password_changed: true } : {}),
    ...(gd ? { google_drive: { ...gd, client_secret: gd.client_secret ? '••••' : undefined } } : {}),
  });
  if (patch.keep_local !== undefined) await applyLocalRetention().catch(() => {});
  res.json(await overview());
});

/** Vista previa de las próximas copias con una configuración (sin guardarla). */
router.post('/backups/settings/preview', async (req, res) => {
  const settings = await getSettings();
  const b = { ...settings.backup, ...(req.body || {}), schedule_enabled: true };
  if (!req.body?.last_scheduled_at) b.last_scheduled_at = bool(settings.backup.schedule_enabled) ? settings.backup.last_scheduled_at : now();
  const runs = [];
  let from = now();
  let sim = b;
  for (let i = 0; i < 5; i++) {
    const next = nextScheduledRun(sim, settings.timezone, from);
    if (next === null) break;
    runs.push(next);
    sim = { ...sim, last_scheduled_at: next };
    from = next;
  }
  res.json({ timezone: settings.timezone, runs });
});

/* ------------------------------- Subir un archivo ------------------------------- */

router.post('/backups/upload', async (req, res) => {
  const name = String(req.query.name || req.headers['x-filename'] || 'backup.iptvbak');
  const tmp = uploadTempPath();
  let bytes = 0;
  try {
    await pipeline(req, new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > MAX_UPLOAD_BYTES) cb(new HttpError(413, 'El archivo supera el tamaño máximo (4 GB)'));
        else cb(null, chunk);
      },
    }), fs.createWriteStream(tmp));
    if (!bytes) throw new HttpError(400, 'No llegó ningún archivo');
    res.status(201).json(await registerFile(tmp, decodeURIComponent(name), { trigger: 'upload', admin: req.admin }));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

/* ------------------------------- Google Drive ------------------------------- */

router.post('/backups/drive/connect', async (req, res) => {
  const body = req.body || {};
  res.json(await drive.startConnect({ clientId: body.client_id, clientSecret: body.client_secret }));
});

router.get('/backups/drive/connect', async (_req, res) => {
  const settings = await getSettings();
  res.json({
    ...drive.connectionState(),
    connected: Boolean(settings.backup.google_drive.refresh_token),
    account_email: settings.backup.google_drive.account_email || null,
  });
});

router.post('/backups/drive/cancel', async (_req, res) => {
  drive.cancelConnect();
  res.json({ ok: true });
});

router.post('/backups/drive/disconnect', async (req, res) => {
  await drive.disconnect();
  await logAction(req.admin, 'backup.drive_disconnect', 'backup', null, null);
  res.json(await overview());
});

router.post('/backups/drive/test', async (req, res) => {
  const result = await drive.testDrive();
  await logAction(req.admin, 'backup.drive_test', 'backup', null, { account: result.account_email, folder: result.folder_name });
  res.json(result);
});

router.get('/backups/drive/files', async (_req, res) => res.json({ items: await driveFiles() }));

router.post('/backups/drive/files/:fileId/import', async (req, res) => {
  res.status(201).json(await importFromDrive(String(req.params.fileId), req.admin));
});

router.post('/backups/drive/retention', async (_req, res) => {
  await applyDriveRetention();
  res.json({ ok: true });
});

/* ------------------------------- Una copia ------------------------------- */

router.get('/backups/:id', async (req, res) => res.json(serializeBackup(await findRow(req.params.id))));

router.patch('/backups/:id', async (req, res) => {
  const row = await findRow(req.params.id);
  const body = req.body || {};
  const patch = {};
  if (body.note !== undefined) patch.note = String(body.note || '').slice(0, 255) || null;
  if (body.pinned !== undefined) patch.pinned = bool(body.pinned);
  if (Object.keys(patch).length) await db('backups').where({ id: row.id }).update(patch);
  if (patch.pinned === false) await applyLocalRetention().catch(() => {});
  const after = await db('backups').where({ id: row.id }).first();
  res.json(after ? serializeBackup(after) : { deleted: true });
});

router.delete('/backups/:id', async (req, res) => {
  const from = oneOf(String(req.query.from || 'server'), ['server', 'drive', 'all'], 'from');
  res.json(await deleteBackup(int(req.params.id), { from, admin: req.admin }));
});

router.get('/backups/:id/download', async (req, res) => {
  const file = await backupFileFor(int(req.params.id));
  await logAction(req.admin, 'backup.download', 'backup', req.params.id, { filename: file.filename });
  res.download(file.path, file.filename, { headers: { 'Content-Type': 'application/octet-stream' } });
});

/** Enlace de descarga válido 10 minutos, para descargar con el navegador sin cargar el archivo en memoria. */
router.post('/backups/:id/download-link', async (req, res) => {
  const file = await backupFileFor(int(req.params.id));
  const token = signScopedToken({ bid: int(req.params.id) }, DOWNLOAD_AUDIENCE, '10m');
  await logAction(req.admin, 'backup.download', 'backup', req.params.id, { filename: file.filename });
  res.json({ url: `/api/admin/backups/file/${token}`, filename: file.filename, size: file.size, expires_at: now() + 600 });
});

router.post('/backups/:id/drive', async (req, res) => {
  const id = int(req.params.id);
  await findRow(id);
  if (bool(req.query.wait)) return res.json(await uploadToDrive(id));
  uploadToDrive(id).catch(() => {});
  res.status(202).json(serializeBackup(await findRow(id)));
});

router.post('/backups/:id/check-password', async (req, res) => {
  res.json(await checkPassword(int(req.params.id), String(req.body?.password || '')));
});

router.post('/backups/:id/restore', async (req, res) => {
  const body = req.body || {};
  if (String(body.confirm || '').trim().toUpperCase() !== 'RESTAURAR') {
    throw new HttpError(400, 'Escribe RESTAURAR para confirmar: se reemplazarán todos los datos actuales');
  }
  res.json(await restoreBackup(int(req.params.id), {
    password: String(body.password || ''),
    safetyBackup: body.safety_backup === undefined ? true : bool(body.safety_backup),
    admin: req.admin,
  }));
});

export default router;
