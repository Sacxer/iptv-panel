// Versiones de la app propia para repartir desde el portal.
import fs from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { adminOnly } from '../../lib/auth.js';
import { HttpError, int } from '../../lib/util.js';
import {
  MAX_APK_BYTES, addApk, deleteFile, deleteRelease, getRelease, listReleases, releaseFile, tempApkPath, updateRelease,
} from '../../services/appReleases.js';

const router = Router();
router.use('/app-releases', adminOnly);

router.get('/app-releases', async (_req, res) => res.json(await listReleases()));

/** Sube un APK (cuerpo binario). Lee paquete, versión y arquitectura del propio archivo. */
router.post('/app-releases/upload', async (req, res) => {
  const name = decodeURIComponent(String(req.query.name || 'app.apk'));
  const tmp = tempApkPath();
  let bytes = 0;
  try {
    await pipeline(req, new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > MAX_APK_BYTES) cb(new HttpError(413, 'El APK supera el tamaño máximo (512 MB)'));
        else cb(null, chunk);
      },
    }), fs.createWriteStream(tmp));
    if (!bytes) throw new HttpError(400, 'No llegó ningún archivo');
    res.status(201).json(await addApk(tmp, name, req.admin));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

router.get('/app-releases/:id', async (req, res) => res.json(await getRelease(int(req.params.id, 0))));

router.patch('/app-releases/:id', async (req, res) => {
  res.json(await updateRelease(int(req.params.id, 0), req.body || {}, req.admin));
});

router.delete('/app-releases/:id', async (req, res) => res.json(await deleteRelease(int(req.params.id, 0), req.admin)));

router.delete('/app-releases/:id/files/:fileId', async (req, res) => {
  res.json(await deleteFile(int(req.params.id, 0), int(req.params.fileId, 0), req.admin));
});

router.get('/app-releases/:id/files/:fileId/download', async (req, res) => {
  const { file, path } = await releaseFile(int(req.params.fileId, 0), { publishedOnly: false });
  if (file.release_id !== int(req.params.id, 0)) throw new HttpError(404, 'Archivo no encontrado');
  res.download(path, file.filename, { headers: { 'Content-Type': 'application/vnd.android.package-archive' } });
});

export default router;
