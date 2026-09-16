import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:iptv_player/services/api_exception.dart';
import 'package:iptv_player/services/portal_relocator.dart';
import 'package:iptv_player/services/server_discovery.dart';
import 'package:iptv_player/services/server_endpoint.dart';
import 'package:iptv_player/services/xtream_api.dart';

const portalId = '6f2c1b7e-portal-mi-iptv';
const otherId = '0a0a0a0a-otro-portal';

PingResult portal([String? id = portalId, List<int> clientPorts = const []]) =>
    PingResult(PingStatus.portal, id: id, clientPorts: clientPorts);

/// Ping falso: responde según la dirección y anota el orden de las consultas.
class FakePing {
  final Map<String, PingResult> answers;
  final List<String> calls = [];
  final Duration delay;

  FakePing(this.answers, {this.delay = Duration.zero});

  Future<PingResult> call(String url) async {
    calls.add(url);
    if (delay > Duration.zero) await Future<void>.delayed(delay);
    return answers[url] ?? PingResult.unreachable;
  }
}

/// Búsqueda en red local falsa.
class FakeLan {
  final List<DiscoveredServer> servers;
  final List<String> calls = [];

  FakeLan([this.servers = const []]);

  Future<List<DiscoveredServer>> call(String id,
      {DiscoveryProgressCallback? onProgress}) async {
    calls.add(id);
    return servers;
  }
}

PortalRelocator relocator(FakePing ping,
        {FakeLan? lan, DateTime Function()? clock}) =>
    PortalRelocator(
      pinger: ping.call,
      lanSearch: (lan ?? FakeLan()).call,
      clock: clock,
    );

const identity = PortalIdentity(
  id: portalId,
  urls: [
    'http://192.168.1.46:8080', // la actual (se salta)
    'http://iptv.midominio.co:25461',
    'http://10.0.0.5:25461',
    'http://192.168.1.60:25461/',
  ],
);

void main() {
  group('Respuesta de ping', () {
    test('portal con id y puertos de clientes', () {
      final r = PortalRelocator.parsePing(
          200,
          jsonEncode({
            'portal': true,
            'type': 'iptv-portal',
            'id': portalId,
            'name': 'Mi IPTV',
            'ports': [25461, 8080],
            'client_ports': [25461],
          }));
      expect(r.status, PingStatus.portal);
      expect(r.id, portalId);
      expect(r.clientPorts, [25461]);
      expect(r.ports, [25461, 8080]);
    });

    test('puerto del panel (404 en texto o JSON)', () {
      final json = PortalRelocator.parsePing(404,
          '{"error":"Este es el puerto del panel. Los clientes usan el puerto 25461."}');
      expect(json.status, PingStatus.panelPort);
      expect(json.suggestedPort, 25461);
      final text = PortalRelocator.parsePing(
          404, 'Este es el puerto del panel. Los clientes usan el puerto 8000.');
      expect(text.suggestedPort, 8000);
    });

    test('lo demás no es el portal', () {
      expect(PortalRelocator.parsePing(404, 'Not found').status,
          PingStatus.notPortal);
      expect(PortalRelocator.parsePing(200, '<html></html>').status,
          PingStatus.notPortal);
      expect(PortalRelocator.parsePing(200, '{"portal": false}').status,
          PingStatus.notPortal);
      expect(PortalRelocator.parsePing(500, '').status, PingStatus.notPortal);
      // Portal anterior sin id.
      final old = PortalRelocator.parsePing(200, '{"portal": true}');
      expect(old.status, PingStatus.portal);
      expect(old.id, isNull);
    });

    test('direcciones', () {
      expect(PortalRelocator.normalizeBase(' 192.168.1.46:8080/player_api.php?x=1 '),
          'http://192.168.1.46:8080');
      expect(PortalRelocator.normalizeBase('ftp://x'), '');
      expect(PortalRelocator.withPort('http://tv.co:8080', 25461),
          'http://tv.co:25461');
      expect(PortalRelocator.withPort('https://tv.co', 443), 'https://tv.co:443');
    });
  });

  group('Orden de búsqueda', () {
    test('si la dirección actual responde, no se cambia nada', () async {
      final ping = FakePing({'http://192.168.1.46:8080': portal()});
      final lan = FakeLan();
      final r = await relocator(ping, lan: lan).relocate(
          currentUrl: 'http://192.168.1.46:8080', identity: identity);
      expect(r.outcome, RelocationOutcome.currentWorks);
      expect(ping.calls, ['http://192.168.1.46:8080']);
      expect(lan.calls, isEmpty);
    });

    test('direcciones guardadas en orden: gana la primera con el mismo id',
        () async {
      final ping = FakePing({
        'http://iptv.midominio.co:25461': portal(otherId), // otro portal: nunca
        'http://10.0.0.5:25461': portal(portalId, [25461]),
        'http://192.168.1.60:25461': portal(),
      });
      final lan = FakeLan();
      final r = await relocator(ping, lan: lan).relocate(
          currentUrl: 'http://192.168.1.46:8080/', identity: identity);
      expect(r.outcome, RelocationOutcome.found);
      expect(r.url, 'http://10.0.0.5:25461');
      expect(r.via, RelocationVia.savedUrl);
      expect(r.previousUrl, 'http://192.168.1.46:8080');
      expect(r.clientPorts, [25461]);
      // Primero la actual; la actual no se repite entre las guardadas.
      expect(ping.calls.first, 'http://192.168.1.46:8080');
      expect(ping.calls.where((u) => u == 'http://192.168.1.46:8080'),
          hasLength(1));
      expect(ping.calls.skip(1), [
        'http://iptv.midominio.co:25461',
        'http://10.0.0.5:25461',
        'http://192.168.1.60:25461',
      ]);
      expect(lan.calls, isEmpty);
    });

    test('si ninguna guardada responde, busca en la red local por id', () async {
      final ping = FakePing({
        'http://192.168.0.23:25461': portal(),
        'http://192.168.0.99:25461': portal(otherId),
      });
      final lan = FakeLan(const [
        DiscoveredServer(
            name: 'Vecino', url: 'http://192.168.0.99:25461', id: otherId),
        DiscoveredServer(
            name: 'Sin id', url: 'http://192.168.0.50:25461'),
        DiscoveredServer(
            name: 'Mi IPTV', url: 'http://192.168.0.23:25461', id: portalId),
      ]);
      final r = await relocator(ping, lan: lan).relocate(
          currentUrl: 'http://192.168.1.46:8080', identity: identity);
      expect(r.outcome, RelocationOutcome.found);
      expect(r.url, 'http://192.168.0.23:25461');
      expect(r.via, RelocationVia.localNetwork);
      expect(lan.calls, [portalId]);
      // Los de otro id (o sin id) ni se consultan.
      expect(ping.calls, isNot(contains('http://192.168.0.99:25461')));
      expect(ping.calls, isNot(contains('http://192.168.0.50:25461')));
      expect(ping.calls.last, 'http://192.168.0.23:25461'); // confirmación
    });

    test('nunca cambia a un portal con otro id', () async {
      final ping = FakePing({
        for (final u in identity.urls.skip(1))
          PortalRelocator.normalizeBase(u): portal(otherId),
        'http://192.168.0.99:25461': portal(otherId),
      });
      final lan = FakeLan(const [
        DiscoveredServer(
            name: 'Otro', url: 'http://192.168.0.99:25461', id: otherId),
      ]);
      final r = await relocator(ping, lan: lan).relocate(
          currentUrl: 'http://192.168.1.46:8080', identity: identity);
      expect(r.outcome, RelocationOutcome.notFound);
      expect(r.url, isNull);
    });

    test('red local: la respuesta con el id correcto se confirma con ping',
        () async {
      // El UDP dice que es el portal, pero esa dirección no responde: no se usa.
      final ping = FakePing({});
      final lan = FakeLan(const [
        DiscoveredServer(
            name: 'Mi IPTV', url: 'http://192.168.0.23:25461', id: portalId),
      ]);
      final r = await relocator(ping, lan: lan).relocate(
          currentUrl: 'http://192.168.1.46:8080', identity: identity);
      expect(r.outcome, RelocationOutcome.notFound);
    });

    test('sin id guardado: acepta "portal: true" pero no busca en la red local',
        () async {
      final ping = FakePing({'http://10.0.0.5:25461': portal(null)});
      final lan = FakeLan(const [
        DiscoveredServer(name: 'X', url: 'http://192.168.0.23:25461', id: 'x'),
      ]);
      const noId = PortalIdentity(
          urls: ['http://192.168.1.46:8080', 'http://10.0.0.5:25461']);
      final r = await relocator(ping, lan: lan)
          .relocate(currentUrl: 'http://192.168.1.46:8080', identity: noId);
      expect(r.url, 'http://10.0.0.5:25461');

      final ping2 = FakePing({});
      final r2 = await relocator(ping2, lan: lan)
          .relocate(currentUrl: 'http://192.168.1.46:8080', identity: noId);
      expect(r2.outcome, RelocationOutcome.notFound);
      expect(lan.calls, isEmpty);
    });

    test('perfil sin datos del portal: no busca nada', () async {
      final ping = FakePing({});
      final lan = FakeLan();
      final r = await relocator(ping, lan: lan).relocate(
          currentUrl: 'http://xtream-ajeno.com:8080',
          identity: const PortalIdentity());
      expect(r.outcome, RelocationOutcome.unknownPortal);
      expect(ping.calls, isEmpty);
      expect(lan.calls, isEmpty);
    });

    test('puerto del panel: prueba el mismo equipo con el puerto de clientes',
        () async {
      final ping = FakePing({
        'http://192.168.1.46:8080': const PingResult(PingStatus.panelPort,
            suggestedPort: 25461),
        'http://192.168.1.46:25461': portal(portalId, [25461]),
        'http://iptv.midominio.co:25461': portal(),
      });
      final r = await relocator(ping).relocate(
          currentUrl: 'http://192.168.1.46:8080', identity: identity);
      expect(r.outcome, RelocationOutcome.found);
      // Se prefiere el mismo equipo (el portal dijo a qué puerto ir).
      expect(r.url, 'http://192.168.1.46:25461');
      expect(r.via, RelocationVia.clientPort);
    });

    test('puerto del panel: usa también los client_ports guardados', () async {
      final ping = FakePing({
        'http://tv.co:8080': PingResult.notPortal,
        'http://tv.co:8000': portal(),
      });
      const id = PortalIdentity(
          id: portalId, urls: ['http://tv.co:8080'], clientPorts: [8000]);
      // La petición Xtream ya dijo "Los clientes usan el puerto 8000".
      final r = await relocator(ping).relocate(
          currentUrl: 'http://tv.co:8080', identity: id, suggestedPort: 8000);
      expect(r.url, 'http://tv.co:8000');
    });
  });

  group('Límite de búsquedas', () {
    test('una a la vez: quien llega mientras tanto recibe el mismo resultado',
        () async {
      final ping = FakePing({'http://10.0.0.5:25461': portal()},
          delay: const Duration(milliseconds: 20));
      final lan = FakeLan();
      final reloc = relocator(ping, lan: lan);
      final a = reloc.relocate(
          currentUrl: 'http://192.168.1.46:8080', identity: identity);
      expect(reloc.isRunning, isTrue);
      final b = reloc.relocate(
          currentUrl: 'http://192.168.1.46:8080', identity: identity);
      final results = await Future.wait([a, b]);
      expect(identical(results[0], results[1]), isTrue);
      expect(results[0].url, 'http://10.0.0.5:25461');
      // Cada dirección se consultó una sola vez.
      expect(ping.calls.toSet().length, ping.calls.length);
      expect(reloc.isRunning, isFalse);
    });

    test('máximo una cada 20 s (salvo el botón "Buscar servidor")', () async {
      var now = DateTime(2026, 9, 16, 8);
      final ping = FakePing({});
      final lan = FakeLan();
      final reloc = relocator(ping, lan: lan, clock: () => now);

      final first = await reloc.relocate(
          currentUrl: 'http://192.168.1.46:8080', identity: identity);
      expect(first.outcome, RelocationOutcome.notFound);
      expect(lan.calls, hasLength(1));

      now = now.add(const Duration(seconds: 19));
      final second = await reloc.relocate(
          currentUrl: 'http://192.168.1.46:8080', identity: identity);
      expect(second.outcome, RelocationOutcome.skipped);
      expect(lan.calls, hasLength(1));

      final manual = await reloc.relocate(
          currentUrl: 'http://192.168.1.46:8080',
          identity: identity,
          force: true);
      expect(manual.outcome, RelocationOutcome.notFound);
      expect(lan.calls, hasLength(2));

      now = now.add(const Duration(seconds: 21));
      await reloc.relocate(
          currentUrl: 'http://192.168.1.46:8080', identity: identity);
      expect(lan.calls, hasLength(3));
    });

    test('dentro de los 20 s, quien falló con la dirección vieja recibe la nueva',
        () async {
      var now = DateTime(2026, 9, 16, 8);
      final ping = FakePing({'http://10.0.0.5:25461': portal()});
      final reloc = relocator(ping, clock: () => now);
      final first = await reloc.relocate(
          currentUrl: 'http://192.168.1.46:8080', identity: identity);
      expect(first.found, isTrue);

      now = now.add(const Duration(seconds: 3));
      final late = await reloc.relocate(
          currentUrl: 'http://192.168.1.46:8080', identity: identity);
      expect(late.url, 'http://10.0.0.5:25461');
      final other = await reloc.relocate(
          currentUrl: 'http://10.0.0.5:25461', identity: identity);
      expect(other.outcome, RelocationOutcome.skipped);
    });
  });

  group('Cliente Xtream con dirección compartida', () {
    test('si la dirección cambió durante la petición, repite con la nueva sin buscar',
        () async {
      final endpoint = ServerEndpoint('http://192.168.1.46:25461');
      final hosts = <String>[];
      var handlerCalls = 0;
      final client = MockClient((req) async {
        hosts.add(req.url.host);
        if (req.url.host == '192.168.1.46') {
          endpoint.url = 'http://10.0.0.5:25461'; // otra petición ya lo reencontró
          throw http.ClientException('Connection refused');
        }
        return http.Response(
            jsonEncode({
              'user_info': {'auth': 1, 'status': 'Active'},
            }),
            200);
      });
      final api = XtreamApi(
        serverUrl: endpoint.url,
        username: 'u',
        password: 'p',
        client: client,
        endpoint: endpoint,
        onConnectionLost: (_) async {
          handlerCalls++;
          return false;
        },
      );
      final auth = await api.authenticate();
      expect(auth.userInfo.auth, isTrue);
      expect(hosts, ['192.168.1.46', '10.0.0.5']);
      expect(handlerCalls, 0);
      expect(api.liveUrl('7'), 'http://10.0.0.5:25461/live/u/p/7.ts');
    });

    test('errores 401 no disparan la búsqueda; el 404 del panel sí', () async {
      var handlerCalls = 0;
      XtreamApi apiWith(int status, String body) => XtreamApi(
            serverUrl: 'http://h:8080',
            username: 'u',
            password: 'p',
            client: MockClient((_) async => http.Response(body, status)),
            onConnectionLost: (e) async {
              handlerCalls++;
              expect(e.clientPort, 25461);
              return false;
            },
          );
      await expectLater(apiWith(401, '').authenticate(),
          throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)));
      expect(handlerCalls, 0);
      await expectLater(
          apiWith(404, 'Este es el puerto del panel. Los clientes usan el puerto 25461.')
              .authenticate(),
          throwsA(isA<ApiException>()
              .having((e) => e.kind, 'kind', ApiErrorKind.panelPort)));
      expect(handlerCalls, 1);
    });
  });

  group('Con servidores HTTP reales en 127.0.0.1', () {
    late HttpServer fresh;
    late int deadPort;

    Future<HttpServer> portalServer(String id) async {
      final s = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      s.listen((req) {
        if (req.uri.path == '/api/client/ping') {
          req.response.headers.contentType = ContentType.json;
          req.response.write(jsonEncode({
            'portal': true,
            'type': 'iptv-portal',
            'id': id,
            'name': 'Mi IPTV',
            'client_ports': [s.port],
            'ports': [s.port],
          }));
        } else {
          req.response.statusCode = 404;
        }
        req.response.close();
      });
      return s;
    }

    setUp(() async {
      final dead = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      deadPort = dead.port;
      await dead.close();
    });

    tearDown(() => fresh.close(force: true));

    test('el viejo no responde y el nuevo tiene el mismo id: se usa el nuevo',
        () async {
      fresh = await portalServer(portalId);
      final old = 'http://127.0.0.1:$deadPort';
      final newer = 'http://127.0.0.1:${fresh.port}';
      final r = await PortalRelocator(searchLocalNetwork: false).relocate(
        currentUrl: old,
        identity: PortalIdentity(id: portalId, urls: [old, newer]),
      );
      expect(r.outcome, RelocationOutcome.found);
      expect(r.url, newer);
      expect(r.clientPorts, [fresh.port]);
    });

    test('un portal con otro id se rechaza', () async {
      fresh = await portalServer(otherId);
      final old = 'http://127.0.0.1:$deadPort';
      final r = await PortalRelocator(searchLocalNetwork: false).relocate(
        currentUrl: old,
        identity: PortalIdentity(
            id: portalId, urls: [old, 'http://127.0.0.1:${fresh.port}']),
      );
      expect(r.outcome, RelocationOutcome.notFound);
    });
  });
}
