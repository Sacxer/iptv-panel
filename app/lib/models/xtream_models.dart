import 'dart:convert';

import 'json_utils.dart';
import 'media_item.dart';

/// `user_info` de `player_api.php`.
class XtreamUserInfo {
  final bool auth;
  final String username;
  final String status;
  final String message;
  final DateTime? expDate;
  final bool isTrial;
  final int activeConnections;
  final int maxConnections;
  final DateTime? createdAt;
  final List<String> allowedOutputFormats;

  const XtreamUserInfo({
    required this.auth,
    this.username = '',
    this.status = '',
    this.message = '',
    this.expDate,
    this.isTrial = false,
    this.activeConnections = 0,
    this.maxConnections = 0,
    this.createdAt,
    this.allowedOutputFormats = const [],
  });

  bool get isActive => status.toLowerCase() == 'active';

  factory XtreamUserInfo.fromJson(Map<String, dynamic> j) => XtreamUserInfo(
        auth: asBool(j['auth']),
        username: str(j['username']),
        status: str(j['status']),
        message: str(j['message']),
        expDate: asUnixDate(j['exp_date']),
        isTrial: asBool(j['is_trial']),
        activeConnections: asInt(j['active_cons']) ?? 0,
        maxConnections: asInt(j['max_connections']) ?? 0,
        createdAt: asUnixDate(j['created_at']),
        allowedOutputFormats: asStringList(j['allowed_output_formats']),
      );

  /// Mensaje en español según el estado de la cuenta.
  String get statusMessage {
    switch (status.toLowerCase()) {
      case 'active':
        return 'Activa';
      case 'expired':
        return 'Su suscripción ha vencido.';
      case 'banned':
        return 'Su cuenta está suspendida.';
      case 'disabled':
        return 'Su cuenta está deshabilitada.';
      default:
        return status.isEmpty ? 'Estado desconocido' : 'Estado: $status';
    }
  }

  String get statusLabel {
    switch (status.toLowerCase()) {
      case 'active':
        return 'Activa';
      case 'expired':
        return 'Vencida';
      case 'banned':
        return 'Suspendida';
      case 'disabled':
        return 'Deshabilitada';
      default:
        return status.isEmpty ? 'Desconocido' : status;
    }
  }
}

class XtreamServerInfo {
  final String url;
  final String port;
  final String protocol;
  final String timezone;
  final int? timestampNow;

  const XtreamServerInfo({
    this.url = '',
    this.port = '',
    this.protocol = 'http',
    this.timezone = '',
    this.timestampNow,
  });

  factory XtreamServerInfo.fromJson(Map<String, dynamic> j) => XtreamServerInfo(
        url: str(j['url']),
        port: str(j['port']),
        protocol: nonEmpty(j['server_protocol']) ?? 'http',
        timezone: str(j['timezone']),
        timestampNow: asInt(j['timestamp_now']),
      );
}

class XtreamAuthResponse {
  final XtreamUserInfo userInfo;
  final XtreamServerInfo serverInfo;

  const XtreamAuthResponse({required this.userInfo, required this.serverInfo});

  factory XtreamAuthResponse.fromJson(dynamic json) {
    final j = asMap(json);
    return XtreamAuthResponse(
      userInfo: XtreamUserInfo.fromJson(asMap(j['user_info'])),
      serverInfo: XtreamServerInfo.fromJson(asMap(j['server_info'])),
    );
  }
}

List<MediaCategory> parseXtreamCategories(dynamic json) => asList(json)
    .map((e) => MediaCategory.fromXtream(asMap(e)))
    .where((c) => c.id.isNotEmpty)
    .toList();

List<MediaItem> parseXtreamLive(dynamic json) => asList(json)
    .map((e) => MediaItem.fromXtreamLive(asMap(e)))
    .where((i) => i.id.isNotEmpty)
    .toList();

List<MediaItem> parseXtreamVod(dynamic json) => asList(json)
    .map((e) => MediaItem.fromXtreamVod(asMap(e)))
    .where((i) => i.id.isNotEmpty)
    .toList();

List<MediaItem> parseXtreamSeries(dynamic json) => asList(json)
    .map((e) => MediaItem.fromXtreamSeries(asMap(e)))
    .where((i) => i.id.isNotEmpty)
    .toList();

String? _firstImage(dynamic v) {
  final list = asStringList(v);
  return list.isEmpty ? null : list.first;
}

/// Respuesta de `get_vod_info`.
MovieDetail parseXtreamVodInfo(dynamic json, MediaItem fallback) {
  final j = asMap(json);
  final info = asMap(j['info']);
  final data = asMap(j['movie_data']);
  final rating = asDouble(info['rating']);
  final durationSecs = asInt(info['duration_secs']);
  String? duration = nonEmpty(info['duration']);
  if (duration == null && durationSecs != null && durationSecs > 0) {
    final h = durationSecs ~/ 3600;
    final m = (durationSecs % 3600) ~/ 60;
    duration = h > 0 ? '${h}h ${m}min' : '${m}min';
  }
  return MovieDetail(
    item: fallback,
    image: nonEmpty(info['movie_image']) ??
        nonEmpty(info['cover_big']) ??
        fallback.logo,
    backdrop: _firstImage(info['backdrop_path']),
    plot: nonEmpty(info['plot']) ?? nonEmpty(info['description']),
    genre: nonEmpty(info['genre']),
    releaseDate: nonEmpty(info['releasedate']) ?? nonEmpty(info['release_date']),
    rating: (rating != null && rating > 0)
        ? rating.toStringAsFixed(rating == rating.roundToDouble() ? 0 : 1)
        : fallback.rating,
    duration: duration,
    cast: nonEmpty(info['cast']) ?? nonEmpty(info['actors']),
    director: nonEmpty(info['director']),
    containerExtension:
        nonEmpty(data['container_extension']) ?? fallback.containerExtension,
  );
}

/// Respuesta de `get_series_info`. `episodes` puede venir como mapa
/// `{"1": [...]}` o como lista de listas según el panel.
SeriesDetail parseXtreamSeriesInfo(dynamic json, MediaItem fallback) {
  final j = asMap(json);
  final info = asMap(j['info']);
  final seasons = <int, List<MediaItem>>{};
  final rawEpisodes = j['episodes'];

  void addEpisode(dynamic raw, int? seasonHint) {
    final e = asMap(raw);
    final id = str(e['id']);
    if (id.isEmpty) return;
    final season = asInt(e['season']) ?? seasonHint ?? 1;
    final epNum = asInt(e['episode_num']);
    final epInfo = asMap(e['info']);
    final title = nonEmpty(e['title']) ??
        'Episodio ${epNum ?? (seasons[season]?.length ?? 0) + 1}';
    seasons.putIfAbsent(season, () => []).add(MediaItem(
          id: id,
          type: ContentType.episode,
          name: title,
          logo: nonEmpty(epInfo['movie_image']) ?? fallback.logo,
          containerExtension: nonEmpty(e['container_extension']) ?? 'mp4',
          plot: nonEmpty(epInfo['plot']),
          seriesId: fallback.id,
          seriesName: fallback.name,
          season: season,
          episodeNum: epNum,
          added: asInt(e['added']),
        ));
  }

  if (rawEpisodes is Map) {
    rawEpisodes.forEach((k, v) {
      final hint = asInt(k);
      for (final e in asList(v)) {
        addEpisode(e, hint);
      }
    });
  } else if (rawEpisodes is List) {
    for (final group in rawEpisodes) {
      if (group is List) {
        for (final e in group) {
          addEpisode(e, null);
        }
      } else {
        addEpisode(group, null);
      }
    }
  }
  for (final list in seasons.values) {
    list.sort((a, b) => (a.episodeNum ?? 0).compareTo(b.episodeNum ?? 0));
  }
  final rating = asDouble(info['rating']);
  return SeriesDetail(
    item: fallback,
    seasons: seasons,
    cover: nonEmpty(info['cover']) ?? fallback.logo,
    backdrop: _firstImage(info['backdrop_path']),
    plot: nonEmpty(info['plot']) ?? fallback.plot,
    genre: nonEmpty(info['genre']),
    releaseDate: nonEmpty(info['releaseDate']) ??
        nonEmpty(info['release_date']) ??
        fallback.releaseDate,
    rating: (rating != null && rating > 0)
        ? rating.toStringAsFixed(rating == rating.roundToDouble() ? 0 : 1)
        : fallback.rating,
    cast: nonEmpty(info['cast']),
    director: nonEmpty(info['director']),
  );
}

/// Decodifica base64 si el texto lo es (UTF-8 válido y legible); si no, lo devuelve igual.
String decodeMaybeBase64(dynamic v) {
  final s = str(v).trim();
  if (s.isEmpty) return '';
  final compact = s.replaceAll(RegExp(r'\s'), '');
  final looksBase64 = compact.length % 4 == 0 &&
      RegExp(r'^[A-Za-z0-9+/]+={0,2}$').hasMatch(compact);
  if (!looksBase64) return s;
  try {
    final decoded = utf8.decode(base64.decode(compact));
    if (decoded.isEmpty ||
        decoded.codeUnits.any((c) => c < 32 && c != 9 && c != 10 && c != 13)) {
      return s;
    }
    return decoded.trim();
  } catch (_) {
    return s;
  }
}

DateTime? _epgDate(dynamic timestamp, dynamic text) {
  final d = asUnixDate(timestamp);
  if (d != null) return d;
  final t = nonEmpty(text);
  if (t == null) return null;
  return DateTime.tryParse(t.replaceFirst(' ', 'T'));
}

/// Respuesta de `get_short_epg` / `get_simple_data_table`.
List<EpgEntry> parseXtreamShortEpg(dynamic json) {
  final list = asList(asMap(json)['epg_listings']);
  final entries = list.map((raw) {
    final e = asMap(raw);
    return EpgEntry(
      title: decodeMaybeBase64(e['title']),
      description: decodeMaybeBase64(e['description']),
      start: _epgDate(e['start_timestamp'], e['start']),
      end: _epgDate(e['stop_timestamp'], e['end'] ?? e['stop']),
    );
  }).where((e) => e.title.isNotEmpty).toList();
  entries.sort((a, b) {
    final sa = a.start, sb = b.start;
    if (sa == null || sb == null) return 0;
    return sa.compareTo(sb);
  });
  return entries;
}
