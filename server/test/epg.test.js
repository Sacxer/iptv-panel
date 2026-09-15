// EPG: fuentes XMLTV (plana y .gz), emparejamiento automático, asignación manual y guía combinada.
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

let api;
let stop;
let epgServer;
let epgBase;

const pad = (n) => String(n).padStart(2, '0');
const xt = (ts) => {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`;
};
const NOW = Math.floor(Date.now() / 1000);
const H = 3600;
const guideA = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="prueba">
  <channel id="AE.co"><display-name lang="es">A&amp;E</display-name><icon src="http://logos/ae.png"/></channel>
  <channel id="CanalRCN.co"><display-name>Canal RCN HD</display-name></channel>
  <channel id="DiscoveryChannel.us"><display-name>Discovery Channel</display-name></channel>
  <channel id="DiscoveryChannel.co"><display-name>Discovery Channel Colombia</display-name></channel>
  <channel id="ESPN3.co"><display-name>ESPN 3</display-name></channel>
  <channel id="CaracolTV.co"><display-name>Caracol Televisión</display-name></channel>
  <programme start="${xt(NOW - H)}" stop="${xt(NOW + H)}" channel="AE.co"><title lang="es">Programa AE</title><desc lang="es">Serie de &amp; acción</desc></programme>
  <programme start="${xt(NOW + H)}" stop="${xt(NOW + 2 * H)}" channel="AE.co"><title lang="es">Después de AE</title></programme>
  <programme start="${xt(NOW - 30 * H)}" stop="${xt(NOW - 29 * H)}" channel="AE.co"><title>Muy viejo</title></programme>
  <programme start="${xt(NOW)}" stop="${xt(NOW + H)}" channel="ESPN3.co"><title>Fútbol</title></programme>
  <programme start="${xt(NOW)}" stop="${xt(NOW + H)}" channel="CanalRCN.co"><title>Noticias RCN</title></programme>
</tv>`;
const guideB = `<?xml version="1.0"?><tv><channel id="AE.co"><display-name>A&amp;E duplicado</display-name></channel>
<programme start="${xt(NOW)}" stop="${xt(NOW + H)}" channel="AE.co"><title>No debe salir (otra fuente)</title></programme></tv>`;

before(async () => {
  ({ api, stop } = await startTestServer());
  epgServer = http.createServer((req, res) => {
    if (req.url === '/a.xml.gz') {
      res.writeHead(200, { 'Content-Type': 'application/gzip' });
      return res.end(zlib.gzipSync(guideA));
    }
    if (req.url === '/b.xml') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(guideB);
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<html>no es una guía</html>'.repeat(300));
  }).listen(0);
  await new Promise((r) => epgServer.once('listening', r));
  epgBase = `http://127.0.0.1:${epgServer.address().port}`;
});
after(async () => {
  epgServer.close();
  await stop();
});

describe('EPG automático', () => {
  test('cargar guías, emparejar canales, asignar a mano y generar la guía combinada', async () => {
    const mk = async (name, extra = {}) => (await api('POST', '/api/admin/streams', { type: 'live', name, source_url: `http://o/${encodeURIComponent(name)}.ts`, ...extra })).data;
    const ae = await mk('A&E HD');
    const rcn = await mk('CO: Canal RCN');
    const disc = await mk('Discovery Channel FHD');
    const espn2 = await mk('ESPN 2');
    const caracol = await mk('Caracol TV HD');
    const nada = await mk('Canal Inventado XYZ');
    const manual = await mk('ESPN 3', { epg_channel_id: 'mi.id.propio' });

    await api('PUT', '/api/admin/settings', { epg_country: 'co' });
    const bad = (await api('POST', '/api/admin/epg/sources?wait=true', { name: 'Mala', url: `${epgBase}/nada` })).data;
    assert.equal(bad.status, 'error');
    assert.match(bad.last_error, /XMLTV/);
    const errRefresh = await api('POST', `/api/admin/epg/sources/${bad.id}/refresh?wait=true`);
    assert.equal(errRefresh.status, 502);
    await api('DELETE', `/api/admin/epg/sources/${bad.id}`);

    const a = (await api('POST', '/api/admin/epg/sources?wait=true', { name: 'Guía A', url: `${epgBase}/a.xml.gz`, priority: 0 })).data;
    assert.equal(a.status, 'ok');
    assert.deepEqual([a.channel_count, a.programme_count], [6, 5]);
    assert.equal(a.outdated, false);
    assert.equal(a.current_programmes, 3, 'AE, ESPN 3 y RCN en emisión');
    assert.ok(a.last_programme_at > Math.floor(Date.now() / 1000));
    await api('POST', '/api/admin/epg/sources?wait=true', { name: 'Guía B', url: `${epgBase}/b.xml`, priority: 1 });
    assert.equal((await api('GET', '/api/admin/epg/channels?search=rcn')).data.total, 1);

    const dry = (await api('POST', '/api/admin/epg/match', { dry_run: true })).data;
    const byName = Object.fromEntries(dry.results.map((r) => [r.name, r]));
    assert.equal(byName['A&E HD'].match.xmltv_id, 'AE.co');
    assert.equal(byName['A&E HD'].action, 'assign');
    assert.equal(byName['CO: Canal RCN'].match.xmltv_id, 'CanalRCN.co');
    assert.equal(byName['Discovery Channel FHD'].match.xmltv_id, 'DiscoveryChannel.co', 'país preferido co');
    assert.equal(byName['Caracol TV HD'].match.xmltv_id, 'CaracolTV.co', 'televisión = tv');
    assert.notEqual(byName['ESPN 2'].action, 'assign', 'ESPN 2 no es ESPN 3');
    assert.equal(byName['Canal Inventado XYZ'].action, 'none');
    assert.ok(!byName['ESPN 3'], 'los que ya tienen EPG asignado a mano no se tocan');
    assert.equal((await api('GET', `/api/admin/streams/${ae.id}`)).data.epg_channel_id, '', 'la simulación no cambia nada');

    const applied = (await api('POST', '/api/admin/epg/match', {})).data;
    assert.ok(applied.assigned >= 4);
    const aeNow = (await api('GET', `/api/admin/streams/${ae.id}`)).data;
    assert.equal(aeNow.epg_channel_id, 'AE.co');
    assert.equal(aeNow.logo, 'http://logos/ae.png', 'logo tomado de la guía');
    assert.ok(aeNow.epg_match_score >= 85);
    assert.equal((await api('GET', `/api/admin/streams/${manual.id}`)).data.epg_locked, true);

    // Asignación manual: queda bloqueada y el emparejamiento automático ya no la cambia.
    await api('POST', '/api/admin/epg/assign', { stream_id: espn2.id, xmltv_id: 'ESPN3.co' });
    await api('POST', '/api/admin/epg/match', { only_missing: false });
    assert.equal((await api('GET', `/api/admin/streams/${espn2.id}`)).data.epg_channel_id, 'ESPN3.co');

    const status = (await api('GET', '/api/admin/epg/status')).data;
    assert.equal(status.sources.length, 2);
    assert.ok(status.streams.with_epg >= 5);

    // Guía combinada: solo canales usados y programación de la fuente con más prioridad.
    const guide = (await api('POST', '/api/admin/epg/guide/build?wait=true')).data;
    assert.ok(guide.channels >= 3);
    await api('POST', '/api/admin/users', { username: 'epguser', password: 'epg12345' });
    // La lista M3U anuncia la guía para que los reproductores la carguen solos.
    const m3u = await api('GET', '/get.php?username=epguser&password=epg12345&type=m3u_plus&output=ts', undefined, { auth: false });
    const header = m3u.data.split('\n')[0];
    assert.match(header, /^#EXTM3U url-tvg="http:\/\/127\.0\.0\.1:\d+\/xmltv\.php\?username=epguser&password=epg12345" x-tvg-url="/);
    assert.match(m3u.data, /tvg-id="AE\.co"/);
    const res = await api('GET', '/xmltv.php?username=epguser&password=epg12345', undefined, { auth: false });
    assert.equal(res.status, 200);
    assert.match(res.data, /<channel id="AE.co">/);
    assert.match(res.data, /Programa AE/);
    assert.match(res.data, /Noticias RCN/);
    assert.ok(!/No debe salir/.test(res.data), 'programación de la fuente con menos prioridad descartada');
    assert.ok(!/DiscoveryChannel\.us/.test(res.data), 'canales no usados fuera de la guía');
    // "Ahora / siguiente" en la API Xtream (títulos en base64 como Xtream Codes).
    const shortEpg = (await api('GET', `/player_api.php?username=epguser&password=epg12345&action=get_short_epg&stream_id=${ae.id}&limit=2`, undefined, { auth: false })).data;
    const titles = shortEpg.epg_listings.map((e) => Buffer.from(e.title, 'base64').toString('utf8'));
    assert.deepEqual(titles, ['Programa AE', 'Después de AE']);
    assert.equal(Buffer.from(shortEpg.epg_listings[0].description, 'base64').toString('utf8'), 'Serie de & acción');
    assert.equal(shortEpg.epg_listings[0].channel_id, 'AE.co');
    assert.match(shortEpg.epg_listings[0].start, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const table = (await api('GET', `/player_api.php?username=epguser&password=epg12345&action=get_simple_data_table&stream_id=${ae.id}`, undefined, { auth: false })).data;
    assert.equal(table.epg_listings.filter((e) => e.now_playing === 1).length, 1);
    assert.ok(!table.epg_listings.some((e) => Buffer.from(e.title, 'base64').toString('utf8') === 'Muy viejo'), 'fuera de la ventana guardada');
    const noEpg = (await api('GET', `/player_api.php?username=epguser&password=epg12345&action=get_short_epg&stream_id=${nada.id}`, undefined, { auth: false })).data;
    assert.deepEqual(noEpg, { epg_listings: [] });
    assert.equal(nada.epg_channel_id, '');
    assert.ok(disc && caracol && rcn);
  });
});
