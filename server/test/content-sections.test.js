// Qué secciones ve cada cliente (canales, películas, series): automático por paquetes o marcadas a mano.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

let ctx;
let live;
let movie;
let onlyLive;
let full;
before(async () => {
  ctx = await startTestServer();
  const { api } = ctx;
  live = (await api('POST', '/api/admin/streams', { type: 'live', name: 'zz-canal', source_url: 'http://origen.test/c.ts' })).data;
  movie = (await api('POST', '/api/admin/streams', {
    type: 'movie', name: 'zz-peli', source_url: 'http://origen.test/p.mp4', container_extension: 'mp4',
  })).data;
  const series = (await api('POST', '/api/admin/series', { name: 'zz-serie' })).data;
  await api('POST', `/api/admin/series/${series.id}/episodes`, { season: 1, episode_num: 1, name: 'E1', source_url: 'http://origen.test/e1.mp4' });
  onlyLive = (await api('POST', '/api/admin/packages', { name: 'zz-solo-tv', stream_ids: [live.id] })).data;
  full = (await api('POST', '/api/admin/packages', { name: 'zz-todo', stream_ids: [live.id, movie.id], series_ids: [series.id] })).data;
});
after(async () => ctx.stop());

const q = (u) => `username=${u.username}&password=${u.password}`;
const xtream = async (u, action, extra = '') => (await ctx.api('GET', `/player_api.php?${q(u)}&action=${action}${extra}`, undefined, { auth: false })).data;
const info = async (u) => (await ctx.api('GET', `/api/client/info?${q(u)}`, undefined, { auth: false })).data;
const status = async (path) => (await ctx.api('GET', path, undefined, { auth: false, raw: true })).status;

describe('secciones de cada cliente', () => {
  test('automático: según sus paquetes; solo canales abre en el último canal', async () => {
    const tv = (await ctx.api('POST', '/api/admin/users', { username: 'zz-tv', password: 'clave1234', package_ids: [onlyLive.id] })).data;
    assert.deepEqual(tv.content_sections, [], 'sin marcar = automático');
    assert.deepEqual((await info(tv)).content, { sections: ['live'], mode: 'auto', start: 'last_channel' });

    const all = (await ctx.api('POST', '/api/admin/users', { username: 'zz-todo', password: 'clave1234', package_ids: [full.id] })).data;
    assert.deepEqual((await info(all)).content, { sections: ['live', 'movies', 'series'], mode: 'auto', start: 'menu' });

    // Sin paquetes y "ver todo sin paquete": lo que tenga el portal
    const free = (await ctx.api('POST', '/api/admin/users', { username: 'zz-libre', password: 'clave1234' })).data;
    assert.deepEqual((await info(free)).content.sections, ['live', 'movies', 'series']);
  });

  test('a mano: solo lo marcado existe para el cliente', async () => {
    const u = (await ctx.api('POST', '/api/admin/users', {
      username: 'zz-pelis', password: 'clave1234', package_ids: [full.id], content_sections: ['movies'],
    })).data;
    assert.deepEqual(u.content_sections, ['movies']);
    assert.deepEqual((await info(u)).content, { sections: ['movies'], mode: 'manual', start: 'menu' });

    // API Xtream: lo no marcado sale vacío
    assert.deepEqual(await xtream(u, 'get_live_categories'), []);
    assert.deepEqual(await xtream(u, 'get_live_streams'), []);
    assert.deepEqual(await xtream(u, 'get_short_epg', `&stream_id=${live.id}`), { epg_listings: [] });
    assert.deepEqual(await xtream(u, 'get_series'), []);
    assert.deepEqual(await xtream(u, 'get_series_info', '&series_id=1'), { seasons: [], info: [], episodes: [] });
    assert.equal((await xtream(u, 'get_vod_streams')).length, 1);

    // Reproducción: lo no marcado responde igual que si no existiera
    assert.equal(await status(`/live/${u.username}/${u.password}/${live.id}.ts`), 404);
    const hidden = await ctx.api('GET', `/live/${u.username}/${u.password}/${live.id}.ts`, undefined, { auth: false, raw: true });
    assert.equal(await hidden.text(), 'Contenido no encontrado');
    assert.equal(await status(`/movie/${u.username}/${u.password}/${movie.id}.mp4`), 302);
    const beat = await ctx.api('POST', '/api/client/playing', { username: u.username, password: u.password, stream_id: live.id }, { auth: false });
    assert.equal(beat.status, 404);

    // Lista M3U y guía
    const m3u = await (await ctx.api('GET', `/get.php?${q(u)}&type=m3u_plus`, undefined, { auth: false, raw: true })).text();
    assert.ok(!m3u.includes('/live/') && !m3u.includes('/series/') && m3u.includes('/movie/'));
    assert.ok(!m3u.includes('url-tvg'), 'sin canales no anuncia la guía');
    const guide = await (await ctx.api('GET', `/xmltv.php?${q(u)}`, undefined, { auth: false, raw: true })).text();
    assert.match(guide, /<tv><\/tv>/);

    // Marcar canales también
    const both = (await ctx.api('PUT', `/api/admin/users/${u.id}`, { content_sections: ['series', 'live'] })).data;
    assert.deepEqual(both.content_sections, ['live', 'series'], 'orden fijo');
    assert.equal((await xtream(u, 'get_live_streams')).length, 1);
    assert.deepEqual(await xtream(u, 'get_vod_streams'), []);
    assert.deepEqual((await info(u)).content, { sections: ['live', 'series'], mode: 'manual', start: 'menu' });

    // Solo canales marcado a mano: abre en el último canal
    await ctx.api('PUT', `/api/admin/users/${u.id}`, { content_sections: ['live'] });
    assert.equal((await info(u)).content.start, 'last_channel');

    // Desmarcar todo = automático
    const auto = (await ctx.api('PUT', `/api/admin/users/${u.id}`, { content_sections: [] })).data;
    assert.deepEqual(auto.content_sections, []);
    assert.equal((await info(u)).content.mode, 'auto');
    assert.equal((await ctx.api('PUT', `/api/admin/users/${u.id}`, { content_sections: ['radio'] })).status, 400);
  });

  test('cambio masivo', async () => {
    const a = (await ctx.api('POST', '/api/admin/users', { username: 'zz-lote-1', password: 'clave1234' })).data;
    const b = (await ctx.api('POST', '/api/admin/users', { username: 'zz-lote-2', password: 'clave1234' })).data;
    const r = await ctx.api('POST', '/api/admin/users/bulk', { action: 'set_content', ids: [a.id, b.id], content_sections: ['live'] });
    assert.equal(r.data.affected, 2);
    assert.deepEqual((await ctx.api('GET', `/api/admin/users/${b.id}`)).data.content_sections, ['live']);
    assert.deepEqual(await xtream(a, 'get_vod_streams'), []);
    await ctx.api('POST', '/api/admin/users/bulk', { action: 'set_content', ids: [a.id], content_sections: [] });
    assert.deepEqual((await ctx.api('GET', `/api/admin/users/${a.id}`)).data.content_sections, []);
    assert.equal((await ctx.api('POST', '/api/admin/users/bulk', { action: 'set_content', ids: [a.id], content_sections: ['x'] })).status, 400);
  });
});
