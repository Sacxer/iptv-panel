import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fakeApk } from './apkFixture.js';
import { startTestServer } from './helpers.js';

let ctx;
let gh;
let base;
const buildFile = path.join(os.tmpdir(), `build-info-${process.pid}.json`);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const apks = {
  armeabi: fakeApk({ versionCode: 1004, versionName: '1.0.2', abis: ['armeabi-v7a'] }),
  arm64: fakeApk({ versionCode: 2004, versionName: '1.0.2', abis: ['arm64-v8a'] }),
  v103: fakeApk({ versionCode: 2005, versionName: '1.0.3', abis: ['arm64-v8a'] }),
};
const fake = { rateLimited: false, head: 'c3', badDigest: false, withV103: false };

function releases() {
  const asset = (name, key) => ({
    name, size: apks[key].length, browser_download_url: `${base}/dl/${key}`,
    digest: `sha256:${fake.badDigest && key === 'arm64' ? '0'.repeat(64) : sha(apks[key])}`,
  });
  const list = [
    {
      tag_name: 'app-v1.0.2', name: 'IPTV Player 1.0.2', body: 'Búsqueda del servidor en la red', draft: false, prerelease: false,
      published_at: '2026-09-15T10:00:00Z', html_url: 'https://github.com/x/r/releases/app-v1.0.2',
      assets: [asset('app-portal-armeabi-v7a-release.apk', 'armeabi'), asset('app-portal-arm64-v8a-release.apk', 'arm64'), { name: 'notas.txt', size: 1 }],
    },
    { tag_name: 'v1.1.0', name: 'Panel', body: '', draft: false, prerelease: false, published_at: '2026-09-15T11:00:00Z', assets: [] },
    {
      tag_name: 'app-v1.0.4-beta', body: 'beta', draft: false, prerelease: true, published_at: '2026-09-15T12:00:00Z',
      assets: [asset('app-portal-arm64-v8a-release.apk', 'arm64')],
    },
    { tag_name: 'app-v9.9.9', draft: true, published_at: '2026-09-16T00:00:00Z', assets: [asset('app-release.apk', 'arm64')] },
  ];
  if (fake.withV103) {
    list.unshift({
      tag_name: 'app-v1.0.3', body: 'Arreglos', draft: false, prerelease: false, published_at: '2026-09-15T13:00:00Z',
      assets: [asset('app-portal-arm64-v8a-release.apk', 'v103')],
    });
  }
  return list;
}

before(async () => {
  gh = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (fake.rateLimited) return json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) });
    const p = url.pathname;
    if (p === '/repos/Sacxer/iptv-panel/commits/main') {
      return json(200, { sha: fake.head, commit: { message: 'Actualizaciones desde GitHub\n\nDetalle', committer: { date: '2026-09-15T12:00:00Z' } } });
    }
    if (p === '/repos/Sacxer/iptv-panel/contents/server/package.json') {
      return json(200, { content: Buffer.from(JSON.stringify({ version: '1.1.0' })).toString('base64') });
    }
    if (p === '/repos/Sacxer/iptv-panel/compare/c1...c3') {
      return json(200, {
        ahead_by: 2, html_url: 'https://github.com/Sacxer/iptv-panel/compare/c1...c3',
        commits: [
          { sha: 'c2aaaaaaaa', commit: { message: 'Copias de seguridad', committer: { date: '2026-09-15T11:00:00Z' } } },
          { sha: 'c3bbbbbbbb', commit: { message: 'Actualizaciones desde GitHub\n\nDetalle', committer: { date: '2026-09-15T12:00:00Z' } } },
        ],
      });
    }
    if (p === '/repos/Sacxer/iptv-panel/releases') return json(200, releases());
    const dl = /^\/dl\/(\w+)$/.exec(p);
    if (dl && apks[dl[1]]) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(apks[dl[1]]);
    }
    return json(404, { message: 'Not Found' });
  }).listen(0);
  await new Promise((r) => gh.once('listening', r));
  base = `http://127.0.0.1:${gh.address().port}`;
  process.env.GITHUB_API_URL = base;
  process.env.BUILD_INFO_FILE = buildFile;
  fs.writeFileSync(buildFile, JSON.stringify({ commit: 'c1', branch: 'main', repo: 'Sacxer/iptv-panel', installed_at: 1789000000 }));
  ctx = await startTestServer();
});

after(async () => {
  await ctx.stop();
  gh.close();
  fs.rmSync(buildFile, { force: true });
});

describe('actualizaciones desde GitHub', () => {
  test('muestra la versión instalada y detecta cambios nuevos del panel', async () => {
    const o = (await ctx.api('GET', '/api/admin/updates')).data;
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
    assert.equal(o.current.version, pkg.version);
    assert.equal(o.current.commit, 'c1');
    assert.equal(o.current.source, 'installer');
    assert.equal(o.last, null);

    const r = (await ctx.api('POST', '/api/admin/updates/check')).data.last;
    assert.equal(r.error, null);
    assert.equal(r.repo, 'Sacxer/iptv-panel');
    assert.equal(r.panel.update_available, true);
    assert.equal(r.panel.commits_behind, 2);
    assert.equal(r.panel.latest_version, '1.1.0');
    assert.deepEqual(r.panel.changes.map((c) => c.message), ['Actualizaciones desde GitHub', 'Copias de seguridad']);
    assert.equal(r.panel.install_command, 'curl -fsSL https://raw.githubusercontent.com/Sacxer/iptv-panel/main/install.sh | sudo bash');

    assert.equal(r.app.latest.tag, 'app-v1.0.2', 'la última estable (ni borradores, ni beta, ni etiquetas del panel)');
    assert.deepEqual(r.app.latest.assets.map((a) => a.abi), ['armeabi-v7a', 'arm64-v8a']);
    assert.equal(r.app.beta.tag, 'app-v1.0.4-beta');
    assert.equal(r.app.imported, false);

    const dash = (await ctx.api('GET', '/api/admin/dashboard')).data.updates;
    assert.equal(dash.panel_update_available, true);
    assert.equal(dash.app_latest, '1.0.2');
    assert.equal(dash.app_update_pending, true);
  });

  test('importa los APK de la versión de GitHub como borrador', async () => {
    const imp = await ctx.api('POST', '/api/admin/updates/app/import', {});
    assert.equal(imp.status, 200, JSON.stringify(imp.data));
    assert.equal(imp.data.version_name, '1.0.2');
    assert.equal(imp.data.published, false);
    assert.deepEqual(imp.data.files.map((f) => [f.abi, f.version_code]), [['armeabi-v7a', 1004], ['arm64-v8a', 2004]]);
    assert.equal(imp.data.overview.last.app.imported, true);

    const rel = (await ctx.api('GET', `/api/admin/app-releases/${imp.data.release_id}`)).data;
    assert.equal(rel.notes, 'Búsqueda del servidor en la red');
    assert.equal(rel.files.length, 2);
    assert.equal(rel.files.find((f) => f.abi === 'arm64-v8a').sha256, sha(apks.arm64));
    const offer = await ctx.api('GET', '/api/client/app-update?package=com.iptvplayer.app&version_code=2001&abis=arm64-v8a', undefined, { auth: false });
    assert.equal(offer.data.update, false, 'no se ofrece hasta publicarla');
    await ctx.api('PATCH', `/api/admin/app-releases/${imp.data.release_id}`, { published: true });
    assert.equal((await ctx.api('GET', '/api/admin/updates')).data.last.app.published, true, 'el estado se lee en vivo, sin volver a consultar GitHub');
    await ctx.api('PATCH', `/api/admin/app-releases/${imp.data.release_id}`, { published: false });
  });

  test('con publicación automática la versión nueva llega a los equipos; huella dañada se rechaza', async () => {
    const s = await ctx.api('PUT', '/api/admin/updates/settings', { github_repo: 'otro/repo', auto_publish_app: true, check_hours: 12 });
    assert.equal(s.data.repo, 'Sacxer/iptv-panel', 'el repositorio es automático y no se cambia desde el panel');
    assert.equal(s.data.branch, 'main');
    assert.equal(s.data.settings.github_repo, undefined);
    assert.equal(s.data.settings.check_hours, 12);

    fake.withV103 = true;
    const imp = (await ctx.api('POST', '/api/admin/updates/app/import', {})).data;
    assert.equal(imp.version_name, '1.0.3');
    assert.equal(imp.published, true);
    const offer = await ctx.api('GET', '/api/client/app-update?package=com.iptvplayer.app&version_code=2004&version_name=1.0.2&abis=arm64-v8a', undefined, { auth: false });
    assert.equal(offer.data.release.version_name, '1.0.3');
    assert.equal(offer.data.release.notes, 'Arreglos');

    fake.badDigest = true;
    const beta = await ctx.api('POST', '/api/admin/updates/app/import', { tag: 'app-v1.0.4-beta' });
    assert.equal(beta.status, 502, JSON.stringify(beta.data));
    assert.match(beta.data.error, /dañado/);
    const missing = await ctx.api('POST', '/api/admin/updates/app/import', { tag: 'app-v7.0.0' });
    assert.equal(missing.status, 404);
    fake.badDigest = false;
  });

  test('al día y límite de consultas de GitHub', async () => {
    fs.writeFileSync(buildFile, JSON.stringify({ commit: 'c3', branch: 'main', repo: 'Sacxer/iptv-panel' }));
    const r = (await ctx.api('POST', '/api/admin/updates/check')).data.last;
    assert.equal(r.panel.update_available, false);
    assert.equal(r.panel.commits_behind, 0);

    fake.rateLimited = true;
    const limited = await ctx.api('POST', '/api/admin/updates/check');
    assert.equal(limited.status, 429);
    assert.match(limited.data.error, /limitó las consultas/);
    const o = (await ctx.api('GET', '/api/admin/updates')).data;
    assert.match(o.last.error, /limitó/);
    assert.equal(o.last.panel.update_available, false, 'conserva el último resultado bueno');
    fake.rateLimited = false;
  });
});
