// El portal cambió de IP: el nodo y la app lo vuelven a encontrar por sus direcciones conocidas o en la red local.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_FFMPEG = path.join(here, 'fixtures', 'fake-ffmpeg.js');
let ctx;
let tmp;
let portalIdValue;
const nodes = [];

before(async () => {
  ctx = await startTestServer();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'node-relocate-'));
  portalIdValue = (await ctx.api('GET', '/api/client/ping', undefined, { auth: false })).data.id;
});
after(async () => {
  for (const n of nodes) await n.stop();
  await ctx.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function deadUrl() {
  const s = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return `http://127.0.0.1:${port}`;
}

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function newNode(name, { state = null, discoveryPort, discoveryTargets } = {}) {
  const server = (await ctx.api('POST', '/api/admin/servers', { name })).data;
  const stateFile = path.join(tmp, `${name}.json`);
  if (state) fs.writeFileSync(stateFile, JSON.stringify(state));
  const { startNode } = await import('../../node/iptv-node.js');
  const node = await startNode({
    mainUrl: await deadUrl(), token: server.token, port: 0, host: '127.0.0.1', ffmpeg: FAKE_FFMPEG,
    hlsDir: path.join(tmp, `hls-${name}`), heartbeatSeconds: 1, stateFile, discoveryPort, discoveryTargets,
  });
  nodes.push(node);
  return { server, node, stateFile };
}

const isOnline = async (id) => (await ctx.api('GET', `/api/admin/servers/${id}`)).data.status === 'online';

describe('reencontrar el portal', () => {
  test('el portal se identifica y entrega sus direcciones', async () => {
    assert.match(portalIdValue, /^[0-9a-f-]{36}$/);
    await ctx.api('PUT', '/api/admin/settings', { alternate_urls: ['https://tv.midominio.com', 'http://10.8.0.1:25461'] });
    const bad = await ctx.api('PUT', '/api/admin/settings', { alternate_urls: ['ftp://x'] });
    assert.equal(bad.status, 400);
    await ctx.api('POST', '/api/admin/users', { username: 'zz-app-urls', password: 'clave12345' });
    const info = (await ctx.api('GET', '/api/client/info?username=zz-app-urls&password=clave12345', undefined, { auth: false })).data;
    assert.equal(info.server.id, portalIdValue);
    assert.equal(info.server.urls[0], ctx.base, 'primero la dirección que usó la app');
    assert.ok(info.server.urls.includes('https://tv.midominio.com'));
    assert.ok(info.server.urls.includes('http://10.8.0.1:25461'));
  });

  test('nodo: la dirección de instalación ya no sirve y usa otra conocida del mismo portal', async () => {
    const { server, node, stateFile } = await newNode('zz-nodo-reubicado', {
      state: { current: null, known: ['http://127.0.0.1:1', ctx.base], id: portalIdValue },
    });
    assert.ok(await waitFor(() => isOnline(server.id)), 'el nodo vuelve a estar en línea');
    assert.equal(node.manager.link.current, ctx.base);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.current, ctx.base, 'recuerda la dirección que funcionó');
    assert.equal(saved.id, portalIdValue);
    assert.ok(saved.known.includes(ctx.base), 'guarda las direcciones que informó el portal');
  });

  test('nodo: no se conecta a un portal con otro identificador', async () => {
    const { server, node } = await newNode('zz-nodo-otro-portal', {
      state: { current: null, known: [ctx.base], id: '00000000-0000-4000-8000-000000000000' },
    });
    assert.equal(await waitFor(() => isOnline(server.id), 2500), false);
    assert.notEqual(node.manager.link.current, ctx.base);
  });

  test('nodo: sin direcciones que respondan, encuentra el portal en la red local (UDP)', async () => {
    const responder = dgram.createSocket('udp4');
    await new Promise((r) => responder.bind(0, '127.0.0.1', r));
    responder.on('message', (msg, rinfo) => {
      if (!msg.toString().startsWith('IPTV-DISCOVER')) return;
      responder.send(JSON.stringify({ type: 'iptv-portal', id: portalIdValue, url: ctx.base, port: 0 }), rinfo.port, rinfo.address);
    });
    try {
      const { server, node } = await newNode('zz-nodo-udp', {
        state: { current: null, known: [], id: portalIdValue },
        discoveryPort: responder.address().port,
        discoveryTargets: ['127.0.0.1'],
      });
      assert.ok(await waitFor(() => isOnline(server.id), 10000), 'encontrado por difusión');
      assert.equal(node.manager.link.current, ctx.base);
    } finally {
      responder.close();
    }
  });
});
