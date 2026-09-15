// Cortes sincronizados con plataforma externa (WispHub simulado), recordatorios y carrusel de avisos.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

let api;
let db;
let stop;

before(async () => {
  ({ api, db, stop } = await startTestServer());
});
after(async () => stop());

describe('cortes con plataforma externa (WispHub simulado)', () => {
  let wisp;
  let wispBase;
  let detailEnabled = false; // WispHub real tiene /clientes/{id}/; aquí se prueba con y sin él
  const hits = [];
  const clientes = [
    { id_servicio: 9001, usuario: 'ana.w', nombre: 'Ana Ruiz', cedula: '1.020.304', email: 'ana@x.co', telefono: '3001112233', estado: 'Activo', plan_internet: { nombre: 'Fibra 100 + TV' }, password_servicio: 'secreto1', password_router_wifi: 'secreto2', ssid_router_wifi: 'MiWifi' },
    { id_servicio: 9002, usuario: 'beto.w', nombre: 'Beto Díaz', cedula: '555', email: '', telefono: '', estado: 'Suspendido', plan_internet: { nombre: 'TV' } },
    { id_servicio: 9003, usuario: 'caro.w', nombre: 'Caro', cedula: '777', email: '', telefono: '', estado: 'Activo', plan_internet: null },
    { id_servicio: 9004, usuario: 'sinvinculo', nombre: 'Sin vínculo', cedula: '999', email: '', telefono: '', estado: 'Cancelado', plan_internet: null },
    { id_servicio: 9005, usuario: 'dani.w', nombre: 'Dani', cedula: '888', email: '', telefono: '', estado: 'Activo', plan_internet: null },
  ];

  before(async () => {
    wisp = http.createServer((req, res) => {
      if (req.headers.authorization !== 'Api-Key PRUEBA.123') {
        res.writeHead(401);
        return res.end('{}');
      }
      const url = new URL(req.url, 'http://x');
      hits.push(url.pathname);
      const detail = /^\/api\/clientes\/(\d+)\/$/.exec(url.pathname);
      if (detail && detailEnabled) {
        const c = clientes.find((x) => String(x.id_servicio) === detail[1]);
        res.writeHead(c ? 200 : 404, { 'Content-Type': 'application/json' });
        // Como WispHub real: el detalle trae estado y plan, pero no nombre ni cédula.
        return res.end(JSON.stringify(c ? { id_servicio: c.id_servicio, estado: c.estado, plan_internet: c.plan_internet } : { detail: 'No encontrado' }));
      }
      if (url.pathname !== '/api/clientes/') {
        res.writeHead(404);
        return res.end();
      }
      const limit = Number(url.searchParams.get('limit'));
      const offset = Number(url.searchParams.get('offset'));
      const results = clientes.slice(offset, offset + limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        count: clientes.length, next: offset + limit < clientes.length ? 'x' : null, previous: null, results,
      }));
    }).listen(0);
    await new Promise((r) => wisp.once('listening', r));
    wispBase = `http://127.0.0.1:${wisp.address().port}/api`;
  });
  after(() => wisp.close());

  test('configuración, prueba, vínculos, simulación, sincronización y webhook', async () => {
    const mk = async (body) => (await api('POST', '/api/admin/users', { password: 'tv12345', ...body })).data;
    const ana = await mk({ username: 'ana.iptv', document_id: '1020304' }); // coincide por cédula sin puntos
    const beto = await mk({ username: 'beto.iptv', external_id: '9002' }); // vínculo directo por ID externo
    const caro = await mk({ username: 'caro.iptv', document_id: '777' });
    const dani = await mk({ username: 'dani.iptv', document_id: '888' });

    const cfg = await api('PUT', '/api/admin/integrations/billing', {
      cut_mode: 'both',
      config: { enabled: true, base_url: wispBase, api_key: 'PRUEBA.123', page_size: 2 },
    });
    assert.equal(cfg.status, 200, JSON.stringify(cfg.data));
    assert.equal(cfg.data.config.api_key, undefined);
    assert.equal(cfg.data.config.api_key_set, true);
    assert.ok(cfg.data.webhook_path);

    const badKey = await api('POST', '/api/admin/integrations/billing/test', { api_key: 'MALA' });
    assert.equal(badKey.status, 400);
    assert.match(badKey.data.error, /Lista de clientes/);
    assert.equal(cfg.data.config.api_key_hint, '••••.123');

    // URL sin "/api": se prueba con /api, funciona y queda corregida.
    await api('PUT', '/api/admin/integrations/billing', { config: { base_url: wispBase.replace(/\/api$/, '') } });
    const fixed = (await api('POST', '/api/admin/integrations/billing/test')).data;
    assert.equal(fixed.base_url_corrected, wispBase);
    assert.equal((await api('GET', '/api/admin/integrations/billing')).data.config.base_url, wispBase);

    // Una URL que devuelve HTML da un mensaje claro en vez de "Error interno".
    const html = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>docs</html>'); }).listen(0);
    await new Promise((r) => html.once('listening', r));
    const htmlTest = await api('POST', '/api/admin/integrations/billing/test', { base_url: `http://127.0.0.1:${html.address().port}/api` });
    html.close();
    assert.equal(htmlTest.status, 502);
    assert.match(htmlTest.data.error, /página web/);
    const probe = (await api('POST', '/api/admin/integrations/billing/test')).data;
    assert.equal(probe.total, 5);
    assert.ok(probe.raw_keys.includes('id_servicio'));
    assert.equal(probe.sample[0].plan, 'Fibra 100 + TV');
    assert.deepEqual(probe.status_values.find((s) => s.value === 'Suspendido'), { value: 'Suspendido', maps_to: 'suspended' });

    // Caro fue suspendida a mano en el portal: la plataforma la marca activa, pero no se reactiva sola.
    await api('POST', `/api/admin/users/${caro.id}/suspend`, { reason: 'Mal uso' });

    const dry = (await api('POST', '/api/admin/integrations/billing/sync', { dry_run: true })).data;
    assert.equal(dry.stats.applied, false);
    assert.equal(dry.stats.fetched, 5, 'recorre todas las páginas');
    assert.ok(dry.changes.some((c) => c.username === 'beto.iptv' && c.action === 'suspend'));
    assert.equal((await api('GET', `/api/admin/users/${beto.id}`)).data.status, 'active', 'la simulación no aplica cambios');
    assert.equal((await api('GET', `/api/admin/users/${ana.id}`)).data.external_id, null, 'la simulación no guarda vínculos');
    assert.ok(dry.changes.every((c) => c.username !== 'ana.iptv') || dry.stats.linked_now >= 1);
    assert.equal(dry.stats.linked_total, 4, 'cuenta los vínculos propuestos');

    const run = (await api('POST', '/api/admin/integrations/billing/sync')).data;
    assert.equal(run.stats.applied, true);
    assert.equal(run.stats.linked_total, 4);
    assert.equal(run.stats.suspended, 1);
    assert.equal(run.stats.skipped_manual, 1);
    const b = (await api('GET', `/api/admin/users/${beto.id}`)).data;
    assert.equal(b.status, 'suspended');
    assert.equal(b.suspension_source, 'external');
    assert.equal(b.external_status, 'Suspendido');
    assert.equal((await api('GET', `/api/admin/users/${ana.id}`)).data.external_id, '9001');
    assert.equal((await api('GET', `/api/admin/users/${caro.id}`)).data.status, 'suspended');

    const rawStored = (await db('external_clients').where({ external_id: '9001' }).first()).raw;
    assert.ok(!/secreto|MiWifi|password/i.test(rawStored), 'no se guardan contraseñas de WispHub');
    const ext = (await api('GET', '/api/admin/integrations/billing/external-clients?linked=false')).data;
    assert.equal(ext.total, 1);
    assert.equal(ext.data[0].status_mapped, 'disabled');

    // Pagó y lo activaron en WispHub → se reactiva en IPTV.
    clientes[1].estado = 'Activo';
    const run2 = (await api('POST', '/api/admin/integrations/billing/sync')).data;
    assert.equal(run2.stats.reactivated, 1);
    assert.equal((await api('GET', `/api/admin/users/${beto.id}`)).data.status, 'active');

    // Modo "plataforma externa": los clientes vinculados no se cortan a mano.
    await api('PUT', '/api/admin/integrations/billing', { cut_mode: 'external' });
    assert.equal((await api('POST', `/api/admin/users/${dani.id}/suspend`, { reason: 'x' })).status, 409);
    const bulk = (await api('POST', '/api/admin/users/bulk', { ids: [dani.id], action: 'suspend' })).data;
    assert.deepEqual(bulk, { affected: 0, skipped: 1 });

    // Webhook: la plataforma avisa del corte al instante.
    const token = (await api('GET', '/api/admin/integrations/billing')).data.webhook_path.split('/').pop();
    const bad = await api('POST', '/api/integrations/billing/webhook/malo', { id_servicio: 9005, estado: 'Suspendido' }, { auth: false });
    assert.equal(bad.status, 401);
    const hook = await api('POST', `/api/integrations/billing/webhook/${token}`, { id_servicio: 9005, estado: 'Suspendido' }, { auth: false });
    assert.equal(hook.data.action, 'suspend', JSON.stringify(hook.data));
    assert.equal((await api('GET', `/api/admin/users/${dani.id}`)).data.suspension_source, 'external');

    const runs = (await api('GET', '/api/admin/integrations/billing/runs')).data;
    assert.ok(runs.total >= 4);
    await api('PUT', '/api/admin/integrations/billing', { cut_mode: 'manual', config: { enabled: false } });
  });

  test('revisar ya los suspendidos y actualizar un cliente puntual', async () => {
    const byName = async (username) => db('users').where({ username }).first();
    const status = async (username) => (await api('GET', `/api/admin/users/${(await byName(username)).id}`)).data;
    await api('PUT', '/api/admin/integrations/billing', { cut_mode: 'external', config: { enabled: true, interval_minutes: 1 } });

    const ov = (await api('GET', '/api/admin/integrations/billing')).data;
    assert.equal(ov.config.interval_minutes, 1, 'se puede revisar cada minuto');
    assert.equal(ov.auto_sync.enabled, true);
    assert.ok(ov.auto_sync.next_run_at >= Math.floor(Date.now() / 1000) - 1);
    assert.equal(ov.counts.cut_linked, 2, 'dani (webhook) y caro (a mano)');

    // Ana deja de pagar, pero "Revisar suspendidos" solo mira las cuentas cortadas: no la corta.
    clientes[0].estado = 'Suspendido';
    const check = (await api('POST', '/api/admin/integrations/billing/check-suspended')).data;
    assert.equal(check.stats.scope, 'suspended');
    assert.equal(check.stats.checked, 2);
    assert.equal(check.stats.reactivated, 1, JSON.stringify(check.stats));
    assert.equal(check.stats.skipped_manual, 1, 'la suspensión hecha a mano no se levanta');
    assert.equal(check.stats.suspended, 0);
    assert.ok(check.changes.some((c) => c.username === 'dani.iptv' && c.action === 'reactivate'));
    assert.equal((await status('dani.iptv')).status, 'active');
    assert.equal((await status('ana.iptv')).status, 'active');

    // Un cliente puntual, sin endpoint de detalle: usa la lista.
    const ana = await byName('ana.iptv');
    const r1 = (await api('POST', `/api/admin/integrations/billing/users/${ana.id}/refresh`)).data;
    assert.equal(r1.method, 'list');
    assert.equal(r1.applied, true);
    assert.equal(r1.change.action, 'suspend');
    assert.equal(r1.user.status, 'suspended');
    assert.deepEqual(r1.services.map((x) => [x.external_id, x.status_mapped]), [['9001', 'suspended']]);

    // Pagó: con el endpoint de detalle se consulta solo su servicio.
    detailEnabled = true;
    clientes[0].estado = 'Activo';
    hits.length = 0;
    const r2 = (await api('POST', `/api/admin/integrations/billing/users/${ana.id}/refresh`)).data;
    assert.equal(r2.method, 'detail');
    assert.deepEqual(hits, ['/api/clientes/9001/']);
    assert.equal(r2.change.action, 'reactivate');
    assert.equal(r2.user.status, 'active');
    const stored = await db('external_clients').where({ external_id: '9001' }).first();
    assert.equal(stored.status, 'Activo');
    assert.equal(stored.name, 'Ana Ruiz', 'el detalle no borra el nombre');
    assert.equal(stored.document_id, '1.020.304', 'ni la cédula');

    const lone = (await api('POST', '/api/admin/users', { username: 'solo.iptv', password: 'tv12345' })).data;
    const notLinked = await api('POST', `/api/admin/integrations/billing/users/${lone.id}/refresh`);
    assert.equal(notLinked.status, 400);
    assert.match(notLinked.data.error, /no está vinculado/);

    // En modo manual se consulta pero no se aplica.
    await api('PUT', '/api/admin/integrations/billing', { cut_mode: 'manual' });
    clientes[0].estado = 'Suspendido';
    const r3 = (await api('POST', `/api/admin/integrations/billing/users/${ana.id}/refresh`)).data;
    assert.equal(r3.applied, false);
    assert.equal(r3.change.action, 'suspend');
    assert.equal(r3.user.status, 'active');
    const runs = (await api('GET', '/api/admin/integrations/billing/runs')).data;
    assert.ok(runs.data.some((run) => run.trigger === 'user_refresh') && runs.data.some((run) => run.trigger === 'check_suspended'));

    detailEnabled = false;
    clientes[0].estado = 'Activo';
    await api('PUT', '/api/admin/integrations/billing', { cut_mode: 'manual', config: { enabled: false, interval_minutes: 15 } });
  });
});

describe('vinculación en lote con WispHub', () => {
  let wisp;
  let wispBase;
  const clientes = [
    { id_servicio: 7001, usuario: 'eva.w', nombre: 'Eva Gómez', cedula: '1.234.567', email: 'eva@x.co', telefono: '3100000001', estado: 'Activo', plan_internet: { nombre: 'Fibra 100 + TV' } },
    { id_servicio: 7002, usuario: 'fede.w', nombre: 'Fede Ruiz', cedula: '7.654.321', email: '', telefono: '', estado: 'Suspendido', plan_internet: { nombre: 'Internet 50' } },
    { id_servicio: 7003, usuario: 'gina w', nombre: 'Gina Ñáñez', cedula: '999888', email: '', telefono: '', estado: 'Cancelado', plan_internet: { nombre: 'TV Básico' } },
    { id_servicio: 7004, usuario: 'hugo.w', nombre: 'Hugo', cedula: '555444', email: '', telefono: '', estado: 'Activo', plan_internet: { nombre: 'Internet 20' } },
  ];

  before(async () => {
    wisp = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: clientes.length, next: null, previous: null, results: clientes }));
    }).listen(0);
    await new Promise((r) => wisp.once('listening', r));
    wispBase = `http://127.0.0.1:${wisp.address().port}/api`;
    await api('PUT', '/api/admin/integrations/billing', {
      cut_mode: 'manual',
      config: { enabled: false, base_url: wispBase, api_key: 'X.Y', auto_link: false, page_size: 300 },
    });
    await db('external_clients').del();
    const sync = await api('POST', '/api/admin/integrations/billing/sync');
    assert.equal(sync.data.stats.fetched, 4, JSON.stringify(sync.data));
  });
  after(() => wisp.close());

  test('resumen, simulación, vincular existentes y crear cuentas con su estado', async () => {
    const fede = (await api('POST', '/api/admin/users', { username: 'fede.iptv', password: 'fede1234', document_id: '7654321' })).data;
    await api('POST', '/api/admin/users', { username: 'eva.w', password: 'otra1234' }); // ocupa el usuario "eva.w"

    const summary = (await api('GET', '/api/admin/integrations/billing/external-clients/summary')).data;
    assert.deepEqual(summary.unlinked_by_status, { free: 0, active: 2, suspended: 1, disabled: 1, unknown: 0 });
    assert.ok(summary.plans.some((p) => p.name === 'TV Básico'));
    const actives = (await api('GET', '/api/admin/integrations/billing/external-clients?mapped_status=active&linked=false')).data;
    assert.equal(actives.total, 2);

    // Simulación: todos los que tienen TV en el plan, creando los que falten. No cambia nada.
    const dry = (await api('POST', '/api/admin/integrations/billing/external-clients/bulk-link', {
      status: 'all', plan_contains: 'tv', create_missing: true, dry_run: true, match_by: ['document'],
    })).data;
    assert.equal(dry.selected, 2);
    assert.equal(dry.created, 2);
    assert.deepEqual(dry.credentials, []);
    const dryUser = (await api('POST', '/api/admin/integrations/billing/external-clients/bulk-link', {
      status: 'active', dry_run: true, match_by: ['username'],
    })).data;
    assert.equal(dryUser.items.find((i) => i.external_id === '7001').action, 'link', 'coincide por usuario');
    assert.equal((await api('GET', '/api/admin/integrations/billing/external-clients/summary')).data.linked, 0);

    // Solo los suspendidos, vinculando los que ya existen (fede por cédula) y aplicando su estado.
    const susp = (await api('POST', '/api/admin/integrations/billing/external-clients/bulk-link', {
      status: 'suspended', apply_status: true,
    })).data;
    assert.equal(susp.linked, 1);
    assert.equal(susp.status_applied.suspended, 1);
    const f = (await api('GET', `/api/admin/users/${fede.id}`)).data;
    assert.equal(f.external_id, '7002');
    assert.equal(f.status, 'suspended');
    assert.equal(f.suspension_source, 'external');

    // Todos los que quedan, creando cuentas con la cédula como contraseña y un paquete.
    const pkg = (await api('POST', '/api/admin/packages', { name: 'TV WispHub' })).data;
    const all = (await api('POST', '/api/admin/integrations/billing/external-clients/bulk-link', {
      status: 'all', create_missing: true, apply_status: true, match_by: ['document'],
      create: { username_from: 'usuario', password_mode: 'cedula', package_ids: [pkg.id], max_connections: 2 },
    })).data;
    assert.equal(all.created, 3);
    assert.equal(all.status_applied.disabled, 1);
    const byName = Object.fromEntries(all.credentials.map((c) => [c.external_id, c]));
    assert.equal(byName['7001'].username, 'eva.w-2', 'usuario ocupado → sufijo');
    assert.equal(byName['7001'].password, '1234567');
    assert.equal(byName['7003'].username, 'gina.w', 'espacios reemplazados');

    const auth = (await api('GET', '/player_api.php?username=eva.w-2&password=1234567', undefined, { auth: false })).data;
    assert.equal(auth.user_info.status, 'Active');
    const gina = (await api('GET', '/api/admin/users?search=gina.w')).data.data[0];
    assert.equal(gina.status, 'disabled');
    assert.equal(gina.document_id, '999888');
    assert.deepEqual(gina.package_ids, [pkg.id]);
    assert.equal(gina.max_connections, 2);
    assert.equal((await api('GET', '/api/admin/integrations/billing/external-clients/summary')).data.linked, 4);
  });

  test('sincronizar todos con los valores por defecto: usuario y contraseña = cédula', async () => {
    clientes.push({ id_servicio: 7005, usuario: 'ivan.w', nombre: 'Iván', cedula: '1.098.765.432', email: '', telefono: '', estado: 'Activo', plan_internet: { nombre: '25 MEG@S' } });
    clientes.push({ id_servicio: 7006, usuario: 'ivan2.w', nombre: 'Iván (2º servicio)', cedula: '1098765432', email: '', telefono: '', estado: 'Activo', plan_internet: { nombre: '40 MEG@S' } });
    await api('POST', '/api/admin/integrations/billing/sync');
    const res = (await api('POST', '/api/admin/integrations/billing/external-clients/bulk-link', {
      status: 'active', create_missing: true, apply_status: true, match_by: [],
    })).data;
    assert.equal(res.created, 1, 'una sola cuenta para la misma cédula');
    assert.equal(res.grouped, 1);
    assert.equal(res.accounts, 1);
    assert.equal(res.credentials.length, 1);
    assert.deepEqual([res.credentials[0].username, res.credentials[0].password], ['1098765432', '1098765432']);
    const auth = (await api('GET', '/player_api.php?username=1098765432&password=1098765432', undefined, { auth: false })).data;
    assert.equal(auth.user_info.auth, 1);
    const ivan = (await api('GET', '/api/admin/users?search=1098765432')).data;
    assert.equal(ivan.total, 1);
    assert.equal(ivan.data[0].external_services.length, 2);

    // Estado combinado: un servicio suspendido y otro activo → la cuenta sigue activa.
    await api('PUT', '/api/admin/integrations/billing', { cut_mode: 'both' });
    clientes.find((c) => c.id_servicio === 7005).estado = 'Suspendido';
    let sync = (await api('POST', '/api/admin/integrations/billing/sync')).data;
    assert.equal((await api('GET', `/api/admin/users/${ivan.data[0].id}`)).data.status, 'active', 'otro servicio sigue activo');
    // Ambos suspendidos → la cuenta se suspende; uno paga → se reactiva.
    clientes.find((c) => c.id_servicio === 7006).estado = 'Suspendido';
    sync = (await api('POST', '/api/admin/integrations/billing/sync')).data;
    assert.ok(sync.changes.some((c) => c.username === '1098765432' && c.action === 'suspend' && c.services === 2));
    assert.equal((await api('GET', `/api/admin/users/${ivan.data[0].id}`)).data.status, 'suspended');
    clientes.find((c) => c.id_servicio === 7006).estado = 'Activo';
    await api('POST', '/api/admin/integrations/billing/sync');
    assert.equal((await api('GET', `/api/admin/users/${ivan.data[0].id}`)).data.status, 'active');

    // Gratis: nunca se corta. Con un servicio gratis la cuenta sigue activa aunque los demás estén suspendidos.
    clientes.find((c) => c.id_servicio === 7005).estado = 'Gratis';
    clientes.find((c) => c.id_servicio === 7006).estado = 'Suspendido';
    await api('POST', '/api/admin/integrations/billing/sync');
    assert.equal((await api('GET', `/api/admin/users/${ivan.data[0].id}`)).data.status, 'active', 'gratis no se corta');
    clientes.push({ id_servicio: 7008, usuario: 'free.w', nombre: 'Cortesía', cedula: '44556677', email: '', telefono: '', estado: 'Gratis', plan_internet: null });
    await api('POST', '/api/admin/integrations/billing/sync');
    assert.equal((await api('GET', '/api/admin/integrations/billing/external-clients/summary')).data.unlinked_by_status.free, 1);
    const free = (await api('POST', '/api/admin/integrations/billing/external-clients/bulk-link', {
      status: 'free', create_missing: true, apply_status: true, match_by: [],
    })).data;
    assert.equal(free.created, 1);
    assert.equal(free.status_applied.free, 1);
    assert.equal(free.credentials[0].password_source, 'cedula');
    clientes.find((c) => c.id_servicio === 7005).estado = 'Suspendido';

    // Sincronizar solo suspendidos no suspende a quien tiene otro servicio activo aún sin sincronizar.
    clientes.push({ id_servicio: 7009, usuario: 'jose.a', nombre: 'José', cedula: '31313131', email: '', telefono: '', estado: 'Activo', plan_internet: null });
    clientes.push({ id_servicio: 7010, usuario: 'jose.s', nombre: 'José (2)', cedula: '31.313.131', email: '', telefono: '', estado: 'Suspendido', plan_internet: null });
    await api('POST', '/api/admin/integrations/billing/sync');
    const onlySusp = (await api('POST', '/api/admin/integrations/billing/external-clients/bulk-link', {
      status: 'suspended', create_missing: true, apply_status: true, match_by: ['document'],
    })).data;
    const joseItem = onlySusp.items.find((i) => i.external_id === '7010');
    assert.equal(joseItem.status_applied, 'active', 'tiene otro servicio activo');
    assert.equal((await api('GET', '/api/admin/users?search=31313131')).data.data[0].status, 'active');

    // Un servicio nuevo de la misma persona se agrega a su cuenta en la sincronización automática.
    clientes.push({ id_servicio: 7007, usuario: 'ivan3.w', nombre: 'Iván (3º servicio)', cedula: '1098765432', email: '', telefono: '', estado: 'Activo', plan_internet: null });
    await api('PUT', '/api/admin/integrations/billing', { cut_mode: 'manual', config: { auto_link: true, match_by: ['document'] } });
    await api('POST', '/api/admin/integrations/billing/sync');
    assert.equal((await api('GET', `/api/admin/users/${ivan.data[0].id}`)).data.external_services.length, 3);
  });
});

describe('recordatorios y carrusel de avisos', () => {
  test('recordatorio repetitivo con variables y reemplazo del anterior', async () => {
    const u = (await api('POST', '/api/admin/users', {
      username: 'recor', password: 'rec1234', full_name: 'Rosa Pérez', exp_date: Math.floor(Date.now() / 1000) + 10 * 86400 - 60,
    })).data;
    const r = await api('POST', '/api/admin/reminders', {
      title: 'Pago mensual',
      body: 'Hola {nombre}, tu servicio vence el {vence} ({dias} días).',
      kind: 'payment',
      display: 'popup',
      target: 'user',
      user_id: u.id,
      recurrence: 'weekly',
      config: { time: '08:30', weekdays: [1, 4] },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.upcoming.length, 5);
    assert.ok(r.data.next_run_at > Math.floor(Date.now() / 1000));
    const badWeekly = await api('POST', '/api/admin/reminders', { title: 'x', recurrence: 'weekly', config: { weekdays: [] } });
    assert.equal(badWeekly.status, 400);

    await api('POST', `/api/admin/reminders/${r.data.id}/run`);
    const second = (await api('POST', `/api/admin/reminders/${r.data.id}/run`)).data;
    assert.equal(second.messages_created, 1);
    assert.equal(second.reminder.sent_count, 2);
    assert.equal(second.reminder.active, true, 'un recordatorio repetitivo sigue activo');

    const info = (await api('GET', '/api/client/info?username=recor&password=rec1234')).data;
    const msgs = info.messages.filter((m) => m.title === 'Pago mensual');
    assert.equal(msgs.length, 1, 'el mensaje anterior se reemplaza');
    assert.match(msgs[0].body, /^Hola Rosa Pérez, tu servicio vence el \d{2}\/\d{2}\/\d{4} \(10 días\)\.$/);
    assert.equal(msgs[0].kind, 'payment');
    assert.equal(msgs[0].display, 'popup');
  });

  test('recordatorio único se desactiva tras enviarse', async () => {
    const r = (await api('POST', '/api/admin/reminders', { title: 'Mantenimiento el domingo', kind: 'maintenance', recurrence: 'once' })).data;
    const run = (await api('POST', `/api/admin/reminders/${r.id}/run`)).data;
    assert.equal(run.reminder.active, false);
    assert.equal(run.reminder.next_run_at, null);
  });

  test('recordatorio antes del vencimiento solo a quien vence ese día', async () => {
    const soon = (await api('POST', '/api/admin/users', {
      username: 'vence3', password: 'v12345', exp_date: Math.floor(Date.now() / 1000) + 3 * 86400,
    })).data;
    await api('POST', '/api/admin/users', { username: 'vence20', password: 'v12345', duration: { amount: 20, unit: 'days' } });
    const r = (await api('POST', '/api/admin/reminders', {
      title: 'Tu plan vence pronto',
      body: 'Quedan {dias} días',
      kind: 'expiration',
      recurrence: 'before_expiration',
      config: { time: '09:00', days_before: [3] },
    })).data;
    const run = (await api('POST', `/api/admin/reminders/${r.id}/run`)).data;
    assert.equal(run.messages_created, 1);
    const sent = (await api('GET', `/api/admin/messages?reminder_id=${r.id}`)).data.data;
    assert.equal(sent[0].user_id, soon.id);
    const other = (await api('GET', '/api/client/info?username=vence20&password=v12345')).data;
    assert.ok(!other.messages.some((m) => m.title === 'Tu plan vence pronto'));
  });

  test('avisos: configuración de carrusel y orden por prioridad', async () => {
    await api('PUT', '/api/admin/settings', { notices_carousel_seconds: 6 });
    await api('POST', '/api/admin/notices', { title: 'Promo', level: 'info', display: 'banner', sort_order: 1 });
    await api('POST', '/api/admin/notices', { title: 'Caída parcial', level: 'critical', display: 'banner', duration_seconds: 15 });
    const info = (await api('GET', '/api/client/info?username=recor&password=rec1234')).data;
    assert.deepEqual(info.notice_settings, { carousel: true, interval_seconds: 6 });
    assert.equal(info.notices[0].title, 'Caída parcial');
    assert.equal(info.notices[0].duration_seconds, 15);
  });
});
