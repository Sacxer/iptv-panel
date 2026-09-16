import 'dart:convert';

import 'package:http/http.dart' as http;

import '../constants.dart';
import '../models/json_utils.dart';
import '../models/portal_models.dart';
import 'api_exception.dart';
import 'device.dart';
import 'portal_relocator.dart';
import 'server_endpoint.dart';

/// Respuesta de `POST /api/client/playing`.
class PlayingResponse {
  final int? connectionId;
  final int intervalSeconds;

  const PlayingResponse({this.connectionId, this.intervalSeconds = 30});

  factory PlayingResponse.fromJson(dynamic json) {
    final j = asMap(json);
    final interval = asInt(j['interval_seconds']) ?? 30;
    return PlayingResponse(
      connectionId: asInt(j['connection_id']),
      intervalSeconds: interval.clamp(10, 600),
    );
  }
}

/// Cliente de la API de portal (`/api/client`) — funciones extra opcionales.
class PortalApi {
  /// Dirección del servidor (compartida con la API Xtream de la sesión).
  final ServerEndpoint endpoint;
  final String username;
  final String password;
  final http.Client _client;

  /// Si una petición falla por red, se llama; con `true` se repite una vez con la dirección nueva.
  ConnectionLostHandler? onConnectionLost;

  PortalApi({
    required String serverUrl,
    required this.username,
    required this.password,
    http.Client? client,
    ServerEndpoint? endpoint,
    this.onConnectionLost,
  })  : endpoint = endpoint ?? ServerEndpoint(serverUrl),
        _client = client ?? http.Client();

  String get baseUrl => endpoint.url;

  Map<String, String> get _headers => {
        ...Device.headers,
        'Accept': 'application/json',
      };

  Map<String, String> get _jsonHeaders =>
      {..._headers, 'Content-Type': 'application/json'};

  /// `true` si el servidor es el portal propio. Nunca lanza excepción.
  Future<bool> ping() async =>
      (await pingDetails()).status == PingStatus.portal;

  /// `/api/client/ping` con su identificador y puertos. Nunca lanza excepción.
  Future<PingResult> pingDetails() async {
    try {
      final res = await _client
          .get(Uri.parse('$baseUrl/api/client/ping'), headers: _headers)
          .timeout(AppConfig.pingTimeout);
      return PortalRelocator.parsePing(
          res.statusCode, utf8.decode(res.bodyBytes, allowMalformed: true));
    } catch (_) {
      return PingResult.unreachable;
    }
  }

  dynamic _decode(http.Response res) {
    final body = utf8.decode(res.bodyBytes, allowMalformed: true);
    if (res.statusCode != 200) {
      throw ApiException.forResponse(res.statusCode, body);
    }
    return body.trim().isEmpty ? const {} : jsonDecode(body);
  }

  /// Cuenta, avisos, mensajes y la identidad del portal (`server`).
  Future<PortalInfo> info({bool retried = false}) async {
    final usedBase = baseUrl;
    try {
      final uri = Uri.parse('$baseUrl/api/client/info').replace(
        queryParameters: {'username': username, 'password': password},
      );
      final res = await _client
          .get(uri, headers: _headers)
          .timeout(AppConfig.apiTimeout);
      return PortalInfo.fromJson(_decode(res));
    } catch (e) {
      final error = ApiException.from(e);
      final handler = onConnectionLost;
      if (!retried && error.canRelocate) {
        if (baseUrl != usedBase ||
            (handler != null &&
                await handler(error).catchError((Object _) => false))) {
          return info(retried: true);
        }
      }
      throw error;
    }
  }

  Future<void> markMessageRead(int id) async {
    try {
      final res = await _client
          .post(
            Uri.parse('$baseUrl/api/client/messages/$id/read'),
            headers: _jsonHeaders,
            body: jsonEncode({'username': username, 'password': password}),
          )
          .timeout(AppConfig.apiTimeout);
      _decode(res);
    } catch (e) {
      throw ApiException.from(e);
    }
  }

  /// Latido de reproducción. Lanza [ApiException] con `statusCode: 429` si se
  /// superó el límite de conexiones.
  Future<PlayingResponse> playing(String streamId, {int? connectionId}) async {
    try {
      final res = await _client
          .post(
            Uri.parse('$baseUrl/api/client/playing'),
            headers: _jsonHeaders,
            body: jsonEncode({
              'username': username,
              'password': password,
              'stream_id': asInt(streamId) ?? streamId,
              'connection_id': ?connectionId,
            }),
          )
          .timeout(AppConfig.apiTimeout);
      return PlayingResponse.fromJson(_decode(res));
    } catch (e) {
      throw ApiException.from(e);
    }
  }

  Future<void> stopped({int? connectionId}) async {
    try {
      final res = await _client
          .post(
            Uri.parse('$baseUrl/api/client/stopped'),
            headers: _jsonHeaders,
            body: jsonEncode({
              'username': username,
              'password': password,
              'connection_id': ?connectionId,
            }),
          )
          .timeout(const Duration(seconds: 10));
      _decode(res);
    } catch (e) {
      throw ApiException.from(e);
    }
  }

  void close() => _client.close();
}
