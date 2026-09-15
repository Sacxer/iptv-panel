import 'dart:convert';

import 'package:http/http.dart' as http;

import '../constants.dart';
import '../models/json_utils.dart';
import '../models/portal_models.dart';
import 'api_exception.dart';
import 'device.dart';
import 'xtream_api.dart';

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
  final String baseUrl;
  final String username;
  final String password;
  final http.Client _client;

  PortalApi({
    required String serverUrl,
    required this.username,
    required this.password,
    http.Client? client,
  })  : baseUrl = XtreamApi.normalizeServerUrl(serverUrl),
        _client = client ?? http.Client();

  Map<String, String> get _headers => {
        ...Device.headers,
        'Accept': 'application/json',
      };

  Map<String, String> get _jsonHeaders =>
      {..._headers, 'Content-Type': 'application/json'};

  /// `true` si el servidor es el portal propio. Nunca lanza excepción.
  Future<bool> ping() async {
    try {
      final res = await _client
          .get(Uri.parse('$baseUrl/api/client/ping'), headers: _headers)
          .timeout(AppConfig.pingTimeout);
      if (res.statusCode != 200) return false;
      final json = jsonDecode(utf8.decode(res.bodyBytes, allowMalformed: true));
      return json is Map && asBool(json['portal']);
    } catch (_) {
      return false;
    }
  }

  dynamic _decode(http.Response res) {
    if (res.statusCode != 200) throw ApiException.forStatus(res.statusCode);
    final body = utf8.decode(res.bodyBytes, allowMalformed: true);
    return body.trim().isEmpty ? const {} : jsonDecode(body);
  }

  Future<PortalInfo> info() async {
    try {
      final uri = Uri.parse('$baseUrl/api/client/info').replace(
        queryParameters: {'username': username, 'password': password},
      );
      final res = await _client
          .get(uri, headers: _headers)
          .timeout(AppConfig.apiTimeout);
      return PortalInfo.fromJson(_decode(res));
    } catch (e) {
      throw ApiException.from(e);
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
