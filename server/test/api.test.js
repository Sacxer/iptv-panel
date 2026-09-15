// Prueba de integración de extremo a extremo con SQLite temporal.
// Ejecutar: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createFakeXtream } from './fakeXtream.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-test-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.ADMIN_PASSWORD = 'admin12345';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_DIST = path.join(tmp, 'no-admin');
process.env.AUTO_PUBLIC_URL = 'false';

const { createApp } = await import('../src/app.js');
const { bootstrap } = await import('../src/bootstrap.js');
const { db } = await import('../src/db/index.js');
const { startMigration, getJob } = await import('../src/services/xtreamMigrator.js');

let server;
let base;
let token;

async function api(method, url, body, { auth = true, raw = false, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    redirect: 'manual',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

before(async () => {
  await bootstrap({ quiet: true });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  server.close();
  await db.destroy();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('portal IPTV', () => {
  let user;
  let pkg;
  let channel;

  test('login de administrador', async () => {
    const bad = await api('POST', '/api/admin/auth/login', { username: 'admin', password: 'x' });
    assert.equal(bad.status, 401);
    const ok = await api('POST', '/api/admin/auth/login', { username: 'admin', password: 'admin12345' });
    assert.equal(ok.status, 200);
    token = ok.data.token;
    assert.equal((await api('GET', '/api/admin/auth/me')).data.role, 'admin');
    assert.equal((await api('GET', '/api/admin/dashboard', undefined, { auth: false })).status, 401);
  });

  test('importar lista M3U y crear paquete', async () => {
    const content = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="uno.co" tvg-logo="http://l/1.png" group-title="Nacionales",Canal Uno, HD',
      'http://origen.test/uno.ts',
      '#EXTINF:-1 group-title="Nacionales",Canal Dos',
      'http://origen.test/dos.m3u8',
      '#EXTINF:-1 group-title="Cine",Película Y',
      'http://origen.test/peli.mp4',
      '#EXTINF:-1 group-title="Nacionales",Canal Uno duplicado',
      'http://origen.test/uno.ts',
    ].join('\r\n');
    const r = await api('POST', '/api/admin/streams/import-m3u', { content, type: 'auto' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual([r.data.created, r.data.skipped, r.data.categories_created], [3, 1, 2]);

    const live = await api('GET', '/api/admin/streams?type=live&search=uno');
    assert.equal(live.data.total, 1);
    channel = live.data.data[0];
    assert.equal(channel.name, 'Canal Uno, HD');
    assert.equal(channel.epg_channel_id, 'uno.co');

    const p = await api('POST', '/api/admin/packages', { name: 'Básico', stream_ids: [channel.id] });
    assert.equal(p.status, 201);
    pkg = p.data;
    assert.equal(pkg.stream_count, 1);
  });

  test('crear, suspender, reactivar y extender usuario', async () => {
    const created = await api('POST', '/api/admin/users', {
      username: 'juan', password: 'abc123', duration: { amount: 1, unit: 'months' }, max_connections: 1, package_ids: [pkg.id],
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    user = created.data;
    assert.equal(user.status, 'active');
    assert.deepEqual(user.package_ids, [pkg.id]);

    assert.equal((await api('POST', '/api/admin/users', { username: 'juan', password: 'x1234' })).status, 409);
    const rnd = await api('POST', '/api/admin/users', { random: true });
    assert.equal(rnd.status, 201);
    assert.ok(rnd.data.username.length >= 8);

    const s = await api('POST', `/api/admin/users/${user.id}/suspend`, { reason: 'Falta de pago' });
    assert.equal(s.data.status, 'suspended');
    const auth = await api('GET', '/player_api.php?username=juan&password=abc123');
    assert.equal(auth.data.user_info.status, 'Banned');
    assert.equal(auth.data.user_info.message, 'Falta de pago');
    const info = await api('GET', '/api/client/info?username=juan&password=abc123');
    assert.equal(info.data.user.status, 'suspended');

    assert.equal((await api('POST', `/api/admin/users/${user.id}/reactivate`)).data.status, 'active');
    const ext = await api('POST', `/api/admin/users/${user.id}/extend`, { amount: 10, unit: 'days' });
    assert.ok(ext.data.exp_date > user.exp_date);

    const list = await api('GET', '/api/admin/users?status=active&search=ju');
    assert.equal(list.data.total, 1);
  });

  test('API Xtream: autenticación, categorías, canales y M3U', async () => {
    assert.deepEqual((await api('GET', '/player_api.php?username=juan&password=mal')).data, { user_info: { auth: 0 } });
    const auth = await api('POST', '/player_api.php?username=juan&password=abc123');
    assert.equal(auth.data.user_info.auth, 1);
    assert.equal(auth.data.user_info.status, 'Active');
    assert.ok(auth.data.server_info.port);

    const cats = await api('GET', '/player_api.php?username=juan&password=abc123&action=get_live_categories');
    assert.equal(cats.data.length, 1);
    assert.equal(cats.data[0].category_name, 'Nacionales');
    const streams = await api('GET', `/player_api.php?username=juan&password=abc123&action=get_live_streams&category_id=${cats.data[0].category_id}`);
    assert.equal(streams.data.length, 1, 'solo el canal del paquete');
    assert.equal(streams.data[0].stream_id, channel.id);
    const vod = await api('GET', '/player_api.php?username=juan&password=abc123&action=get_vod_streams');
    assert.equal(vod.data.length, 0);

    const m3u = await api('GET', '/get.php?username=juan&password=abc123&type=m3u_plus&output=ts');
    assert.equal(m3u.status, 200);
    assert.match(m3u.data, /^#EXTM3U/);
    assert.match(m3u.data, new RegExp(`/live/juan/abc123/${channel.id}\\.ts`));
  });

  test('reproducción: redirección, paquetes, límite de conexiones y cortes', async () => {
    const res = await api('GET', `/live/juan/abc123/${channel.id}.ts`, undefined, { raw: true });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'http://origen.test/uno.ts');

    const other = (await api('GET', '/api/admin/streams?type=live&search=dos')).data.data[0];
    assert.equal((await api('GET', `/live/juan/abc123/${other.id}.ts`, undefined, { raw: true })).status, 403);
    assert.equal((await api('GET', `/live/juan/mal/${channel.id}.ts`, undefined, { raw: true })).status, 401);

    const conns = await api('GET', '/api/admin/connections');
    assert.equal(conns.data.length, 1);
    // Otra IP/dispositivo supera el límite de 1 conexión.
    await db('connections').update({ ip: '10.0.0.9' });
    assert.equal((await api('GET', `/live/juan/abc123/${channel.id}.ts`, undefined, { raw: true })).status, 429);
    assert.equal((await api('DELETE', `/api/admin/connections/${conns.data[0].id}`)).status, 200);
    assert.equal((await api('GET', `/live/juan/abc123/${channel.id}.ts`, undefined, { raw: true })).status, 302);

    const outage = await api('POST', '/api/admin/outages', {
      title: 'Mantenimiento', reason: 'Cambio de servidor', scope: 'package', package_id: pkg.id,
      starts_at: Math.floor(Date.now() / 1000) - 60, block_playback: true,
    });
    assert.equal(outage.status, 201);
    assert.equal(outage.data.active_now, true);
    assert.equal((await api('GET', `/live/juan/abc123/${channel.id}.ts`, undefined, { raw: true })).status, 403);
    const info = await api('GET', '/api/client/info?username=juan&password=abc123');
    assert.equal(info.data.outage.title, 'Mantenimiento');
    await api('DELETE', `/api/admin/outages/${outage.data.id}`);
    assert.equal((await api('GET', `/live/juan/abc123/${channel.id}.ts`, undefined, { raw: true })).status, 302);
  });

  test('mensajes y avisos para la app', async () => {
    const msg = await api('POST', '/api/admin/messages', { title: 'Pago', body: 'Tu plan vence pronto', target: 'user', user_id: user.id });
    assert.equal(msg.status, 201, JSON.stringify(msg.data));
    await api('POST', '/api/admin/messages', { title: 'Otro paquete', target: 'package', package_id: 999 }).then((r) => assert.equal(r.status, 400));
    await api('POST', '/api/admin/notices', { title: 'Nuevo canal', body: 'Disfrútalo', level: 'info', display: 'popup' });

    let info = await api('GET', '/api/client/info?username=juan&password=abc123');
    assert.equal(info.data.unread_messages, 1);
    assert.equal(info.data.notices.length, 1);
    assert.equal((await api('GET', '/api/client/info?username=juan&password=no')).status, 401);

    const read = await api('POST', `/api/client/messages/${msg.data.id}/read`, { username: 'juan', password: 'abc123' });
    assert.equal(read.status, 200);
    info = await api('GET', '/api/client/info?username=juan&password=abc123');
    assert.equal(info.data.unread_messages, 0);
    assert.equal((await api('GET', '/api/admin/messages')).data.data[0].read_count, 1);
  });

  test('revendedor solo ve sus usuarios', async () => {
    const r = await api('POST', '/api/admin/admins', { username: 'rev', password: 'revclave123', role: 'reseller' });
    assert.equal(r.status, 201);
    const adminToken = token;
    token = (await api('POST', '/api/admin/auth/login', { username: 'rev', password: 'revclave123' })).data.token;
    assert.equal((await api('GET', '/api/admin/users')).data.total, 0);
    assert.equal((await api('GET', '/api/admin/settings')).status, 403);
    assert.equal((await api('POST', '/api/admin/packages', { name: 'x' })).status, 403);
    const own = await api('POST', '/api/admin/users', { random: true, package_ids: [pkg.id] });
    assert.equal(own.status, 201);
    assert.equal((await api('GET', `/api/admin/users/${user.id}`)).status, 404);
    token = adminToken;
  });

  test('migración desde XtreamUI conserva IDs, credenciales y paquetes', async () => {
    const fake = createFakeXtream();
    const admin = await db('admins').where({ username: 'admin' }).first();
    const job = await startMigration(admin, {}, { resellers: true }, { connection: fake });
    for (let i = 0; i < 100 && (await getJob(job.id)).status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const done = await getJob(job.id);
    assert.equal(done.status, 'done', `${done.error}\n${done.log.join('\n')}`);
    assert.equal(done.stats.users.created, 3);
    assert.equal(done.stats.streams.created, 3);
    assert.equal(done.stats.episodes.created, 2);
    assert.equal(done.reseller_credentials.length, 1);
    assert.ok(fake.ended);

    // El cliente migrado entra con las mismas credenciales y los mismos IDs de canal.
    const auth = await api('GET', '/player_api.php?username=cliente1&password=clave1');
    assert.equal(auth.data.user_info.status, 'Active');
    assert.equal(auth.data.user_info.max_connections, '2');
    const live = await api('GET', '/player_api.php?username=cliente1&password=clave1&action=get_live_streams');
    assert.deepEqual(live.data.map((s) => s.stream_id), [101]);
    const vodInfo = await api('GET', '/player_api.php?username=cliente1&password=clave1&action=get_vod_info&vod_id=205');
    assert.equal(vodInfo.data.movie_data.container_extension, 'mkv');
    assert.equal(vodInfo.data.info.plot, 'Una peli');
    const seriesInfo = await api('GET', '/player_api.php?username=cliente1&password=clave1&action=get_series_info&series_id=40');
    assert.deepEqual(seriesInfo.data.episodes['1'].map((e) => e.id), ['901', '902']);

    const play = await api('GET', '/live/cliente1/clave1/101.ts', undefined, { raw: true });
    assert.equal(play.status, 302);
    assert.equal(play.headers.get('location'), 'http://origen.test/dep.ts');
    assert.equal((await api('GET', '/series/cliente1/clave1/901.mp4', undefined, { raw: true })).status, 302);

    assert.equal((await api('GET', '/player_api.php?username=vencido&password=clave2')).data.user_info.status, 'Expired');
    assert.equal((await api('GET', '/player_api.php?username=baneado&password=clave3')).data.user_info.status, 'Banned');

    const migrated = (await api('GET', '/api/admin/users?source=xtreamui')).data;
    assert.equal(migrated.total, 3);
    const c1 = migrated.data.find((u) => u.username === 'cliente1');
    assert.equal(c1.owner_username, 'revendedor1');

    // Segunda ejecución sin sobrescribir: todo se omite.
    const again = await startMigration(admin, {}, {}, { connection: createFakeXtream() });
    for (let i = 0; i < 100 && (await getJob(again.id)).status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const second = await getJob(again.id);
    assert.equal(second.status, 'done', second.error);
    assert.equal(second.stats.users.created, 0);
    assert.equal(second.stats.users.skipped, 3);
  });

  test('ajustes: modo xtream_upstream redirige al servidor antiguo', async () => {
    const s = await api('PUT', '/api/admin/settings', { stream_mode: 'xtream_upstream', xtream_upstream_url: 'http://viejo.test:25461/' });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    assert.equal(s.data.xtream_db.password, undefined);
    const res = await api('GET', '/live/cliente1/clave1/101.ts', undefined, { raw: true });
    assert.equal(res.headers.get('location'), 'http://viejo.test:25461/live/cliente1/clave1/101.ts');
    await api('PUT', '/api/admin/settings', { stream_mode: 'redirect' });
  });
});

describe('modo proxy', () => {
  test('retransmite la fuente, usa respaldo y libera la conexión al cerrar', async () => {
    const http = await import('node:http');
    const origin = http.createServer((req, res) => {
      if (req.url === '/caido.ts') { res.writeHead(500); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.end(Buffer.alloc(4096, 0x47));
    }).listen(0);
    await new Promise((r) => origin.once('listening', r));
    const o = `http://127.0.0.1:${origin.address().port}`;
    try {
      const created = await api('POST', '/api/admin/streams', {
        type: 'live', name: 'Proxy', source_url: `${o}/caido.ts`, backup_urls: [`${o}/ok.ts`],
      });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      await api('PUT', '/api/admin/settings', { stream_mode: 'proxy', allow_all_without_package: true });
      const u = (await api('POST', '/api/admin/users', { username: 'proxyuser', password: 'px1234' })).data;
      const res = await api('GET', `/live/proxyuser/px1234/${created.data.id}.ts`, undefined, { raw: true });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'video/mp2t');
      assert.equal((await res.arrayBuffer()).byteLength, 4096);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal((await api('GET', `/api/admin/users/${u.id}/connections`)).data.length, 0);
    } finally {
      await api('PUT', '/api/admin/settings', { stream_mode: 'redirect' });
      origin.close();
    }
  });
});

describe('dispositivos', () => {
  const TVBOX_UA = 'Dalvik/2.1.0 (Linux; U; Android 9; X96Max_Plus2 Build/PPR1.180610.011)';

  test('detecta el equipo al conectarse y genera alerta de TV Box nuevo', async () => {
    const u = (await api('POST', '/api/admin/users', { username: 'cliente.box', password: 'box1234' })).data;
    await api('GET', '/player_api.php?username=cliente.box&password=box1234', undefined, { headers: { 'User-Agent': TVBOX_UA } });
    await api('GET', '/get.php?username=cliente.box&password=box1234', undefined,
      { headers: { 'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) SamsungBrowser/2.2 TV Safari/537.36' } });

    const list = (await api('GET', `/api/admin/devices?user_id=${u.id}`)).data;
    assert.equal(list.total, 2);
    const box = list.data.find((d) => d.type === 'tvbox');
    assert.equal(box.model, 'X96Max_Plus2');
    assert.equal(box.ownership, 'company');
    assert.equal(box.online, true);
    assert.equal(box.last_activity, 'xtream_api');
    assert.equal(list.data.find((d) => d.type === 'smart_tv').brand, 'Samsung');
    assert.equal((await api('GET', '/api/admin/devices?search=cliente.b')).data.total, 2, 'busca por usuario del cliente');
    assert.equal((await api('GET', '/api/admin/devices?search=X96Max')).data.total, 1);

    const alerts = (await api('GET', '/api/admin/devices/alerts')).data;
    assert.ok(alerts.data.some((a) => a.type === 'new_tvbox' && a.device_id === box.id));
    assert.equal((await api('GET', `/api/admin/users/${u.id}`)).data.device_count, 2);

    // Asignarlo confirma el equipo y cierra la alerta de TV Box nuevo.
    const assigned = await api('POST', `/api/admin/devices/${box.id}/assign`, { user_id: u.id });
    assert.equal(assigned.data.open_alerts, 0);
  });

  test('registro manual, uso por otro cliente e inactividad', async () => {
    const a = (await api('POST', '/api/admin/users', { username: 'dueno', password: 'd12345' })).data;
    await api('POST', '/api/admin/users', { username: 'otro', password: 'o12345' });

    const created = await api('POST', '/api/admin/devices', {
      name: 'Box bodega 001', model: 'X96 Mini', serial: 'SN-001', device_id: 'APP-001', ownership: 'company',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.inventory_status, 'available');
    const dev = (await api('POST', `/api/admin/devices/${created.data.id}/assign`, { user_id: a.id })).data;
    assert.equal(dev.inventory_status, 'assigned');
    assert.equal((await api('POST', '/api/admin/devices', { device_id: 'APP-001' })).status, 409);

    // La app propia se identifica con X-Device-Id: se reconoce el equipo registrado.
    const appHeaders = { 'User-Agent': 'okhttp/4.9', 'X-Device-Id': 'APP-001', 'X-App-Name': 'IPTV Player' };
    await api('GET', '/api/client/info?username=dueno&password=d12345', undefined, { headers: appHeaders });
    let d = (await api('GET', `/api/admin/devices/${dev.id}`)).data;
    assert.equal(d.last_username, 'dueno');
    assert.equal(d.app, 'IPTV Player');
    assert.equal(d.type, 'tvbox', 'el tipo manual no se sobrescribe');

    await api('GET', '/player_api.php?username=otro&password=o12345', undefined, { headers: appHeaders });
    const foreign = (await api('GET', `/api/admin/devices/alerts?device_id=${dev.id}`)).data.data;
    assert.ok(foreign.some((x) => x.type === 'foreign_user'), 'alerta de uso por otro cliente');

    // Simular 40 días sin actividad.
    await api('PUT', '/api/admin/settings', { device_inactive_message_client: true });
    await db('devices').where({ id: dev.id }).update({ last_seen_at: Math.floor(Date.now() / 1000) - 40 * 86400 });
    const check = (await api('POST', '/api/admin/devices/check')).data;
    assert.ok(check.alerts_created >= 1);
    d = (await api('GET', `/api/admin/devices/${dev.id}`)).data;
    assert.equal(d.inactive, true);
    const inactiveAlert = (await api('GET', `/api/admin/devices/alerts?type=inactive&device_id=${dev.id}`)).data.data[0];
    assert.match(inactiveAlert.message, /sin conexión hace 40 días/);
    assert.equal((await api('POST', '/api/admin/devices/check')).data.alerts_created, 0, 'no duplica alertas');
    const info = (await api('GET', '/api/client/info?username=dueno&password=d12345')).data;
    assert.ok(info.messages.some((m) => m.title === 'Revisión de tu equipo'));

    const stats = (await api('GET', '/api/admin/devices/stats')).data;
    assert.ok(stats.inactive >= 1 && stats.company_tvbox >= 1 && stats.open_alerts >= 1);
    assert.ok((await api('GET', '/api/admin/dashboard')).data.devices.open_alerts >= 1);

    const resolved = await api('POST', `/api/admin/devices/alerts/${inactiveAlert.id}/resolve`, { resolution: 'Cliente contactado' });
    assert.equal(resolved.status, 200);
  });
});

describe('panel: salud del contenido y consumo del servidor', () => {
  test('revisa fuentes y clasifica en línea / caídos', async () => {
    const http = await import('node:http');
    const origin = http.createServer((req, res) => {
      if (req.url === '/ok.ts') { res.writeHead(200, { 'Content-Type': 'video/mp2t' }); return res.end(Buffer.alloc(2048, 0x47)); }
      if (req.url === '/lista.m3u8') { res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); return res.end('#EXTM3U\n#EXTINF:10,\nseg.ts\n'); }
      if (req.url === '/web.ts') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>error</html>'); }
      res.writeHead(404); res.end();
    }).listen(0);
    await new Promise((r) => origin.once('listening', r));
    const o = `http://127.0.0.1:${origin.address().port}`;
    try {
      const mk = async (name, url, type = 'live') => (await api('POST', '/api/admin/streams', { type, name, source_url: url })).data.id;
      const ids = [
        await mk('Salud OK', `${o}/ok.ts`),
        await mk('Salud HLS', `${o}/lista.m3u8`),
        await mk('Salud 404', `${o}/nada.ts`),
        await mk('Salud HTML', `${o}/web.ts`),
        await mk('Peli OK', `${o}/ok.ts`, 'movie'),
      ];
      const r = await api('POST', '/api/admin/streams/check', { ids });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const byId = Object.fromEntries(r.data.results.map((x) => [x.id, x]));
      assert.equal(byId[ids[0]].status, 'online');
      assert.equal(byId[ids[1]].status, 'online');
      assert.equal(byId[ids[2]].status, 'offline');
      assert.equal(byId[ids[2]].error, 'HTTP 404');
      assert.match(byId[ids[3]].error, /página web/);
      assert.equal(byId[ids[4]].status, 'online');

      const offline = (await api('GET', '/api/admin/streams?health=offline&search=Salud')).data;
      assert.equal(offline.total, 2);
      assert.ok(offline.data[0].health_down_since);

      const dash = (await api('GET', '/api/admin/dashboard')).data;
      assert.ok(dash.content_health.live.online >= 2);
      assert.ok(dash.content_health.live.offline >= 2);
      assert.ok(dash.offline_streams.some((s) => s.name === 'Salud 404'));
      assert.ok(dash.recent_logs.length <= 6);
      const health = (await api('GET', '/api/admin/streams/health')).data;
      assert.equal(health.running, false);
      assert.ok(health.movie.online >= 1);
    } finally {
      origin.close();
    }
  });

  test('métricas del servidor', async () => {
    const m = await api('GET', '/api/admin/system/metrics');
    assert.equal(m.status, 200);
    assert.ok(m.data.cpu.cores > 0);
    assert.ok(m.data.memory.total > 0 && m.data.memory.percent > 0);
    assert.ok(m.data.disk === null || m.data.disk.total > 0);
    assert.ok(Array.isArray(m.data.history) && m.data.history.length >= 1);
    assert.ok(m.data.uptime.system > 0);
  });
});
