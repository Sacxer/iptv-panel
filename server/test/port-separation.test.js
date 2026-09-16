// Panel y clientes en puertos distintos, sin mezclarse.
import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

let ctx;
let panel;
let client;
let listeners;

async function freePort() {
  const s = net.createServer().listen(0, '0.0.0.0');
  await new Promise((r) => s.once('listening', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

const get = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
  return { status: res.status, text: await res.text() };
};

before(async () => {
  ctx = await startTestServer();
  const { createApp } = await import('../src/app.js');
  listeners = await import('../src/services/listeners.js');
  panel = await freePort();
  client = await freePort();
  await listeners.startListeners(createApp(), { panelPort: panel });
  await listeners.applyClientPorts([client]);
  await ctx.api('POST', '/api/admin/users', { username: 'zz-sep', password: 'clave12345' });
});
after(async () => {
  await listeners.stopListeners();
  await ctx.stop();
});

describe('separación de puertos', () => {
  test('una instalación nueva la trae activada', async () => {
    const o = (await ctx.api('GET', '/api/admin/system/ports')).data;
    assert.equal(o.separate_ports, true);
    assert.equal(o.separation_active, true);
    assert.equal(o.panel_port, panel);
  });

  test('el panel no se sirve por el puerto de clientes', async () => {
    for (const path of ['/api/admin/dashboard', '/admin/', '/admin', '/']) {
      const r = await get(client, path);
      assert.equal(r.status, 404, path);
      assert.equal(r.text, 'Portal IPTV');
    }
    const ok = await get(client, '/api/client/ping');
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.text).client_ports, [client]);
    assert.notEqual((await get(client, '/player_api.php?username=zz-sep&password=clave12345')).status, 404);
    assert.equal((await get(client, '/health')).status, 200);
    const hb = await fetch(`http://127.0.0.1:${client}/api/node/heartbeat`, { method: 'POST' });
    assert.equal(hb.status, 401, 'los nodos pueden usar cualquier puerto (pide su token)');
  });

  test('los clientes no usan el puerto del panel', async () => {
    for (const path of ['/player_api.php?username=zz-sep&password=clave12345', '/get.php', '/xmltv.php', '/live/zz-sep/clave12345/1.ts', '/zz-sep/clave12345/1', '/api/client/ping']) {
      const r = await get(panel, path);
      assert.equal(r.status, 404, path);
      assert.match(r.text, new RegExp(`puerto ${client}`), path);
    }
    const login = await fetch(`http://127.0.0.1:${panel}/api/admin/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin12345' }),
    });
    assert.equal(login.status, 200, 'el panel funciona en su puerto');
    assert.equal((await get(panel, '/health')).status, 200);
    assert.equal((await get(panel, '/privacidad')).status, 200);
  });

  test('la app y la búsqueda en la red reciben el puerto de clientes', async () => {
    const { discoveryInfo } = await import('../src/services/discovery.js');
    const info = await discoveryInfo('127.0.0.1');
    assert.equal(info.port, client);
    assert.equal(info.url, `http://127.0.0.1:${client}`);
    assert.equal(info.panel_port, panel);
    const r = await get(client, '/api/client/info?username=zz-sep&password=clave12345');
    const urls = JSON.parse(r.text).server.urls;
    assert.equal(urls[0], `http://127.0.0.1:${client}`);
    assert.ok(urls.every((u) => !u.endsWith(`:${panel}`)), 'sin el puerto del panel');
  });

  test('se puede desactivar y al activarla la URL sale del puerto del panel', async () => {
    const off = (await ctx.api('PUT', '/api/admin/system/ports', { separate_ports: false })).data;
    assert.equal(off.separate_ports, false);
    assert.notEqual((await get(panel, '/api/client/ping')).status, 404);
    assert.equal((await get(client, '/api/admin/dashboard')).status, 401, 'sin separación el panel responde en todos');

    await ctx.api('PUT', '/api/admin/settings', { public_url: `http://10.0.0.5:${panel}` });
    const on = (await ctx.api('PUT', '/api/admin/system/ports', { separate_ports: true })).data;
    assert.equal(on.public_url_changed, `http://10.0.0.5:${client}`);
    assert.equal((await get(panel, '/api/client/ping')).status, 404);

    const same = await ctx.api('PUT', '/api/admin/system/ports', { client_ports: [panel] });
    assert.equal(same.status, 400);
    assert.match(same.data.error, /distinto/);
  });

  test('portal ya en uso: la separación empieza apagada', async () => {
    const { initPortSeparation } = await import('../src/services/portalAddresses.js');
    await ctx.db('settings').where({ key: 'separate_ports' }).del();
    const { invalidateSettings } = await import('../src/lib/settings.js');
    invalidateSettings();
    await initPortSeparation();
    invalidateSettings();
    assert.equal((await ctx.api('GET', '/api/admin/system/ports')).data.separate_ports, false, 'hay clientes: no romper enlaces');
  });
});
