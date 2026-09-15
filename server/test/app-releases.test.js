import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { fakeApk } from './apkFixture.js';
import { startTestServer } from './helpers.js';

let ctx;
before(async () => { ctx = await startTestServer(); });
after(async () => ctx.stop());

async function token() {
  return (await ctx.api('POST', '/api/admin/auth/login', { username: 'admin', password: 'admin12345' })).data.token;
}

async function upload(buffer, name) {
  const res = await fetch(`${ctx.base}/api/admin/app-releases/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${await token()}` },
    body: buffer,
  });
  return { status: res.status, data: await res.json() };
}

const check = (params) => ctx.api('GET', `/api/client/app-update?${new URLSearchParams({ package: 'com.iptvplayer.app', ...params })}`, undefined, { auth: false });

describe('actualizaciones de la app desde el portal', () => {
  let v101;

  test('lee paquete, versión y arquitectura del APK y agrupa por versión', async () => {
    const { readApkInfo } = await import('../src/lib/apk.js');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = path.join(os.tmpdir(), `apk-${Date.now()}.apk`);
    fs.writeFileSync(tmp, fakeApk({ versionCode: 2003, versionName: '1.0.1', abis: ['arm64-v8a'] }));
    assert.deepEqual(
      (({ package: p, versionCode, versionName, minSdk, targetSdk, abi }) => ({ p, versionCode, versionName, minSdk, targetSdk, abi }))(readApkInfo(tmp)),
      { p: 'com.iptvplayer.app', versionCode: 2003, versionName: '1.0.1', minSdk: 24, targetSdk: 36, abi: 'arm64-v8a' },
    );
    fs.rmSync(tmp);

    const junk = await upload(Buffer.from('no soy un apk'), 'x.apk');
    assert.equal(junk.status, 400);

    const a = await upload(fakeApk({ versionCode: 2003, versionName: '1.0.1', abis: ['arm64-v8a'] }), 'app-arm64-v8a-release.apk');
    assert.equal(a.status, 201, JSON.stringify(a.data));
    assert.equal(a.data.release.published, false, 'queda en borrador');
    const b = await upload(fakeApk({ versionCode: 1003, versionName: '1.0.1', abis: ['armeabi-v7a'] }), 'app-armeabi-v7a-release.apk');
    const u = await upload(fakeApk({ versionCode: 3, versionName: '1.0.1', abis: ['arm64-v8a', 'armeabi-v7a', 'x86_64'] }), 'app-release.apk');
    assert.equal(b.data.release.id, a.data.release.id);
    assert.equal(u.data.release.id, a.data.release.id);
    v101 = u.data.release;
    assert.deepEqual(v101.files.map((f) => [f.abi, f.version_code]), [['arm64-v8a', 2003], ['armeabi-v7a', 1003], ['universal', 3]]);
    assert.equal(v101.version_code, 2003);

    const lower = await upload(fakeApk({ versionCode: 2002, versionName: '1.0.1', abis: ['arm64-v8a'] }), 'viejo.apk');
    assert.equal(lower.status, 409, 'no se reemplaza por un número menor');
  });

  test('no se ofrece hasta publicar; luego elige el APK de la arquitectura del equipo', async () => {
    assert.equal((await check({ version_code: 2001, version_name: '1.0.0', abis: 'arm64-v8a,armeabi-v7a' })).data.update, false);
    const pub = await ctx.api('PATCH', `/api/admin/app-releases/${v101.id}`, { published: true, notes: 'Mejoras en la guía' });
    assert.equal(pub.data.published, true);
    assert.ok(pub.data.published_at);

    const arm64 = (await check({ version_code: 2001, version_name: '1.0.0', abis: 'arm64-v8a,armeabi-v7a', device_type: 'tvbox' })).data;
    assert.equal(arm64.update, true);
    assert.equal(arm64.file.abi, 'arm64-v8a');
    assert.equal(arm64.release.notes, 'Mejoras en la guía');
    assert.equal(arm64.mandatory, false);

    const tvbox32 = (await check({ version_code: 1001, version_name: '1.0.0', abis: 'armeabi-v7a' })).data;
    assert.equal(tvbox32.file.abi, 'armeabi-v7a');

    // Instalado desde el APK universal (código 1): cualquier archivo mayor sirve, se prefiere su arquitectura.
    assert.equal((await check({ version_code: 1, version_name: '1.0.0', abis: 'x86_64' })).data.file.abi, 'universal');
    // Ya tiene 1.0.1: nada que actualizar.
    assert.equal((await check({ version_code: 2003, version_name: '1.0.1', abis: 'arm64-v8a' })).data.update, false);
    // Un universal con código 3 no se puede instalar sobre un 2001 (Android no deja bajar el número).
    const onlyUniversal = await upload(fakeApk({ versionCode: 4, versionName: '1.0.2', abis: ['arm64-v8a', 'armeabi-v7a'] }), 'u.apk');
    await ctx.api('PATCH', `/api/admin/app-releases/${onlyUniversal.data.release.id}`, { published: true });
    const stuck = (await check({ version_code: 2003, version_name: '1.0.1', abis: 'arm64-v8a' })).data;
    assert.equal(stuck.update, false);
    await ctx.api('DELETE', `/api/admin/app-releases/${onlyUniversal.data.release.id}`);

    const dl = await fetch(ctx.base + arm64.file.url);
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('content-type'), 'application/vnd.android.package-archive');
    const bytes = Buffer.from(await dl.arrayBuffer());
    const crypto = await import('node:crypto');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), arm64.file.sha256);
    const list = (await ctx.api('GET', '/api/admin/app-releases')).data;
    assert.equal(list.items[0].files.find((f) => f.abi === 'arm64-v8a').downloads, 1);
  });

  test('tipos de equipo, despliegue gradual y versión obligatoria', async () => {
    const v2 = (await upload(fakeApk({ versionCode: 2010, versionName: '1.1.0', abis: ['arm64-v8a'] }), 'v2.apk')).data.release;
    await ctx.api('PATCH', `/api/admin/app-releases/${v2.id}`, { published: true, targets: ['tvbox'] });
    const bad = await ctx.api('PATCH', `/api/admin/app-releases/${v2.id}`, { targets: ['nevera'] });
    assert.equal(bad.status, 400);

    const phone = (await check({ version_code: 2003, version_name: '1.0.1', abis: 'arm64-v8a', device_type: 'mobile' })).data;
    assert.equal(phone.update, false, 'solo para TV box');
    const box = (await check({ version_code: 2003, version_name: '1.0.1', abis: 'arm64-v8a', device_type: 'tvbox' })).data;
    assert.equal(box.release.version_name, '1.1.0');
    // Un celular con 1.0.0 recibe la 1.0.1 (la 1.1.0 no es para él).
    assert.equal((await check({ version_code: 2001, version_name: '1.0.0', abis: 'arm64-v8a', device_type: 'mobile' })).data.release.version_name, '1.0.1');

    await ctx.api('PATCH', `/api/admin/app-releases/${v2.id}`, { targets: [], rollout_percent: 30 });
    let offered = 0;
    for (let i = 0; i < 200; i++) {
      if ((await check({ version_code: 2003, version_name: '1.0.1', abis: 'arm64-v8a', device_id: `equipo-${i}` })).data.update) offered++;
    }
    assert.ok(offered > 30 && offered < 90, `aprox. 30% de 200 (${offered})`);
    const same = await Promise.all([1, 2, 3].map(() => check({ version_code: 2003, version_name: '1.0.1', abis: 'arm64-v8a', device_id: 'equipo-7' })));
    assert.equal(new Set(same.map((r) => r.data.update)).size, 1, 'un equipo siempre recibe la misma respuesta');

    // Obligatoria: sin despliegue gradual y marca obligatoria aunque haya una más nueva normal encima.
    await ctx.api('PATCH', `/api/admin/app-releases/${v2.id}`, { mandatory: true });
    const v3 = (await upload(fakeApk({ versionCode: 2020, versionName: '1.2.0', abis: ['arm64-v8a'] }), 'v3.apk')).data.release;
    await ctx.api('PATCH', `/api/admin/app-releases/${v3.id}`, { published: true });
    const forced = (await check({ version_code: 2003, version_name: '1.0.1', abis: 'arm64-v8a' })).data;
    assert.equal(forced.release.version_name, '1.2.0');
    assert.equal(forced.mandatory, true);
    const after12 = (await check({ version_code: 2010, version_name: '1.1.0', abis: 'arm64-v8a' })).data;
    assert.equal(after12.mandatory, false, 'quien ya tiene la obligatoria no está obligado');

    // Borrar el último archivo despublica la versión.
    const detail = (await ctx.api('GET', `/api/admin/app-releases/${v3.id}`)).data;
    const left = (await ctx.api('DELETE', `/api/admin/app-releases/${v3.id}/files/${detail.files[0].id}`)).data;
    assert.equal(left.published, false);
    const noFile = await ctx.api('PATCH', `/api/admin/app-releases/${v3.id}`, { published: true });
    assert.equal(noFile.status, 400);
  });

  test('la app informa su versión y el panel cuenta equipos por versión', async () => {
    const user = (await ctx.api('POST', '/api/admin/users', { username: 'zz-app-version', password: 'clave12345' })).data;
    const res = await fetch(`${ctx.base}/api/client/info?username=zz-app-version&password=clave12345`, {
      headers: {
        'User-Agent': 'IPTVPlayer/1.0.1 (Android 12; X96 Max)', 'X-Device-Id': 'box-123', 'X-Device-Type': 'tvbox', 'X-App-Name': 'IPTV Player',
        'X-App-Version': '1.0.1', 'X-App-Build': '2003', 'X-App-Distribution': 'portal',
      },
    });
    assert.equal(res.status, 200);
    const device = await ctx.db('devices').where({ user_id: user.id }).first();
    assert.deepEqual([device.app_version, Number(device.app_build), device.app_distribution], ['1.0.1', 2003, 'portal']);
    const list = (await ctx.api('GET', '/api/admin/app-releases')).data;
    assert.deepEqual(list.devices_by_version, [{ version: '1.0.1', distribution: 'portal', devices: 1 }]);
    assert.equal(list.items.find((r) => r.version_name === '1.0.1').installed_devices, 1);
    assert.ok(list.targets.includes('tvbox'));
  });

  test('páginas públicas de privacidad y eliminación de datos para Google Play', async () => {
    const bad = await ctx.api('PUT', '/api/admin/settings', { support_email: 'no-es-correo' });
    assert.equal(bad.status, 400);
    await ctx.api('PUT', '/api/admin/settings', { company_name: 'Mi Empresa <S.A.S>', support_email: 'soporte@ejemplo.co', support_phone: '300 000 0000' });
    const res = await fetch(`${ctx.base}/privacidad`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.ok(html.includes('Mi Empresa &lt;S.A.S&gt;'), 'escapa el HTML');
    assert.ok(html.includes('mailto:soporte@ejemplo.co'));
    assert.ok(html.includes('IPTV Player'));
    const del = await fetch(`${ctx.base}/eliminar-datos`);
    assert.equal(del.status, 200);
    assert.ok((await del.text()).includes('300 000 0000'));
  });
});
