// Contenido de demostración para la revisión de las tiendas: se carga una vez, se puede rehacer y no toca portales con clientes.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

let ctx;
before(async () => { ctx = await startTestServer(); });
after(async () => ctx.stop());

const quiet = () => {};

describe('contenido de demostración para las tiendas', () => {
  test('carga canales por el nodo local, películas, serie y cuentas de prueba', async () => {
    const { ensureLocalNode } = await import('../scripts/local-node.js');
    const { loadDemo, CHANNELS, MOVIES } = await import('../scripts/demo-revision.js');
    const { row: node } = await ensureLocalNode();
    const first = await loadDemo({ panelUrl: ctx.base, medios: 'http://203.0.113.9/', log: quiet });
    assert.equal(first.reused, false);
    assert.deepEqual(first.accounts.map((a) => a.username), ['lgqa1', 'lgqa2']);
    assert.ok(first.accounts.every((a) => /^[A-Za-z0-9]{10}$/.test(a.password)));

    const live = (await ctx.api('GET', '/api/admin/streams?type=live&limit=100')).data.data;
    assert.equal(live.length, CHANNELS.length);
    assert.ok(live.every((s) => s.delivery_mode === 'restream'), 'por el nodo de este servidor');
    assert.ok(live.every((s) => s.source_url.startsWith('http://203.0.113.9/demo/live/')));
    const movies = (await ctx.api('GET', '/api/admin/streams?type=movie&limit=100')).data.data;
    assert.equal(movies.length, MOVIES.length);
    assert.ok(movies.every((s) => /\/demo\/vod\/\w+\/index\.m3u8$/.test(s.source_url)));

    // La cuenta de prueba ve todo desde la API Xtream
    const { username, password } = first.accounts[0];
    const q = `username=${username}&password=${password}`;
    const auth = (await ctx.api('GET', `/player_api.php?${q}`, undefined, { auth: false })).data;
    assert.equal(auth.user_info.auth, 1);
    assert.equal(String(auth.user_info.max_connections), '3');
    assert.equal((await ctx.api('GET', `/player_api.php?${q}&action=get_live_streams`, undefined, { auth: false })).data.length, CHANNELS.length);
    const vod = (await ctx.api('GET', `/player_api.php?${q}&action=get_vod_streams`, undefined, { auth: false })).data;
    assert.equal(vod.length, MOVIES.length);
    const info = (await ctx.api('GET', `/player_api.php?${q}&action=get_vod_info&vod_id=${vod[0].stream_id}`, undefined, { auth: false })).data;
    assert.match(info.info.plot, /Creative Commons/);
    assert.equal(info.info.backdrop_path.length, 1);
    const series = (await ctx.api('GET', `/player_api.php?${q}&action=get_series`, undefined, { auth: false })).data;
    const detail = (await ctx.api('GET', `/player_api.php?${q}&action=get_series_info&series_id=${series[0].series_id}`, undefined, { auth: false })).data;
    assert.equal(detail.episodes['1'].length, MOVIES.length);
    const settings = (await ctx.api('GET', '/api/admin/settings')).data;
    assert.equal(settings.server_name, 'PTOVS TV');

    // Otra vez: no duplica y muestra las mismas cuentas
    const again = await loadDemo({ panelUrl: ctx.base, medios: 'http://203.0.113.9', log: quiet });
    assert.equal(again.reused, true);
    assert.deepEqual(again.accounts, first.accounts);
    assert.equal((await ctx.api('GET', '/api/admin/streams?type=live&limit=100')).data.data.length, CHANNELS.length);

    // --rehacer: borra lo anterior y crea todo de nuevo con claves nuevas
    const redo = await loadDemo({ panelUrl: ctx.base, medios: 'http://203.0.113.9', rehacer: true, log: quiet });
    assert.equal(redo.reused, false);
    assert.notEqual(redo.accounts[0].password, first.accounts[0].password);
    assert.equal((await ctx.api('GET', '/api/admin/streams?limit=100')).data.data.length, CHANNELS.length + MOVIES.length);
    assert.equal((await ctx.api('GET', '/api/admin/users?search=lgqa')).data.data.length, 2);
    assert.ok(node.id);
  });

  test('se niega en un portal que ya tiene clientes', async () => {
    const { loadDemo } = await import('../scripts/demo-revision.js');
    await ctx.db('settings').where({ key: 'demo_revision' }).del();
    await ctx.api('POST', '/api/admin/users', { username: 'zz-cliente-real', password: 'clave12345' });
    await assert.rejects(loadDemo({ panelUrl: ctx.base, medios: 'http://203.0.113.9', log: quiet }), /ya tiene \d+ clientes/);
  });
});
