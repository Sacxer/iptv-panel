import 'dart:convert';
import 'dart:io' hide ContentType;
import 'dart:io' as io show ContentType;

import 'package:flutter_test/flutter_test.dart';
import 'package:iptv_player/models/media_item.dart';
import 'package:iptv_player/models/portal_models.dart';
import 'package:iptv_player/models/profile.dart';
import 'package:iptv_player/providers/portal_provider.dart';
import 'package:iptv_player/providers/profiles_provider.dart';
import 'package:iptv_player/providers/session_provider.dart';
import 'package:iptv_player/services/portal_relocator.dart';
import 'package:iptv_player/services/storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

const portalId = 'a1b2c3d4-portal-de-prueba';

/// Portal falso: ping, player_api.php e info. Con [panelFor] actúa como el puerto del panel.
class FakePortal {
  final String id;
  int? panelFor;
  late final HttpServer server;
  final List<String> paths = [];

  FakePortal(this.id, {this.panelFor});

  String get url => 'http://127.0.0.1:${server.port}';

  Future<FakePortal> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen(_handle);
    return this;
  }

  Future<void> stop() => server.close(force: true);

  void _json(HttpRequest req, Object body) {
    req.response.headers.contentType = io.ContentType.json;
    req.response.write(jsonEncode(body));
  }

  Future<void> _handle(HttpRequest req) async {
    paths.add(req.uri.path);
    final res = req.response;
    final panel = panelFor;
    if (panel != null) {
      res.statusCode = 404;
      final text = 'Este es el puerto del panel. Los clientes usan el puerto $panel.';
      if (req.uri.path.startsWith('/api/')) {
        _json(req, {'error': text});
      } else {
        res.write(text);
      }
      await res.close();
      return;
    }
    switch (req.uri.path) {
      case '/api/client/ping':
        _json(req, {
          'portal': true,
          'type': 'iptv-portal',
          'id': id,
          'name': 'Mi IPTV',
          'client_ports': [server.port],
          'ports': [server.port],
        });
      case '/api/client/info':
        _json(req, {
          'portal': true,
          'server_name': 'Mi IPTV',
          'server': {
            'id': id,
            'name': 'Mi IPTV',
            'urls': [url, 'http://iptv.midominio.co:25461', 'http://10.8.0.1:25461'],
          },
          'user': {'username': 'zz-prueba', 'status': 'active', 'max_connections': 1},
          'notices': [],
          'messages': [],
          'unread_messages': 0,
        });
      case '/player_api.php':
        final action = req.uri.queryParameters['action'];
        if (action == null) {
          _json(req, {
            'user_info': {
              'auth': 1,
              'username': 'zz-prueba',
              'status': 'Active',
              'max_connections': '1',
              'active_cons': '0',
              'allowed_output_formats': ['ts', 'm3u8'],
            },
            'server_info': {'url': '127.0.0.1', 'port': '${server.port}'},
          });
        } else if (action == 'get_live_streams') {
          _json(req, [
            {'num': 1, 'name': 'Canal 1', 'stream_id': 11, 'category_id': '1'},
          ]);
        } else {
          _json(req, []);
        }
      default:
        res.statusCode = 404;
    }
    await res.close();
  }
}

Future<int> deadPort() async {
  final s = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
  final port = s.port;
  await s.close();
  return port;
}

void main() {
  late Storage storage;
  late ProfilesProvider profiles;
  late SessionProvider session;
  late List<String> notices;
  final started = <FakePortal>[];

  Future<FakePortal> portal(String id, {int? panelFor}) async {
    final p = await FakePortal(id, panelFor: panelFor).start();
    started.add(p);
    return p;
  }

  Future<Profile> saveProfile(Profile p) async {
    await profiles.save(p);
    return p;
  }

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    storage = await Storage.init();
    profiles = ProfilesProvider(storage);
    notices = [];
    session = SessionProvider(
      storage,
      profiles: profiles,
      relocator: PortalRelocator(searchLocalNetwork: false),
      onNotice: notices.add,
    );
  });

  tearDown(() async {
    session.logout(notify: false);
    for (final p in started) {
      await p.stop();
    }
    started.clear();
  });

  test('cambió la IP: encuentra el portal por su id, actualiza el perfil y entra',
      () async {
    final fresh = await portal(portalId);
    final old = 'http://127.0.0.1:${await deadPort()}';
    final profile = await saveProfile(Profile(
      id: 'p1',
      name: 'Casa',
      type: ProfileType.xtream,
      serverUrl: old,
      username: 'zz-prueba',
      password: 'clave',
      portalId: portalId,
      portalUrls: [old, fresh.url],
    ));

    final ok = await session.login(profile);

    expect(ok, isTrue, reason: session.error);
    expect(session.profile!.serverUrl, fresh.url);
    expect(session.endpoint!.url, fresh.url);
    expect(profiles.byId('p1')!.serverUrl, fresh.url);
    expect(storage.loadProfiles().single.serverUrl, fresh.url);
    expect(storage.loadProfiles().single.portalId, portalId);
    expect(notices, [SessionProvider.relocatedMessage]);
    // Las URL de video salen de la dirección nueva.
    final item = MediaItem(id: '11', name: 'Canal 1', type: ContentType.live);
    expect(session.source!.streamUrl(item),
        startsWith('${fresh.url}/live/zz-prueba/clave/11.'));
  });

  test('un portal con otro id no se usa: el perfil no cambia', () async {
    final other = await portal('otro-portal');
    final old = 'http://127.0.0.1:${await deadPort()}';
    final profile = await saveProfile(Profile(
      id: 'p1',
      name: 'Casa',
      type: ProfileType.xtream,
      serverUrl: old,
      username: 'zz-prueba',
      password: 'clave',
      portalId: portalId,
      portalUrls: [old, other.url],
    ));

    final ok = await session.login(profile);

    expect(ok, isFalse);
    expect(session.errorCanRelocate, isTrue);
    expect(session.error, contains('No se pudo conectar'));
    expect(profiles.byId('p1')!.serverUrl, old);
    expect(notices, isEmpty);
    expect(other.paths, ['/api/client/ping']); // se preguntó, pero no se usó
  });

  test('puerto del panel: pasa al puerto de clientes del mismo equipo', () async {
    final clients = await portal(portalId);
    final panel = await portal(portalId, panelFor: clients.server.port);
    final profile = await saveProfile(Profile(
      id: 'p1',
      name: 'Casa',
      type: ProfileType.xtream,
      serverUrl: panel.url,
      username: 'zz-prueba',
      password: 'clave',
      portalId: portalId,
      portalUrls: [panel.url],
    ));

    final ok = await session.login(profile);

    expect(ok, isTrue, reason: session.error);
    expect(profiles.byId('p1')!.serverUrl, clients.url);
    expect(profiles.byId('p1')!.clientPorts, [clients.server.port]);
    expect(notices, [SessionProvider.relocatedMessage]);
  });

  test('servidor Xtream que no es el portal: no busca en otras direcciones',
      () async {
    final someone = await portal(portalId);
    final old = 'http://127.0.0.1:${await deadPort()}';
    final profile = await saveProfile(Profile(
      id: 'p1',
      name: 'Otro proveedor',
      type: ProfileType.xtream,
      serverUrl: old,
      username: 'zz-prueba',
      password: 'clave',
    ));

    expect(await session.login(profile), isFalse);
    expect(someone.paths, isEmpty);
    expect(profiles.byId('p1')!.serverUrl, old);
  });

  test('en plena sesión: se cae la IP, busca, cambia y repite la petición',
      () async {
    final first = await portal(portalId);
    final second = await portal(portalId);
    final profile = await saveProfile(Profile(
      id: 'p1',
      name: 'Casa',
      type: ProfileType.xtream,
      serverUrl: first.url,
      username: 'zz-prueba',
      password: 'clave',
      portalId: portalId,
      portalUrls: [first.url, second.url],
    ));
    expect(await session.login(profile), isTrue);
    expect(notices, isEmpty);

    await first.stop();
    started.remove(first);
    final items = await session.source!.items(ContentType.live);

    expect(items.map((i) => i.name), ['Canal 1']);
    expect(session.profile!.serverUrl, second.url);
    expect(session.source!.streamUrl(items.first), startsWith(second.url));
    expect(notices, [SessionProvider.relocatedMessage]);
    expect(second.paths, contains('/player_api.php'));
  });

  test('guarda la identidad y las direcciones del portal tras /api/client/info',
      () async {
    final server = await portal(portalId);
    final profile = await saveProfile(Profile(
      id: 'p1',
      name: 'Casa',
      type: ProfileType.xtream,
      serverUrl: server.url,
      username: 'zz-prueba',
      password: 'clave',
    ));
    expect(await session.login(profile), isTrue);

    final portalProvider = PortalProvider(storage, session: session);
    addTearDown(portalProvider.stop);
    await portalProvider.start(session.profile!);

    expect(portalProvider.enabled, isTrue);
    expect(portalProvider.info!.server!.id, portalId);
    final saved = profiles.byId('p1')!;
    expect(saved.portalId, portalId);
    expect(saved.portalUrls, [
      server.url,
      'http://iptv.midominio.co:25461',
      'http://10.8.0.1:25461',
    ]);
    expect(saved.clientPorts, [server.server.port]);
    expect(storage.loadProfiles().single.portalUrls, saved.portalUrls);
  });

  test('la identidad sobrevive a guardar y leer el perfil', () {
    const p = Profile(
      id: 'p1',
      name: 'Casa',
      type: ProfileType.xtream,
      serverUrl: 'http://192.168.1.46:25461',
      portalId: portalId,
      portalUrls: ['http://192.168.1.46:25461', 'http://iptv.co:25461'],
      clientPorts: [25461],
    );
    final back = Profile.fromJson(jsonDecode(jsonEncode(p.toJson())));
    expect(back.portalId, portalId);
    expect(back.portalUrls, p.portalUrls);
    expect(back.clientPorts, [25461]);
    expect(back.portalIdentity.isKnown, isTrue);
    // Perfiles viejos (sin esos campos) siguen funcionando.
    final legacy = Profile.fromJson({
      'id': 'x',
      'name': 'Viejo',
      'type': 'xtream',
      'serverUrl': 'http://h:8080',
    });
    expect(legacy.portalIdentity.isKnown, isFalse);
    // M3U: nunca se reubica.
    const m3u = Profile(
        id: 'm', name: 'Lista', type: ProfileType.m3uUrl, portalId: portalId);
    expect(m3u.portalIdentity.isKnown, isFalse);
  });

  test('PortalServer ignora direcciones inválidas y repetidas', () {
    final s = PortalServer.fromJson({
      'id': portalId,
      'name': 'Mi IPTV',
      'urls': ['http://a:1/', 'http://a:1', 'ftp://x', '', null, 'https://b.co'],
    })!;
    expect(s.urls, ['http://a:1', 'https://b.co']);
    expect(PortalServer.fromJson(null), isNull);
    expect(PortalServer.fromJson({'urls': []}), isNull);
  });
}
