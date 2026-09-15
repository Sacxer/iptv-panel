// Red: clasificación de IPs, detección de puertos y URL pública sin IPs locales.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

let api;
let stop;

before(async () => {
  ({ api, stop } = await startTestServer());
});
after(async () => stop());

describe('red y URL pública', () => {
  test('orden de IPs: interfaz principal primero, nunca loopback ni interfaces caídas', async () => {
    const { rankAddresses, interfaceType } = await import('../src/services/network.js');
    assert.equal(interfaceType('eth0'), 'ethernet');
    assert.equal(interfaceType('wlan0'), 'wifi');
    assert.equal(interfaceType('ztabc123'), 'vpn');
    assert.equal(interfaceType('docker0'), 'virtual');
    assert.equal(interfaceType('Ethernet 3', 'VirtualBox Host-Only Ethernet Adapter'), 'virtual');
    const ports = [
      { name: 'lo', type: 'loopback', type_label: 'Local', status: 'up', default_route: false, addresses: [{ address: '127.0.0.1', family: 'IPv4', scope: 'loopback' }] },
      { name: 'docker0', type: 'virtual', type_label: 'Virtual', status: 'up', default_route: false, addresses: [{ address: '172.17.0.1', family: 'IPv4', scope: 'private' }] },
      { name: 'eth1', type: 'ethernet', type_label: 'Ethernet', status: 'up', default_route: false, addresses: [{ address: '10.10.0.5', family: 'IPv4', scope: 'private' }] },
      { name: 'eth0', type: 'ethernet', type_label: 'Ethernet', status: 'up', default_route: true, addresses: [{ address: '192.168.10.20', family: 'IPv4', scope: 'private' }, { address: 'fe80::1', family: 'IPv6', scope: 'link-local' }] },
      { name: 'eth2', type: 'ethernet', type_label: 'Ethernet', status: 'down', default_route: false, addresses: [{ address: '192.168.99.9', family: 'IPv4', scope: 'private' }] },
    ];
    assert.deepEqual(rankAddresses(ports).map((a) => a.address), ['192.168.10.20', '10.10.0.5', '172.17.0.1']);
  });

  test('clasifica IPs públicas, privadas y locales', async () => {
    const { classifyIp } = await import('../src/services/network.js');
    assert.equal(classifyIp('127.0.0.1'), 'loopback');
    assert.equal(classifyIp('192.168.1.46'), 'private');
    assert.equal(classifyIp('10.147.17.40'), 'private');
    assert.equal(classifyIp('172.20.0.5'), 'private');
    assert.equal(classifyIp('100.72.1.1'), 'cgnat');
    assert.equal(classifyIp('169.254.3.3'), 'link-local');
    assert.equal(classifyIp('203.0.113.10'), 'public');
    assert.equal(classifyIp('::1'), 'loopback');
    assert.equal(classifyIp('fe80::1'), 'link-local');
    assert.equal(classifyIp('fd12::1'), 'private');
    assert.equal(classifyIp('2800:e2:1::5'), 'public');
  });

  test('escanea interfaces y puertos a la escucha', async () => {
    const net = (await api('GET', '/api/admin/system/network')).data;
    assert.ok(Array.isArray(net.network_ports) && net.network_ports.length > 0);
    const lo = net.network_ports.find((p) => p.addresses.some((a) => a.scope === 'loopback'));
    assert.ok(lo, 'aparece la interfaz local');
    for (const p of net.network_ports) {
      assert.ok(['ethernet', 'wifi', 'vpn', 'virtual', 'loopback'].includes(p.type));
      assert.equal(typeof p.default_route, 'boolean');
    }
    assert.ok(Array.isArray(net.listening));
    assert.ok(net.listening.length > 0, 'hay al menos un puerto a la escucha (el de la prueba)');
    for (const p of net.listening) assert.ok(p.port > 0 && typeof p.ip === 'string');
    assert.ok(Array.isArray(net.portal_ports));
    assert.equal(net.public_ip, null, 'la IP externa solo se consulta si se pide');
    assert.ok(Array.isArray(net.suggestions));
    for (const s of net.suggestions) assert.notEqual(s.scope, 'loopback', 'nunca se sugiere 127.0.0.1');
  });

  test('PUBLIC_URL se aplica al arrancar y se usa en los enlaces de clientes', async () => {
    const { autoConfigurePublicUrl } = await import('../src/services/network.js');
    const { saveSettings } = await import('../src/lib/settings.js');
    process.env.PUBLIC_URL = 'http://203.0.113.5:25461/';
    try {
      assert.equal(await autoConfigurePublicUrl(saveSettings, () => {}), 'http://203.0.113.5:25461/');
    } finally {
      delete process.env.PUBLIC_URL;
    }
    const u = (await api('POST', '/api/admin/users', { username: 'redtest', password: 'red12345' })).data;
    const links = (await api('GET', `/api/admin/users/${u.id}/m3u-url`)).data;
    assert.match(links.m3u_url, /^http:\/\/203\.0\.113\.5:25461\/get\.php\?/);
    // Con URL pública ya configurada no se sobrescribe.
    process.env.PUBLIC_URL = 'http://198.51.100.1';
    try {
      assert.equal(await autoConfigurePublicUrl(saveSettings, () => {}), null);
    } finally {
      delete process.env.PUBLIC_URL;
    }
  });
});

describe('descubrimiento del portal en la red local', () => {
  test('responde por UDP con la IP de la misma red y el puerto; /ping se identifica', async () => {
    const dgram = await import('node:dgram');
    const { startDiscovery, localAddressFor } = await import('../src/services/discovery.js');
    const { config } = await import('../src/config.js');

    const ifaces = {
      lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
      eth0: [{ address: '192.168.10.20', netmask: '255.255.255.0', family: 'IPv4', internal: false }],
      eth1: [{ address: '10.0.5.1', netmask: '255.255.0.0', family: 'IPv4', internal: false }],
    };
    assert.equal(localAddressFor('10.0.9.44', ifaces), '10.0.5.1', 'la interfaz que da a la red del celular');
    assert.equal(localAddressFor('192.168.10.77', ifaces), '192.168.10.20');
    assert.equal(localAddressFor('172.20.0.9', ifaces), '192.168.10.20', 'si no coincide, la primera IP privada');

    const probe = dgram.createSocket('udp4');
    await new Promise((r) => probe.bind(0, '127.0.0.1', r));
    const free = dgram.createSocket('udp4');
    await new Promise((r) => free.bind(0, '127.0.0.1', r));
    const port = free.address().port;
    await new Promise((r) => free.close(r));

    const stop = startDiscovery({ port, log: () => {} });
    await new Promise((r) => setTimeout(r, 100));
    const reply = new Promise((resolve, reject) => {
      probe.once('message', (msg) => resolve(JSON.parse(msg.toString())));
      setTimeout(() => reject(new Error('sin respuesta')), 2000);
    });
    probe.send(Buffer.from('IPTV-DISCOVER v1'), port, '127.0.0.1');
    const info = await reply;
    assert.equal(info.type, 'iptv-portal');
    assert.equal(info.port, config.port);
    assert.equal(info.url, `http://127.0.0.1:${config.port}`);
    assert.ok(info.name);

    // Mensajes que no son de descubrimiento se ignoran.
    let extra = false;
    probe.once('message', () => { extra = true; });
    probe.send(Buffer.from('hola'), port, '127.0.0.1');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(extra, false);
    stop();
    probe.close();

    const ping = await api('GET', '/api/client/ping', undefined, { auth: false });
    assert.equal(ping.data.type, 'iptv-portal');
    assert.equal(ping.data.portal, true);
    assert.ok(Array.isArray(ping.data.ports));
  });
});
