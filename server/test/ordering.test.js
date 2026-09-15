// Orden de canales y categorías, y cómo lo reciben las apps.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

let api;
let stop;

before(async () => {
  ({ api, stop } = await startTestServer());
});
after(async () => stop());

describe('orden de canales', () => {
  test('arrastrar, ordenar automático y orden en la API Xtream y M3U', async () => {
    const catA = (await api('POST', '/api/admin/categories', { name: 'Nacionales', type: 'live' })).data;
    const catB = (await api('POST', '/api/admin/categories', { name: 'Deportes', type: 'live' })).data;
    const mk = async (name, category_id) => (await api('POST', '/api/admin/streams', { type: 'live', name, category_id, source_url: `http://o/${encodeURIComponent(name)}.ts` })).data;
    const c10 = await mk('Canal 10', catA.id);
    const c2 = await mk('Canal 2', catA.id);
    const c1 = await mk('Canal 1', catA.id);
    const espn = await mk('ESPN', catB.id);
    const fox = await mk('Fox Sports', catB.id);
    await api('POST', '/api/admin/users', { username: 'orden', password: 'orden123' });
    const liveIds = async () => (await api('GET', '/player_api.php?username=orden&password=orden123&action=get_live_streams', undefined, { auth: false })).data.map((s) => s.stream_id);

    // Automático por número: Canal 1, Canal 2, Canal 10 (no alfabético "1, 10, 2").
    assert.equal((await api('POST', '/api/admin/streams/sort', { type: 'live', category_id: catA.id, mode: 'number' })).data.updated, 3);
    // Manual (arrastrar y soltar) en Deportes: Fox primero.
    assert.equal((await api('POST', '/api/admin/streams/reorder', { ids: [fox.id, espn.id] })).data.updated, 2);
    // Categorías: Deportes antes que Nacionales.
    await api('POST', '/api/admin/categories/reorder', { ids: [catB.id, catA.id] });

    assert.deepEqual(await liveIds(), [fox.id, espn.id, c1.id, c2.id, c10.id]);
    const cats = (await api('GET', '/player_api.php?username=orden&password=orden123&action=get_live_categories', undefined, { auth: false })).data;
    assert.deepEqual(cats.map((c) => c.category_name), ['Deportes', 'Nacionales']);
    const nums = (await api('GET', '/player_api.php?username=orden&password=orden123&action=get_live_streams', undefined, { auth: false })).data.map((s) => s.num);
    assert.deepEqual(nums, [1, 2, 3, 4, 5]);

    const m3u = (await api('GET', '/get.php?username=orden&password=orden123&type=m3u_plus', undefined, { auth: false })).data;
    const names = [...m3u.matchAll(/,([^\n]+)\n/g)].map((m) => m[1]);
    assert.deepEqual(names, ['Fox Sports', 'ESPN', 'Canal 1', 'Canal 2', 'Canal 10']);

    // Alfabético inverso dentro de Nacionales y listado del panel filtrado por categoría.
    await api('POST', '/api/admin/streams/sort', { type: 'live', category_id: catA.id, mode: 'alpha_desc' });
    const panel = (await api('GET', `/api/admin/streams?type=live&category_id=${catA.id}`)).data.data.map((s) => s.name);
    assert.deepEqual(panel, ['Canal 10', 'Canal 2', 'Canal 1']);
    assert.equal((await api('POST', '/api/admin/streams/reorder', { ids: [] })).status, 400);
  });
});
