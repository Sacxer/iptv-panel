import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:iptv_player/services/server_discovery.dart';

class FakeInterface implements NetworkInterface {
  @override
  final String name;
  @override
  final List<InternetAddress> addresses;

  FakeInterface(this.name, List<String> ips)
      : addresses = [for (final ip in ips) InternetAddress(ip)];

  @override
  int get index => 0;
}

Future<List<NetworkInterface>> noInterfaces() async => const [];

List<int> bytes(Object json) => utf8.encode(jsonEncode(json));

Map<String, Object?> udpReply({
  String url = 'http://192.168.1.46:8080',
  String? publicUrl,
  List<int> ports = const [8080, 25461],
}) =>
    {
      'type': 'iptv-portal',
      'name': 'Mi IPTV',
      'version': '1.0.0',
      'url': url,
      'host': Uri.parse(url).host,
      'port': Uri.parse(url).port,
      'ports': ports,
      'public_url': publicUrl,
    };

DiscoveredServer server(
  String url, {
  DiscoverySource source = DiscoverySource.udp,
  List<int>? ports,
  String? publicUrl,
  String version = '1.0.0',
  String name = 'Mi IPTV',
}) =>
    DiscoveredServer(
      name: name,
      url: url,
      version: version,
      publicUrl: publicUrl,
      ports: ports ?? [Uri.parse(url).port],
      source: source,
    );

/// Portal UDP falso en 127.0.0.1. [reply] `null` = no responde.
Future<(RawDatagramSocket, List<String>)> udpResponder(
    Map<String, Object?>? Function() reply) async {
  final socket = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
  final received = <String>[];
  socket.listen((event) {
    if (event != RawSocketEvent.read) return;
    final d = socket.receive();
    if (d == null) return;
    final text = ascii.decode(d.data, allowInvalid: true);
    received.add(text);
    final body = reply();
    if (text.startsWith('IPTV-DISCOVER') && body != null) {
      socket.send(bytes(body), d.address, d.port);
    }
  });
  return (socket, received);
}

/// Servidor HTTP falso en 127.0.0.1 que responde [body] en `/api/client/ping`.
Future<HttpServer> httpServer(String Function(HttpServer s) body) async {
  final s = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  s.listen((req) {
    if (req.uri.path == '/api/client/ping') {
      req.response.headers.contentType = ContentType.json;
      req.response.write(body(s));
    } else {
      req.response.statusCode = 404;
    }
    req.response.close();
  });
  return s;
}

void main() {
  group('Respuesta UDP', () {
    test('acepta la respuesta del portal', () {
      final s = ServerDiscovery.parseUdpReply(
        bytes(udpReply(publicUrl: 'http://iptv.midominio.co:8080/')),
        sender: InternetAddress('192.168.1.46'),
      )!;
      expect(s.name, 'Mi IPTV');
      expect(s.url, 'http://192.168.1.46:8080');
      expect(s.host, '192.168.1.46');
      expect(s.port, 8080);
      expect(s.version, '1.0.0');
      expect(s.ports, [8080, 25461]);
      expect(s.publicUrl, 'http://iptv.midominio.co:8080');
      expect(s.outsideUrl, 'http://iptv.midominio.co:8080');
      expect(s.source, DiscoverySource.udp);
    });

    test('rechaza otros tipos, JSON inválido y basura', () {
      expect(
          ServerDiscovery.parseUdpReply(
              bytes({...udpReply(), 'type': 'otro-servicio'})),
          isNull);
      expect(ServerDiscovery.parseUdpReply(bytes({'portal': true})), isNull);
      expect(ServerDiscovery.parseUdpReply(utf8.encode('{"type":')), isNull);
      expect(ServerDiscovery.parseUdpReply(utf8.encode('IPTV-DISCOVER v1')),
          isNull);
      expect(ServerDiscovery.parseUdpReply(bytes(['iptv-portal'])), isNull);
      expect(ServerDiscovery.parseUdpReply(const [0xff, 0x00, 0x13]), isNull);
    });

    test('sin url usa host y puerto, o la IP que respondió', () {
      final a = ServerDiscovery.parseUdpReply(bytes({
        'type': 'iptv-portal',
        'host': '192.168.0.10',
        'port': '8080',
      }))!;
      expect(a.url, 'http://192.168.0.10:8080');
      expect(a.name, 'Servidor IPTV');
      expect(a.ports, [8080]);

      final b = ServerDiscovery.parseUdpReply(
        bytes({'type': 'iptv-portal', 'ports': [25461, 8080]}),
        sender: InternetAddress('10.0.0.7'),
      )!;
      expect(b.url, 'http://10.0.0.7:25461');

      expect(ServerDiscovery.parseUdpReply(bytes({'type': 'iptv-portal'})),
          isNull);
    });

    test('url de loopback se cambia por la IP que respondió', () {
      final s = ServerDiscovery.parseUdpReply(
        bytes(udpReply(url: 'http://127.0.0.1:8080')),
        sender: InternetAddress('192.168.1.46'),
      )!;
      expect(s.url, 'http://192.168.1.46:8080');
      // Desde el mismo equipo (loopback) se deja tal cual.
      final local = ServerDiscovery.parseUdpReply(
        bytes(udpReply(url: 'http://127.0.0.1:8080')),
        sender: InternetAddress('127.0.0.1'),
      )!;
      expect(local.url, 'http://127.0.0.1:8080');
    });
  });

  group('Respuesta de /api/client/ping', () {
    test('portal actual: la URL es http://ip:puerto', () {
      final s = ServerDiscovery.parsePingResponse(
        jsonEncode({
          'portal': true,
          'type': 'iptv-portal',
          'name': 'Cable Norte',
          'version': '1.2.0',
          'url': 'http://localhost:8080',
          'public_url': null,
          'ports': [8080, 25461],
        }),
        '192.168.1.46',
        25461,
      )!;
      expect(s.url, 'http://192.168.1.46:25461');
      expect(s.name, 'Cable Norte');
      expect(s.version, '1.2.0');
      expect(s.ports, [8080, 25461]);
      expect(s.publicUrl, isNull);
      expect(s.source, DiscoverySource.http);
    });

    test('portal anterior con "portal": true sin type', () {
      final s = ServerDiscovery.parsePingResponse(
          '{"portal": true}', '192.168.1.5', 80)!;
      expect(s.url, 'http://192.168.1.5:80');
      expect(s.name, 'Servidor IPTV');
      expect(s.ports, [80]);
    });

    test('rechaza lo que no es un portal', () {
      expect(ServerDiscovery.parsePingResponse('{"portal": false}', 'h', 1),
          isNull);
      expect(
          ServerDiscovery.parsePingResponse('{"type": "router"}', 'h', 1), isNull);
      expect(
          ServerDiscovery.parsePingResponse(
              '<html><body>Router</body></html>', 'h', 1),
          isNull);
      expect(ServerDiscovery.parsePingResponse('', 'h', 1), isNull);
    });

    test('outsideUrl solo si public_url es distinta', () {
      expect(
          server('http://192.168.1.46:8080',
                  publicUrl: 'http://192.168.1.46:8080/')
              .outsideUrl,
          isNull);
      expect(server('http://192.168.1.46:8080').outsideUrl, isNull);
      expect(
          server('http://192.168.1.46:8080', publicUrl: 'http://181.50.1.2:8080')
              .outsideUrl,
          'http://181.50.1.2:8080');
    });
  });

  group('Redes y subred', () {
    test('dirección de difusión', () {
      expect(ServerDiscovery.broadcastAddress('192.168.1.46'), '192.168.1.255');
      expect(ServerDiscovery.broadcastAddress('10.20.30.40', 16),
          '10.20.255.255');
      expect(ServerDiscovery.broadcastAddress('172.16.5.9', 30), '172.16.5.11');
      expect(ServerDiscovery.broadcastAddress('100.70.1.2', 10),
          '100.127.255.255');
      expect(ServerDiscovery.broadcastAddress('192.168.1.46', 32),
          '192.168.1.46');
      expect(ServerDiscovery.broadcastAddress('192.168.1.46', 0),
          '255.255.255.255');
      expect(ServerDiscovery.broadcastAddress('192.168.1'), isNull);
      expect(ServerDiscovery.broadcastAddress('192.168.1.300'), isNull);
      expect(ServerDiscovery.broadcastAddress('192.168.1.4', 33), isNull);
    });

    test('equipos de la /24', () {
      final hosts = ServerDiscovery.hostsInSubnet24('192.168.1.46');
      expect(hosts, hasLength(254));
      expect(hosts.first, '192.168.1.1');
      expect(hosts.last, '192.168.1.254');
      expect(hosts, contains('192.168.1.46'));
      expect(ServerDiscovery.hostsInSubnet24('fe80::1'), isEmpty);
    });

    test('IPs de red local', () {
      for (final ip in [
        '10.0.0.1',
        '172.16.0.1',
        '172.31.255.1',
        '192.168.1.46',
        '100.64.0.1',
        '100.127.255.254',
      ]) {
        expect(ServerDiscovery.isLanAddress(ip), isTrue, reason: ip);
      }
      for (final ip in [
        '8.8.8.8',
        '172.32.0.1',
        '100.128.0.1',
        '169.254.10.1',
        '127.0.0.1',
        'abc',
      ]) {
        expect(ServerDiscovery.isLanAddress(ip), isFalse, reason: ip);
      }
    });

    test('elige Wi-Fi / cable y descarta datos móviles, VPN y virtuales', () {
      final nets = ServerDiscovery.selectLocalNetworks([
        FakeInterface('rmnet_data0', ['10.45.3.2']),
        FakeInterface('ccmni1', ['100.72.4.1']),
        FakeInterface('tun0', ['10.8.0.2']),
        FakeInterface('lo', ['127.0.0.1']),
        FakeInterface('Conexión de área local', ['192.168.0.5']),
        FakeInterface('ZeroTier One [6ab565387a0dccfd]', ['10.147.17.32']),
        FakeInterface('wlan0', ['192.168.1.23', '169.254.3.3']),
        FakeInterface('eth0', ['181.49.10.2']), // IP pública: no se barre
      ]);
      expect(nets.map((n) => n.interfaceName),
          ['wlan0', 'Conexión de área local']);
      expect(nets.first.address, '192.168.1.23');
      expect(nets.first.broadcast, '192.168.1.255');
      expect(nets.first.preferred, isTrue);
      expect(nets.last.preferred, isFalse);
    });

    test('sin Wi-Fi ni cable no hay redes', () {
      expect(
          ServerDiscovery.selectLocalNetworks([
            FakeInterface('rmnet_data0', ['10.45.3.2']),
            FakeInterface('v4-rmnet_data0', ['192.0.0.4']),
          ]),
          isEmpty);
    });

    test('destinos UDP y equipos del barrido sin repetir', () {
      const nets = [
        LocalNetwork(interfaceName: 'wlan0', address: '192.168.1.23'),
        LocalNetwork(interfaceName: 'eth0', address: '192.168.1.80'),
        LocalNetwork(interfaceName: 'ap0', address: '192.168.43.1'),
      ];
      expect(ServerDiscovery.udpTargetsFor(nets),
          ['255.255.255.255', '192.168.1.255', '192.168.43.255']);
      expect(ServerDiscovery.udpTargetsFor(const []), ['255.255.255.255']);
      final hosts = ServerDiscovery.sweepHostsFor(nets);
      expect(hosts, hasLength(508));
      expect(hosts.first, '192.168.1.1');
      expect(hosts[254], '192.168.43.1');
    });
  });

  group('Redes más grandes que /24', () {
    List<String> labels(List<SweepBlock> blocks) =>
        [for (final b in blocks) b.label];

    test('/19 con puerta de enlace: propia, router y vecinas por cercanía', () {
      const net = LocalNetwork(
        interfaceName: 'wlan0',
        address: '172.27.14.218',
        prefixLength: 19,
        gateway: '172.27.0.1',
      );
      expect(net.broadcast, '172.27.31.255');
      expect(net.cidr, '172.27.0.0/19');
      final blocks = ServerDiscovery.sweepBlocks(net);
      expect(blocks, hasLength(32));
      expect(labels(blocks).take(6), [
        '172.27.14.0/24', // la del teléfono
        '172.27.0.0/24', // la del router
        '172.27.13.0/24',
        '172.27.15.0/24',
        '172.27.12.0/24',
        '172.27.16.0/24',
      ]);
      expect(blocks.last.label, '172.27.31.0/24');
      expect(blocks.every((b) => b.network == '172.27.0.0/19'), isTrue);
      // Dentro de una /19, x.x.14.0 y x.x.14.255 son equipos válidos.
      expect(blocks.first.hosts.first, '172.27.14.0');
      expect(blocks.first.hosts.last, '172.27.14.255');
      expect(blocks.first.count, 256);
      // Sin dirección de red ni de difusión.
      expect(blocks[1].hosts.first, '172.27.0.1');
      expect(blocks.last.hosts.last, '172.27.31.254');
      expect(blocks.fold<int>(0, (n, b) => n + b.count), 8190);
      expect(ServerDiscovery.udpTargetsFor(const [net]),
          ['255.255.255.255', '172.27.31.255']);
    });

    test('/22 sin puerta de enlace conocida', () {
      const net = LocalNetwork(
          interfaceName: 'eth0', address: '10.0.4.10', prefixLength: 22);
      expect(net.broadcast, '10.0.7.255');
      final blocks = ServerDiscovery.sweepBlocks(net);
      expect(labels(blocks),
          ['10.0.4.0/24', '10.0.5.0/24', '10.0.6.0/24', '10.0.7.0/24']);
      expect(blocks.fold<int>(0, (n, b) => n + b.count), 1022);
      expect(blocks.first.hosts.first, '10.0.4.1');
    });

    test('/16 completa y redes aún más grandes recortadas a /16', () {
      const net16 = LocalNetwork(
          interfaceName: 'wlan0', address: '192.168.77.5', prefixLength: 16);
      expect(net16.broadcast, '192.168.255.255');
      final blocks = ServerDiscovery.sweepBlocks(net16);
      expect(blocks, hasLength(256));
      expect(labels(blocks).take(3),
          ['192.168.77.0/24', '192.168.76.0/24', '192.168.78.0/24']);
      expect(blocks.fold<int>(0, (n, b) => n + b.count), 65534);

      const net12 = LocalNetwork(
          interfaceName: 'wlan0', address: '172.20.3.4', prefixLength: 12);
      expect(net12.broadcast, '172.31.255.255'); // la difusión es la real
      final clipped = ServerDiscovery.sweepBlocks(net12);
      expect(clipped, hasLength(256));
      expect(clipped.first.network, '172.20.0.0/16');
    });

    test('redes pequeñas: solo sus equipos', () {
      final small = ServerDiscovery.sweepBlocks(const LocalNetwork(
          interfaceName: 'wlan0', address: '192.168.1.1', prefixLength: 30));
      expect(small.single.hosts.toList(), ['192.168.1.1', '192.168.1.2']);
      final sweep24 = ServerDiscovery.sweepHostsFor(const [
        LocalNetwork(interfaceName: 'wlan0', address: '192.168.1.23'),
      ]);
      expect(sweep24, ServerDiscovery.hostsInSubnet24('192.168.1.23'));
    });

    test('límite de tiempo según el tamaño de la red', () {
      const d = ServerDiscovery();
      expect(d.autoLimit(3 * 254), ServerDiscovery.shortestLimit);
      expect(d.autoLimit(3 * 8190), ServerDiscovery.longestLimit);
      expect(d.autoLimit(0), ServerDiscovery.shortestLimit);
    });

    test('redes de Android: máscara real, sin datos móviles ni VPN', () {
      final nets = ServerDiscovery.fromPlatformInfo([
        {
          'interface': 'rmnet_data0',
          'transport': 'cellular',
          'active': false,
          'addresses': [
            {'address': '10.45.3.2', 'prefix': 30},
          ],
          'gateways': ['10.45.3.1'],
        },
        {
          'interface': 'tun0',
          'transport': 'vpn',
          'active': true,
          'addresses': [
            {'address': '10.8.0.2', 'prefix': 24},
          ],
        },
        {
          'interface': 'eth0',
          'transport': 'ethernet',
          'active': false,
          'addresses': [
            {'address': '192.168.1.5', 'prefix': 24},
          ],
          'gateways': [],
        },
        {
          'interface': 'wlan0',
          'transport': 'wifi',
          'active': true,
          'addresses': [
            {'address': '172.27.14.218', 'prefix': 19},
            {'address': '8.8.8.8', 'prefix': 24}, // pública: no
          ],
          'gateways': ['172.27.0.1'],
        },
        {
          'interface': 'weird0',
          'transport': 'other',
          'addresses': [
            {'address': '192.168.50.2', 'prefix': 0},
          ],
        },
      ]);
      expect(nets.map((n) => n.address),
          ['172.27.14.218', '192.168.1.5', '192.168.50.2']);
      expect(nets.first.prefixLength, 19);
      expect(nets.first.gateway, '172.27.0.1');
      expect(nets.first.preferred, isTrue);
      expect(nets.last.prefixLength, 24); // máscara inválida → /24
      expect(nets.last.preferred, isFalse);
      expect(ServerDiscovery.udpTargetsFor(nets),
          ['255.255.255.255', '172.27.31.255', '192.168.1.255', '192.168.50.255']);
    });

    test('barrido: orden por puerto y tramo, conexión TCP antes del ping',
        () async {
      final tcpCalls = <(String, int)>[];
      final pinged = <(String, int)>[];
      final result = await ServerDiscovery(
        enableUdp: false,
        httpPorts: const [25461, 8080],
        concurrency: 1,
        maxDuration: const Duration(seconds: 20),
        networkLister: () async => const [
          LocalNetwork(
            interfaceName: 'wlan0',
            address: '172.27.14.218',
            prefixLength: 22,
            gateway: '172.27.12.1',
            preferred: true,
          ),
        ],
        tcpProbe: (host, port) async {
          tcpCalls.add((host, port));
          return host == '172.27.13.7' && port == 8080;
        },
        prober: (host, port) async {
          pinged.add((host, port));
          return DiscoveredServer(
              name: 'Mi IPTV',
              url: 'http://$host:$port',
              id: 'p1',
              source: DiscoverySource.http);
        },
      ).discover();

      expect(tcpCalls, hasLength(2 * 1022));
      expect(tcpCalls[0], ('172.27.14.0', 25461)); // la propia primero
      expect(tcpCalls[256], ('172.27.12.1', 25461)); // luego la del router
      expect(tcpCalls[256 + 255], ('172.27.13.0', 25461)); // la vecina más cercana
      expect(tcpCalls[256 + 255 + 256], ('172.27.15.0', 25461));
      expect(tcpCalls[1022], ('172.27.14.0', 8080)); // segundo puerto
      expect(pinged, [('172.27.13.7', 8080)]); // solo el puerto abierto
      expect(result.servers.single.url, 'http://172.27.13.7:8080');
    });

    test('con id buscado termina en cuanto aparece ese portal', () async {
      var calls = 0;
      final progress = <DiscoveryProgress>[];
      final result = await ServerDiscovery(
        enableUdp: false,
        httpPorts: const [25461],
        concurrency: 2,
        maxDuration: const Duration(seconds: 20),
        networkLister: () async => const [
          LocalNetwork(
              interfaceName: 'wlan0', address: '10.1.0.9', prefixLength: 16),
        ],
        tcpProbe: (host, port) async {
          calls++;
          await Future<void>.delayed(const Duration(milliseconds: 1));
          return host == '10.1.0.20' || host == '10.1.0.40';
        },
        prober: (host, port) async => DiscoveredServer(
          name: host,
          url: 'http://$host:$port',
          id: host == '10.1.0.40' ? 'buscado' : 'otro',
          source: DiscoverySource.http,
        ),
      ).discover(expectedId: 'buscado', onProgress: progress.add);

      expect(result.servers.map((s) => s.id), ['otro', 'buscado']);
      expect(calls, lessThan(60)); // de 65534: paró al encontrarlo
      expect(progress.first.label, 'Buscando en 10.1.0.0/16… 0 %');
      expect(progress.first.total, 65534);
    });

    test('puerto del panel: sigue la pista al puerto de clientes', () async {
      final clients = await httpServer((s) => jsonEncode({
            'type': 'iptv-portal',
            'id': 'p1',
            'name': 'Mi IPTV',
            'client_ports': [s.port],
          }));
      final panel = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      panel.listen((req) {
        req.response
          ..statusCode = 404
          ..headers.contentType = ContentType.json
          ..write(jsonEncode({
            'error':
                'Este es el puerto del panel. Los clientes usan el puerto ${clients.port}.'
          }))
          ..close();
      });
      addTearDown(() async {
        await clients.close(force: true);
        await panel.close(force: true);
      });

      final result = await ServerDiscovery(
        enableUdp: false,
        sweepHosts: const ['127.0.0.1'],
        httpPorts: [panel.port],
        interfaceLister: noInterfaces,
      ).discover();

      expect(result.servers.single.url, 'http://127.0.0.1:${clients.port}');
      expect(result.servers.single.id, 'p1');
      expect(
          ServerDiscovery.panelPortHint(
              '{"error":"Este es el puerto del panel. Los clientes usan el puerto 25461."}'),
          25461);
      expect(ServerDiscovery.panelPortHint('Not found'), isNull);
      expect(ServerDiscovery.panelPortHint('Los clientes usan el puerto 99999'),
          isNull);
    });
  });

  group('Identidad del portal (id)', () {
    test('UDP y ping traen el id del portal', () {
      final udp = ServerDiscovery.parseUdpReply(bytes({
        ...udpReply(url: 'http://192.168.1.46:25461', ports: [25461, 8080]),
        'id': 'portal-1',
        'panel_port': 8080,
      }))!;
      expect(udp.id, 'portal-1');
      expect(udp.url, 'http://192.168.1.46:25461');
      final ping = ServerDiscovery.parsePingResponse(
          jsonEncode({'type': 'iptv-portal', 'id': 'portal-1'}),
          '192.168.1.46',
          25461)!;
      expect(ping.id, 'portal-1');
      expect(ServerDiscovery.parseUdpReply(bytes(udpReply()))!.id, isNull);
    });

    test('dos portales en el mismo equipo no se unen; el id se completa al unir',
        () {
      final merged = ServerDiscovery.mergeServers([
        const DiscoveredServer(
            name: 'A', url: 'http://192.168.1.46:8080', ports: [8080, 25461], id: 'a'),
        const DiscoveredServer(
            name: 'B', url: 'http://192.168.1.46:25461', ports: [25461], id: 'b',
            source: DiscoverySource.http),
        const DiscoveredServer(
            name: 'A', url: 'http://192.168.1.46:8080', ports: [8080],
            source: DiscoverySource.http),
      ]);
      expect(merged.map((s) => s.id), ['a', 'b']);

      final filled = ServerDiscovery.mergeServers([
        const DiscoveredServer(name: 'A', url: 'http://10.0.0.2:8080'),
        const DiscoveredServer(
            name: 'A', url: 'http://10.0.0.2:8080', id: 'a',
            source: DiscoverySource.http),
      ]);
      expect(filled.single.id, 'a');
    });
  });

  group('Unión de resultados', () {
    test('misma URL: gana UDP y se completan datos', () {
      final merged = ServerDiscovery.mergeServers([
        server('http://192.168.1.46:8080',
            source: DiscoverySource.http,
            publicUrl: 'http://iptv.co:8080',
            ports: [8080, 25461]),
        server('http://192.168.1.46:8080', version: ''),
      ]);
      expect(merged, hasLength(1));
      expect(merged.single.source, DiscoverySource.udp);
      expect(merged.single.publicUrl, 'http://iptv.co:8080');
      expect(merged.single.version, '1.0.0');
      expect(merged.single.ports, [8080, 25461]);
    });

    test('mismo equipo en otro puerto del portal se une', () {
      final merged = ServerDiscovery.mergeServers([
        server('http://192.168.1.46:8080', ports: [8080, 25461]),
        server('http://192.168.1.46:25461',
            source: DiscoverySource.http, ports: [8080, 25461]),
      ]);
      expect(merged.map((s) => s.url), ['http://192.168.1.46:8080']);
    });

    test('entre barridos se prefiere el puerto principal', () {
      final merged = ServerDiscovery.mergeServers([
        server('http://192.168.1.46:25461',
            source: DiscoverySource.http, ports: [8080, 25461]),
        server('http://192.168.1.46:8080',
            source: DiscoverySource.http, ports: [8080, 25461]),
      ]);
      expect(merged.map((s) => s.url), ['http://192.168.1.46:8080']);
    });

    test('equipos o portales distintos se mantienen en orden', () {
      final merged = ServerDiscovery.mergeServers([
        server('http://192.168.1.50:8080'),
        server('http://192.168.1.46:8080'),
        server('http://192.168.1.46:9090', name: 'Otro portal'),
        server('http://192.168.1.50:8080', source: DiscoverySource.http),
      ]);
      expect(merged.map((s) => s.url), [
        'http://192.168.1.50:8080',
        'http://192.168.1.46:8080',
        'http://192.168.1.46:9090',
      ]);
    });
  });

  group('Búsqueda con sockets reales en 127.0.0.1', () {
    test('UDP: envía IPTV-DISCOVER v1, recibe y termina pronto', () async {
      final (responder, received) =
          await udpResponder(() => udpReply(url: 'http://127.0.0.1:8080'));
      addTearDown(responder.close);
      final updates = <List<DiscoveredServer>>[];

      final result = await ServerDiscovery(
        udpPort: responder.port,
        udpTargets: const ['127.0.0.1'],
        enableSweep: false,
        interfaceLister: noInterfaces,
        minDuration: const Duration(milliseconds: 300),
        grace: const Duration(milliseconds: 300),
        udpDuration: const Duration(seconds: 3),
      ).discover(onUpdate: updates.add);

      expect(received.first, 'IPTV-DISCOVER v1');
      expect(result.servers.map((s) => s.url), ['http://127.0.0.1:8080']);
      expect(result.servers.single.source, DiscoverySource.udp);
      expect(updates, hasLength(1));
      expect(result.cancelled, isFalse);
      expect(result.noLocalNetwork, isFalse);
      expect(result.elapsed, lessThan(const Duration(milliseconds: 2000)));
    });

    test('UDP sin respuesta: repite 3 veces y termina sin resultados', () async {
      final (responder, received) = await udpResponder(() => null);
      addTearDown(responder.close);

      final result = await ServerDiscovery(
        udpPort: responder.port,
        udpTargets: const ['127.0.0.1'],
        enableSweep: false,
        interfaceLister: noInterfaces,
        udpDuration: const Duration(milliseconds: 600),
      ).discover();

      expect(result.servers, isEmpty);
      expect(received, List.filled(3, 'IPTV-DISCOVER v1'));
      expect(result.elapsed,
          greaterThanOrEqualTo(const Duration(milliseconds: 550)));
    });

    test('barrido HTTP: portal actual y anterior, ignora el resto', () async {
      final portal = await httpServer((s) => jsonEncode({
            'portal': true,
            'type': 'iptv-portal',
            'name': 'Mi IPTV',
            'version': '1.0.0',
            'url': 'http://localhost:${s.port}',
            'public_url': 'http://iptv.co:8080',
            'ports': [s.port],
          }));
      final legacy = await httpServer((_) => '{"portal": true, "name": "Viejo"}');
      final router = await httpServer((_) => '<html>Router</html>');
      final closed = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final closedPort = closed.port;
      await closed.close();
      addTearDown(() async {
        await portal.close(force: true);
        await legacy.close(force: true);
        await router.close(force: true);
      });

      final result = await ServerDiscovery(
        enableUdp: false,
        sweepHosts: const ['127.0.0.1'],
        httpPorts: [portal.port, legacy.port, router.port, closedPort],
        interfaceLister: noInterfaces,
      ).discover();

      // Las peticiones van en paralelo: el orden de llegada puede variar.
      expect(
          result.servers.map((s) => s.url),
          unorderedEquals([
            'http://127.0.0.1:${portal.port}',
            'http://127.0.0.1:${legacy.port}',
          ]));
      final byPort = {for (final s in result.servers) s.port: s};
      expect(byPort[portal.port]!.name, 'Mi IPTV');
      expect(byPort[portal.port]!.outsideUrl, 'http://iptv.co:8080');
      expect(byPort[legacy.port]!.name, 'Viejo');
      expect(result.servers.every((s) => s.source == DiscoverySource.http),
          isTrue);
    });

    test('UDP y barrido a la vez encuentran el mismo portal una vez', () async {
      final portal = await httpServer((s) => jsonEncode({
            'type': 'iptv-portal',
            'name': 'Mi IPTV',
            'ports': [s.port],
          }));
      addTearDown(() => portal.close(force: true));
      final (responder, _) = await udpResponder(() => udpReply(
          url: 'http://127.0.0.1:${portal.port}', ports: [portal.port]));
      addTearDown(responder.close);

      final result = await ServerDiscovery(
        udpPort: responder.port,
        udpTargets: const ['127.0.0.1'],
        sweepHosts: const ['127.0.0.1'],
        httpPorts: [portal.port],
        interfaceLister: noInterfaces,
        minDuration: const Duration(milliseconds: 400),
      ).discover();

      expect(result.servers, hasLength(1));
      expect(result.servers.single.url, 'http://127.0.0.1:${portal.port}');
      expect(result.servers.single.source, DiscoverySource.udp);
    });

    test('ping a un puerto que no contesta respeta el tiempo límite', () async {
      final silent = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final sockets = <Socket>[];
      silent.listen(sockets.add); // acepta y nunca responde
      final client = HttpClient()
        ..connectionTimeout = const Duration(milliseconds: 200);
      addTearDown(() async {
        client.close(force: true);
        for (final s in sockets) {
          s.destroy();
        }
        await silent.close();
      });

      final clock = Stopwatch()..start();
      final s = await ServerDiscovery.probePing(
          client, '127.0.0.1', silent.port,
          timeout: const Duration(milliseconds: 200));
      expect(s, isNull);
      expect(clock.elapsed, lessThan(const Duration(seconds: 1)));
    });
  });

  group('Control de la búsqueda', () {
    test('barrido: límite de concurrencia, orden por puerto y hallazgo',
        () async {
      var inFlight = 0;
      var maxInFlight = 0;
      final calls = <(String, int)>[];
      final result = await ServerDiscovery(
        enableUdp: false,
        sweepHosts: [for (var i = 1; i <= 100; i++) '10.0.0.$i'],
        httpPorts: const [8080, 80],
        concurrency: 7,
        interfaceLister: noInterfaces,
        prober: (host, port) async {
          calls.add((host, port));
          inFlight++;
          if (inFlight > maxInFlight) maxInFlight = inFlight;
          await Future<void>.delayed(const Duration(milliseconds: 2));
          inFlight--;
          return host == '10.0.0.42' && port == 80
              ? server('http://$host:$port', source: DiscoverySource.http)
              : null;
        },
      ).discover();

      expect(calls, hasLength(200));
      expect(maxInFlight, 7);
      expect(calls.take(100).every((c) => c.$2 == 8080), isTrue);
      expect(result.servers.map((s) => s.url), ['http://10.0.0.42:80']);
    });

    test('duración máxima corta el barrido', () async {
      var calls = 0;
      final result = await ServerDiscovery(
        enableUdp: false,
        sweepHosts: [for (var i = 1; i <= 100; i++) '10.0.0.$i'],
        httpPorts: const [8080],
        concurrency: 2,
        interfaceLister: noInterfaces,
        maxDuration: const Duration(milliseconds: 400),
        prober: (host, port) async {
          calls++;
          await Future<void>.delayed(const Duration(milliseconds: 100));
          return null;
        },
      ).discover();

      expect(calls, lessThan(100));
      expect(result.elapsed, lessThan(const Duration(milliseconds: 1200)));
    });

    test('cancelar termina enseguida', () async {
      final (responder, _) = await udpResponder(() => null);
      addTearDown(responder.close);
      final token = DiscoveryCancelToken();
      Timer(const Duration(milliseconds: 150), token.cancel);

      final result = await ServerDiscovery(
        udpPort: responder.port,
        udpTargets: const ['127.0.0.1'],
        enableSweep: false,
        interfaceLister: noInterfaces,
        udpDuration: const Duration(seconds: 5),
      ).discover(cancelToken: token);

      expect(result.cancelled, isTrue);
      expect(result.elapsed, lessThan(const Duration(seconds: 1)));
    });

    test('solo datos móviles: avisa sin buscar', () async {
      var probed = false;
      final result = await ServerDiscovery(
        interfaceLister: () async => [
          FakeInterface('rmnet_data0', ['10.45.3.2']),
          FakeInterface('lo', ['127.0.0.1']),
        ],
        prober: (_, _) async {
          probed = true;
          return null;
        },
      ).discover();

      expect(result.noLocalNetwork, isTrue);
      expect(result.servers, isEmpty);
      expect(probed, isFalse);
      expect(result.elapsed, lessThan(const Duration(milliseconds: 500)));
    });
  });
}
