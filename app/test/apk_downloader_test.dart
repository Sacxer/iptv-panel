import 'dart:io';

import 'package:crypto/crypto.dart' as crypto;
import 'package:flutter_test/flutter_test.dart';
import 'package:iptv_player/services/apk_downloader.dart';

/// Servidor de APK falso con soporte de `Range`.
class FakeApkServer {
  final List<int> data;

  /// En la primera petición, corta la conexión después de estos bytes (null = no corta).
  int? dropFirstAfter;

  /// Ignora `Range` y siempre responde 200 con todo.
  bool ignoreRange = false;

  /// Espera entre trozos (para poder cancelar a mitad).
  Duration chunkDelay = Duration.zero;

  final List<String?> ranges = [];
  late final HttpServer _server;
  int _requests = 0;

  FakeApkServer(this.data);

  Uri get uri => Uri.parse('http://127.0.0.1:${_server.port}/app.apk');

  Future<void> start() async {
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    _server.listen(_handle);
  }

  Future<void> close() => _server.close(force: true);

  Future<void> _handle(HttpRequest req) async {
    _requests++;
    final range = req.headers.value(HttpHeaders.rangeHeader);
    ranges.add(range);
    if (req.uri.path != '/app.apk') {
      req.response.statusCode = 404;
      await req.response.close();
      return;
    }
    var start = 0;
    final m = RegExp(r'bytes=(\d+)-').firstMatch(range ?? '');
    final res = req.response;
    if (m != null && !ignoreRange) {
      start = int.parse(m.group(1)!);
      res.statusCode = HttpStatus.partialContent;
      res.headers.set(HttpHeaders.contentRangeHeader,
          'bytes $start-${data.length - 1}/${data.length}');
    }
    res.headers.contentType = ContentType('application', 'vnd.android.package-archive');
    res.contentLength = data.length - start;

    final drop = _requests == 1 ? dropFirstAfter : null;
    if (drop != null) {
      final socket = await res.detachSocket();
      socket.add(data.sublist(start, start + drop));
      await socket.flush();
      socket.destroy();
      return;
    }
    const chunk = 16 * 1024;
    try {
      for (var i = start; i < data.length; i += chunk) {
        res.add(data.sublist(i, i + chunk > data.length ? data.length : i + chunk));
        if (chunkDelay > Duration.zero) {
          await res.flush();
          await Future<void>.delayed(chunkDelay);
        }
      }
      await res.close();
    } catch (_) {
      // El cliente canceló.
    }
  }
}

void main() {
  late Directory tmp;
  late List<int> data;
  late String hash;
  late FakeApkServer server;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('apk_downloader_test');
    data = List<int>.generate(300 * 1024, (i) => (i * 31 + 7) & 0xff);
    hash = crypto.sha256.convert(data).toString();
    server = FakeApkServer(data);
    await server.start();
  });

  tearDown(() async {
    await server.close();
    if (await tmp.exists()) await tmp.delete(recursive: true);
  });

  ApkDownloader downloader() => ApkDownloader(
        retryDelay: const Duration(milliseconds: 10),
        idleTimeout: const Duration(seconds: 5),
      );

  String target() => '${tmp.path}${Platform.pathSeparator}iptv-player-2003.apk';

  test('descarga completa, informa progreso y verifica sha256', () async {
    final progress = <int>[];
    final file = await downloader().download(
      uri: server.uri,
      targetPath: target(),
      sha256: hash.toUpperCase(),
      expectedSize: data.length,
      onProgress: (received, total) {
        expect(total, data.length);
        progress.add(received);
      },
    );
    expect(await file.readAsBytes(), data);
    expect(progress.last, data.length);
    expect(File('${target()}.part').existsSync(), isFalse);
    expect(server.ranges, [null]);
  });

  test('si se corta la conexión, continúa con Range', () async {
    server.dropFirstAfter = 100 * 1024;
    final file = await downloader().download(
      uri: server.uri,
      targetPath: target(),
      sha256: hash,
      expectedSize: data.length,
    );
    expect(await file.readAsBytes(), data);
    expect(server.ranges.first, isNull);
    expect(server.ranges.last, 'bytes=${100 * 1024}-');
  });

  test('si el servidor ignora Range, vuelve a empezar sin dañar el archivo', () async {
    server
      ..dropFirstAfter = 50 * 1024
      ..ignoreRange = true;
    final file = await downloader().download(
      uri: server.uri,
      targetPath: target(),
      sha256: hash,
      expectedSize: data.length,
    );
    expect(await file.readAsBytes(), data);
    expect(server.ranges.last, 'bytes=${50 * 1024}-');
  });

  test('sha256 distinto: borra lo descargado y avisa', () async {
    final wrong = '0' * 64;
    await expectLater(
      downloader().download(
        uri: server.uri,
        targetPath: target(),
        sha256: wrong,
        expectedSize: data.length,
      ),
      throwsA(isA<ApkDownloadException>()
          .having((e) => e.corrupted, 'corrupted', isTrue)),
    );
    expect(File(target()).existsSync(), isFalse);
    expect(File('${target()}.part').existsSync(), isFalse);
  });

  test('cancelar deja lo descargado para continuar después', () async {
    server.chunkDelay = const Duration(milliseconds: 20);
    final token = DownloadCancelToken();
    var cancelled = false;
    await expectLater(
      downloader().download(
        uri: server.uri,
        targetPath: target(),
        sha256: hash,
        expectedSize: data.length,
        cancelToken: token,
        onProgress: (received, _) {
          if (received >= 64 * 1024 && !cancelled) {
            cancelled = true;
            token.cancel();
          }
        },
      ),
      throwsA(isA<ApkDownloadCancelled>()),
    );
    final part = File('${target()}.part');
    expect(part.existsSync(), isTrue);
    final kept = part.lengthSync();
    expect(kept, greaterThan(0));

    server.chunkDelay = Duration.zero;
    final file = await downloader().download(
      uri: server.uri,
      targetPath: target(),
      sha256: hash,
      expectedSize: data.length,
    );
    expect(await file.readAsBytes(), data);
    expect(server.ranges.last, 'bytes=$kept-');
  });

  test('404: no reintenta y explica', () async {
    await expectLater(
      downloader().download(
        uri: server.uri.replace(path: '/no-existe.apk'),
        targetPath: target(),
        sha256: hash,
        expectedSize: data.length,
      ),
      throwsA(isA<ApkDownloadException>()
          .having((e) => e.retryable, 'retryable', isFalse)),
    );
    expect(server.ranges, hasLength(1));
  });

  test('si ya está descargado y es válido, no vuelve a bajarlo', () async {
    await File(target()).writeAsBytes(data);
    final file = await downloader().download(
      uri: server.uri,
      targetPath: target(),
      sha256: hash,
      expectedSize: data.length,
    );
    expect(file.path, target());
    expect(server.ranges, isEmpty);
  });
}
