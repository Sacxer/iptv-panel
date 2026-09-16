import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../constants.dart';
import '../models/media_item.dart';
import '../models/xtream_models.dart';
import 'api_exception.dart';
import 'device.dart';

enum _ParseKind { categories, live, vod, series }

dynamic _parseInIsolate((String, _ParseKind) args) {
  final json = jsonDecode(args.$1);
  switch (args.$2) {
    case _ParseKind.categories:
      return parseXtreamCategories(json);
    case _ParseKind.live:
      return parseXtreamLive(json);
    case _ParseKind.vod:
      return parseXtreamVod(json);
    case _ParseKind.series:
      return parseXtreamSeries(json);
  }
}

/// Cliente de la API compatible Xtream Codes (`player_api.php`).
class XtreamApi {
  final String baseUrl;
  final String username;
  final String password;
  final http.Client _client;

  XtreamApi({
    required String serverUrl,
    required this.username,
    required this.password,
    http.Client? client,
  })  : baseUrl = normalizeServerUrl(serverUrl),
        _client = client ?? http.Client();

  static Map<String, String> get defaultHeaders => {
        ...Device.headers,
        'Accept': 'application/json, */*',
      };

  /// Normaliza la URL: agrega `http://`, quita `/` final y `player_api.php`.
  static String normalizeServerUrl(String input) {
    var s = input.trim();
    if (s.isEmpty) return s;
    if (!s.contains('://')) s = 'http://$s';
    final lower = s.toLowerCase();
    for (final suffix in ['/player_api.php', '/get.php', '/panel_api.php']) {
      final idx = lower.indexOf(suffix);
      if (idx >= 0) {
        s = s.substring(0, idx);
        break;
      }
    }
    final q = s.indexOf('?');
    if (q >= 0) s = s.substring(0, q);
    while (s.endsWith('/')) {
      s = s.substring(0, s.length - 1);
    }
    return s;
  }

  static bool isValidServerUrl(String input) {
    final uri = Uri.tryParse(normalizeServerUrl(input));
    return uri != null &&
        (uri.scheme == 'http' || uri.scheme == 'https') &&
        uri.host.isNotEmpty;
  }

  Uri _apiUri(Map<String, String> params) {
    final base = Uri.parse('$baseUrl/player_api.php');
    return base.replace(queryParameters: {
      'username': username,
      'password': password,
      ...params,
    });
  }

  Future<String> _getBody(Map<String, String> params,
      {Duration timeout = AppConfig.apiTimeout}) async {
    try {
      final res = await _client
          .get(_apiUri(params), headers: defaultHeaders)
          .timeout(timeout);
      if (res.statusCode != 200) {
        throw ApiException.forStatus(res.statusCode);
      }
      return utf8.decode(res.bodyBytes, allowMalformed: true);
    } catch (e) {
      throw ApiException.from(e);
    }
  }

  Future<dynamic> _getJson(Map<String, String> params,
      {Duration timeout = AppConfig.apiTimeout}) async {
    final body = await _getBody(params, timeout: timeout);
    try {
      return jsonDecode(body);
    } catch (e) {
      throw ApiException.from(const FormatException());
    }
  }

  Future<T> _getParsed<T>(_ParseKind kind, Map<String, String> params) async {
    final body = await _getBody(params, timeout: AppConfig.longTimeout);
    final trimmed = body.trimLeft();
    if (trimmed.isEmpty) return (<dynamic>[]) as T;
    try {
      // Listas grandes se procesan en un isolate para no bloquear la UI.
      final result = body.length > 100000
          ? await compute(_parseInIsolate, (body, kind))
          : _parseInIsolate((body, kind));
      return result as T;
    } catch (e) {
      throw ApiException.from(const FormatException());
    }
  }

  /// Autenticación. Lanza [ApiException] si falla la red; el llamador debe
  /// revisar `userInfo.auth` y `userInfo.status`.
  Future<XtreamAuthResponse> authenticate() async {
    final json = await _getJson(const {});
    if (json is! Map) {
      throw const ApiException(
          'El servidor no respondió como un servidor Xtream Codes. Verifique la URL.');
    }
    return XtreamAuthResponse.fromJson(json);
  }

  Future<List<MediaCategory>> getLiveCategories() async =>
      List<MediaCategory>.from(await _getParsed<List>(
          _ParseKind.categories, {'action': 'get_live_categories'}));

  Future<List<MediaCategory>> getVodCategories() async =>
      List<MediaCategory>.from(await _getParsed<List>(
          _ParseKind.categories, {'action': 'get_vod_categories'}));

  Future<List<MediaCategory>> getSeriesCategories() async =>
      List<MediaCategory>.from(await _getParsed<List>(
          _ParseKind.categories, {'action': 'get_series_categories'}));

  Future<List<MediaItem>> getLiveStreams({String? categoryId}) async =>
      List<MediaItem>.from(await _getParsed<List>(_ParseKind.live, {
        'action': 'get_live_streams',
        'category_id': ?categoryId,
      }));

  Future<List<MediaItem>> getVodStreams({String? categoryId}) async =>
      List<MediaItem>.from(await _getParsed<List>(_ParseKind.vod, {
        'action': 'get_vod_streams',
        'category_id': ?categoryId,
      }));

  Future<List<MediaItem>> getSeries({String? categoryId}) async =>
      List<MediaItem>.from(await _getParsed<List>(_ParseKind.series, {
        'action': 'get_series',
        'category_id': ?categoryId,
      }));

  Future<MovieDetail> getVodInfo(MediaItem movie) async {
    final json = await _getJson({'action': 'get_vod_info', 'vod_id': movie.id});
    return parseXtreamVodInfo(json, movie);
  }

  Future<SeriesDetail> getSeriesInfo(MediaItem series) async {
    final json =
        await _getJson({'action': 'get_series_info', 'series_id': series.id});
    return parseXtreamSeriesInfo(json, series);
  }

  Future<List<EpgEntry>> getShortEpg(String streamId, {int limit = 2}) async {
    final json = await _getJson({
      'action': 'get_short_epg',
      'stream_id': streamId,
      'limit': '$limit',
    }, timeout: const Duration(seconds: 12));
    return parseXtreamShortEpg(json);
  }

  /// Guía completa del canal (`get_simple_data_table`).
  Future<List<EpgEntry>> getFullEpg(String streamId) async {
    final json = await _getJson({
      'action': 'get_simple_data_table',
      'stream_id': streamId,
    }, timeout: const Duration(seconds: 20));
    return parseXtreamShortEpg(json);
  }

  String get _u => Uri.encodeComponent(username);
  String get _p => Uri.encodeComponent(password);

  String liveUrl(String streamId, {String format = 'ts'}) =>
      '$baseUrl/live/$_u/$_p/$streamId.$format';

  String movieUrl(String streamId, String? ext) =>
      '$baseUrl/movie/$_u/$_p/$streamId.${ext ?? 'mp4'}';

  String episodeUrl(String episodeId, String? ext) =>
      '$baseUrl/series/$_u/$_p/$episodeId.${ext ?? 'mp4'}';

  void close() => _client.close();
}
