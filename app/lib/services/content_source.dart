import 'dart:io';

import 'package:http/http.dart' as http;

import '../constants.dart';
import '../models/media_item.dart';
import '../models/profile.dart';
import 'api_exception.dart';
import 'device.dart';
import 'm3u_parser.dart';
import 'xtream_api.dart';

/// Fuente de contenido unificada (Xtream o M3U).
abstract class ContentSource {
  /// Si la sección Series tiene contenido/soporte.
  bool get supportsSeries;
  bool get supportsMovies;
  bool get supportsEpg;

  Future<List<MediaCategory>> categories(ContentType type);

  /// Todos los ítems del tipo (en caché tras la primera carga).
  Future<List<MediaItem>> items(ContentType type);

  Future<MovieDetail> movieDetail(MediaItem item);
  Future<SeriesDetail> seriesDetail(MediaItem item);
  Future<List<EpgEntry>> shortEpg(MediaItem item);
  Future<List<EpgEntry>> fullEpg(MediaItem item);

  /// URL de reproducción.
  String streamUrl(MediaItem item);

  void clearCache();
  void dispose();
}

class XtreamSource extends ContentSource {
  final XtreamApi api;
  String liveFormat;

  XtreamSource(this.api, {this.liveFormat = 'ts'});

  final Map<ContentType, Future<List<MediaCategory>>> _rawCats = {};
  final Map<ContentType, Future<List<MediaCategory>>> _cats = {};
  final Map<ContentType, Future<List<MediaItem>>> _items = {};

  @override
  bool get supportsSeries => true;
  @override
  bool get supportsMovies => true;
  @override
  bool get supportsEpg => true;

  Future<T> _cached<T>(Map<ContentType, Future<T>> cache, ContentType type,
      Future<T> Function() loader) {
    final existing = cache[type];
    if (existing != null) return existing;
    final future = loader();
    cache[type] = future;
    // Si falla, se quita de la caché para permitir reintentar.
    future.then((_) {}, onError: (Object _) {
      if (identical(cache[type], future)) cache.remove(type);
    });
    return future;
  }

  static ContentType _norm(ContentType t) =>
      t == ContentType.episode ? ContentType.series : t;

  Future<List<MediaCategory>> _rawCategories(ContentType type) =>
      _cached(_rawCats, _norm(type), () {
        switch (_norm(type)) {
          case ContentType.live:
            return api.getLiveCategories();
          case ContentType.movie:
            return api.getVodCategories();
          default:
            return api.getSeriesCategories();
        }
      });

  @override
  Future<List<MediaCategory>> categories(ContentType type) {
    return _cached(_cats, _norm(type), () async {
      final all = await items(type);
      final cats = await _rawCategories(type);
      final counts = <String, int>{};
      for (final i in all) {
        final c = i.categoryId;
        if (c != null) counts[c] = (counts[c] ?? 0) + 1;
      }
      return cats.map((c) => c.withCount(counts[c.id] ?? 0)).toList();
    });
  }

  @override
  Future<List<MediaItem>> items(ContentType type) {
    return _cached(_items, _norm(type), () async {
      final catsFuture = _rawCategories(type);
      final Future<List<MediaItem>> itemsFuture;
      switch (_norm(type)) {
        case ContentType.live:
          itemsFuture = api.getLiveStreams();
        case ContentType.movie:
          itemsFuture = api.getVodStreams();
        default:
          itemsFuture = api.getSeries();
      }
      final list = await itemsFuture;
      // Si las categorías fallan, los ítems se muestran igualmente.
      final cats =
          await catsFuture.catchError((Object _) => const <MediaCategory>[]);
      final names = {for (final c in cats) c.id: c.name};
      for (final i in list) {
        i.categoryName = names[i.categoryId];
      }
      return list;
    });
  }

  @override
  Future<MovieDetail> movieDetail(MediaItem item) => api.getVodInfo(item);

  @override
  Future<SeriesDetail> seriesDetail(MediaItem item) async {
    final d = await api.getSeriesInfo(item);
    for (final eps in d.seasons.values) {
      for (final e in eps) {
        e.categoryName = item.categoryName;
      }
    }
    return d;
  }

  @override
  Future<List<EpgEntry>> shortEpg(MediaItem item) async {
    if (item.type != ContentType.live) return const [];
    return api.getShortEpg(item.id);
  }

  @override
  Future<List<EpgEntry>> fullEpg(MediaItem item) async {
    if (item.type != ContentType.live) return const [];
    return api.getFullEpg(item.id);
  }

  @override
  String streamUrl(MediaItem item) {
    if (item.url != null && item.url!.startsWith('http')) {
      return item.url!;
    }
    switch (item.type) {
      case ContentType.live:
        return api.liveUrl(item.id, format: liveFormat);
      case ContentType.movie:
        return api.movieUrl(item.id, item.containerExtension);
      case ContentType.episode:
        return api.episodeUrl(item.id, item.containerExtension);
      case ContentType.series:
        return '';
    }
  }

  @override
  void clearCache() {
    _rawCats.clear();
    _cats.clear();
    _items.clear();
  }

  @override
  void dispose() => api.close();
}

class M3uSource extends ContentSource {
  PlaylistData data;
  final Profile profile;

  M3uSource(this.profile, this.data);

  /// Descarga (URL) o lee (archivo) la lista y la analiza en un isolate.
  static Future<PlaylistData> loadPlaylist(Profile profile) async {
    try {
      if (profile.type == ProfileType.m3uFile) {
        final file = File(profile.filePath);
        if (!await file.exists()) {
          throw const ApiException(
              'No se encontró el archivo de la lista. Edite el perfil y selecciónelo de nuevo.');
        }
        final bytes = await file.readAsBytes();
        return await parsePlaylistBytesInBackground(bytes);
      }
      var url = profile.m3uUrl.trim();
      if (!url.contains('://')) url = 'http://$url';
      final uri = Uri.tryParse(url);
      if (uri == null || uri.host.isEmpty) {
        throw const ApiException('La URL de la lista no es válida.');
      }
      final client = http.Client();
      try {
        final res = await client
            .get(uri, headers: Device.headers)
            .timeout(AppConfig.longTimeout);
        if (res.statusCode != 200) throw ApiException.forStatus(res.statusCode);
        return await parsePlaylistBytesInBackground(res.bodyBytes);
      } finally {
        client.close();
      }
    } catch (e) {
      throw ApiException.from(e);
    }
  }

  @override
  bool get supportsSeries => data.hasSeries;
  @override
  bool get supportsMovies => data.hasMovies;
  @override
  bool get supportsEpg => false;

  @override
  Future<List<MediaCategory>> categories(ContentType type) async =>
      data.categoriesOf(type);

  @override
  Future<List<MediaItem>> items(ContentType type) async => data.itemsOf(type);

  @override
  Future<MovieDetail> movieDetail(MediaItem item) async =>
      MovieDetail(item: item, image: item.logo);

  @override
  Future<SeriesDetail> seriesDetail(MediaItem item) async {
    final eps = data.seriesEpisodes[item.id] ?? const <MediaItem>[];
    final seasons = <int, List<MediaItem>>{};
    for (final e in eps) {
      seasons.putIfAbsent(e.season ?? 1, () => []).add(e);
    }
    return SeriesDetail(item: item, seasons: seasons, cover: item.logo);
  }

  @override
  Future<List<EpgEntry>> shortEpg(MediaItem item) async => const [];

  @override
  Future<List<EpgEntry>> fullEpg(MediaItem item) async => const [];

  @override
  String streamUrl(MediaItem item) => item.url ?? '';

  @override
  void clearCache() {}

  @override
  void dispose() {}
}
