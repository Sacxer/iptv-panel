// Cambiar los puertos para clientes desde el panel, en caliente.
import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

let ctx;
let busy;
before(async () => {
  process.env.FIREWALL_HELPER = '/no/existe/iptv-firewall';
  ctx = await startTestServer();
  busy = net.createServer().listen(0, '0.0.0.0');
  await new Promise((r) => busy.once('listening', r));
});
after(async () => {
  const { stopListeners } = await import('../src/services/listeners.js');
  await stopListeners();
  busy.close();
  await ctx.stop();
});

async function freePort() {
  const s = net.createServer().listen(0, '0.0.0.0');
  await new Promise((r) => s.once('listening', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

const health = (port) => fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
  .then((r) => r.ok).catch(() => false);

describe('puertos para clientes', () => {
  test('muestra la configuración y comprueba si un puerto está libre', async () => {
    const o = (await ctx.api('GET', '/api/admin/system/ports')).data;
    assert.equal(o.panel_port, 8080);
    assert.equal(o.source, 'env');
    assert.equal(o.firewall_helper, false);
    const free = await freePort();
    assert.equal((await ctx.api('POST', '/api/admin/system/ports/check', { port: free })).data.available, true);
    const taken = (await ctx.api('POST', '/api/admin/system/ports/check', { port: busy.address().port })).data;
    assert.equal(taken.available, false);
    assert.match(taken.error, /Ocupado/);
    assert.equal((await ctx.api('POST', '/api/admin/system/ports/check', { port: 70000 })).status, 400);
  });

  test('valida la lista de puertos', async () => {
    for (const client_ports of [[], [22], [8080], ['abc'], Array.from({ length: 11 }, (_, i) => 30000 + i)]) {
      const r = await ctx.api('PUT', '/api/admin/system/ports', { client_ports });
      assert.equal(r.status, 400, JSON.stringify(client_ports));
    }
  });

  test('abre y cierra puertos sin reiniciar y mueve la URL para clientes', async () => {
    await ctx.api('PUT', '/api/admin/settings', { public_url: 'http://10.0.0.5:25471' });
    const p1 = await freePort();
    const r1 = (await ctx.api('PUT', '/api/admin/system/ports', { client_ports: [p1] })).data;
    assert.deepEqual(r1.client_ports, [p1]);
    assert.equal(r1.source, 'panel');
    assert.equal(r1.results.find((r) => r.port === p1).ok, true);
    assert.equal(r1.public_url_changed, `http://10.0.0.5:${p1}`);
    assert.deepEqual(r1.firewall, [{ port: p1, ok: false, manual: `sudo ufw allow ${p1}/tcp` }]);
    assert.equal(await health(p1), true, 'el puerto nuevo atiende al instante');
    const ping = (await ctx.api('GET', '/api/client/ping', undefined, { auth: false })).data;
    assert.ok(ping.ports.includes(p1));

    // Un puerto ocupado queda "en espera"; el que se quitó se cierra.
    const p2 = await freePort();
    const occupied = busy.address().port;
    const r2 = (await ctx.api('PUT', '/api/admin/system/ports', { client_ports: [p2, occupied] })).data;
    assert.equal(r2.results.find((r) => r.port === occupied).ok, false);
    assert.equal(r2.listeners.find((l) => l.port === occupied).status, 'waiting');
    assert.ok(r2.results.some((r) => r.port === p1 && r.closed));
    assert.equal(await health(p1), false, 'el puerto quitado ya no responde');
    assert.equal(await health(p2), true);
    assert.equal(r2.public_url_changed, `http://10.0.0.5:${p2}`);

    // Si la URL usa un puerto que sigue abierto, no se toca.
    const r3 = (await ctx.api('PUT', '/api/admin/system/ports', { client_ports: [occupied, p2] })).data;
    assert.equal(r3.public_url_changed, null);
    assert.equal(r3.public_url, `http://10.0.0.5:${p2}`);
    const logs = (await ctx.api('GET', '/api/admin/logs')).data;
    assert.ok(JSON.stringify(logs).includes('system.ports'));
  });
});
