import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;

/// Error de red / API con mensaje legible en español.
class ApiException implements Exception {
  final String message;
  final int? statusCode;

  const ApiException(this.message, {this.statusCode});

  @override
  String toString() => message;

  /// Convierte cualquier excepción en un [ApiException] con mensaje amigable.
  static ApiException from(Object error) {
    if (error is ApiException) return error;
    if (error is TimeoutException) {
      return const ApiException(
          'El servidor tardó demasiado en responder. Inténtelo de nuevo.');
    }
    if (error is HandshakeException || error is TlsException) {
      return const ApiException(
          'Error de conexión segura (SSL). Pruebe con http:// en lugar de https://.');
    }
    if (error is SocketException || error is http.ClientException) {
      return const ApiException(
          'No se pudo conectar con el servidor. Verifique la URL y su conexión a Internet.');
    }
    if (error is FormatException) {
      return const ApiException(
          'Respuesta inválida del servidor. Verifique que la URL sea correcta.');
    }
    if (error is FileSystemException) {
      return ApiException('No se pudo leer el archivo: ${error.message}');
    }
    return ApiException('Error inesperado: $error');
  }

  static ApiException forStatus(int code) {
    if (code == 401) {
      return const ApiException('Usuario o contraseña incorrectos.',
          statusCode: 401);
    }
    if (code == 403) {
      return const ApiException(
          'Acceso denegado. Su cuenta no tiene acceso a este contenido.',
          statusCode: 403);
    }
    if (code == 404) {
      return const ApiException(
          'No se encontró el recurso en el servidor (404). Verifique la URL.',
          statusCode: 404);
    }
    if (code == 429) {
      return const ApiException(
          'Límite de conexiones alcanzado.',
          statusCode: 429);
    }
    if (code >= 500) {
      return ApiException('Error del servidor ($code). Inténtelo más tarde.',
          statusCode: code);
    }
    return ApiException('Respuesta inesperada del servidor ($code).',
        statusCode: code);
  }
}
