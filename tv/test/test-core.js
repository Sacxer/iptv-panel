'use strict';
/*
 * Pruebas de la lógica de la app de TV: URLs Xtream, almacenamiento, peticiones con identidad,
 * cabeceras del equipo, cálculo de subredes y barrido, orden de reubicación e identidad del portal,
 * modos de compilación (tienda / completa), inicio de sesión con varias direcciones, foco, teclas,
 * datos del portal y herramientas de compilación.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { load, fakeXhr, MemoryStorage, FakeEl, fakeDocument, rect, fakeClock, tick } = require('./helpers');

const CORE = ['util', 'storage', 'http', 'device', 'lan', 'relocate', 'xtream', 'source', 'session', 'portal', 'keys'];

/* ======================= util / xtream ======================= */
test('util: normaliza la dirección del servidor y el texto', () => {
  const { util: U } = load(['util']);
  assert.equal(U.normalizeServer('tv.midominio.com:25461/'), 'http://tv.midominio.com:25461');
  assert.equal(U.normalizeServer('http://1.2.3.4:8080/player_api.php?username=a'), 'http://1.2.3.4:8080');
  assert.equal(U.normalizeServer('https://x.com/get.php?u=1'), 'https://x.com');
  assert.equal(U.normalizeServer('  '), '');
  assert.equal(U.qs({ a: 'b c', n: 1, x: null, y: undefined }), 'a=b%20c&n=1');
  assert.equal(U.normalize('Televisión Ñandú'), 'television nandu');
  assert.equal(U.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(U.formatDuration(3725), '1:02:05');
  assert.equal(U.formatDuration(65), '1:05');
  assert.equal(U.b64decode('Q2FuYWwgw5E='), 'Canal Ñ');
});

test('xtream: construye URLs de API y de reproducción', () => {
  const { Xtream: X } = load(['util', 'xtream']);
  assert.equal(X.apiUrl('http://s:25461', 'juan pérez', 'a&b', { action: 'get_live_streams', category_id: 3 }),
    'http://s:25461/player_api.php?username=juan%20p%C3%A9rez&password=a%26b&action=get_live_streams&category_id=3');
  assert.equal(X.liveUrl('http://s', 'u/1', 'p', 10, 'm3u8'), 'http://s/live/u%2F1/p/10.m3u8');
  assert.equal(X.liveUrl('http://s', 'u', 'p', 10), 'http://s/live/u/p/10.ts');
  assert.equal(X.movieUrl('http://s', 'u', 'p', 20, 'mkv'), 'http://s/movie/u/p/20.mkv');
  assert.equal(X.episodeUrl('http://s', 'u', 'p', 55), 'http://s/series/u/p/55.mp4');
  assert.equal(X.altLiveUrl('http://s/live/u/p/10.ts'), 'http://s/live/u/p/10.m3u8');
  assert.equal(X.altLiveUrl('http://s/live/u/p/10.m3u8?t=1'), 'http://s/live/u/p/10.ts?t=1');
  assert.equal(X.altLiveUrl('http://s/movie/u/p/10.mp4'), null);
  assert.equal(X.withDevice('http://s/live/u/p/10.ts', 'TV 1'), 'http://s/live/u/p/10.ts?did=TV%201');
  assert.equal(X.withDevice('http://s/x?t=1', 'A'), 'http://s/x?t=1&did=A');
  assert.equal(X.withDevice('http://s/x', ''), 'http://s/x');
  assert.equal(X.altLiveUrl('http://s/live/u/p/10.ts?did=A'), 'http://s/live/u/p/10.m3u8?did=A');
});

test('xtream: interpreta la autenticación y normaliza listas', () => {
  const { Xtream: X } = load(['util', 'xtream']);
  assert.equal(X.parseAuth(null).reason, 'invalid');
  assert.equal(X.parseAuth({ user_info: { auth: 0 } }).reason, 'auth');
  const ok = X.parseAuth({ user_info: { auth: 1, status: 'Active', exp_date: '1767225600', max_connections: '2', allowed_output_formats: ['m3u8'] }, server_info: {} });
  assert.equal(ok.ok, true);
  assert.equal(ok.user.exp_date, 1767225600);
  assert.deepEqual(ok.user.formats, ['m3u8']);
  const banned = X.parseAuth({ user_info: { auth: '1', status: 'Banned', message: 'Falta de pago' } });
  assert.equal(banned.ok, false);
  assert.equal(banned.reason, 'status');
  assert.equal(banned.message, 'Falta de pago');

  const live = X.normLive([{ num: 1, name: 'Canal', stream_id: 10, stream_icon: 'i', category_id: '1', epg_channel_id: 'c.co' }, { stream_id: 11, category_ids: [5] }]);
  assert.deepEqual([live[0].id, live[0].cat, live[0].epg, live[1].cat, live[1].name, live[1].num], ['10', '1', 'c.co', '5', 'Canal', 2]);
  assert.deepEqual(X.normLive('basura'), []);
  const info = X.normSeriesInfo({ info: [], episodes: [[{ id: '2', episode_num: 2, season: 1 }, { id: '1', episode_num: 1, season: 1 }]] }, { id: '9', name: 'S', logo: 'l' });
  assert.equal(info.seasons.length, 1);
  assert.deepEqual(info.seasons[0].episodes.map((e) => e.id), ['1', '2'], 'episodios ordenados; acepta episodes como arreglo');
  assert.equal(info.info.cover, 'l');
  assert.equal(info.info.backdrop, '');
  assert.equal(X.normSeriesInfo({ info: { backdrop_path: ['', 'http://s/b.jpg'] } }).info.backdrop, 'http://s/b.jpg');
  assert.equal(X.normSeries([{ series_id: 1, backdrop_path: ['http://s/f.jpg'] }])[0].backdrop, 'http://s/f.jpg');
  assert.equal(X.normVodInfo({ info: { backdrop_path: 'http://s/v.jpg', movie_image: 'http://s/p.jpg' } }).backdrop, 'http://s/v.jpg');
  assert.equal(X.normVodInfo({ info: [] }, { logo: 'p' }).backdrop, '');
  const epg = X.normEpg({ epg_listings: [{ title: 'Tm90aWNpYXM=', description: '', start_timestamp: '200', stop_timestamp: '300' }, { title: 'QQ==', start: '1970-01-01 00:01:40', end: '1970-01-01 00:03:20' }] });
  assert.deepEqual(epg.map((e) => [e.title, e.start, e.end]), [['A', 100, 200], ['Noticias', 200, 300]]);
});

/* ======================= storage ======================= */
test('storage: perfiles, favoritos, recientes, posiciones y avisos vistos', () => {
  const { storage: S } = load(['util', 'storage']);
  const p = S.saveProfile({ name: 'Casa', type: 'xtream' });
  assert.ok(p.id);
  S.saveProfile(Object.assign({}, p, { name: 'Sala' }));
  assert.equal(S.getProfiles().length, 1);
  assert.equal(S.getProfile(p.id).name, 'Sala');

  const ch = { type: 'live', id: '10', name: 'Canal', logo: '', extra: 'no' };
  assert.equal(S.toggleFavorite(p.id, ch), true);
  assert.equal(S.isFavorite(p.id, { type: 'live', id: '10' }), true);
  assert.equal(S.getFavorites(p.id)[0].extra, undefined, 'solo guarda los campos necesarios');
  assert.equal(S.toggleFavorite(p.id, ch), false);

  for (let i = 0; i < 70; i++) S.addRecent(p.id, { type: 'movie', id: String(i), name: `P${i}` });
  S.addRecent(p.id, { type: 'movie', id: '5', name: 'P5' });
  const rec = S.getRecents(p.id);
  assert.equal(rec.length, 60);
  assert.equal(rec[0].id, '5', 'el último reproducido va primero y sin repetir');

  const movie = { type: 'movie', id: '7' };
  S.setPosition(p.id, movie, 20, 3000);
  assert.equal(S.getPosition(p.id, movie), null, 'menos de 30 s no se guarda');
  S.setPosition(p.id, movie, 1200.7, 3000);
  assert.equal(S.getPosition(p.id, movie).t, 1200);
  S.setPosition(p.id, movie, 2970, 3000);
  assert.equal(S.getPosition(p.id, movie), null, 'casi terminada se borra');

  S.markSeen(p.id, 'notice:1');
  assert.equal(S.wasSeen(p.id, 'notice:1'), true);
  S.set('activeProfile', p.id);
  S.deleteProfile(p.id);
  assert.equal(S.getProfiles().length, 0);
  assert.equal(S.get('activeProfile'), undefined);
  assert.deepEqual(S.getFavorites(p.id), []);
});

test('storage: en desarrollo cada variante guarda aparte y sin localStorage usa memoria', () => {
  const ls = new MemoryStorage();
  load(['util', 'storage'], { config: { dev: true, variant: 'store' }, localStorage: ls });
  global.IPTV.storage.set('x', 1);
  assert.deepEqual(ls.keys(), ['iptv.store.x']);
  const { storage: S } = load(['util', 'storage'], { config: { dev: false, variant: 'store' }, localStorage: ls });
  S.set('x', 2);
  assert.ok(ls.keys().includes('iptv.x'));
  global.localStorage = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('lleno'); }, removeItem() {} };
  assert.equal(S.set('y', 5), false);
  assert.equal(S.get('y'), 5, 'queda en memoria');
});

/* ======================= http ======================= */
test('http: reconoce el puerto del panel y clasifica errores', async () => {
  const { http: H } = load(['util', 'http']);
  assert.equal(H.panelPortHint('Este es el puerto del panel. Los clientes usan el puerto 25461.'), 25461);
  assert.equal(H.panelPortHint('otro texto'), null);
  assert.equal(H.makeError('network', 0, '').canRelocate, true);
  assert.equal(H.makeError('http', 401, '').canRelocate, false);
  fakeXhr((req) => {
    if (req.url.includes('/panel')) return { status: 404, body: { error: 'Este es el puerto del panel. Los clientes usan el puerto 25461.' } };
    if (req.url.includes('/mal')) return { status: 200, body: '<html>' };
    if (req.url.includes('/lento')) return null;
    return { status: 401, body: { error: 'Credenciales inválidas' } };
  });
  const get = (url, timeout) => new Promise((r) => H.getJSON(url, (err, data) => r({ err, data }), timeout));
  const panel = await get('http://h:8080/panel');
  assert.equal(panel.err.kind, 'panelPort');
  assert.equal(panel.err.clientPort, 25461);
  assert.equal(panel.err.canRelocate, true);
  assert.equal((await get('http://h/mal')).err.kind, 'format');
  const auth = await get('http://h/x');
  assert.equal(auth.err.status, 401);
  assert.equal(auth.err.message, 'Credenciales inválidas');
  const slow = await get('http://h/lento', 30);
  assert.equal(slow.err.kind, 'timeout');
});

test('http: envía la identidad del equipo y la quita si un servidor ajeno la rechaza', async () => {
  const { http: H } = load(['util', 'http']);
  H.identityHeaders = () => ({ 'X-Device-Id': 'abc', 'X-Device-Type': 'smart_tv' });
  const reqs = fakeXhr((req) => {
    /* El servidor ajeno rechaza (CORS) cuando llegan cabeceras propias */
    if (req.url.startsWith('http://ajeno') && req.headers['X-Device-Id']) return { status: 0, body: '' };
    return { status: 200, body: { ok: true } };
  });
  const get = (url) => new Promise((r) => H.request({ url, json: true, identity: true }, (err, res) => r({ err, res })));
  const portal = await get('http://portal:25461/api/client/info');
  assert.equal(portal.err, null);
  assert.equal(reqs[0].headers['X-Device-Id'], 'abc');
  assert.equal(reqs[0].headers.Accept, 'application/json');
  const ajeno = await get('http://ajeno/player_api.php');
  assert.equal(ajeno.err, null);
  assert.equal(reqs.length, 3, 'reintentó sin cabeceras');
  assert.equal(reqs[2].headers['X-Device-Id'], undefined);
  await get('http://ajeno/player_api.php?x=2');
  assert.equal(reqs[3].headers['X-Device-Id'], undefined, 'recuerda el origen');
  const plain = await new Promise((r) => H.request({ url: 'http://portal:25461/api/client/ping' }, (e) => r(e)));
  assert.equal(plain, null);
  assert.equal(reqs[4].headers['X-Device-Id'], undefined, 'sin identity no envía cabeceras');
});

/* ======================= device ======================= */
test('device: identificador persistente y cabeceras ASCII', async () => {
  const IPTV = load(['util', 'storage', 'http', 'device'], { config: { appName: 'Televisión Ñ', version: '1.2.3', distribution: 'webos' } });
  const D = IPTV.device;
  IPTV.platform = 'browser';
  const nav = Object.getOwnPropertyDescriptor(global, 'navigator');
  Object.defineProperty(global, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36' }, configurable: true, writable: true });
  await new Promise((r) => D.init(r));
  assert.match(D.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const id = D.id;
  await new Promise((r) => D.init(r));
  assert.equal(D.id, id, 'se conserva');
  const h = D.headers();
  assert.equal(h['X-Device-Type'], 'smart_tv');
  assert.equal(h['X-App-Name'], 'Television N');
  assert.equal(h['X-App-Version'], '1.2.3');
  assert.equal(h['X-App-Build'], '10203');
  assert.equal(h['X-App-Distribution'], 'webos');
  assert.equal(h['X-Device-Model'], 'Chrome 140');
  for (const v of Object.values(h)) assert.match(v, /^[\x20-\x7E]*$/);
  assert.deepEqual(IPTV.http.identityHeaders(), h, 'las peticiones con identity usan estas cabeceras');
  IPTV.config.distribution = 'browser';
  assert.equal(D.headers()['X-App-Distribution'], undefined, 'el portal solo acepta tizen/webos');
  assert.equal(D.buildNumber('2.10.5'), 21005);
  assert.equal(D.ascii('Señal “HD”\n'), 'Senal HD');
  if (nav) Object.defineProperty(global, 'navigator', nav); else delete global.navigator;
});

test('device: redes de Tizen y webOS', async () => {
  const IPTV = load(['util', 'storage', 'http', 'device', 'lan']);
  const D = IPTV.device;
  IPTV.platform = 'tizen';
  global.tizen = {
    systeminfo: {
      getPropertyValue(prop, ok) {
        if (prop === 'ETHERNET_NETWORK') setTimeout(() => ok({ status: 'ON', ipAddress: '172.27.14.20', subnetMask: '255.255.224.0', gateway: '172.27.0.1' }), 1);
        else setTimeout(() => ok({ status: 'OFF', ipAddress: '' }), 1);
      },
    },
  };
  global.webapis = { network: { getIp: () => '192.168.1.50', getSubnetMask: () => '255.255.255.0', getGateway: () => '192.168.1.1', getActiveConnectionType: () => 1 } };
  const tz = await new Promise((r) => D.networks(r));
  assert.deepEqual(tz.map((n) => [n.address, n.prefix, n.gateway]), [['172.27.14.20', 19, '172.27.0.1'], ['192.168.1.50', 24, '192.168.1.1']]);
  delete global.tizen;
  delete global.webapis;

  IPTV.platform = 'webos';
  global.PalmServiceBridge = class {
    call(uri) {
      setTimeout(() => this.onservicecallback(JSON.stringify(uri.includes('connectionmanager')
        ? { returnValue: true, isInternetConnectionAvailable: true, wired: { state: 'disconnected' }, wifi: { state: 'connected', ipAddress: '10.20.30.40', netmask: '255.255.0.0', gateway: '10.20.0.1' } }
        : { returnValue: true })), 1);
    }
  };
  const wo = await new Promise((r) => D.networks(r));
  assert.deepEqual(wo, [{ name: 'wifi', address: '10.20.30.40', prefix: 16, gateway: '10.20.0.1', preferred: true }]);
  delete global.PalmServiceBridge;

  IPTV.platform = 'browser';
  IPTV.config.dev = true;
  global.location = { search: '?lan=127.0.0.0/30,8.8.8.8', hostname: 'localhost' };
  const br = await new Promise((r) => D.networks(r));
  assert.deepEqual(br.map((n) => `${n.address}/${n.prefix}`), ['127.0.0.0/30', '8.8.8.8/24'], 'en desarrollo ?lan= admite cualquier red');
  IPTV.config.dev = false;
  global.location = { search: '?lan=127.0.0.0/30', hostname: '192.168.5.5' };
  const br2 = await new Promise((r) => D.networks(r));
  assert.deepEqual(br2.map((n) => `${n.address}/${n.prefix}`), ['192.168.5.5/24'], 'fuera de desarrollo solo redes locales');
  delete global.location;
});

/* ======================= lan: subredes ======================= */
test('lan: cálculo de direcciones y máscaras', () => {
  const { lan: L } = load(['util', 'http', 'lan']);
  assert.equal(L.ipToInt('192.168.1.10'), 3232235786);
  assert.equal(L.ipToInt('255.255.255.255'), 4294967295);
  assert.equal(L.intToIp(4294967295), '255.255.255.255');
  assert.equal(L.ipToInt('1.2.3'), null);
  assert.equal(L.ipToInt('1.2.3.256'), null);
  assert.equal(L.ipToInt('1.2.3.x'), null);
  assert.equal(L.prefixFromMask('255.255.255.0'), 24);
  assert.equal(L.prefixFromMask('255.255.240.0'), 20);
  assert.equal(L.prefixFromMask('255.255.255.255'), 32);
  assert.equal(L.prefixFromMask('0.0.0.0'), 0);
  assert.equal(L.prefixFromMask('255.0.255.0'), null, 'máscara no contigua');
  assert.equal(L.prefixFromMask('/22'), 22);
  assert.equal(L.prefixFromMask(''), null);
  assert.equal(L.maskOf(24), L.ipToInt('255.255.255.0'));
  assert.equal(L.maskOf(0), 0);
  assert.equal(L.cidr('172.27.14.20', 19), '172.27.0.0/19');
  for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.1', '100.64.0.1', '100.127.1.1']) assert.equal(L.isLanAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '127.0.0.1', '169.254.1.1', 'x']) assert.equal(L.isLanAddress(ip), false, ip);
});

test('lan: tramos del barrido por cercanía, con la red del router y como máximo una /16', () => {
  const { lan: L } = load(['util', 'http', 'lan']);
  const own = L.sweepBlocks({ address: '192.168.1.77', prefix: 24 });
  assert.equal(own.length, 1);
  assert.deepEqual([L.intToIp(own[0].first), L.intToIp(own[0].last), own[0].network], ['192.168.1.1', '192.168.1.254', '192.168.1.0/24']);

  const big = L.sweepBlocks({ address: '172.27.14.20', prefix: 19, gateway: '172.27.0.1' });
  assert.equal(big.length, 32);
  assert.deepEqual(big.slice(0, 5).map((b) => b.label), ['172.27.14.0/24', '172.27.0.0/24', '172.27.13.0/24', '172.27.15.0/24', '172.27.12.0/24']);
  assert.equal(L.intToIp(big[1].first), '172.27.0.1', 'sin la dirección de red');
  assert.ok(big.every((b) => b.network === '172.27.0.0/19'));
  const last = big.find((b) => b.label === '172.27.31.0/24');
  assert.equal(L.intToIp(last.last), '172.27.31.254', 'sin la dirección de difusión');

  const huge = L.sweepBlocks({ address: '10.5.6.7', prefix: 8 });
  assert.equal(huge.length, 256, 'una /8 se recorta a su /16');
  assert.equal(huge[0].network, '10.5.0.0/16');
  assert.equal(L.countTargets(huge, [25461, 8080, 80]), 3 * (65536 - 2));

  const p2p = L.sweepBlocks({ address: '10.0.0.8', prefix: 31 });
  assert.deepEqual([L.intToIp(p2p[0].first), L.intToIp(p2p[0].last)], ['10.0.0.8', '10.0.0.9']);
  assert.deepEqual(L.sweepBlocks({ address: 'nada' }), []);

  const nets = [{ address: '192.168.1.5', prefix: 24 }, { address: '192.168.1.9', prefix: 24 }, { address: '10.0.0.2', prefix: 24 },
    { address: '10.0.1.2', prefix: 24 }, { address: '10.0.2.2', prefix: 24 }, { address: '10.0.3.2', prefix: 24 }];
  const all = L.sweepBlocksFor(nets);
  assert.deepEqual(all.map((b) => b.label), ['192.168.1.0/24', '10.0.0.0/24', '10.0.1.0/24'], 'sin repetir y como máximo 4 redes');
});

test('lan: recorre cada puerto por todos los tramos y calcula el tiempo máximo', () => {
  const { lan: L } = load(['util', 'http', 'lan']);
  const blocks = L.sweepBlocks({ address: '10.0.0.5', prefix: 30 });
  const it = L.sweepTargets(blocks, [25461, 80]);
  const seq = [];
  for (let t = it.next(); t; t = it.next()) seq.push(`${t.host}:${t.port}`);
  assert.deepEqual(seq, ['10.0.0.5:25461', '10.0.0.6:25461', '10.0.0.5:80', '10.0.0.6:80']);
  assert.equal(L.sweepTargets([], [80]).next(), null);
  assert.equal(L.autoLimit(10, 40, 1500), L.SHORTEST_LIMIT);
  assert.equal(L.autoLimit(3 * 65534, 40, 1500), L.LONGEST_LIMIT);
  assert.ok(L.autoLimit(762, 40, 1500) > L.SHORTEST_LIMIT && L.autoLimit(762, 40, 1500) < L.LONGEST_LIMIT);
});

test('lan: interpreta /api/client/ping', () => {
  const { lan: L } = load(['util', 'http', 'lan']);
  const p = L.parsePing(200, JSON.stringify({ portal: true, type: 'iptv-portal', id: 'abc', name: 'Mi IPTV', ports: [8080, 25461], client_ports: [25461, 25461, 'x'] }));
  assert.equal(p.status, 'portal');
  assert.equal(p.id, 'abc');
  assert.deepEqual(p.clientPorts, [25461]);
  assert.equal(L.parsePing(200, '{"portal":true}').status, 'portal', 'portales anteriores');
  assert.equal(L.parsePing(200, '{"portal":true}').id, '');
  assert.equal(L.parsePing(200, '{"type":"otra-cosa"}').status, 'notPortal');
  assert.equal(L.parsePing(200, '[1,2]').status, 'notPortal');
  assert.equal(L.parsePing(200, '<html>').status, 'notPortal');
  assert.equal(L.parsePing(500, '').status, 'notPortal');
  assert.equal(L.parsePing(0, '').status, 'unreachable');
  const panel = L.parsePing(404, '{"error":"Este es el puerto del panel. Los clientes usan el puerto 25461."}');
  assert.deepEqual(panel, { status: 'panelPort', suggestedPort: 25461 });
  assert.equal(L.parsePing(404, 'Portal IPTV').status, 'notPortal');
});

function portalProbe(map, delay = 1) {
  const calls = [];
  const probe = (host, port, cb) => {
    calls.push(`${host}:${port}`);
    const s = map[`${host}:${port}`];
    const t = setTimeout(() => cb(s ? Object.assign({ url: `http://${host}:${port}`, host, port, ports: [port], clientPorts: [port] }, s) : null), delay);
    return { abort: () => clearTimeout(t) };
  };
  return { probe, calls };
}

test('lan: el barrido se detiene al encontrar el portal buscado y respeta la concurrencia', async () => {
  const { lan: L } = load(['util', 'http', 'lan']);
  let inFlight = 0, maxInFlight = 0;
  const hits = { '192.168.1.200:8080': { id: 'otro', name: 'Otro' }, '192.168.1.130:25461': { id: 'bueno', name: 'Mío' } };
  const probe = (host, port, cb) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    const t = setTimeout(() => { inFlight--; const s = hits[`${host}:${port}`]; cb(s ? { url: `http://${host}:${port}`, host, port, ports: [port], clientPorts: [], ...s } : null); }, 1);
    return { abort: () => { clearTimeout(t); inFlight--; } };
  };
  const progress = [];
  const res = await new Promise((r) => L.discover({
    networks: [{ address: '192.168.1.10', prefix: 24 }], ports: [25461, 8080], expectedId: 'bueno', concurrency: 8, probe,
    onProgress: (p) => progress.push(p),
  }, r));
  assert.equal(res.cancelled, false);
  assert.deepEqual(res.servers.map((s) => s.id), ['bueno'], 'el puerto 25461 se revisa entero antes que 8080');
  assert.ok(maxInFlight <= 8);
  assert.ok(progress.length >= 1 && /192\.168\.1\.0\/24/.test(progress[0].label));
});

test('lan: acepta solo los portales permitidos, se puede cancelar y avisa si no hay red', async () => {
  const { lan: L } = load(['util', 'http', 'lan']);
  const { probe } = portalProbe({ '10.0.0.2:80': { id: 'a' }, '10.0.0.3:80': { id: 'b' } });
  const only = await new Promise((r) => L.discover({ networks: [{ address: '10.0.0.1', prefix: 29 }], ports: [80], probe, accept: (s) => s.id === 'b', grace: 5, minDuration: 0 }, r));
  assert.deepEqual(only.servers.map((s) => s.id), ['b']);
  const both = await new Promise((r) => L.discover({ networks: [{ address: '10.0.0.1', prefix: 29 }], ports: [80], probe, grace: 50, minDuration: 0 }, r));
  assert.deepEqual(both.servers.map((s) => s.id).sort(), ['a', 'b']);

  const slow = portalProbe({}, 1000);
  let handle;
  const cancelled = new Promise((r) => { handle = L.discover({ networks: [{ address: '10.0.0.1', prefix: 24 }], ports: [80], probe: slow.probe }, r); });
  await tick(5);
  handle.cancel();
  const c = await cancelled;
  assert.equal(c.cancelled, true);

  const none = await new Promise((r) => L.discover({ networks: [], probe }, r));
  assert.equal(none.noNetwork, true);
});

test('lan: sigue el aviso del puerto del panel hasta el puerto de clientes', async () => {
  const IPTV = load(['util', 'http', 'lan']);
  fakeXhr((req) => {
    if (req.url === 'http://10.1.1.1:8080/api/client/ping') return { status: 404, body: { error: 'Este es el puerto del panel. Los clientes usan el puerto 25461.' } };
    if (req.url === 'http://10.1.1.1:25461/api/client/ping') return { status: 200, body: { type: 'iptv-portal', id: 'p1', name: 'Portal', ports: [25461, 8080] } };
    return { status: 0, body: '' };
  });
  const s = await new Promise((r) => IPTV.lan.probe('10.1.1.1', 8080, r));
  assert.equal(s.url, 'http://10.1.1.1:25461');
  assert.equal(s.id, 'p1');
  assert.equal(await new Promise((r) => IPTV.lan.probe('10.1.1.2', 80, r)), null);
});

/* ======================= relocate ======================= */
test('relocate: normaliza direcciones', () => {
  const { relocate: R } = load(['util', 'relocate']);
  assert.equal(R.normalizeBase('192.168.1.5:25461/'), 'http://192.168.1.5:25461');
  assert.equal(R.normalizeBase('HTTP://TV.Dominio.com:8080/player_api.php?u=1'), 'http://tv.dominio.com:8080');
  assert.equal(R.normalizeBase('http://x/panel/'), 'http://x/panel');
  assert.equal(R.normalizeBase('ftp://x'), '');
  assert.equal(R.normalizeBase('http://x:99999'), '');
  assert.equal(R.normalizeBase(''), '');
  assert.equal(R.withPort('http://10.0.0.1:8080', 25461), 'http://10.0.0.1:25461');
  assert.equal(R.withPort('https://tv.com', 443), 'https://tv.com:443');
  assert.equal(R.withPort('http://x', 0), null);
  assert.equal(R.sameUrl('http://x', 'http://X:80/'), true);
  assert.equal(R.sameUrl('http://x:8080', 'http://x:25461'), false);
  assert.equal(R.isKnown({ id: '', urls: [] }), false);
  assert.equal(R.isKnown({ id: 'a' }), true);
  assert.equal(R.accepts({ status: 'portal', id: 'a' }, { id: 'b' }), false, 'nunca otro id');
  assert.equal(R.accepts({ status: 'portal', id: 'a' }, { id: '' }), true);
  assert.equal(R.accepts({ status: 'panelPort' }, { id: '' }), false);
});

function makePinger(table, delays = {}) {
  const calls = [];
  const ping = (url, cb) => {
    calls.push(url);
    setTimeout(() => cb(table[url] || { status: 'unreachable' }), delays[url] || 1);
  };
  return { ping, calls };
}

const relocate = (r, o) => new Promise((res) => r.relocate(o, res));

test('relocate: la dirección actual que responde no se cambia', async () => {
  const { relocate: R } = load(['util', 'relocate']);
  const { ping, calls } = makePinger({ 'http://a:25461': { status: 'portal', id: 'P', clientPorts: [25461] } });
  const r = new R.Relocator({ ping, lanSearch: null });
  const res = await relocate(r, { currentUrl: 'http://a:25461/', identity: { id: 'P', urls: ['http://b:25461'] } });
  assert.equal(res.outcome, 'currentWorks');
  assert.deepEqual(res.clientPorts, [25461]);
  assert.deepEqual(calls, ['http://a:25461']);
});

test('relocate: puerto del panel → mismo equipo con el puerto de clientes, antes que las guardadas', async () => {
  const { relocate: R } = load(['util', 'relocate']);
  const { ping, calls } = makePinger({
    'http://a:8080': { status: 'panelPort', suggestedPort: 25461 },
    'http://a:25461': { status: 'portal', id: 'P', clientPorts: [25461] },
    'http://b:25461': { status: 'portal', id: 'P' },
  }, { 'http://a:25461': 30 });
  const r = new R.Relocator({ ping, lanSearch: null });
  const res = await relocate(r, { currentUrl: 'http://a:8080', identity: { id: 'P', urls: ['http://b:25461', 'http://a:8080'], clientPorts: [9000] } });
  assert.equal(res.outcome, 'found');
  assert.equal(res.url, 'http://a:25461', 'espera a la primera de la lista aunque otra responda antes');
  assert.equal(res.via, 'clientPort');
  assert.deepEqual(calls, ['http://a:8080', 'http://a:25461', 'http://a:9000', 'http://b:25461']);
});

test('relocate: direcciones guardadas en orden, sin aceptar otro portal', async () => {
  const { relocate: R } = load(['util', 'relocate']);
  const { ping } = makePinger({
    'http://nueva:25461': { status: 'portal', id: 'OTRO' },
    'http://vpn:25461': { status: 'portal', id: 'P', clientPorts: [25461] },
  });
  const r = new R.Relocator({ ping, lanSearch: null });
  const res = await relocate(r, { currentUrl: 'http://vieja:25461', identity: { id: 'P', urls: ['http://vieja:25461', 'http://nueva:25461', 'http://vpn:25461'] } });
  assert.equal(res.outcome, 'found');
  assert.equal(res.url, 'http://vpn:25461');
  assert.equal(res.via, 'savedUrl');
  assert.equal(res.previousUrl, 'http://vieja:25461');
  const res2 = await relocate(new R.Relocator({ ping, lanSearch: null, minInterval: 0 }), { currentUrl: 'http://vieja:25461', identity: { id: 'X', urls: ['http://nueva:25461'] } });
  assert.equal(res2.outcome, 'notFound');
});

test('relocate: red local solo con id y confirmando con ping', async () => {
  const { relocate: R } = load(['util', 'relocate']);
  const { ping } = makePinger({ 'http://192.168.1.9:25461': { status: 'portal', id: 'P' }, 'http://192.168.1.8:25461': { status: 'portal', id: 'P' } });
  const searches = [];
  const lanSearch = (id, onProgress, cb) => {
    searches.push(id);
    onProgress({ label: 'x' });
    setTimeout(() => cb([
      { url: 'http://192.168.1.7:25461', id: 'OTRO' },
      { url: 'http://192.168.1.6:25461', id: 'P' },
      { url: 'http://192.168.1.9:25461', id: 'P' },
    ]), 1);
    return { cancel() {} };
  };
  const progress = [];
  const r = new R.Relocator({ ping, lanSearch, minInterval: 0 });
  const res = await relocate(r, { currentUrl: 'http://10.0.0.1:25461', identity: { id: 'P', urls: [] }, onProgress: (p) => progress.push(p) });
  assert.equal(res.outcome, 'found');
  assert.equal(res.url, 'http://192.168.1.9:25461', 'la .6 no respondió al confirmar');
  assert.equal(res.via, 'localNetwork');
  assert.deepEqual(searches, ['P']);
  assert.equal(progress.length, 1);
  const noId = await relocate(r, { currentUrl: 'http://10.0.0.1:25461', identity: { id: '', urls: ['http://x:1'] } });
  assert.equal(noId.outcome, 'notFound');
  assert.equal(searches.length, 1, 'sin id no se barre la red');
  const unknown = await relocate(r, { currentUrl: 'http://10.0.0.1:25461', identity: {} });
  assert.equal(unknown.outcome, 'unknownPortal');
});

test('relocate: una búsqueda a la vez y como máximo una cada 20 s', async () => {
  const { relocate: R } = load(['util', 'relocate']);
  const clock = { t: 0 };
  const { ping, calls } = makePinger({ 'http://b:1': { status: 'portal', id: 'P' } }, { 'http://a:1': 10 });
  const r = new R.Relocator({ ping, lanSearch: null, now: () => clock.t });
  const o = { currentUrl: 'http://a:1', identity: { id: 'P', urls: ['http://b:1'] } };
  const [x, y] = await Promise.all([relocate(r, o), relocate(r, o)]);
  assert.equal(x, y, 'la segunda recibe el mismo resultado');
  assert.equal(calls.length, 2);
  clock.t = 5000;
  const again = await relocate(r, o);
  assert.equal(again.outcome, 'found', 'quien falló con la dirección vieja recibe la nueva');
  assert.equal(calls.length, 2);
  const other = await relocate(r, { currentUrl: 'http://b:1', identity: o.identity });
  assert.equal(other.outcome, 'skipped');
  const forced = await relocate(r, Object.assign({ force: true }, o));
  assert.equal(forced.outcome, 'found');
  assert.equal(calls.length, 4);
  clock.t = 30000;
  const later = await relocate(r, { currentUrl: 'http://b:1', identity: o.identity });
  assert.equal(later.outcome, 'currentWorks');
});

test('relocate: se puede cancelar durante la búsqueda en la red', async () => {
  const { relocate: R } = load(['util', 'relocate']);
  const { ping } = makePinger({});
  let cancelled = false;
  const lanSearch = (id, p, cb) => ({ cancel() { cancelled = true; setTimeout(() => cb([]), 1); } });
  const r = new R.Relocator({ ping, lanSearch });
  const pending = relocate(r, { currentUrl: 'http://a:1', identity: { id: 'P' } });
  await tick(10);
  assert.equal(r.isRunning(), true);
  r.cancel();
  const res = await pending;
  assert.equal(cancelled, true);
  assert.equal(res.outcome, 'cancelled');
});

/* ======================= session: modos y direcciones ======================= */
function sessionEnv(config, profile, pings = {}) {
  const IPTV = load(CORE, { config });
  IPTV.app = { profile: profile || null, source: null };
  IPTV.lan.ping = (url, cb) => setTimeout(() => cb(pings[url] || { status: 'unreachable' }), 1);
  return IPTV;
}

test('session: compilación de tienda y completa', () => {
  const store = sessionEnv({ allowCustomServer: false, allowM3U: false, serverUrls: ['http://192.168.30.100:25461'] });
  const s = store.session.loginOptions();
  assert.deepEqual(s, { restricted: true, showServer: false, showM3U: false, types: ['xtream'], prefillServer: '', lanSearch: true });
  const full = sessionEnv({ allowCustomServer: true, allowM3U: true, serverUrls: ['http://192.168.30.100:25461/'] });
  const f = full.session.loginOptions();
  assert.equal(f.restricted, false);
  assert.equal(f.showServer, true);
  assert.deepEqual(f.types, ['xtream', 'm3u']);
  assert.equal(f.prefillServer, 'http://192.168.30.100:25461', 'sugiere el servidor del operador');
  assert.equal(full.session.isOperatorServer('192.168.30.100:25461'), true);
  assert.equal(full.session.isOperatorServer('http://otro:25461'), false);
  const noM3u = sessionEnv({ allowCustomServer: true, allowM3U: false });
  assert.deepEqual(noM3u.session.loginOptions().types, ['xtream']);
  assert.equal(noM3u.session.loginOptions().prefillServer, '');
});

test('session: direcciones para iniciar sesión (serverUrls en orden y la última usada)', () => {
  const cfg = { allowCustomServer: false, allowM3U: false, serverUrls: ['http://192.168.30.100:25461', 'http://200.1.2.3:25461'] };
  const IPTV = sessionEnv(cfg);
  const SS = IPTV.session;
  assert.deepEqual(SS.connectCandidates({ type: 'xtream', auto: true, server: '' }), cfg.serverUrls);
  assert.deepEqual(SS.connectCandidates({ type: 'xtream', auto: true, server: 'http://192.168.30.100:25461' }), cfg.serverUrls);
  assert.deepEqual(SS.connectCandidates({ type: 'xtream', auto: true, server: 'http://10.9.9.9:25461' }), [...cfg.serverUrls, 'http://10.9.9.9:25461']);
  assert.deepEqual(SS.connectCandidates({ type: 'xtream', auto: false, server: 'http://ajeno:8080/' }), ['http://ajeno:8080']);
  assert.deepEqual(SS.connectCandidates({ type: 'm3u' }), []);
});

test('session: la reubicación automática exige el id del portal (XtreamUI no se reubica)', () => {
  const cfg = { allowCustomServer: false, serverUrls: ['http://192.168.30.100:25461'] };
  const xtreamUi = { type: 'xtream', auto: true, server: 'http://192.168.30.100:25461' };
  const IPTV = sessionEnv(cfg, xtreamUi);
  assert.equal(IPTV.session.canRelocate(), false);
  assert.deepEqual(IPTV.session.identityOf(xtreamUi).urls, ['http://192.168.30.100:25461']);
  xtreamUi.portalId = 'P1';
  assert.equal(IPTV.session.canRelocate(), true);
  IPTV.app.profile = { type: 'm3u', portalId: 'P1' };
  assert.equal(IPTV.session.canRelocate(), false);
});

test('session: guarda la identidad del portal y no adopta la de otro', () => {
  const profile = { id: 'p1', type: 'xtream', auto: true, server: 'http://192.168.30.100:25461', name: 'x' };
  const IPTV = sessionEnv({ allowCustomServer: false, serverUrls: ['http://192.168.30.100:25461'] }, profile);
  const SS = IPTV.session;
  IPTV.storage.saveProfile(profile);
  SS.rememberPortal({ id: 'P1', urls: ['http://192.168.30.100:25461/', 'http://10.0.0.5:25461', 'http://10.0.0.5:25461'] }, [25461]);
  assert.equal(profile.portalId, 'P1');
  assert.deepEqual(profile.portalUrls, ['http://192.168.30.100:25461', 'http://10.0.0.5:25461']);
  assert.deepEqual(IPTV.storage.get('portal').id, 'P1', 'copia global para el modo tienda');
  SS.rememberPortal({ id: 'OTRO', urls: ['http://evil:1'] });
  assert.equal(profile.portalId, 'P1');
  assert.deepEqual(profile.portalUrls, ['http://192.168.30.100:25461', 'http://10.0.0.5:25461']);
  assert.equal(SS.expectedPortalId(), 'P1');
  const ids = SS.identityOf(profile);
  assert.equal(ids.id, 'P1');
  assert.ok(ids.urls.includes('http://10.0.0.5:25461'));
});

test('session: aplica la dirección nueva a la fuente, al portal y al perfil', async () => {
  const profile = { id: 'p1', type: 'xtream', auto: false, server: 'http://vieja:25461', username: 'u', password: 'p', portalId: 'P', portalUrls: ['http://nueva:25461'] };
  const IPTV = sessionEnv({}, profile, { 'http://nueva:25461': { status: 'portal', id: 'P', clientPorts: [25461] } });
  IPTV.storage.saveProfile(profile);
  const src = IPTV.createSource(profile);
  IPTV.app.source = src;
  IPTV.portal.server = 'http://vieja:25461';
  global.IPTV.ui = { toast: (m) => { global.lastToast = m; } };
  const moved = await new Promise((r) => IPTV.session.connectionLost({ canRelocate: true, kind: 'network' }, 'http://vieja:25461', r));
  assert.equal(moved, true);
  assert.equal(profile.server, 'http://nueva:25461');
  assert.equal(src.server, 'http://nueva:25461');
  assert.equal(src.urlFor({ type: 'live', id: '5' }).indexOf('http://nueva:25461/live/'), 0);
  assert.equal(src.urlFor({ type: 'live', id: '5' }).indexOf('did='), -1, 'sin portal propio: URL estándar');
  IPTV.portal.enabled = true;
  IPTV.device.id = 'TV-1';
  assert.equal(src.urlFor({ type: 'episode', id: '7', ext: 'mkv' }), 'http://nueva:25461/series/u/p/7.mkv?did=TV-1', 'con el portal: ID del equipo');
  IPTV.portal.enabled = false;
  const ch = { type: 'live', id: '9' };
  const firstExt = IPTV.util.urlExt(src.urlFor(ch));
  const other = firstExt === 'ts' ? 'm3u8' : 'ts';
  src.rememberFormat(ch, other);
  assert.equal(IPTV.util.urlExt(src.urlFor(ch)), other, 'recuerda el formato que funcionó en ese canal');
  assert.equal(IPTV.util.urlExt(src.urlFor({ type: 'live', id: '10' })), firstExt, 'los demás canales no cambian');
  src.rememberFormat({ type: 'movie', id: '9' }, 'mp4');
  assert.equal(IPTV.util.urlExt(src.urlFor(ch)), other);
  assert.equal(IPTV.portal.server, 'http://nueva:25461');
  assert.equal(global.lastToast, 'Servidor encontrado en la nueva dirección');
  assert.equal(IPTV.storage.getProfile('p1').server, 'http://nueva:25461');
  const again = await new Promise((r) => IPTV.session.connectionLost({ canRelocate: true }, 'http://vieja:25461', r));
  assert.equal(again, true, 'otra petición con la dirección vieja se repite sin buscar');
  const notRelocatable = await new Promise((r) => IPTV.session.connectionLost({ canRelocate: false }, 'http://nueva:25461', r));
  assert.equal(notRelocatable, false);
  delete global.lastToast;
});

test('session: elige el servidor del operador; serverUrls es de confianza y el resto exige el id', async () => {
  const cfg = { allowCustomServer: false, serverUrls: ['http://192.168.30.100:25461', 'http://200.1.1.1:25461'] };
  const pings = {
    'http://192.168.30.100:25461': { status: 'unreachable' },
    'http://200.1.1.1:25461': { status: 'portal', id: 'REINSTALADO' },
    'http://10.0.0.9:25461': { status: 'portal', id: 'OTRO' },
  };
  const IPTV = sessionEnv(cfg, null, pings);
  IPTV.storage.set('portal', { id: 'P1', url: 'http://10.0.0.9:25461', urls: ['http://10.0.0.9:25461'] });
  const cands = IPTV.session.storeCandidates();
  assert.deepEqual(cands, [
    { url: 'http://10.0.0.9:25461', trusted: false },
    { url: 'http://192.168.30.100:25461', trusted: true },
    { url: 'http://200.1.1.1:25461', trusted: true },
  ]);
  const hit = await new Promise((r) => IPTV.session.pingFirst(cands, 'P1', r));
  assert.equal(hit.url, 'http://200.1.1.1:25461', 'la guardada con otro id se descarta; la del operador se acepta');
  assert.equal(hit.trusted, true);

  const panel = sessionEnv(cfg, null, {
    'http://192.168.30.100:25461': { status: 'panelPort', suggestedPort: 25462 },
    'http://192.168.30.100:25462': { status: 'portal', id: 'P1' },
  });
  const viaPanel = await new Promise((r) => panel.session.pingFirst(['http://192.168.30.100:25461'], 'P1', r));
  assert.equal(viaPanel.url, 'http://192.168.30.100:25462');
});

test('session: coincidencia con serverUrls para portales encontrados sin id conocido', () => {
  const IPTV = sessionEnv({ allowCustomServer: false, serverUrls: ['http://192.168.30.100:25461', 'http://tv.operador.co:25461'] });
  const M = IPTV.session.matchesOperatorUrls;
  assert.equal(M({ url: 'http://192.168.30.100:8080' }), true, 'mismo equipo');
  assert.equal(M({ url: 'http://10.1.1.1:25461', publicUrl: 'http://tv.operador.co:25461' }), true, 'misma URL pública');
  assert.equal(M({ url: 'http://192.168.1.50:25461' }), false, 'otro portal de la red de la casa');
});

/* ======================= source: inicio de sesión con varias direcciones ======================= */
function xtreamEnv(config, responses) {
  const IPTV = load(CORE, { config });
  IPTV.app = { profile: null };
  const calls = [];
  IPTV.http.getJSON = (url, cb, timeout, extra) => {
    calls.push({ url, identity: extra && extra.identity });
    const base = url.split('/player_api.php')[0];
    const r = responses[base] || { err: { kind: 'network', status: 0, canRelocate: true, message: 'sin conexión' }, delay: 5 };
    setTimeout(() => cb(r.err || null, r.data || null), r.delay || 1);
    return { abort() {} };
  };
  return { IPTV, calls };
}

const ACTIVE = { user_info: { auth: 1, status: 'Active' }, server_info: {} };

test('source: con XtreamUI en la IP local que choca con la casa usa la siguiente dirección', async () => {
  const urls = ['http://192.168.30.100:25461', 'http://200.1.1.1:25461'];
  const { IPTV, calls } = xtreamEnv({ allowCustomServer: false, serverUrls: urls }, {
    'http://192.168.30.100:25461': { data: '<html>router</html>', delay: 2 },
    'http://200.1.1.1:25461': { data: ACTIVE, delay: 5 },
  });
  const profile = { type: 'xtream', auto: true, server: '', username: 'u', password: 'p' };
  const src = IPTV.createSource(profile);
  const [err, auth] = await new Promise((r) => src.connect(null, (e, a) => r([e, a]), IPTV.session.connectCandidates(profile)));
  assert.equal(err, null);
  assert.equal(auth.ok, true);
  assert.equal(src.server, 'http://200.1.1.1:25461');
  assert.equal(profile.server, 'http://200.1.1.1:25461');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.identity), 'con cabeceras del equipo');
});

test('source: prefiere la primera dirección si ambas responden y espera un poco por ella', async () => {
  const urls = ['http://lan:25461', 'http://pub:25461'];
  const { IPTV } = xtreamEnv({}, { 'http://lan:25461': { data: ACTIVE, delay: 40 }, 'http://pub:25461': { data: ACTIVE, delay: 1 } });
  const src = IPTV.createSource({ type: 'xtream', server: '', username: 'u', password: 'p' });
  await new Promise((r) => src.connect(null, r, urls));
  assert.equal(src.server, 'http://lan:25461');

  const slow = xtreamEnv({}, { 'http://lan:25461': { data: ACTIVE, delay: 400 }, 'http://pub:25461': { data: ACTIVE, delay: 1 } });
  slow.IPTV.XtreamSource.PREFER_WAIT = 30;
  const src2 = slow.IPTV.createSource({ type: 'xtream', server: '', username: 'u', password: 'p' });
  const t0 = Date.now();
  await new Promise((r) => src2.connect(null, r, urls));
  assert.equal(src2.server, 'http://pub:25461', 'no espera más de lo necesario');
  assert.ok(Date.now() - t0 < 300);
});

test('source: errores de inicio de sesión (credenciales primero, luego red)', async () => {
  const urls = ['http://lan:25461', 'http://pub:25461'];
  const { IPTV } = xtreamEnv({}, { 'http://pub:25461': { data: { user_info: { auth: 0 } } } });
  const src = IPTV.createSource({ type: 'xtream', server: '', username: 'u', password: 'mala' });
  const err = await new Promise((r) => src.connect(null, (e) => r(e), urls));
  assert.equal(err.code, 'auth');
  const X = IPTV.XtreamSource;
  assert.equal(X.evaluateAuth({ status: 401 }).error.code, 'auth');
  assert.equal(X.evaluateAuth({ status: 404, kind: 'http' }).error.code, 'invalid');
  assert.equal(X.evaluateAuth({ status: 0, kind: 'timeout', canRelocate: true }).error.code, 'network');
  assert.equal(X.evaluateAuth(null, { user_info: { auth: 1, status: 'Expired' } }).ok, true, 'vencida: entra y se muestra el bloqueo');
  assert.equal(X.bestError([{ code: 'network' }, { code: 'invalid' }]).code, 'invalid');
  assert.equal(X.bestError([]).code, 'network');

  const down = xtreamEnv({}, {});
  const src2 = down.IPTV.createSource({ type: 'xtream', server: 'http://solo:25461', username: 'u', password: 'p' });
  const e2 = await new Promise((r) => src2.connect(null, (e) => r(e)));
  assert.equal(e2.code, 'network');
  assert.equal(e2.canRelocate, true);
});

test('source: si responde el puerto del panel usa el puerto de clientes que indica', async () => {
  const panelErr = { err: { kind: 'panelPort', status: 404, clientPort: 25461, canRelocate: true, message: 'panel' } };
  const { IPTV } = xtreamEnv({}, { 'http://h:8080': panelErr, 'http://h:25461': { data: ACTIVE } });
  const profile = { type: 'xtream', server: 'http://h:8080', username: 'u', password: 'p' };
  const src = IPTV.createSource(profile);
  const err = await new Promise((r) => src.connect(null, (e) => r(e)));
  assert.equal(err, null);
  assert.equal(src.server, 'http://h:25461');
  assert.equal(profile.server, 'http://h:25461');
  const multi = xtreamEnv({}, { 'http://h:8080': panelErr, 'http://h:25461': { data: ACTIVE } });
  const src2 = multi.IPTV.createSource({ type: 'xtream', server: '', username: 'u', password: 'p' });
  const urls = ['http://h:8080', 'http://otra:25461'];
  await new Promise((r) => src2.connect(null, r, urls));
  assert.equal(src2.server, 'http://h:25461');
  assert.deepEqual(urls, ['http://h:8080', 'http://otra:25461'], 'no modifica la lista recibida');
});

test('source: una petición que falla con el portal propio se repite con la dirección nueva', async () => {
  const profile = { id: 'p', type: 'xtream', server: 'http://vieja:25461', username: 'u', password: 'p', portalId: 'P', portalUrls: ['http://nueva:25461'] };
  const { IPTV, calls } = xtreamEnv({}, { 'http://nueva:25461': { data: [{ category_id: '1', category_name: 'Noticias' }] } });
  IPTV.app.profile = profile;
  IPTV.lan.ping = (url, cb) => setTimeout(() => cb(url === 'http://nueva:25461' ? { status: 'portal', id: 'P' } : { status: 'unreachable' }), 1);
  const src = IPTV.createSource(profile);
  IPTV.app.source = src;
  const data = await new Promise((r) => src.api({ action: 'get_live_categories' }, (e, d) => r(d)));
  assert.deepEqual(data, [{ category_id: '1', category_name: 'Noticias' }]);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /^http:\/\/nueva:25461\/player_api\.php/);
});

/* ======================= portal ======================= */
test('portal: normaliza /api/client/info y decide el bloqueo', () => {
  const IPTV = load(CORE);
  const P = IPTV.Portal;
  const st = P.normalize({
    server_name: 'Mi IPTV',
    server: { id: 'P', name: 'Mi IPTV', urls: ['http://a:1'] },
    user: { status: 'active' },
    notices: [{ id: 1, title: 'A', level: 'raro', display: 'popup', duration_seconds: '12' }, null, 'x'],
    messages: [{ id: 4, title: 'Pago', kind: 'payment', display: 'popup', read: false }, { id: 5, read: true }],
    notice_settings: { carousel: false, interval_seconds: 2 },
  });
  assert.equal(st.notices.length, 1);
  assert.equal(st.notices[0].level, 'info');
  assert.equal(st.notices[0].duration_seconds, 12);
  assert.deepEqual(st.noticeSettings, { carousel: false, interval: 8 }, 'intervalo mínimo 3 s');
  assert.equal(st.unread, 1);
  assert.equal(st.server.id, 'P');
  assert.deepEqual(P.normalize(null).noticeSettings, { carousel: true, interval: 8 });
  assert.deepEqual(P.normalize({ notice_settings: { interval_seconds: 15 } }).noticeSettings, { carousel: true, interval: 15 });

  const portal = new P();
  assert.equal(portal.blockInfo(), null, 'sin portal no bloquea');
  portal.enabled = true;
  portal.state = st;
  assert.equal(portal.blockInfo(), null);
  assert.deepEqual(portal.popupMessages().map((m) => m.id), [4]);
  const now = Math.floor(Date.now() / 1000);
  portal.state = P.normalize({ user: { status: 'suspended', suspension_reason: 'Falta de pago' } });
  assert.deepEqual(portal.blockInfo(), { kind: 'suspended', title: 'Servicio suspendido', reason: 'Falta de pago' });
  portal.state = P.normalize({ user: { status: 'expired', exp_date: 1767225600 } });
  assert.match(portal.blockInfo().reason, /venció el 1 de enero de 2026|venció el 31 de diciembre de 2025/);
  portal.state = P.normalize({ user: { status: 'active' }, outage: { id: 2, title: 'Mantenimiento', reason: 'Cambio', starts_at: now - 10, ends_at: now + 3600, block_playback: true } });
  assert.equal(portal.blockInfo().kind, 'outage');
  assert.equal(portal.blockInfo().until, now + 3600);
  portal.state = P.normalize({ user: { status: 'active' }, outage: { id: 2, starts_at: now + 600, block_playback: true } });
  assert.equal(portal.blockInfo(), null, 'el corte aún no empieza');
  portal.state = P.normalize({ notices: [{ id: 1, display: 'banner', starts_at: now + 100 }, { id: 2, display: 'banner', ends_at: now - 1 }, { id: 3, display: 'ticker' }, { id: 4 }] });
  assert.deepEqual(portal.activeNotices('banner').map((n) => n.id), [4]);
  assert.deepEqual(portal.activeNotices('ticker').map((n) => n.id), [3]);
  portal.authError = true;
  assert.equal(portal.blockInfo().kind, 'auth');
});

test('portal: latido de reproducción con límite de conexiones', async () => {
  const IPTV = load(CORE);
  IPTV.app = { profile: { type: 'xtream', server: 'http://s' } };
  const bodies = [];
  let limit = false;
  IPTV.http.postJSON = (url, body, cb) => {
    bodies.push([url.replace('http://s', ''), body]);
    setTimeout(() => {
      if (url.endsWith('/playing') && limit) cb({ status: 429, kind: 'http', message: 'Límite de conexiones alcanzado (1)' });
      else if (url.endsWith('/playing')) cb(null, { ok: true, connection_id: 77, interval_seconds: 30 });
      else cb(null, { ok: true });
    }, 1);
  };
  const portal = IPTV.portal;
  portal.enabled = true;
  portal.server = 'http://s';
  portal.user = 'u';
  portal.pass = 'p';
  portal.heartbeat.start('10');
  await tick(10);
  assert.deepEqual(bodies[0], ['/api/client/playing', { username: 'u', password: 'p', stream_id: 10 }]);
  portal.heartbeat.start('10');
  assert.equal(bodies.length, 1, 'el mismo canal no abre otra conexión');
  portal.heartbeat.stop();
  await tick(5);
  assert.deepEqual(bodies[1], ['/api/client/stopped', { username: 'u', password: 'p', connection_id: 77 }]);
  limit = true;
  const limited = new Promise((r) => portal.on('limit', r));
  portal.heartbeat.start(11);
  assert.equal(await limited, 'Límite de conexiones alcanzado (1)');
  assert.equal(portal.heartbeat.active, false);
  portal.heartbeat.start('abc');
  assert.equal(portal.heartbeat.active, false, 'solo ids numéricos');
  portal.heartbeat.stop();
});

/* ======================= keys ======================= */
test('keys: traduce el control remoto de Samsung, LG y el teclado del PC', () => {
  const IPTV = load(['util', 'keys']);
  const K = IPTV.keys;
  const t = (keyCode, extra, editing) => K.translate(Object.assign({ keyCode }, extra || {}), editing);
  IPTV.platform = 'tizen';
  assert.equal(t(10009).action, 'back');
  assert.equal(t(10252).action, 'playpause');
  assert.equal(t(427).action, 'chup');
  assert.equal(t(403).action, 'red');
  assert.equal(t(10182).action, 'exit');
  assert.equal(t(82).action, null, 'letras solo en el navegador');
  assert.deepEqual([t(53).action, t(53).digit], ['digit', 5]);
  IPTV.platform = 'webos';
  assert.equal(t(461).action, 'back');
  assert.equal(t(33).action, 'chup');
  assert.equal(t(1536).pointer, 'show');
  assert.equal(t(1537).pointer, 'hide');
  IPTV.platform = 'browser';
  assert.equal(t(8).action, 'back');
  assert.equal(t(27).action, 'back');
  assert.equal(t(82).action, 'red');
  assert.equal(t(82, { ctrlKey: true }).action, null);
  assert.equal(t(32).action, 'playpause');
  assert.equal(t(190).action, 'ff');
  assert.equal(t(8, {}, true).action, null, 'Retroceso borra al escribir');
  assert.equal(t(53, {}, true).action, null);
  assert.equal(t(13, {}, true).action, 'ok');
  assert.equal(t(40, {}, true).action, 'down');
  /* Eventos sin keyCode: nombre de la tecla */
  assert.equal(K.translate({ keyCode: 0, key: 'ArrowUp' }).action, 'up');
  assert.equal(K.translate({ keyCode: 0, key: 'Enter' }).action, 'ok');
  assert.equal(K.translate({ keyCode: 0, key: 'MediaPlayPause' }).action, 'playpause');
  assert.equal(K.translate({ keyCode: 0, key: 'ColorF1Green' }).action, 'green');
  assert.equal(K.translate({ keyCode: 0, key: 'GoBack' }).action, 'back');
  assert.equal(K.translate({ keyCode: 0, key: 'g' }).action, 'green');
  assert.deepEqual([K.translate({ keyCode: 0, key: '7' }).action, K.translate({ keyCode: 0, key: '7' }).digit], ['digit', 7]);
  assert.equal(K.translate({ keyCode: 0, key: 'r' }, true).action, null, 'al escribir las letras no son acciones');

  const registered = [];
  global.tizen = { tvinputdevice: {
    getSupportedKeys: () => [{ name: 'MediaPlayPause', code: 10252 }, { name: 'ColorF0Red', code: 999 }, { name: 'Exit', code: 10182 }],
    registerKey: (n) => registered.push(n),
  } };
  assert.equal(K.registerKeys(), 2);
  assert.deepEqual(registered, ['MediaPlayPause', 'ColorF0Red'], 'solo las compatibles; nunca Exit');
  IPTV.platform = 'tizen';
  assert.equal(t(999).action, 'red', 'usa el código que informa el televisor');
  delete global.tizen;
});

/* ======================= focus ======================= */
test('focus: elige el vecino correcto en cada dirección', () => {
  global.document = fakeDocument();
  const IPTV = load(['util', 'focus']);
  const F = IPTV.focus;
  const cand = (id, r) => ({ el: id, rect: r });
  const from = rect(100, 100, 100, 50);
  const cands = [
    cand('derecha', rect(220, 100, 100, 50)),
    cand('derecha-lejos', rect(600, 100, 100, 50)),
    cand('derecha-arriba', rect(220, 20, 100, 50)),
    cand('abajo', rect(100, 170, 100, 50)),
    cand('abajo-desplazado', rect(300, 170, 100, 50)),
    cand('arriba', rect(120, 20, 60, 40)),
    cand('izquierda', rect(-10, 110, 80, 30)),
  ];
  assert.equal(F._pick(from, cands, 'right', true), 'derecha');
  assert.equal(F._pick(from, cands, 'down', true), 'abajo');
  assert.equal(F._pick(from, cands, 'up', true), 'arriba');
  assert.equal(F._pick(from, cands, 'left', true), 'izquierda');
  assert.equal(F._pick(from, [cand('solapado', rect(150, 100, 100, 50))], 'right', true), null, 'estricto: no acepta solapados');
  assert.equal(F._pick(from, [cand('solapado', rect(150, 100, 100, 50))], 'right', false), 'solapado');
  delete global.document;
});

test('focus: navegación con capas, grupos y data-nav', () => {
  const doc = fakeDocument();
  global.document = doc;
  const IPTV = load(['util', 'focus']);
  const F = IPTV.focus;
  const mk = (id, r) => { const e = new FakeEl(id, r, ['focusable']); return e; };
  const screen = new FakeEl('screen', rect(0, 0, 1920, 1080));
  const menu = new FakeEl('menu', rect(0, 0, 300, 1080));
  menu.setAttribute('data-focus-group', '');
  const m1 = mk('m1', rect(10, 10, 280, 60));
  const m2 = mk('m2', rect(10, 80, 280, 60));
  menu.append(m1, m2);
  const content = new FakeEl('content', rect(320, 0, 1600, 1080));
  const c1 = mk('c1', rect(340, 10, 200, 200));
  const c2 = mk('c2', rect(560, 10, 200, 200));
  const hidden = mk('oculto', rect(780, 10, 200, 200));
  hidden.classList.add('hidden');
  c2.setAttribute('data-nav-right', 'none');
  content.append(c1, c2, hidden);
  screen.append(menu, content);
  doc.body.append(screen);

  F.pushLayer(screen);
  assert.equal(F.first(), true);
  assert.equal(F.get(), m1);
  F.move('down');
  assert.equal(F.get(), m2);
  F.move('right');
  assert.equal(F.get(), c1);
  F.move('right');
  assert.equal(F.get(), c2);
  F.move('right');
  assert.equal(F.get(), c2, 'data-nav-right="none" bloquea y no salta al oculto');
  F.move('left');
  F.move('left');
  assert.equal(F.get(), m2, 'el grupo recuerda su último elemento');
  let ok = 0;
  m2.__ok = () => { ok++; };
  F.ok();
  assert.equal(ok, 1);
  m2.classList.add('disabled');
  F.ok();
  assert.equal(ok, 1, 'deshabilitado no responde');

  const dialog = new FakeEl('dlg', rect(600, 400, 600, 300));
  const b1 = mk('b1', rect(620, 600, 200, 60));
  dialog.append(b1);
  doc.body.append(dialog);
  F.pushLayer(dialog);
  F.set(b1);
  F.move('left');
  assert.equal(F.get(), b1, 'la capa limita la navegación');
  F.set(c1);
  assert.equal(F.get(), b1, 'la pantalla de abajo no le quita el foco al diálogo');
  F.popLayer(dialog);
  assert.equal(F.get(), c1, 'al cerrar se aplica el foco pedido mientras estaba abierto');
  F.pushLayer(dialog);
  F.set(b1);
  F.popLayer(dialog);
  assert.equal(F.get(), c1, 'al cerrar vuelve el foco anterior');
  delete global.document;
});

/* ======================= compilación ======================= */
test('build: configuración de las variantes tienda y completa', () => {
  const cfg = require('../scripts/lib/appconfig');
  const op = {
    appName: 'IPTV Player',
    serverUrls: ['http://192.168.30.100:25461/', 'http://IP-PUBLICA-O-DOMINIO:25461', '192.168.30.100:25461', 'no válida'],
    allowCustomServer: false, allowM3U: false,
    full: { allowCustomServer: true, allowM3U: true },
    support: { phone: '300 000 0000' },
  };
  const store = cfg.variantConfig(op, { variant: 'store', platform: 'tizen' });
  assert.equal(store.config.allowCustomServer, false);
  assert.equal(store.config.allowM3U, false);
  assert.equal(store.config.distribution, 'tizen');
  assert.deepEqual(store.config.serverUrls, ['http://192.168.30.100:25461']);
  assert.ok(store.warnings.some((w) => /ejemplo/.test(w)));
  assert.ok(store.warnings.some((w) => /no válida/.test(w)));
  const full = cfg.variantConfig(op, { variant: 'full', platform: 'webos' });
  assert.equal(full.config.allowCustomServer, true);
  assert.equal(full.config.allowM3U, true);
  const openStore = cfg.variantConfig(Object.assign({}, op, { allowCustomServer: true }), { variant: 'store', platform: 'webos' });
  assert.equal(openStore.config.allowCustomServer, true, 'un cambio en operator.json abre la compilación de tienda');
  const noUrls = cfg.variantConfig({ allowCustomServer: false }, { variant: 'store', platform: 'webos' });
  assert.ok(noUrls.warnings.some((w) => /serverUrls/.test(w)));
  assert.equal(full.config.build, cfg.buildNumber(cfg.packageInfo().version));

  const js = cfg.configJs(store.config);
  require('acorn').parse(js, { ecmaVersion: 5 });
  const sandbox = {};
  new Function('global', js)(sandbox);
  assert.equal(sandbox.IPTV.config.serverUrls[0], 'http://192.168.30.100:25461');

  assert.deepEqual(cfg.appIds({}, 'store'), { tizenPackage: 'IptvPlayr1', tizenName: 'IPTVPlayer', webos: 'com.iptvplayer.tv', tizenId: 'IptvPlayr1.IPTVPlayer' });
  assert.equal(cfg.appIds({ appId: { webos: 'com.a.b' }, full: { appId: { webos: 'com.a.full' } } }, 'full').webos, 'com.a.full');
  assert.throws(() => cfg.appIds({ appId: { tizenPackage: 'corto' } }, 'store'), /10 letras/);
  assert.throws(() => cfg.appIds({ appId: { webos: 'com.lge.app' } }, 'store'), /no es válido/);
  assert.throws(() => cfg.versionParts('1.2'), /x\.y\.z/);
  assert.throws(() => cfg.versionParts('256.0.0'), /fuera de rango/);
  assert.equal(cfg.isPlaceholderUrl('http://midominio.com'), true);
});

test('build: PNG sin dependencias (lectura, escritura y redimensionado)', () => {
  const png = require('../scripts/lib/png');
  const img = png.createImage(3, 2, [10, 20, 30, 255]);
  img.data.set([255, 0, 0, 128], 4);
  const back = png.decode(png.encode(img));
  assert.equal(back.width, 3);
  assert.deepEqual([...back.data.slice(0, 8)], [10, 20, 30, 255, 255, 0, 0, 128]);
  const rgb = png.decode(png.encode(img, { alpha: false }));
  assert.equal(rgb.data[7], 255, 'sin alfa queda opaco');
  const big = png.resize(png.createImage(10, 10, [200, 100, 50, 255]), 4, 3);
  assert.equal(big.width, 4);
  assert.deepEqual([...big.data.slice(0, 4)], [200, 100, 50, 255]);
  const up = png.resize(png.createImage(2, 2, [0, 0, 255, 255]), 5, 5);
  assert.deepEqual([...up.data.slice(-4)], [0, 0, 255, 255]);
  const icon = png.decode(require('fs').readFileSync(path.join(__dirname, '..', 'assets', 'icons', 'webos', 'icon.png')));
  assert.deepEqual([icon.width, icon.height], [80, 80]);
  assert.equal(png.crc32(Buffer.from('IEND')), 0xae426082);
});

test('build: todo el código de la app es ES5', () => {
  const { checkFile, listJs } = require('../scripts/check-es5');
  const bad = listJs(path.join(__dirname, '..', 'src')).map((f) => [f, checkFile(f)]).filter(([, p]) => p.length);
  assert.deepEqual(bad, []);
});
