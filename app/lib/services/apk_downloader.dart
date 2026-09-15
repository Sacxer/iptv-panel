/// Descarga del APK de actualización: progreso, cancelación, reanudación con `Range`
/// si se corta la conexión y verificación sha256 antes de entregarlo.
///
/// No depende de Flutter (solo `dart:io`, `http` y `crypto`).
library;

import 'dart:async';
import 'dart:io';
import 'dart:isolate';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

typedef DownloadProgress = void Function(int received, int total);

class DownloadCancelToken {
  final _completer = Completer<void>();

  bool get isCancelled => _completer.isCompleted;

  Future<void> get whenCancelled => _completer.future;

  void cancel() {
    if (!_completer.isCompleted) _completer.complete();
  }
}

/// El usuario canceló la descarga (se conserva lo descargado para continuar después).
class ApkDownloadCancelled implements Exception {
  const ApkDownloadCancelled();

  @override
  String toString() => 'Descarga cancelada';
}

class ApkDownloadException implements Exception {
  final String message;

  /// Se puede reintentar automáticamente (corte de red, error 5xx).
  final bool retryable;

  /// El archivo no coincidió con el sha256 esperado (ya se borró).
  final bool corrupted;

  /// Lo descargado no sirve y hay que borrarlo.
  final bool discardPartial;

  const ApkDownloadException(this.message,
      {this.retryable = false,
      this.corrupted = false,
      this.discardPartial = false});

  @override
  String toString() => message;
}

class ApkDownloader {
  final http.Client Function() _newClient;
  final Map<String, String> headers;

  /// Tiempo máximo sin recibir datos antes de reintentar.
  final Duration idleTimeout;

  /// Reintentos seguidos sin avanzar antes de rendirse.
  final int maxRetries;
  final Duration retryDelay;

  ApkDownloader({
    http.Client Function()? clientFactory,
    this.headers = const {},
    this.idleTimeout = const Duration(seconds: 30),
    this.maxRetries = 6,
    this.retryDelay = const Duration(seconds: 3),
  }) : _newClient = clientFactory ?? http.Client.new;

  /// Descarga [uri] en [targetPath] (usa `targetPath.part` mientras tanto) y devuelve el
  /// archivo ya verificado. Si ya existe completo y válido, no lo vuelve a bajar.
  ///
  /// [beforeRetry] se espera antes de cada reintento: la app lo usa para no gastar reintentos
  /// mientras está en segundo plano o con la pantalla apagada (continúa al volver).
  Future<File> download({
    required Uri uri,
    required String targetPath,
    required String sha256,
    int expectedSize = 0,
    DownloadProgress? onProgress,
    DownloadCancelToken? cancelToken,
    Future<void> Function()? beforeRetry,
  }) async {
    final target = File(targetPath);
    final part = File('$targetPath.part');
    final expectedHash = sha256.toLowerCase();

    if (await target.exists()) {
      if ((expectedSize <= 0 || await target.length() == expectedSize) &&
          await sha256OfFile(target.path) == expectedHash) {
        onProgress?.call(await target.length(), await target.length());
        return target;
      }
      await target.delete();
    }

    var failures = 0;
    while (true) {
      _throwIfCancelled(cancelToken);
      var have = await part.exists() ? await part.length() : 0;
      if (expectedSize > 0 && have > expectedSize) {
        await part.delete();
        have = 0;
      }
      if (expectedSize > 0 && have == expectedSize) break;

      final client = _newClient();
      var progressed = false;
      try {
        final req = http.AbortableRequest('GET', uri,
            abortTrigger: cancelToken?.whenCancelled);
        req.headers.addAll(headers);
        if (have > 0) req.headers[HttpHeaders.rangeHeader] = 'bytes=$have-';
        final res = await client.send(req).timeout(idleTimeout);

        if (res.statusCode == 416) {
          // Lo guardado no sirve para continuar: empezar de cero.
          await res.stream.drain<void>().catchError((_) {});
          if (await part.exists()) await part.delete();
          throw const ApkDownloadException('Rango no válido', retryable: true);
        }
        if (res.statusCode != 200 && res.statusCode != 206) {
          await res.stream.drain<void>().catchError((_) {});
          throw ApkDownloadException(
            res.statusCode == 404
                ? 'La actualización ya no está disponible en el servidor.'
                : 'El servidor respondió con un error (${res.statusCode}).',
            retryable: res.statusCode >= 500,
          );
        }

        // 206 que continúa justo donde quedamos: se agrega. Si no, se reescribe desde cero.
        final append = res.statusCode == 206 &&
            have > 0 &&
            _rangeStart(res.headers['content-range']) == have;
        if (!append) have = 0;
        final total = expectedSize > 0
            ? expectedSize
            : (res.contentLength != null ? have + res.contentLength! : 0);

        final sink =
            part.openWrite(mode: append ? FileMode.append : FileMode.write);
        try {
          await for (final chunk in res.stream.timeout(idleTimeout)) {
            _throwIfCancelled(cancelToken);
            sink.add(chunk);
            have += chunk.length;
            progressed = true;
            onProgress?.call(have, total);
            if (expectedSize > 0 && have > expectedSize) {
              throw const ApkDownloadException(
                  'El archivo del servidor no coincide con la actualización anunciada.',
                  discardPartial: true);
            }
          }
        } finally {
          await sink.flush().catchError((_) {});
          await sink.close().catchError((_) {});
        }
        if (expectedSize <= 0 || have >= expectedSize) break;
        // Terminó antes de tiempo sin error: se continúa con Range.
        throw const ApkDownloadException('Conexión cortada', retryable: true);
      } on ApkDownloadCancelled {
        rethrow;
      } on ApkDownloadException catch (e) {
        if (!e.retryable) {
          if (e.discardPartial && await part.exists()) await part.delete();
          rethrow;
        }
        failures = progressed ? 1 : failures + 1;
      } on FileSystemException catch (e) {
        throw ApkDownloadException(
            'No se pudo guardar la descarga (¿falta espacio?): ${e.message}');
      } catch (_) {
        // Corte de red, tiempo agotado, cancelación a mitad de la respuesta…
        _throwIfCancelled(cancelToken);
        failures = progressed ? 1 : failures + 1;
      } finally {
        client.close();
      }

      if (failures > maxRetries) {
        // Lo descargado se conserva: al reintentar continúa donde quedó.
        throw const ApkDownloadException(
            'No se pudo descargar: la conexión se cortó varias veces. Revisa la red e inténtalo de nuevo.',
            retryable: true);
      }
      await _sleep(retryDelay, cancelToken);
      if (beforeRetry != null) {
        await beforeRetry();
        _throwIfCancelled(cancelToken);
      }
    }

    // Verificación antes de instalar.
    final size = await part.length();
    if (expectedSize > 0 && size != expectedSize) {
      await part.delete();
      throw const ApkDownloadException(
          'La descarga quedó incompleta. Se borró el archivo; inténtalo de nuevo.',
          corrupted: true);
    }
    final hash = await sha256OfFile(part.path);
    if (hash != expectedHash) {
      await part.delete();
      throw const ApkDownloadException(
          'La descarga está dañada (la verificación sha256 no coincide). '
          'Se borró el archivo; inténtalo de nuevo.',
          corrupted: true);
    }
    if (await target.exists()) await target.delete();
    return part.rename(target.path);
  }

  /// Borra descargas viejas de [dir] (menos [keepName] y su `.part`).
  Future<void> removeOtherDownloads(String dir, String keepName) async {
    try {
      await for (final entity in Directory(dir).list()) {
        if (entity is! File) continue;
        final name = entity.uri.pathSegments.isEmpty
            ? ''
            : entity.uri.pathSegments.last;
        if (name != keepName && name != '$keepName.part') await entity.delete();
      }
    } catch (_) {
      // Limpieza opcional.
    }
  }

  static int? _rangeStart(String? contentRange) {
    // "bytes 1000-1999/2000"
    final m = RegExp(r'bytes\s+(\d+)-').firstMatch(contentRange ?? '');
    return m == null ? null : int.tryParse(m.group(1)!);
  }

  static void _throwIfCancelled(DownloadCancelToken? token) {
    if (token?.isCancelled ?? false) throw const ApkDownloadCancelled();
  }

  static Future<void> _sleep(Duration d, DownloadCancelToken? token) async {
    if (token == null) return Future<void>.delayed(d);
    await Future.any<void>([Future<void>.delayed(d), token.whenCancelled]);
    _throwIfCancelled(token);
  }

  /// sha256 (hex en minúsculas) de un archivo, calculado fuera del hilo de la interfaz.
  static Future<String> sha256OfFile(String path) {
    Future<String> compute() async =>
        (await sha256.bind(File(path).openRead()).first).toString();
    return Isolate.run(compute).catchError((Object _) => compute());
  }
}
