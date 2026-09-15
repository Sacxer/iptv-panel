import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:iptv_player/services/app_update.dart';

const _sha = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const _query = AppUpdateQuery(
  packageName: 'com.iptvplayer.app',
  versionCode: 2002,
  versionName: '1.0.1',
  abis: ['arm64-v8a', 'armeabi-v7a'],
  deviceType: 'tvbox',
  deviceId: 'equipo-1',
  sdk: 31,
);

Map<String, Object?> updateJson({
  bool mandatory = false,
  int versionCode = 2003,
  String versionName = '1.0.2',
  String url = '/api/client/app-update/download/7',
  String sha = _sha,
}) =>
    {
      'update': true,
      'mandatory': mandatory,
      'release': {
        'id': 3,
        'version_name': versionName,
        'version_code': versionCode,
        'notes': 'Arreglos en la guía',
        'published_at': 1726300000,
        'channel': 'stable',
      },
      'file': {
        'id': 7,
        'abi': 'arm64-v8a',
        'size': 32145678,
        'sha256': sha,
        'url': url,
      },
    };

/// Cliente falso que responde siempre lo mismo y guarda las peticiones.
(MockClient, List<http.Request>) fakeClient(Object? body, {int status = 200}) {
  final requests = <http.Request>[];
  final client = MockClient((req) async {
    requests.add(req);
    return http.Response(
      body is String ? body : jsonEncode(body),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
  });
  return (client, requests);
}

AppUpdateChecker checkerWith(
  Object? body, {
  int status = 200,
  MemorySnoozeStore? store,
  DateTime Function()? clock,
}) {
  final (client, _) = fakeClient(body, status: status);
  return AppUpdateChecker(
    api: AppUpdateApi(client: client),
    snoozeStore: store ?? MemorySnoozeStore(),
    clock: clock,
  );
}

void main() {
  group('Consulta al portal', () {
    test('normaliza la URL del servidor', () {
      expect(AppUpdateApi.normalizeServer(' 192.168.1.46:8080/ '),
          'http://192.168.1.46:8080');
      expect(AppUpdateApi.normalizeServer('http://tv.midominio.co:25461/player_api.php'),
          'http://tv.midominio.co:25461');
      expect(AppUpdateApi.normalizeServer('https://iptv.co'), 'https://iptv.co');
      expect(AppUpdateApi.normalizeServer('ftp://iptv.co'), isNull);
      expect(AppUpdateApi.normalizeServer(''), isNull);
      expect(AppUpdateApi.normalizeServer(null), isNull);
    });

    test('envía paquete, versión, arquitecturas y equipo', () async {
      final (client, requests) = fakeClient({'update': false});
      final api = AppUpdateApi(
        client: client,
        headers: const {'X-App-Version': '1.0.1', 'X-App-Build': '2002'},
      );
      await api.check('http://192.168.1.46:8080/', _query);

      final req = requests.single;
      expect(req.method, 'GET');
      expect(req.url.path, '/api/client/app-update');
      expect(req.url.origin, 'http://192.168.1.46:8080');
      expect(req.url.queryParameters, {
        'package': 'com.iptvplayer.app',
        'version_code': '2002',
        'version_name': '1.0.1',
        'abis': 'arm64-v8a,armeabi-v7a',
        'device_type': 'tvbox',
        'device_id': 'equipo-1',
        'sdk': '31',
      });
      expect(req.headers['X-App-Version'], '1.0.1');
      expect(req.headers['X-App-Build'], '2002');
    });

    test('interpreta una actualización disponible', () async {
      final (client, _) = fakeClient(updateJson());
      final check =
          await AppUpdateApi(client: client).check('192.168.1.46:8080', _query);

      expect(check.status, AppUpdateStatus.available);
      final info = check.info!;
      expect(info.mandatory, isFalse);
      expect(info.release.versionName, '1.0.2');
      expect(info.release.versionCode, 2003);
      expect(info.release.notes, 'Arreglos en la guía');
      expect(info.release.publishedAt,
          DateTime.fromMillisecondsSinceEpoch(1726300000 * 1000));
      expect(info.file.abi, 'arm64-v8a');
      expect(info.file.size, 32145678);
      expect(info.file.sha256, _sha);
      expect(info.downloadUri.toString(),
          'http://192.168.1.46:8080/api/client/app-update/download/7');
    });

    test('sha256 en mayúsculas se acepta; URL absoluta se respeta', () {
      final check = AppUpdateApi.parse(
        updateJson(
            sha: _sha.toUpperCase(),
            url: 'https://cdn.midominio.co/app-arm64.apk'),
        'http://192.168.1.46:8080',
      );
      expect(check.info!.file.sha256, _sha);
      expect(check.info!.downloadUri.toString(),
          'https://cdn.midominio.co/app-arm64.apk');
    });

    test('sin versión nueva', () async {
      final (client, _) = fakeClient({'update': false});
      final check = await AppUpdateApi(client: client)
          .check('http://192.168.1.46:8080', _query);
      expect(check.status, AppUpdateStatus.upToDate);
      expect(check.info, isNull);
    });

    test('servidor que no es el portal o respuesta rara: silencioso', () async {
      Future<AppUpdateStatus> statusFor(Object? body, {int status = 200}) async {
        final (client, _) = fakeClient(body, status: status);
        return (await AppUpdateApi(client: client)
                .check('http://xtream-ajeno.com:8080', _query))
            .status;
      }

      expect(await statusFor('Not found', status: 404),
          AppUpdateStatus.unavailable);
      expect(await statusFor('<html>Panel</html>'), AppUpdateStatus.unavailable);
      expect(await statusFor({'user_info': {'auth': 0}}),
          AppUpdateStatus.unavailable);
      expect(await statusFor([1, 2, 3]), AppUpdateStatus.unavailable);
      expect(await statusFor(updateJson(sha: 'abc')),
          AppUpdateStatus.unavailable);
      expect(await statusFor({'update': true, 'release': {}, 'file': {}}),
          AppUpdateStatus.unavailable);

      final failing = MockClient((_) async => throw http.ClientException('sin red'));
      expect(
          (await AppUpdateApi(client: failing).check('http://192.168.1.46:8080', _query))
              .status,
          AppUpdateStatus.unavailable);
      expect((await AppUpdateApi(client: failing).check('', _query)).status,
          AppUpdateStatus.unavailable);
    });

    test('se rinde si el servidor no contesta a tiempo', () async {
      final hanging = MockClient((_) => Completer<http.Response>().future);
      final check = await AppUpdateApi(
        client: hanging,
        timeout: const Duration(milliseconds: 50),
      ).check('http://192.168.1.46:8080', _query);
      expect(check.status, AppUpdateStatus.unavailable);
    });
  });

  group('Reglas: obligatoria y "Más tarde"', () {
    test('opcional pregunta; obligatoria bloquea; sin versión no hace nada', () async {
      expect((await checkerWith(updateJson()).run('h:1', _query)).action,
          UpdateAction.prompt);
      expect(
          (await checkerWith(updateJson(mandatory: true)).run('h:1', _query))
              .action,
          UpdateAction.block);
      expect((await checkerWith({'update': false}).run('h:1', _query)).action,
          UpdateAction.none);
      expect(
          (await checkerWith('error', status: 500).run('h:1', _query)).action,
          UpdateAction.none);
    });

    test('"Más tarde" calla esa versión 24 h', () async {
      var now = DateTime(2026, 9, 15, 20, 0);
      final store = MemorySnoozeStore();
      final checker = checkerWith(updateJson(), store: store, clock: () => now);

      final first = await checker.run('h:1', _query);
      expect(first.action, UpdateAction.prompt);
      await checker.snooze(first.info!);

      now = now.add(const Duration(hours: 23, minutes: 59));
      expect((await checker.run('h:1', _query)).action, UpdateAction.snoozed);

      // La búsqueda manual ("Buscar actualizaciones") ignora el aplazamiento.
      expect((await checker.run('h:1', _query, manual: true)).action,
          UpdateAction.prompt);

      now = now.add(const Duration(minutes: 2));
      expect((await checker.run('h:1', _query)).action, UpdateAction.prompt);
    });

    test('aplazar una versión no calla la siguiente', () async {
      final now = DateTime(2026, 9, 15);
      final store = MemorySnoozeStore();
      final v2 = checkerWith(updateJson(), store: store, clock: () => now);
      await v2.snooze((await v2.run('h:1', _query)).info!);

      final v3 = checkerWith(
        updateJson(versionName: '1.0.3', versionCode: 2004),
        store: store,
        clock: () => now,
      );
      expect((await v3.run('h:1', _query)).action, UpdateAction.prompt);
    });

    test('obligatoria bloquea aunque se haya aplazado', () async {
      final now = DateTime(2026, 9, 15);
      final store = MemorySnoozeStore();
      final optional = checkerWith(updateJson(), store: store, clock: () => now);
      await optional.snooze((await optional.run('h:1', _query)).info!);

      final mandatory =
          checkerWith(updateJson(mandatory: true), store: store, clock: () => now);
      expect((await mandatory.run('h:1', _query)).action, UpdateAction.block);
    });
  });
}
