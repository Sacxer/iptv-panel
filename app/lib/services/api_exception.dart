import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;

/// Tipo de error, para decidir si vale la pena buscar el servidor en otra dirección.
enum ApiErrorKind {
  /// No se pudo conectar (rechazada, sin ruta, DNS…).
  network,

  /// El servidor no respondió a tiempo.
  timeout,

  /// Respondió el puerto del panel: los clientes usan otro puerto.
  panelPort,

  /// Respuesta HTTP con error (401, 403, 404, 5xx…).
  http,

  /// Respuesta que no se pudo interpretar.
  format,

  other,
}

/// Error de red / API con mensaje legible en español.
class ApiException implements Exception {
  final String message;
  final int? statusCode;
  final ApiErrorKind kind;

  /// Puerto de clientes que indicó el portal (solo con [ApiErrorKind.panelPort]).
  final int? clientPort;

  const ApiException(
    this.message, {
    this.statusCode,
    this.kind = ApiErrorKind.other,
    this.clientPort,
  });

  /// Errores por los que el portal pudo haber cambiado de dirección.
  bool get canRelocate =>
      kind == ApiErrorKind.network ||
      kind == ApiErrorKind.timeout ||
      kind == ApiErrorKind.panelPort;

  @override
  String toString() => message;

  static final RegExp _panelPort =
      RegExp(r'clientes usan el puerto (\d{1,5})', caseSensitive: false);

  /// Convierte cualquier excepción en un [ApiException] con mensaje amigable.
  static ApiException from(Object error) {
    if (error is ApiException) return error;
    if (error is TimeoutException) {
      return const ApiException(
          'El servidor tardó demasiado en responder. Inténtelo de nuevo.',
          kind: ApiErrorKind.timeout);
    }
    if (error is HandshakeException || error is TlsException) {
      return const ApiException(
          'Error de conexión segura (SSL). Pruebe con http:// en lugar de https://.');
    }
    if (error is SocketException || error is http.ClientException) {
      return const ApiException(
          'No se pudo conectar con el servidor. Verifique la URL y su conexión a Internet.',
          kind: ApiErrorKind.network);
    }
    if (error is FormatException) {
      return const ApiException(
          'Respuesta inválida del servidor. Verifique que la URL sea correcta.',
          kind: ApiErrorKind.format);
    }
    if (error is FileSystemException) {
      return ApiException('No se pudo leer el archivo: ${error.message}');
    }
    return ApiException('Error inesperado: $error');
  }

  /// Como [forStatus], pero reconoce el 404 del puerto del panel del portal
  /// ("Este es el puerto del panel. Los clientes usan el puerto N.").
  static ApiException forResponse(int code, String body) {
    if (code == 404) {
      final m = _panelPort.firstMatch(body);
      final port = m == null ? null : int.tryParse(m.group(1)!);
      if (port != null) {
        return ApiException(
          'Esta dirección es la del panel del servidor; las apps usan el puerto $port.',
          statusCode: 404,
          kind: ApiErrorKind.panelPort,
          clientPort: port,
        );
      }
    }
    return forStatus(code);
  }

  static ApiException forStatus(int code) {
    if (code == 401) {
      return const ApiException('Usuario o contraseña incorrectos.',
          statusCode: 401, kind: ApiErrorKind.http);
    }
    if (code == 403) {
      return const ApiException(
          'Acceso denegado. Su cuenta no tiene acceso a este contenido.',
          statusCode: 403,
          kind: ApiErrorKind.http);
    }
    if (code == 404) {
      return const ApiException(
          'No se encontró el recurso en el servidor (404). Verifique la URL.',
          statusCode: 404,
          kind: ApiErrorKind.http);
    }
    if (code == 429) {
      return const ApiException('Límite de conexiones alcanzado.',
          statusCode: 429, kind: ApiErrorKind.http);
    }
    if (code >= 500) {
      return ApiException('Error del servidor ($code). Inténtelo más tarde.',
          statusCode: code, kind: ApiErrorKind.http);
    }
    return ApiException('Respuesta inesperada del servidor ($code).',
        statusCode: code, kind: ApiErrorKind.http);
  }
}

/// Se llama cuando una petición falla por red / puerto del panel. Si devuelve `true`, el
/// servidor está en otra dirección (ya actualizada) y la petición se repite una vez.
typedef ConnectionLostHandler = Future<bool> Function(ApiException error);
