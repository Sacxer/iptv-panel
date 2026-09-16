// Dispositivos sin repetir: firmas genéricas, actualizaciones de app, app propia, duplicados existentes y limpieza.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

let api;
let db;
let stop;

before(async () => {
  ({ api, db, stop } = await startTestServer());
});
after(async () => stop());

const TVBOX = 'Dalvik/2.1.0 (Linux; U; Android 9; X96Max_Plus2 Build/PPR1.180610.011)';
const PHONE = 'Dalvik/2.1.0 (Linux; U; Android 13; SM-A536E Build/TP1A.220624.014)';

async function devicesOf(userId) {
  return (await api('GET', `/api/admin/devices?user_id=${userId}`)).data.data;
}

describe('dispositivos sin duplicados', () => {
  test('la API con la firma de la app y la reproducción con la del reproductor son un solo TV Box', async () => {
    const u = (await api('POST', '/api/admin/users', { username: 'casa1', password: 'casa1234' })).data;
    await api('GET', '/player_api.php?username=casa1&password=casa1234', undefined, { headers: { 'User-Agent': 'IPTVSmartersPlayer' } });
    await api('GET', '/get.php?username=casa1&password=casa1234', undefined, { headers: { 'User-Agent': 'okhttp/4.9.0' } });
    await api('GET', `/player_api.php?username=casa1&password=casa1234`, undefined, { headers: { 'User-Agent': TVBOX } });
    await api('GET', '/player_api.php?username=casa1&password=casa1234', undefined, { headers: { 'User-Agent': 'IPTVSmartersPlayer' } });
    const list = await devicesOf(u.id);
    assert.equal(list.length, 1, JSON.stringify(list.map((d) => [d.type, d.model, d.user_agent])));
    assert.equal(list[0].type, 'tvbox');
    assert.equal(list[0].model, 'X96Max_Plus2');
  });

  test('actualizar la app no crea otro equipo; un celular distinto en la misma red sí', async () => {
    const u = (await api('POST', '/api/admin/users', { username: 'casa2', password: 'casa1234', max_connections: 3 })).data;
    await api('GET', '/player_api.php?username=casa2&password=casa1234', undefined, { headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20' } });
    await api('GET', '/player_api.php?username=casa2&password=casa1234', undefined, { headers: { 'User-Agent': 'VLC/3.0.21 LibVLC/3.0.21' } });
    assert.equal((await devicesOf(u.id)).length, 1, 'VLC 3.0.20 y 3.0.21 son el mismo');
    await api('GET', '/player_api.php?username=casa2&password=casa1234', undefined, { headers: { 'User-Agent': PHONE } });
    await api('GET', '/player_api.php?username=casa2&password=casa1234', undefined, { headers: { 'User-Agent': TVBOX } });
    const list = await devicesOf(u.id);
    const types = list.map((d) => d.type).sort();
    assert.deepEqual(types, ['mobile', 'tvbox'], JSON.stringify(list.map((d) => [d.type, d.model, d.app])));
  });

  test('la app propia (X-Device-Id) y su reproductor sin cabeceras son el mismo equipo', async () => {
    const u = (await api('POST', '/api/admin/users', { username: 'casa3', password: 'casa1234' })).data;
    const appHeaders = { 'User-Agent': 'okhttp/4.12', 'X-Device-Id': 'APP-XYZ', 'X-Device-Type': 'tvbox', 'X-App-Name': 'IPTV Player' };
    await api('GET', '/api/client/info?username=casa3&password=casa1234', undefined, { headers: appHeaders });
    await api('GET', '/player_api.php?username=casa3&password=casa1234', undefined, { headers: { 'User-Agent': 'Lavf/60.3.100' } });
    // Un segundo equipo con la app propia nunca se une al primero.
    await api('GET', '/api/client/info?username=casa3&password=casa1234', undefined, { headers: { ...appHeaders, 'X-Device-Id': 'APP-OTRO' } });
    const list = await devicesOf(u.id);
    assert.equal(list.length, 2);
    assert.ok(list.some((d) => d.device_id === 'APP-XYZ'));
  });

  test('app de televisor: el vídeo con ?did= es el mismo equipo y el latido acepta episodios', async () => {
    const u = (await api('POST', '/api/admin/users', { username: 'casa-tv', password: 'casa1234' })).data;
    const tvHeaders = {
      'User-Agent': 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36',
      'X-Device-Id': 'TV-ABC', 'X-Device-Type': 'smart_tv', 'X-Device-Brand': 'Samsung', 'X-Device-Model': 'UN50TU7000',
      'X-App-Name': 'IPTV Player', 'X-App-Version': '1.0.0', 'X-App-Build': '1', 'X-App-Distribution': 'tizen',
    };
    await api('GET', '/api/client/info?username=casa-tv&password=casa1234', undefined, { headers: tvHeaders });
    // El reproductor no envía cabeceras propias y su User-Agent parece de PC (navegador de escritorio).
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
    await api('GET', '/live/casa-tv/casa1234/999999.ts?did=TV-ABC', undefined, { headers: { 'User-Agent': chrome }, raw: true });
    const list = await devicesOf(u.id);
    assert.equal(list.length, 1, JSON.stringify(list.map((d) => [d.type, d.device_id, d.user_agent])));
    assert.equal(list[0].type, 'smart_tv', 'el User-Agent del reproductor no cambia el tipo');
    assert.equal(list[0].model, 'UN50TU7000');
    assert.equal(list[0].last_activity, 'stream');
    assert.equal(list[0].app_version, '1.0.0');
    assert.equal(list[0].app_build, 1);
    assert.equal(list[0].app_distribution, 'tizen');
    const detail = (await api('GET', `/api/admin/devices/${list[0].id}`)).data;
    assert.equal(detail.app_distribution, 'tizen');

    const series = (await api('POST', '/api/admin/series', { name: 'zz-serie-tv' })).data;
    const ep = (await api('POST', `/api/admin/series/${series.id}/episodes`, {
      season: 1, episode_num: 1, name: 'Capítulo 1', source_url: 'http://127.0.0.1:9/ep1.mp4',
    })).data;
    const beat = await api('POST', '/api/client/playing', { username: 'casa-tv', password: 'casa1234', stream_id: ep.id }, { auth: false, headers: tvHeaders });
    assert.equal(beat.status, 200, JSON.stringify(beat.data));
    const conn = await db('connections').where({ id: beat.data.connection_id }).first();
    assert.equal(conn.stream_type, 'episode');
    await api('POST', '/api/client/stopped', { username: 'casa-tv', password: 'casa1234', connection_id: beat.data.connection_id }, { auth: false });
  });

  test('seleccionar todos por filtro y acciones en lote', async () => {
    const t = Math.floor(Date.now() / 1000);
    const rows = Array.from({ length: 7 }, (_, i) => ({
      uid: `ua:lote:${i}`, name: `lote-${i}`, type: i < 5 ? 'tvbox' : 'mobile', ownership: 'unknown', inventory_status: 'assigned',
      source: 'auto', last_ip: '10.9.9.9', user_agent: `Lote/${i}`, first_seen_at: t, last_seen_at: t, created_at: t, updated_at: t,
    }));
    await db('devices').insert(rows);
    const all = (await api('GET', '/api/admin/devices/ids?search=lote-&type=tvbox')).data;
    assert.equal(all.total, 5);
    assert.equal(all.ids.length, 5);
    const page = (await api('GET', '/api/admin/devices?search=lote-&type=tvbox&limit=2')).data;
    assert.equal(page.data.length, 2);
    assert.equal(page.total, 5);

    const own = (await api('POST', '/api/admin/devices/bulk', { action: 'set_ownership', value: 'company', filter: { search: 'lote-', type: 'tvbox' } })).data;
    assert.equal(own.affected, 5);
    assert.equal((await api('GET', '/api/admin/devices?search=lote-&ownership=company')).data.total, 5);
    assert.equal((await api('POST', '/api/admin/devices/bulk', { action: 'set_ownership', value: 'otro', ids: all.ids })).status, 400);
    const retire = (await api('POST', '/api/admin/devices/bulk', { action: 'set_inventory', value: 'retired', ids: all.ids.slice(0, 2) })).data;
    assert.equal(retire.affected, 2);
    const del = (await api('POST', '/api/admin/devices/bulk', { action: 'delete', filter: { search: 'lote-' } })).data;
    assert.equal(del.affected, 7);
    assert.equal((await api('GET', '/api/admin/devices/ids?search=lote-')).data.total, 0);
  });

  test('detectar y fusionar duplicados existentes, y limpiar equipos de clientes borrados', async () => {
    const u = (await api('POST', '/api/admin/users', { username: 'viejo', password: 'viejo123' })).data;
    const t = Math.floor(Date.now() / 1000);
    const base = { type: 'pc', app: 'VLC', ownership: 'client', inventory_status: 'assigned', source: 'auto', user_id: u.id, last_user_id: u.id, last_ip: '10.0.0.5', created_at: t, updated_at: t };
    const [a] = await db('devices').insert({ ...base, uid: 'ua:legacy:1', user_agent: 'VLC/3.0.18 LibVLC/3.0.18', first_seen_at: t - 900, last_seen_at: t - 800 }).returning('id');
    const [b] = await db('devices').insert({ ...base, uid: 'ua:legacy:2', user_agent: 'VLC/3.0.21 LibVLC/3.0.21', first_seen_at: t - 100, last_seen_at: t - 50 }).returning('id');
    const idA = a.id ?? a;
    const idB = b.id ?? b;
    await db('device_alerts').insert({ device_id: idA, user_id: u.id, type: 'inactive', message: 'x', status: 'open', created_at: t });

    const dup = (await api('GET', '/api/admin/devices/duplicates')).data;
    const group = dup.groups.find((g) => g.device_ids.includes(idA));
    assert.ok(group && group.device_ids.includes(idB), JSON.stringify(dup.groups));
    const dedupe = (await api('POST', '/api/admin/devices/dedupe')).data;
    assert.ok(dedupe.merged >= 1);
    const list = await devicesOf(u.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].first_seen_at, t - 900, 'conserva la primera vez visto');
    assert.equal((await api('GET', `/api/admin/devices/alerts?device_id=${list[0].id}&status=all`)).data.total, 1, 'mueve las alertas');
    // La firma del registro borrado queda como alias: una conexión con esa firma exacta no lo vuelve a crear.
    assert.equal((await db('device_aliases').where({ device_id: list[0].id })).length >= 1, true);

    // Borrar el cliente borra sus equipos detectados, pero no un TV Box de la empresa asignado a él.
    const company = (await api('POST', '/api/admin/devices', { name: 'Box empresa', model: 'X96 Mini', ownership: 'company', user_id: u.id })).data;
    await api('DELETE', `/api/admin/users/${u.id}`);
    assert.equal((await db('devices').where({ id: list[0].id }).first()), undefined);
    const kept = (await api('GET', `/api/admin/devices/${company.id}`)).data;
    assert.equal(kept.user_id, null);
    assert.equal(kept.name, 'Box empresa');

    // Huérfanos antiguos (de antes de este cambio) se pueden limpiar.
    await db('devices').insert({ ...base, uid: 'ua:huerfano', user_agent: 'TestPlayer', user_id: null, last_user_id: null, first_seen_at: t, last_seen_at: t });
    const dry = (await api('POST', '/api/admin/devices/cleanup-orphans', { dry_run: true })).data;
    assert.equal(dry.orphans, 1);
    assert.equal((await api('POST', '/api/admin/devices/cleanup-orphans', {})).data.deleted, 1);
  });
});
