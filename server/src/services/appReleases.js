// Actualizaciones de la app propia repartidas desde el portal (TV box y equipos sin Play Store).
// El administrador sube los APK; la app pregunta si hay una versión más nueva para su arquitectura.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, insertId } from '../db/index.js';
import { KNOWN_ABIS, readApkInfo } from '../lib/apk.js';
import { DEVICE_TYPES } from '../lib/deviceDetect.js';
import { logAction } from '../lib/log.js';
import {
  HttpError, bool, now, parseJson, randomString,
} from '../lib/util.js';

export const MAX_APK_BYTES = 512 * 1024 * 1024;
const TARGETABLE = DEVICE_TYPES.filter((t) => t !== 'unknown');

const releaseDir = (id) => path.join(config.appReleasesDir, String(id));
const filePath = (file) => path.join(releaseDir(file.release_id), path.basename(file.filename));

async function sha256File(p) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(p)) hash.update(chunk);
  return hash.digest('hex');
}

export function tempApkPath() {
  fs.mkdirSync(config.appReleasesDir, { recursive: true });
  return path.join(config.appReleasesDir, `.subida-${randomString(10)}.part`);
}

function serializeFile(f) {
  return {
    id: f.id,
    abi: f.abi,
    version_code: Number(f.version_code),
    filename: f.filename,
    size: Number(f.size || 0),
    sha256: f.sha256 || null,
    downloads: Number(f.downloads || 0),
    created_at: Number(f.created_at),
    missing: !fs.existsSync(filePath(f)),
  };
}

export function serializeRelease(r, files = []) {
  return {
    id: r.id,
    package_name: r.package_name,
    version_name: r.version_name,
    version_code: Number(r.version_code),
    channel: r.channel,
    notes: r.notes || '',
    mandatory: bool(r.mandatory),
    published: bool(r.published),
    targets: parseJson(r.targets, []) || [],
    rollout_percent: Number(r.rollout_percent ?? 100),
    min_sdk: r.min_sdk ? Number(r.min_sdk) : null,
    target_sdk: r.target_sdk ? Number(r.target_sdk) : null,
    created_by: r.created_by || null,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
    published_at: r.published_at ? Number(r.published_at) : null,
    files: files.map(serializeFile).sort((a, b) => abiRank(a.abi) - abiRank(b.abi)),
    downloads: files.reduce((a, f) => a + Number(f.downloads || 0), 0),
  };
}

const abiRank = (abi) => (abi === 'universal' ? 90 : abi === 'none' ? 95 : Math.max(0, KNOWN_ABIS.indexOf(abi)));

export async function listReleases() {
  const releases = await db('app_releases').orderBy('version_code', 'desc').orderBy('id', 'desc');
  const files = await db('app_release_files').whereIn('release_id', releases.map((r) => r.id));
  const since = now() - 30 * 86400;
  const versions = await db('devices').whereNotNull('app_version').where('last_seen_at', '>=', since)
    .groupBy('app_version', 'app_distribution').select('app_version', 'app_distribution').count({ c: '*' });
  return {
    items: releases.map((r) => ({
      ...serializeRelease(r, files.filter((f) => f.release_id === r.id)),
      installed_devices: versions.filter((v) => v.app_version === r.version_name).reduce((a, v) => a + Number(v.c), 0),
    })),
    devices_by_version: versions.map((v) => ({ version: v.app_version, distribution: v.app_distribution || null, devices: Number(v.c) }))
      .sort((a, b) => b.devices - a.devices),
    targets: TARGETABLE,
  };
}

export async function getRelease(id) {
  const r = await db('app_releases').where({ id }).first();
  if (!r) throw new HttpError(404, 'Versión no encontrada');
  return serializeRelease(r, await db('app_release_files').where({ release_id: id }));
}

/**
 * Registra un APK subido. Los APK de la misma versión (versionName) se agrupan en una sola publicación,
 * uno por arquitectura. Devuelve { release, file, replaced, warnings }.
 */
export async function addApk(tmpPath, originalName, admin = null) {
  const info = readApkInfo(tmpPath);
  const warnings = [];
  if (info.abi === 'none') warnings.push('El APK no trae librerías nativas: se ofrecerá a todos los equipos.');
  const abi = info.abi === 'none' ? 'universal' : info.abi;
  const others = await db('app_releases').whereNot('package_name', info.package).first();
  if (others) warnings.push(`Ya hay versiones de otro paquete (${others.package_name}). Los equipos solo reciben las de su propio paquete.`);

  const t = now();
  let release = await db('app_releases').where({ package_name: info.package, version_name: info.versionName }).first();
  const newer = await db('app_releases').where({ package_name: info.package }).where('version_code', '>', info.versionCode)
    .whereNot('version_name', info.versionName).first();
  if (newer) warnings.push(`Ya existe una versión con número mayor (${newer.version_name}); esta no se ofrecerá a quien tenga aquella.`);

  if (!release) {
    const id = await insertId(db, 'app_releases', {
      package_name: info.package,
      version_name: info.versionName,
      version_code: info.versionCode,
      channel: 'stable',
      mandatory: false,
      published: false,
      targets: JSON.stringify([]),
      rollout_percent: 100,
      min_sdk: info.minSdk || null,
      target_sdk: info.targetSdk || null,
      created_by: admin?.username || null,
      created_at: t,
      updated_at: t,
    });
    release = await db('app_releases').where({ id }).first();
  }

  const existing = await db('app_release_files').where({ release_id: release.id, abi }).first();
  if (existing && Number(existing.version_code) > info.versionCode) {
    throw new HttpError(409, `Esta versión ya tiene un APK ${abi} con número mayor (${existing.version_code} > ${info.versionCode})`);
  }

  fs.mkdirSync(releaseDir(release.id), { recursive: true });
  const filename = `${info.package}-${info.versionName.replace(/[^\w.-]+/g, '_')}-${abi}.apk`;
  const dest = path.join(releaseDir(release.id), filename);
  const sha256 = await sha256File(tmpPath);
  const size = fs.statSync(tmpPath).size;
  fs.renameSync(tmpPath, dest);

  let fileId;
  if (existing) {
    if (existing.filename !== filename) fs.rmSync(filePath(existing), { force: true });
    await db('app_release_files').where({ id: existing.id }).update({
      version_code: info.versionCode, filename, size, sha256, created_at: t,
    });
    fileId = existing.id;
  } else {
    fileId = await insertId(db, 'app_release_files', {
      release_id: release.id, abi, version_code: info.versionCode, filename, size, sha256, downloads: 0, created_at: t,
    });
  }
  const maxCode = Number((await db('app_release_files').where({ release_id: release.id }).max({ m: 'version_code' }).first()).m) || info.versionCode;
  await db('app_releases').where({ id: release.id }).update({
    version_code: maxCode,
    min_sdk: info.minSdk || release.min_sdk,
    target_sdk: info.targetSdk || release.target_sdk,
    updated_at: t,
  });
  await logAction(admin, 'app_release.upload', 'app_release', release.id, {
    package: info.package, version: info.versionName, code: info.versionCode, abi, file: originalName,
  });
  const out = await getRelease(release.id);
  return {
    release: out, file: out.files.find((f) => f.id === fileId), replaced: Boolean(existing), warnings, apk: info,
  };
}

export async function updateRelease(id, body, admin = null) {
  const r = await db('app_releases').where({ id }).first();
  if (!r) throw new HttpError(404, 'Versión no encontrada');
  const patch = {};
  if (body.notes !== undefined) patch.notes = String(body.notes || '').slice(0, 5000);
  if (body.channel !== undefined) {
    if (!['stable', 'beta'].includes(body.channel)) throw new HttpError(400, 'Canal no válido (stable o beta)');
    patch.channel = body.channel;
  }
  if (body.mandatory !== undefined) patch.mandatory = bool(body.mandatory);
  if (body.targets !== undefined) {
    const list = Array.isArray(body.targets) ? body.targets : [];
    const bad = list.filter((x) => !TARGETABLE.includes(x));
    if (bad.length) throw new HttpError(400, `Tipos de equipo no válidos: ${bad.join(', ')}`);
    patch.targets = JSON.stringify([...new Set(list)]);
  }
  if (body.rollout_percent !== undefined) patch.rollout_percent = Math.max(1, Math.min(100, Math.trunc(Number(body.rollout_percent) || 100)));
  if (body.published !== undefined) {
    const published = bool(body.published);
    if (published) {
      const files = await db('app_release_files').where({ release_id: id });
      if (!files.some((f) => fs.existsSync(filePath(f)))) throw new HttpError(400, 'Sube al menos un APK antes de publicar esta versión');
    }
    patch.published = published;
    if (published && !bool(r.published)) patch.published_at = now();
  }
  patch.updated_at = now();
  await db('app_releases').where({ id }).update(patch);
  await logAction(admin, 'app_release.update', 'app_release', id, { ...patch, notes: patch.notes !== undefined ? '(editadas)' : undefined });
  return getRelease(id);
}

export async function deleteRelease(id, admin = null) {
  const r = await db('app_releases').where({ id }).first();
  if (!r) throw new HttpError(404, 'Versión no encontrada');
  await db('app_releases').where({ id }).del();
  fs.rmSync(releaseDir(id), { recursive: true, force: true });
  await logAction(admin, 'app_release.delete', 'app_release', id, { version: r.version_name });
  return { deleted: true };
}

export async function deleteFile(releaseId, fileId, admin = null) {
  const f = await db('app_release_files').where({ id: fileId, release_id: releaseId }).first();
  if (!f) throw new HttpError(404, 'Archivo no encontrado');
  await db('app_release_files').where({ id: f.id }).del();
  fs.rmSync(filePath(f), { force: true });
  const left = await db('app_release_files').where({ release_id: releaseId });
  const patch = { updated_at: now() };
  if (left.length) patch.version_code = Math.max(...left.map((x) => Number(x.version_code)));
  else patch.published = false;
  await db('app_releases').where({ id: releaseId }).update(patch);
  await logAction(admin, 'app_release.delete_file', 'app_release', releaseId, { abi: f.abi });
  return getRelease(releaseId);
}

export async function releaseFile(fileId, { publishedOnly = true } = {}) {
  const f = await db('app_release_files').where({ id: fileId }).first();
  if (!f) throw new HttpError(404, 'Archivo no encontrado');
  const r = await db('app_releases').where({ id: f.release_id }).first();
  if (publishedOnly && !bool(r?.published)) throw new HttpError(404, 'Archivo no encontrado');
  const p = filePath(f);
  if (!fs.existsSync(p)) throw new HttpError(404, 'El archivo ya no está en el servidor');
  return { file: f, release: r, path: p };
}

export async function countDownload(fileId) {
  await db('app_release_files').where({ id: fileId }).increment('downloads', 1);
}

/** Posición estable del equipo (0-99) para despliegues graduales. */
function bucket(deviceKey, releaseId) {
  return crypto.createHash('sha256').update(`${deviceKey}:${releaseId}`).digest().readUInt32BE(0) % 100;
}

/**
 * ¿Hay una versión nueva para este equipo?
 * query: package, version_code, version_name, abis (lista por preferencia), device_type, device_id, channel, sdk.
 */
export async function checkUpdate(q) {
  const pkg = String(q.package || '').trim();
  if (!pkg) throw new HttpError(400, 'Indica el paquete de la app (package)');
  const current = Math.max(0, Math.trunc(Number(q.version_code) || 0));
  const currentName = String(q.version_name || '').trim();
  const abis = String(q.abis || '').split(',').map((s) => s.trim()).filter(Boolean);
  const deviceType = String(q.device_type || '').trim();
  const sdk = Number(q.sdk) || null;
  const channels = q.channel === 'beta' ? ['stable', 'beta'] : ['stable'];
  const deviceKey = String(q.device_id || q.ip || 'anon');

  const releases = await db('app_releases').where({ package_name: pkg, published: true }).whereIn('channel', channels)
    .orderBy('version_code', 'desc').orderBy('id', 'desc');
  if (!releases.length) return { update: false };
  const files = await db('app_release_files').whereIn('release_id', releases.map((r) => r.id));

  const forDevice = (r) => {
    const targets = parseJson(r.targets, []) || [];
    return !(targets.length && deviceType && !targets.includes(deviceType)) && !(sdk && r.min_sdk && sdk < Number(r.min_sdk));
  };
  // Versiones más nuevas que la instalada (la lista va de la más nueva a la más vieja).
  const pending = [];
  for (const r of releases) {
    if ((currentName && r.version_name === currentName) || Number(r.version_code) <= current) break;
    pending.push(r);
  }
  // Si alguna versión intermedia es obligatoria, la actualización también lo es.
  const mandatory = pending.some((r) => bool(r.mandatory) && forDevice(r));

  for (const r of pending) {
    if (!forDevice(r)) continue;
    if (!mandatory && Number(r.rollout_percent) < 100 && bucket(deviceKey, r.id) >= Number(r.rollout_percent)) continue;
    // Un APK que el equipo pueda instalar: su arquitectura (o universal) y con número mayor al instalado.
    const usable = files.filter((f) => f.release_id === r.id && Number(f.version_code) > current && fs.existsSync(filePath(f)));
    const preference = [...abis, 'universal'];
    const file = abis.length
      ? preference.map((a) => usable.find((f) => f.abi === a)).find(Boolean)
      : usable.find((f) => f.abi === 'universal') || usable[0];
    if (!file) continue;
    return {
      update: true,
      mandatory,
      release: {
        id: r.id, version_name: r.version_name, version_code: Number(file.version_code), notes: r.notes || '',
        published_at: r.published_at ? Number(r.published_at) : null, channel: r.channel,
      },
      file: {
        id: file.id, abi: file.abi, size: Number(file.size), sha256: file.sha256, url: `/api/client/app-update/download/${file.id}`,
      },
    };
  }
  return { update: false };
}
