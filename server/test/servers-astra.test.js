// Servidores de streaming (nodo real con FFmpeg simulado), modos de entrega, conexiones exactas y Astra simulado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';
import { buildFfmpegArgs, startNode } from '../../node/iptv-node.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_FFMPEG = path.join(here, 'fixtures', 'fake-ffmpeg.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let api;
let db;
let stop;
let node;
let server;
let base;
const hlsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-node-test-'));

async function waitFor(fn, { timeout = 8000, every = 150, message = 'condición no cumplida' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Tiempo agotado: ${message}`);
    await sleep(every);
  }
}

/** Abre un stream HTTP y devuelve { req, res, firstChunk, closed }. */
function openStream(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let closedResolve;
      const closed = new Promise((r) => { closedResolve = r; });
      res.on('close', () => closedResolve(true));
      res.on('error', () => closedResolve(true));
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ req, res, status: res.statusCode, body, closed }));
        return;
      }
      res.once('data', (chunk) => resolve({ req, res, status: 200, firstChunk: chunk, closed }));
    });
    req.on('error', reject);
  });
}

before(async () => {
  ({ api, db, stop, base } = await startTestServer());
  const created = await api('POST', '/api/admin/servers', { name: 'Nodo 1', public_url: 'http://127.0.0.1:1' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  server = created.data;
  node = await startNode({
    mainUrl: base, token: server.token, port: 0, host: '127.0.0.1', ffmpeg: FAKE_FFMPEG, hlsDir, idleSeconds: 2, heartbeatSeconds: 1,
  });
  await api('PUT', `/api/admin/servers/${server.id}`, { public_url: `http://127.0.0.1:${node.port}` });
  await waitFor(async () => (await api('GET', `/api/admin/servers/${server.id}`)).data.status === 'online', { message: 'nodo en línea' });
});

after(async () => {
  await node?.stop();
  await stop();
  fs.rmSync(hlsDir, { recursive: true, force: true });
});

describe('servidores de streaming y modos de entrega', () => {
  let channel;

  test('servidor sin URL: la toma de la interfaz principal del nodo; se puede elegir otra IP', async () => {
    const created2 = (await api('POST', '/api/admin/servers', { name: 'Nodo sin URL' })).data;
    assert.equal(created2.public_url, '');
    const network = {
      listen_port: 8095,
      ports: [
        { name: 'lo', type: 'loopback', status: 'up', default_route: false, addresses: [{ address: '127.0.0.1', family: 'IPv4', scope: 'loopback' }] },
        { name: 'eth1', type: 'ethernet', status: 'up', default_route: false, addresses: [{ address: '10.0.0.8', family: 'IPv4', scope: 'private' }] },
        { name: 'eth0', type: 'ethernet', status: 'up', default_route: true, addresses: [{ address: '192.168.20.5', family: 'IPv4', scope: 'private' }] },
      ],
    };
    const hb = await api('POST', '/api/node/heartbeat', { version: 't', network, streams: [], sessions: [] }, { auth: false, headers: { Authorization: `Bearer ${created2.token}` } });
    assert.equal(hb.status, 200);
    let s2 = (await api('GET', `/api/admin/servers/${created2.id}`)).data;
    assert.equal(s2.public_url, 'http://192.168.20.5:8095', 'IP de la interfaz principal + puerto del nodo');
    assert.equal(s2.network.ports.length, 3);
    assert.deepEqual(s2.url_suggestions.map((u) => u.url), ['http://192.168.20.5:8095', 'http://10.0.0.8:8095']);
    assert.equal(s2.url_suggestions[0].in_use, true);
    s2 = (await api('POST', `/api/admin/servers/${created2.id}/use-ip`, { ip: '10.0.0.8' })).data;
    assert.equal(s2.public_url, 'http://10.0.0.8:8095');
    assert.equal((await api('POST', `/api/admin/servers/${created2.id}/use-ip`, { ip: '8.8.8.8' })).status, 400);
    await api('DELETE', `/api/admin/servers/${created2.id}`);
  });

  test('el nodo reporta hardware y aparece en línea con su comando de instalación', async () => {
    const s = (await api('GET', `/api/admin/servers/${server.id}`)).data;
    assert.ok(s.network && s.network.ports.length > 0, 'el nodo real informa sus interfaces');
    assert.equal(s.status, 'online');
    assert.ok(s.hardware.encoders.includes('h264_nvenc'));
    assert.match(s.install_command, /api\/node\/install\.sh\?token=/);
    const script = await api('GET', `/api/node/install.sh?token=${server.token}`, undefined, { auth: false });
    assert.equal(script.status, 200);
    assert.match(script.data, /NODE_TOKEN=/);
    assert.equal((await api('GET', '/api/node/agent.js?token=malo', undefined, { auth: false })).status, 401);
  });

  test('reenvío por servidor: una conexión exacta que dura hasta que el cliente cierra', async () => {
    channel = (await api('POST', '/api/admin/streams', {
      type: 'live', name: 'Canal Nodo', source_url: 'http://origen.test/nodo.ts', delivery_mode: 'restream', server_ids: [server.id],
    })).data;
    assert.equal(channel.delivery_mode, 'restream');
    assert.deepEqual(channel.server_ids, [server.id]);
    await api('POST', '/api/admin/users', { username: 'viewer', password: 'view1234', max_connections: 2 });

    const redirect = await api('GET', `/live/viewer/view1234/${channel.id}.ts`, undefined, { raw: true, headers: { 'User-Agent': 'VLC/3.0' } });
    assert.equal(redirect.status, 302);
    const location = redirect.headers.get('location');
    assert.match(location, new RegExp(`^http://127\\.0\\.0\\.1:${node.port}/live/${channel.id}\\.ts\\?token=`));

    const bad = await openStream(location.replace(/token=.*/, 'token=falso'));
    assert.equal(bad.status, 403);

    const stream = await openStream(location);
    assert.equal(stream.status, 200);
    assert.equal(stream.firstChunk[0], 0x47, 'paquetes MPEG-TS');

    const conns = await waitFor(async () => {
      const list = (await api('GET', `/api/admin/streams/${channel.id}/connections`)).data;
      return list.length === 1 ? list : null;
    });
    assert.equal(conns[0].tracking, 'exact');
    assert.equal(conns[0].server_name, 'Nodo 1');
    assert.equal((await api('GET', `/api/admin/streams?search=Canal%20Nodo`)).data.data[0].active_connections, 1);

    // Aunque pase el tiempo de espera, el heartbeat del nodo mantiene viva la conexión mientras el cliente sigue viendo.
    await db('connections').where({ id: conns[0].id }).update({ last_seen_at: Math.floor(Date.now() / 1000) - 3600 });
    await waitFor(async () => (await api('GET', `/api/admin/streams/${channel.id}/connections`)).data.length === 1, { message: 'heartbeat renueva la conexión' });

    const states = await waitFor(async () => {
      const list = (await api('GET', `/api/admin/servers/${server.id}/streams`)).data;
      return list.find((x) => x.stream_id === channel.id && x.state === 'running' && x.clients === 1) ? list : null;
    });
    assert.ok(states[0].bitrate_kbps >= 0);

    // Expulsar desde el portal corta al cliente en el nodo.
    assert.equal((await api('DELETE', `/api/admin/connections/${conns[0].id}`)).status, 200);
    await waitFor(() => Promise.race([stream.closed, sleep(100).then(() => false)]), { message: 'el nodo corta la sesión expulsada' });
    const after2 = await openStream(location);
    assert.equal(after2.status, 403, 'la sesión expulsada no puede reconectar con el mismo acceso');
  });

  test('HLS desde el nodo con segmentos firmados', async () => {
    const redirect = await api('GET', `/live/viewer/view1234/${channel.id}.m3u8`, undefined, { raw: true, headers: { 'User-Agent': 'HLSPlayer' } });
    assert.equal(redirect.status, 302);
    const playlist = await fetch(redirect.headers.get('location'));
    assert.equal(playlist.status, 200, await playlist.clone().text());
    const text = await playlist.text();
    const segment = text.split('\n').find((l) => l.startsWith('/hls/'));
    assert.ok(segment, text);
    const seg = await fetch(`http://127.0.0.1:${node.port}${segment}`);
    assert.equal(seg.status, 200);
    assert.equal(Buffer.from(await seg.arrayBuffer())[0], 0x47);
  });

  test('sin servidores en línea: respaldo directo o 503 según ajustes', async () => {
    const other = (await api('POST', '/api/admin/streams', {
      type: 'live', name: 'Sin nodo', source_url: 'http://origen.test/directo.ts', delivery_mode: 'restream', server_ids: [server.id],
    })).data;
    await api('PUT', `/api/admin/servers/${server.id}`, { enabled: false });
    const fallback = await api('GET', `/live/viewer/view1234/${other.id}.ts`, undefined, { raw: true, headers: { 'User-Agent': 'Otro/1' } });
    assert.equal(fallback.headers.get('location'), 'http://origen.test/directo.ts');
    await api('PUT', '/api/admin/settings', { node_fallback_direct: false });
    assert.equal((await api('GET', `/live/viewer/view1234/${other.id}.ts`, undefined, { raw: true, headers: { 'User-Agent': 'Otro/1' } })).status, 503);
    await api('PUT', '/api/admin/settings', { node_fallback_direct: true });
    await api('PUT', `/api/admin/servers/${server.id}`, { enabled: true });

    const direct = (await api('POST', '/api/admin/streams', {
      type: 'live', name: 'Directo', source_url: 'http://origen.test/siempre-directo.ts', delivery_mode: 'direct',
    })).data;
    await api('PUT', '/api/admin/settings', { stream_mode: 'proxy' });
    const d = await api('GET', `/live/viewer/view1234/${direct.id}.ts`, undefined, { raw: true, headers: { 'User-Agent': 'Otro/1' } });
    assert.equal(d.status, 302, 'direct source ignora el modo proxy general');
    await api('PUT', '/api/admin/settings', { stream_mode: 'redirect' });
  });

  test('perfiles de transcodificación y argumentos de FFmpeg', async () => {
    const profile = await api('POST', '/api/admin/transcode-profiles', {
      name: '720p NVIDIA', hw: 'nvenc', resolution: '720', video_bitrate_kbps: 2500, audio_codec: 'aac', deinterlace: true,
    });
    assert.equal(profile.status, 201, JSON.stringify(profile.data));
    assert.equal((await api('POST', '/api/admin/transcode-profiles', { name: 'x', extra_args: '-y; rm -rf /' })).status, 400);
    const tc = (await api('POST', '/api/admin/streams', {
      type: 'live', name: 'Transcodificado', source_url: 'http://origen.test/tc.ts',
      delivery_mode: 'transcode', transcode_profile_id: profile.data.id, server_ids: [server.id],
    })).data;
    const cfg = await api('GET', `/api/node/streams/${tc.id}`, undefined, { auth: false, headers: { Authorization: `Bearer ${server.token}` } });
    assert.equal(cfg.data.mode, 'transcode');
    const args = buildFfmpegArgs(cfg.data, cfg.data.sources[0]);
    assert.ok(args.includes('h264_nvenc'));
    assert.ok(args.join(' ').includes('yadif_cuda,scale_cuda=-2:720'));
    assert.ok(args.includes('2500k'));
    const copy = buildFfmpegArgs({ mode: 'restream' }, 'http://x/y.ts');
    assert.ok(copy.includes('copy') && !copy.includes('-c:v'));
    assert.equal(copy.at(-1), 'pipe:1');
    assert.equal((await api('GET', '/api/admin/transcode-profiles')).data[0].stream_count, 1);

    const bulk = await api('POST', '/api/admin/streams/bulk', { ids: [tc.id], action: 'set_delivery', delivery_mode: 'direct' });
    assert.equal(bulk.data.affected, 1);
    assert.equal((await api('GET', `/api/admin/streams/${tc.id}`)).data.delivery_mode, 'direct');
  });
});

describe('conexiones: modo proxy y app propia', () => {
  test('cambiar de canal en modo proxy no borra la conexión nueva', async () => {
    const origin = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      const t = setInterval(() => res.write(Buffer.alloc(1880, 0x47)), 50);
      req.on('close', () => clearInterval(t));
    }).listen(0);
    await new Promise((r) => origin.once('listening', r));
    const o = `http://127.0.0.1:${origin.address().port}`;
    try {
      const a = (await api('POST', '/api/admin/streams', { type: 'live', name: 'Proxy A', source_url: `${o}/a.ts` })).data;
      const b = (await api('POST', '/api/admin/streams', { type: 'live', name: 'Proxy B', source_url: `${o}/b.ts` })).data;
      await api('POST', '/api/admin/users', { username: 'zapper', password: 'zap1234', max_connections: 1 });
      await api('PUT', '/api/admin/settings', { stream_mode: 'proxy' });
      const portal = base;
      const sa = await openStream(`${portal}/live/zapper/zap1234/${a.id}.ts`, { 'User-Agent': 'Smarters' });
      assert.equal(sa.status, 200);
      const sb = await openStream(`${portal}/live/zapper/zap1234/${b.id}.ts`, { 'User-Agent': 'Smarters' });
      assert.equal(sb.status, 200, 'el mismo equipo puede cambiar de canal aunque tenga 1 conexión');
      await Promise.race([sa.closed, sleep(3000)]);
      await sleep(300);
      const list = (await api('GET', '/api/admin/connections')).data.filter((c) => c.username === 'zapper');
      assert.equal(list.length, 1);
      assert.equal(list[0].stream_id, b.id);
      assert.equal(list[0].tracking, 'exact');
      sb.req.destroy();
      await waitFor(async () => !(await api('GET', '/api/admin/connections')).data.some((c) => c.username === 'zapper'), { message: 'se libera al cerrar' });
    } finally {
      await api('PUT', '/api/admin/settings', { stream_mode: 'redirect' });
      origin.close();
    }
  });

  test('la app propia mantiene la conexión con /api/client/playing', async () => {
    const s = (await api('POST', '/api/admin/streams', { type: 'live', name: 'App live', source_url: 'http://origen.test/app.ts' })).data;
    await api('POST', '/api/admin/users', { username: 'appuser', password: 'app1234' });
    const p1 = await api('POST', '/api/client/playing', { username: 'appuser', password: 'app1234', stream_id: s.id }, { auth: false });
    assert.equal(p1.status, 200, JSON.stringify(p1.data));
    const conn = (await api('GET', `/api/admin/streams/${s.id}/connections`)).data;
    assert.equal(conn.length, 1);
    assert.equal(conn[0].mode, 'app');
    assert.equal(conn[0].tracking, 'exact');
    const p2 = await api('POST', '/api/client/playing', { username: 'appuser', password: 'app1234', stream_id: s.id, connection_id: p1.data.connection_id }, { auth: false });
    assert.equal(p2.data.connection_id, p1.data.connection_id);
    await api('POST', '/api/client/stopped', { username: 'appuser', password: 'app1234', connection_id: p1.data.connection_id }, { auth: false });
    assert.equal((await api('GET', `/api/admin/streams/${s.id}/connections`)).data.length, 0);
  });
});

describe('Astra', () => {
  let astra;
  let astraBase;
  let streamsConfig;

  before(async () => {
    streamsConfig = [
      { id: 'a001', name: 'Deportes 1', type: 'spts', enable: true, input: ['dvb://a#pnr=101'], output: ['http://0:8100/dep1'], groups: { Genero: 'Deportes' } },
      { id: 'a002', name: 'Noticias 24', type: 'spts', enable: true, input: ['udp://239.1.1.2:1234'], output: [], groups: {} },
    ];
    astra = http.createServer((req, res) => {
      if (req.headers.authorization !== `Basic ${Buffer.from('admin:astra').toString('base64')}`) {
        res.writeHead(401);
        return res.end();
      }
      if (req.method === 'POST' && req.url === '/control/') {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          if (JSON.parse(raw).cmd !== 'load') { res.writeHead(400); return res.end(); }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ make_stream: streamsConfig, categories: [{ name: 'Genero', groups: [{ name: 'Deportes' }] }] }));
        });
        return undefined;
      }
      const m = /^\/api\/stream-status\/(\w+)/.exec(req.url);
      if (m) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ onair: m[1] === 'a001', bitrate: 4200, cc_error: 3, sessions: 1 }));
      }
      res.writeHead(404);
      return res.end();
    }).listen(0);
    await new Promise((r) => astra.once('listening', r));
    astraBase = `http://127.0.0.1:${astra.address().port}`;
  });
  after(() => astra.close());

  test('probar, importar con modo de entrega, sincronizar bajas y monitorear señal', async () => {
    assert.equal((await api('POST', '/api/admin/astra/test', { api_url: astraBase, username: 'admin', password: 'mala' })).status, 400);
    const probe = (await api('POST', '/api/admin/astra/test', { api_url: astraBase, username: 'admin', password: 'astra' })).data;
    assert.equal(probe.total, 2);
    assert.equal(probe.sample[0].play_url, `${astraBase}/play/a001`);
    assert.deepEqual(probe.groups, ['Deportes']);

    const created = await api('POST', '/api/admin/astra/sources', { name: 'Astra Sat', api_url: astraBase, username: 'admin', password: 'astra' });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.sync.new, 2);
    const src = created.data.source;
    assert.equal(src.password_set, true);

    const list = (await api('GET', `/api/admin/astra/sources/${src.id}/channels?imported=false`)).data;
    assert.equal(list.total, 2);
    const imp = await api('POST', `/api/admin/astra/sources/${src.id}/import`, {
      channel_ids: list.data.map((c) => c.id),
      options: { category_mode: 'group', delivery_mode: 'restream', server_ids: [server.id], always_on: false },
    });
    assert.equal(imp.status, 200, JSON.stringify(imp.data));
    assert.deepEqual(imp.data, { created: 2, categories_created: 2 });
    const imported = (await api('GET', `/api/admin/astra/sources/${src.id}/channels?imported=true`)).data.data;
    const dep = imported.find((c) => c.astra_id === 'a001');
    const s1 = (await api('GET', `/api/admin/streams/${dep.stream_id}`)).data;
    assert.equal(s1.delivery_mode, 'restream');
    assert.deepEqual(s1.server_ids, [server.id]);
    assert.equal(s1.category_name, 'Deportes');
    assert.equal(s1.source_url, `${astraBase}/play/a001`);

    const status = (await api('POST', `/api/admin/astra/sources/${src.id}/status`)).data;
    assert.deepEqual(status, { checked: 2, online: 1, offline: 1 });
    assert.equal((await api('GET', `/api/admin/streams/${dep.stream_id}`)).data.health_status, 'online');

    // Canal eliminado en Astra → se marca y se deshabilita en el portal.
    streamsConfig.pop();
    const sync = (await api('POST', `/api/admin/astra/sources/${src.id}/sync`)).data;
    assert.equal(sync.removed, 1);
    assert.equal(sync.streams_disabled, 1);
    const noticias = imported.find((c) => c.astra_id === 'a002');
    assert.equal((await api('GET', `/api/admin/streams/${noticias.stream_id}`)).data.enabled, false);

    // Modo "salida de Astra": usa la URL de output reemplazando 0 por el host.
    await api('PUT', `/api/admin/astra/sources/${src.id}`, { url_mode: 'output' });
    await api('POST', `/api/admin/astra/sources/${src.id}/sync`);
    assert.equal((await api('GET', `/api/admin/streams/${dep.stream_id}`)).data.source_url, 'http://127.0.0.1:8100/dep1');

    // Eliminar todos los canales importados: vuelven a quedar "sin importar" y se borran categorías vacías.
    assert.equal((await api('POST', `/api/admin/astra/sources/${src.id}/delete-imported`, {})).status, 400);
    const del = (await api('POST', `/api/admin/astra/sources/${src.id}/delete-imported`, { all: true, remove_empty_categories: true })).data;
    assert.equal(del.deleted, 2);
    assert.equal(del.categories_deleted, 2);
    assert.equal((await api('GET', `/api/admin/streams/${dep.stream_id}`)).status, 404);
    const after3 = (await api('GET', `/api/admin/astra/sources/${src.id}`)).data.counts;
    assert.equal(after3.imported, 0);
    assert.equal(after3.not_imported, 1);

    // Reimportar y eliminar la fuente junto con sus canales.
    const again = (await api('GET', `/api/admin/astra/sources/${src.id}/channels?imported=false`)).data.data;
    await api('POST', `/api/admin/astra/sources/${src.id}/import`, { channel_ids: again.map((c) => c.id), options: { category_mode: 'group' } });
    const gone = (await api('DELETE', `/api/admin/astra/sources/${src.id}?delete_streams=true&remove_empty_categories=true`)).data;
    assert.equal(gone.deleted, 1);
    assert.equal((await api('GET', '/api/admin/streams?source=astra')).data.total, 0);
  });
});

describe('cierre inmediato de conexiones del nodo', () => {
  test('al cerrar el cliente, la conexión desaparece en segundos', async () => {
    const s = (await api('POST', '/api/admin/streams', {
      type: 'live', name: 'Cierre rápido', source_url: 'http://origen.test/rapido.ts', delivery_mode: 'restream', server_ids: [server.id],
    })).data;
    await api('POST', '/api/admin/users', { username: 'rapido', password: 'rap1234' });
    await waitFor(async () => (await api('GET', `/api/admin/servers/${server.id}`)).data.status === 'online', { message: 'nodo en línea' });
    const redirect = await api('GET', `/live/rapido/rap1234/${s.id}.ts`, undefined, { raw: true, headers: { 'User-Agent': 'Rapido/1' } });
    const stream = await openStream(redirect.headers.get('location'));
    assert.equal(stream.status, 200);
    const [conn] = await waitFor(async () => {
      const list = (await api('GET', `/api/admin/streams/${s.id}/connections`)).data;
      return list.length ? list : null;
    });
    // Simular que la conexión empezó hace rato (fuera del margen para clientes que aún llegan al nodo).
    await db('connections').where({ id: conn.id }).update({ started_at: Math.floor(Date.now() / 1000) - 60 });
    await sleep(1500);
    assert.equal((await api('GET', `/api/admin/streams/${s.id}/connections`)).data.length, 1, 'sigue mientras ve');
    const closedAt = Date.now();
    stream.req.destroy();
    await waitFor(async () => (await api('GET', `/api/admin/streams/${s.id}/connections`)).data.length === 0, { timeout: 5000, message: 'se quita al cerrar' });
    assert.ok(Date.now() - closedAt < 5000);
  });
});
