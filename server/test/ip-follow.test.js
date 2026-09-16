// Tras un corte de luz el router puede dar otra IP: la URL para clientes sigue a su interfaz.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

let ctx;
before(async () => { ctx = await startTestServer(); });
after(async () => ctx.stop());

const nic = (name, address, extra = {}) => ({
  name, type: 'ethernet', status: 'up', default_route: false, addresses: [{ address, family: 'IPv4', scope: 'private' }], ...extra,
});

describe('la URL sigue a la IP de su interfaz', () => {
  test('reglas: misma interfaz primero, luego la mejor; nunca dominios', async () => {
    const { followUrl, interfaceOfUrl } = await import('../src/services/ipFollow.js');
    const { rankAddresses } = await import('../src/services/network.js');
    const ports = [nic('eth1', '10.0.0.9'), nic('eth0', '192.168.1.80', { default_route: true })];
    assert.equal(followUrl('http://192.168.1.80:25461', ports, 'eth0', rankAddresses), null, 'la IP sigue presente');
    assert.deepEqual(followUrl('http://192.168.1.50:25461/x', ports, 'eth0', rankAddresses), {
      url: 'http://192.168.1.80:25461/x', interface: 'eth0', from: '192.168.1.50', to: '192.168.1.80',
    });
    assert.equal(followUrl('http://10.0.0.2:8090', ports, 'eth1', rankAddresses).url, 'http://10.0.0.9:8090', 'misma interfaz aunque no sea la principal');
    assert.equal(followUrl('http://10.0.0.2:8090', ports, 'eth9', rankAddresses).url, 'http://192.168.1.80:8090', 'si la interfaz ya no existe, la mejor');
    assert.equal(followUrl('https://tv.midominio.com', ports, 'eth0', rankAddresses), null);
    assert.equal(interfaceOfUrl('http://10.0.0.9:80', ports), 'eth1');
    assert.equal(interfaceOfUrl('http://203.0.113.5:80', ports), null);
    assert.equal(followUrl('http://203.0.113.5:25461', ports, null, rankAddresses), null, 'IP pública (NAT): nunca se cambia');
    assert.equal(followUrl('http://172.27.14.9:25461', ports, null, rankAddresses).url, 'http://192.168.1.80:25461', 'IP de red local vieja: se sigue');
    const lo = [{ name: 'lo', type: 'loopback', status: 'up', addresses: [{ address: '127.0.0.1', family: 'IPv4', scope: 'loopback' }] }, ...ports];
    assert.equal(interfaceOfUrl('http://127.0.0.1:8090', lo), null, 'loopback no se sigue');
    assert.equal(followUrl('http://127.0.0.1:8090', lo, null, rankAddresses), null);
  });

  test('portal: una IP pública o un dominio no se siguen; una IP de la máquina sí', async () => {
    const { followPublicUrl } = await import('../src/services/ipFollow.js');
    const pub = (await ctx.api('PUT', '/api/admin/settings', { public_url: 'http://203.0.113.5:25461' })).data;
    assert.equal(pub.public_url_auto, false, 'IP que no está en ninguna interfaz (NAT): fija');
    const forced = await ctx.api('PUT', '/api/admin/settings', { public_url_auto: true });
    assert.equal(forced.status, 400, 'no se puede forzar con una IP pública');
    const forcedWithUrl = (await ctx.api('PUT', '/api/admin/settings', { public_url: 'http://203.0.113.5:25461', public_url_auto: true })).data;
    assert.equal(forcedWithUrl.public_url_auto, false);
    const dom = (await ctx.api('PUT', '/api/admin/settings', { public_url: 'https://tv.midominio.com' })).data;
    assert.equal(dom.public_url_auto, false);

    // Simula que se configuró con la IP de eth0 y tras el apagón eth0 tiene otra.
    const on = (await ctx.api('PUT', '/api/admin/settings', { public_url: 'http://192.168.1.50:25461', public_url_auto: true })).data;
    assert.equal(on.public_url_auto, true);
    await ctx.db('settings').where({ key: 'public_url_interface' }).update({ value: JSON.stringify('eth0') });
    const { invalidateSettings } = await import('../src/lib/settings.js');
    invalidateSettings();
    const interfaces = {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth0: [{ address: '192.168.1.77', family: 'IPv4', internal: false }],
    };
    const change = await followPublicUrl({ interfaces });
    assert.equal(change.url, 'http://192.168.1.77:25461');
    const s = (await ctx.api('GET', '/api/admin/settings')).data;
    assert.equal(s.public_url, 'http://192.168.1.77:25461');
    assert.equal(await followPublicUrl({ interfaces }), null, 'ya está al día');

    await ctx.api('PUT', '/api/admin/settings', { public_url_auto: false });
    assert.equal(await followPublicUrl({ interfaces: { eth0: [{ address: '192.168.1.99', family: 'IPv4', internal: false }] } }), null, 'desactivado: no se toca');
    const logs = JSON.stringify((await ctx.api('GET', '/api/admin/logs')).data);
    assert.ok(logs.includes('system.public_url_follow'));
  });

  test('nodo: la URL automática sigue a su interfaz; una URL con dominio no', async () => {
    const node = (await ctx.api('POST', '/api/admin/servers', { name: 'zz-nodo-dhcp' })).data;
    const beat = (network) => ctx.api('POST', '/api/node/heartbeat', { version: 't', network, streams: [], sessions: [] }, {
      auth: false, headers: { Authorization: `Bearer ${node.token}` },
    });
    const net = (eth0) => ({ listen_port: 8090, ports: [nic('eth1', '10.0.0.9'), nic('eth0', eth0, { default_route: true })] });

    await beat(net('192.168.1.60'));
    let s = (await ctx.api('GET', `/api/admin/servers/${node.id}`)).data;
    assert.equal(s.public_url, 'http://192.168.1.60:8090');
    assert.equal(s.public_url_auto, true);
    assert.equal(s.public_url_interface, 'eth0');

    await beat(net('192.168.1.61')); // el router le dio otra IP
    s = (await ctx.api('GET', `/api/admin/servers/${node.id}`)).data;
    assert.equal(s.public_url, 'http://192.168.1.61:8090');

    s = (await ctx.api('POST', `/api/admin/servers/${node.id}/use-ip`, { ip: '10.0.0.9' })).data;
    assert.equal(s.public_url_interface, 'eth1');
    await beat({ listen_port: 8090, ports: [nic('eth1', '10.0.0.20'), nic('eth0', '192.168.1.61', { default_route: true })] });
    s = (await ctx.api('GET', `/api/admin/servers/${node.id}`)).data;
    assert.equal(s.public_url, 'http://10.0.0.20:8090', 'sigue a eth1, la interfaz elegida');

    s = (await ctx.api('PUT', `/api/admin/servers/${node.id}`, { public_url: 'http://nodo.midominio.com:8090' })).data;
    assert.equal(s.public_url_auto, false);
    await beat(net('192.168.1.62'));
    s = (await ctx.api('GET', `/api/admin/servers/${node.id}`)).data;
    assert.equal(s.public_url, 'http://nodo.midominio.com:8090');
    await ctx.api('DELETE', `/api/admin/servers/${node.id}`);
  });

  test('servicios del sistema: arrancan con el servidor y nunca dejan de reintentar', async () => {
    const fs = await import('node:fs');
    const installer = fs.readFileSync(new URL('../../deploy/install-ubuntu.sh', import.meta.url), 'utf8');
    assert.match(installer, /systemctl enable iptv-portal/);
    assert.match(installer, /Wants=network-online\.target/);
    assert.match(installer, /StartLimitIntervalSec=0/);
    assert.match(installer, /Restart=always/);
    const node = (await ctx.api('POST', '/api/admin/servers', { name: 'zz-nodo-arranque' })).data;
    const script = await ctx.api('GET', `/api/node/install.sh?token=${node.token}`, undefined, { auth: false, raw: true });
    assert.equal(script.status, 200);
    const text = await script.text();
    assert.match(text, /Wants=network-online\.target/);
    assert.match(text, /StartLimitIntervalSec=0/);
    assert.match(text, /systemctl enable --now iptv-node/);
    await ctx.api('DELETE', `/api/admin/servers/${node.id}`);
  });
});
