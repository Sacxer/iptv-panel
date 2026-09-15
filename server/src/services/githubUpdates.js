// Actualizaciones desde GitHub:
//  - Panel: compara el commit instalado (build-info.json, lo escribe el instalador) con la rama del repositorio.
//  - App: busca "Releases" con etiqueta app-v<versión> y APK adjuntos; los importa a "Actualizaciones de la app".
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from '../config.js';
import { db } from '../db/index.js';
import { logAction } from '../lib/log.js';
import { getSettings } from '../lib/settings.js';
import { HttpError, bool, now } from '../lib/util.js';
import {
  MAX_APK_BYTES, addApk, tempApkPath, updateRelease,
} from './appReleases.js';

const state = { checking: false, importing: false, result: null };
export const updatesState = () => ({ checking: state.checking, importing: state.importing });

/** De dónde viene lo instalado: build-info.json (instalador) o el repositorio git local (desarrollo). */
export function currentBuild() {
  let info = null;
  try {
    info = JSON.parse(fs.readFileSync(config.buildInfoFile, 'utf8'));
  } catch { /* sin archivo */ }
  const out = {
    version: config.version,
    commit: info?.commit || null,
    branch: info?.branch || null,
    repo: info?.repo || null,
    installed_at: info?.installed_at ? Number(info.installed_at) : null,
    source: info?.commit ? 'installer' : 'unknown',
    node: process.version,
  };
  if (!out.commit) {
    try {
      const git = (...args) => execFileSync('git', ['-C', path.resolve(ROOT_DIR, '..'), ...args], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      out.commit = git('rev-parse', 'HEAD');
      out.branch = git('rev-parse', '--abbrev-ref', 'HEAD');
      out.repo = repoFromUrl(git('remote', 'get-url', 'origin'));
      out.source = 'git';
    } catch { /* no es un repositorio */ }
  }
  return out;
}

export function repoFromUrl(url) {
  const m = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?\/?$/i.exec(String(url || '').replace(/\/\/[^@/]*@/, '//'));
  return m ? m[1] : null;
}

/** Repositorio y rama de las actualizaciones: automáticos (los del instalador o el repositorio del proyecto). */
export function updateSource(build = currentBuild()) {
  const valid = (r) => /^[\w.-]+\/[\w.-]+$/.test(String(r || ''));
  const repo = [config.github.repoOverride, build.repo, config.github.defaultRepo].find(valid);
  const branch = config.github.branchOverride || (build.branch && build.branch !== 'HEAD' ? build.branch : 'main');
  return { repo, branch };
}

async function target() {
  const build = currentBuild();
  return { ...updateSource(build), build, settings: (await getSettings()).updates };
}

async function gh(apiPath, { raw = false } = {}) {
  let res;
  try {
    res = await fetch(`${config.github.apiUrl}${apiPath}`, {
      headers: {
        Accept: raw ? 'application/octet-stream' : 'application/vnd.github+json',
        'User-Agent': 'iptv-panel',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(config.github.token ? { Authorization: `Bearer ${config.github.token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new HttpError(502, `No se pudo contactar a GitHub: ${err.cause?.code || err.message}`);
  }
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) || 0;
    const mins = reset ? Math.max(1, Math.ceil((reset - now()) / 60)) : 60;
    throw new HttpError(429, `GitHub limitó las consultas desde esta IP. Intenta de nuevo en ${mins} min.`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `GitHub respondió HTTP ${res.status}`);
  return res.json();
}

const firstLine = (s) => String(s || '').split('\n')[0].slice(0, 200);

function abiFromName(name) {
  const n = name.toLowerCase();
  if (n.includes('arm64')) return 'arm64-v8a';
  if (n.includes('armeabi') || n.includes('armv7')) return 'armeabi-v7a';
  if (n.includes('x86_64')) return 'x86_64';
  if (/\bx86\b/.test(n)) return 'x86';
  return 'universal';
}

async function checkPanel({ repo, branch, build }) {
  const head = await gh(`/repos/${repo}/commits/${encodeURIComponent(branch)}`);
  if (!head) throw new HttpError(404, `No se encontró el repositorio ${repo} (rama ${branch}). Si es privado, configura GITHUB_TOKEN en el servidor.`);
  const pkg = await gh(`/repos/${repo}/contents/server/package.json?ref=${encodeURIComponent(branch)}`).catch(() => null);
  let latestVersion = null;
  try {
    latestVersion = JSON.parse(Buffer.from(pkg?.content || '', 'base64').toString('utf8')).version || null;
  } catch { /* sin versión */ }

  const panel = {
    current_version: build.version,
    current_commit: build.commit,
    latest_version: latestVersion,
    latest_commit: head.sha,
    latest_message: firstLine(head.commit?.message),
    latest_date: head.commit?.committer?.date ? Math.floor(Date.parse(head.commit.committer.date) / 1000) : null,
    update_available: null, // null = no se sabe de qué commit se instaló
    commits_behind: null,
    changes: [],
    install_command: `curl -fsSL https://raw.githubusercontent.com/${repo}/${branch}/install.sh | sudo bash`,
    compare_url: null,
  };
  if (build.commit) {
    if (build.commit === head.sha) {
      panel.update_available = false;
      panel.commits_behind = 0;
    } else {
      const cmp = await gh(`/repos/${repo}/compare/${build.commit}...${head.sha}`).catch(() => null);
      if (cmp) {
        panel.commits_behind = Number(cmp.ahead_by) || 0;
        panel.update_available = panel.commits_behind > 0;
        panel.changes = (cmp.commits || []).slice(-30).reverse().map((c) => ({
          sha: c.sha.slice(0, 7),
          message: firstLine(c.commit?.message),
          date: c.commit?.committer?.date ? Math.floor(Date.parse(c.commit.committer.date) / 1000) : null,
        }));
        panel.compare_url = cmp.html_url || null;
      } else {
        panel.update_available = true; // el commit instalado ya no está en GitHub: hay algo distinto
      }
    }
  }
  return panel;
}

/** Versiones de la app en GitHub: Releases con etiqueta app-v<versión> y APK adjuntos, de la más nueva a la más vieja. */
async function listAppReleases(repo) {
  const releases = await gh(`/repos/${repo}/releases?per_page=30`) || [];
  return releases
    .filter((r) => !r.draft && /^app-v?\d/i.test(r.tag_name || ''))
    .map((r) => ({
      tag: r.tag_name,
      version_name: r.tag_name.replace(/^app-v?/i, ''),
      name: r.name || r.tag_name,
      notes: String(r.body || '').slice(0, 5000),
      prerelease: Boolean(r.prerelease),
      published_at: r.published_at ? Math.floor(Date.parse(r.published_at) / 1000) : null,
      url: r.html_url || null,
      assets: (r.assets || []).filter((a) => /\.apk$/i.test(a.name)).map((a) => ({
        name: a.name,
        size: Number(a.size || 0),
        abi: abiFromName(a.name),
        sha256: /^sha256:[0-9a-f]{64}$/i.test(a.digest || '') ? a.digest.slice(7).toLowerCase() : null,
        download_url: a.browser_download_url,
      })),
    }))
    .filter((r) => r.assets.length)
    .sort((a, b) => (b.published_at || 0) - (a.published_at || 0));
}

async function checkApp({ repo }) {
  const apps = await listAppReleases(repo);
  const latest = apps.find((r) => !r.prerelease) || null;
  const imported = latest ? await db('app_releases').where({ version_name: latest.version_name }).first() : null;
  const importedFiles = imported ? await db('app_release_files').where({ release_id: imported.id }).select('abi') : [];
  return {
    latest,
    beta: apps.find((r) => r.prerelease) || null,
    imported: Boolean(imported) && latest.assets.every((a) => importedFiles.some((f) => f.abi === a.abi)),
    release_id: imported?.id || null,
    published: imported ? bool(imported.published) : false,
  };
}

/** Consulta GitHub. Guarda el resultado en memoria para el panel. */
export async function checkUpdates() {
  if (state.checking) throw new HttpError(409, 'Ya se están buscando actualizaciones');
  state.checking = true;
  const t = now();
  try {
    const tg = await target();
    const [panel, app] = await Promise.all([checkPanel(tg), checkApp(tg)]);
    state.result = {
      checked_at: t, repo: tg.repo, branch: tg.branch, panel, app, error: null,
    };
    return state.result;
  } catch (err) {
    state.result = { ...(state.result || {}), checked_at: t, error: err.message };
    throw err;
  } finally {
    state.checking = false;
  }
}

/** Último resultado, con el estado de la app (importada/publicada) leído de la base en este momento. */
export async function lastCheck() {
  const r = state.result;
  if (!r?.app?.latest) return r;
  const imported = await db('app_releases').where({ version_name: r.app.latest.version_name }).first();
  const files = imported ? await db('app_release_files').where({ release_id: imported.id }).select('abi') : [];
  return {
    ...r,
    app: {
      ...r.app,
      imported: Boolean(imported) && r.app.latest.assets.every((a) => files.some((f) => f.abi === a.abi)),
      release_id: imported?.id || null,
      published: imported ? bool(imported.published) : false,
    },
  };
}

async function download(asset, dest) {
  const res = await fetch(asset.download_url, {
    headers: { 'User-Agent': 'iptv-panel', ...(config.github.token ? { Authorization: `Bearer ${config.github.token}` } : {}) },
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new HttpError(502, `No se pudo descargar ${asset.name} de GitHub (HTTP ${res.status})`);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  let bytes = 0;
  try {
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (bytes > MAX_APK_BYTES) throw new HttpError(413, `${asset.name} supera el tamaño máximo`);
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  const sha = hash.digest('hex');
  if (asset.sha256 && sha !== asset.sha256) throw new HttpError(400, `${asset.name} llegó dañado (la huella SHA-256 no coincide)`);
  return sha;
}

/** Importa los APK de una versión de la app publicada en GitHub (por defecto la última). */
export async function importAppRelease({ tag = null, admin = null, publish = null } = {}) {
  if (state.importing) throw new HttpError(409, 'Ya se está importando una versión');
  state.importing = true;
  try {
    const tg = await target();
    const apps = await listAppReleases(tg.repo);
    const release = tag ? apps.find((x) => x.tag === tag) : apps.find((x) => !x.prerelease);
    if (!release) {
      throw new HttpError(404, tag ? `No existe la versión ${tag} (con APK) en GitHub` : 'No hay versiones de la app publicadas en GitHub (etiquetas app-v…)');
    }

    const results = [];
    let releaseId = null;
    for (const asset of release.assets) {
      const tmp = tempApkPath();
      try {
        await download(asset, tmp);
        const r = await addApk(tmp, asset.name, admin);
        releaseId = r.release.id;
        results.push({ name: asset.name, abi: r.file.abi, version_code: r.file.version_code, replaced: r.replaced, warnings: r.warnings });
      } catch (err) {
        results.push({ name: asset.name, error: err.message });
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
    if (!releaseId) throw new HttpError(502, `No se pudo importar ningún APK: ${results.map((r) => r.error).filter(Boolean).join('; ')}`);

    const existing = await db('app_releases').where({ id: releaseId }).first();
    const patch = {};
    if (!existing.notes && release.notes) patch.notes = release.notes;
    const doPublish = publish ?? Boolean((await getSettings()).updates.auto_publish_app);
    if (doPublish) patch.published = true;
    const out = Object.keys(patch).length ? await updateRelease(releaseId, patch, admin) : null;
    await logAction(admin, 'app_release.github_import', 'app_release', releaseId, {
      tag: release.tag, files: results.length, published: doPublish,
    });
    return {
      tag: release.tag,
      version_name: release.version_name,
      release_id: releaseId,
      published: out ? out.published : Boolean(existing.published),
      files: results,
    };
  } finally {
    state.importing = false;
  }
}

/** Revisión periódica y, si se activó, importación automática de la app. */
export function startUpdatesScheduler() {
  let last = 0;
  const tick = async () => {
    const s = (await getSettings()).updates;
    if (!s.check_enabled || state.checking) return;
    if (now() - last < Math.max(1, Number(s.check_hours) || 6) * 3600) return;
    last = now();
    const result = await checkUpdates();
    if (s.auto_import_app && result.app.latest && !result.app.imported) {
      await importAppRelease({ publish: Boolean(s.auto_publish_app) });
      await checkUpdates().catch(() => {});
    }
  };
  const run = () => tick().catch((err) => console.warn('Actualizaciones desde GitHub:', err.message));
  const first = setTimeout(run, 2 * 60_000);
  first.unref();
  const timer = setInterval(run, 30 * 60_000);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
