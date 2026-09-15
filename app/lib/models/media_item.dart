import 'json_utils.dart';

enum ContentType { live, movie, series, episode }

extension ContentTypeLabel on ContentType {
  String get label {
    switch (this) {
      case ContentType.live:
        return 'TV en vivo';
      case ContentType.movie:
        return 'Película';
      case ContentType.series:
        return 'Serie';
      case ContentType.episode:
        return 'Episodio';
    }
  }
}

/// Categoría de contenido.
class MediaCategory {
  final String id;
  final String name;
  final int count;

  const MediaCategory({required this.id, required this.name, this.count = 0});

  /// Id de la pseudo-categoría "Todos".
  static const String allId = '__all__';

  factory MediaCategory.fromXtream(Map<String, dynamic> j) => MediaCategory(
        id: str(j['category_id']),
        name: nonEmpty(j['category_name']) ?? 'Sin nombre',
      );

  MediaCategory withCount(int c) => MediaCategory(id: id, name: name, count: c);
}

/// Elemento reproducible o navegable (canal, película, serie o episodio).
///
/// Es un modelo unificado para Xtream y M3U; se serializa para favoritos y recientes.
class MediaItem {
  final String id;
  final ContentType type;
  final String name;
  final String? logo;
  final String? categoryId;
  String? categoryName;

  /// URL directa (M3U). En Xtream se construye con [streamId] y la extensión.
  final String? url;
  final String? containerExtension;
  final int? num;
  final String? epgChannelId;
  final String? rating;
  final String? plot;
  final String? releaseDate;
  final int? added;

  /// Episodios: serie a la que pertenecen.
  final String? seriesId;
  final String? seriesName;
  final int? season;
  final int? episodeNum;

  MediaItem({
    required this.id,
    required this.type,
    required this.name,
    this.logo,
    this.categoryId,
    this.categoryName,
    this.url,
    this.containerExtension,
    this.num,
    this.epgChannelId,
    this.rating,
    this.plot,
    this.releaseDate,
    this.added,
    this.seriesId,
    this.seriesName,
    this.season,
    this.episodeNum,
  });

  /// Clave única para favoritos/recientes.
  String get key => '${type.name}:$id';

  bool get isPlayable => type != ContentType.series;
  bool get isVod => type == ContentType.movie || type == ContentType.episode;

  String? _search;

  /// Nombre normalizado (minúsculas, sin tildes) para búsquedas.
  String get searchKey => _search ??= normalizeSearch(name);

  // ---------- Xtream ----------

  factory MediaItem.fromXtreamLive(Map<String, dynamic> j) => MediaItem(
        id: str(j['stream_id']),
        type: ContentType.live,
        name: nonEmpty(j['name']) ?? 'Canal',
        logo: nonEmpty(j['stream_icon']),
        categoryId: nonEmpty(j['category_id']),
        num: asInt(j['num']),
        epgChannelId: nonEmpty(j['epg_channel_id']),
        added: asInt(j['added']),
      );

  factory MediaItem.fromXtreamVod(Map<String, dynamic> j) => MediaItem(
        id: str(j['stream_id']),
        type: ContentType.movie,
        name: nonEmpty(j['name']) ?? 'Película',
        logo: nonEmpty(j['stream_icon']) ?? nonEmpty(j['cover']),
        categoryId: nonEmpty(j['category_id']),
        num: asInt(j['num']),
        rating: _rating(j['rating']),
        containerExtension: nonEmpty(j['container_extension']),
        added: asInt(j['added']),
      );

  factory MediaItem.fromXtreamSeries(Map<String, dynamic> j) => MediaItem(
        id: str(j['series_id']),
        type: ContentType.series,
        name: nonEmpty(j['name']) ?? 'Serie',
        logo: nonEmpty(j['cover']),
        categoryId: nonEmpty(j['category_id']),
        num: asInt(j['num']),
        rating: _rating(j['rating']),
        plot: nonEmpty(j['plot']),
        releaseDate: nonEmpty(j['releaseDate']) ?? nonEmpty(j['release_date']),
        added: asInt(j['last_modified']),
      );

  static String? _rating(dynamic v) {
    final d = asDouble(v);
    if (d == null || d <= 0) return null;
    return d == d.roundToDouble() ? d.toInt().toString() : d.toStringAsFixed(1);
  }

  // ---------- JSON (persistencia) ----------

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type.name,
        'name': name,
        if (logo != null) 'logo': logo,
        if (categoryId != null) 'categoryId': categoryId,
        if (categoryName != null) 'categoryName': categoryName,
        if (url != null) 'url': url,
        if (containerExtension != null) 'ext': containerExtension,
        if (num != null) 'num': num,
        if (epgChannelId != null) 'epg': epgChannelId,
        if (rating != null) 'rating': rating,
        if (releaseDate != null) 'releaseDate': releaseDate,
        if (seriesId != null) 'seriesId': seriesId,
        if (seriesName != null) 'seriesName': seriesName,
        if (season != null) 'season': season,
        if (episodeNum != null) 'episodeNum': episodeNum,
      };

  factory MediaItem.fromJson(Map<String, dynamic> j) {
    final t = str(j['type']);
    return MediaItem(
      id: str(j['id']),
      type: ContentType.values.firstWhere((e) => e.name == t,
          orElse: () => ContentType.live),
      name: str(j['name']),
      logo: nonEmpty(j['logo']),
      categoryId: nonEmpty(j['categoryId']),
      categoryName: nonEmpty(j['categoryName']),
      url: nonEmpty(j['url']),
      containerExtension: nonEmpty(j['ext']),
      num: asInt(j['num']),
      epgChannelId: nonEmpty(j['epg']),
      rating: nonEmpty(j['rating']),
      releaseDate: nonEmpty(j['releaseDate']),
      seriesId: nonEmpty(j['seriesId']),
      seriesName: nonEmpty(j['seriesName']),
      season: asInt(j['season']),
      episodeNum: asInt(j['episodeNum']),
    );
  }
}

/// Detalle de película.
class MovieDetail {
  final MediaItem item;
  final String? image;
  final String? backdrop;
  final String? plot;
  final String? genre;
  final String? releaseDate;
  final String? rating;
  final String? duration;
  final String? cast;
  final String? director;
  final String? containerExtension;

  const MovieDetail({
    required this.item,
    this.image,
    this.backdrop,
    this.plot,
    this.genre,
    this.releaseDate,
    this.rating,
    this.duration,
    this.cast,
    this.director,
    this.containerExtension,
  });
}

/// Detalle de serie con temporadas y episodios.
class SeriesDetail {
  final MediaItem item;
  final String? cover;
  final String? backdrop;
  final String? plot;
  final String? genre;
  final String? releaseDate;
  final String? rating;
  final String? cast;
  final String? director;

  /// Temporada → episodios (ordenados).
  final Map<int, List<MediaItem>> seasons;

  const SeriesDetail({
    required this.item,
    required this.seasons,
    this.cover,
    this.backdrop,
    this.plot,
    this.genre,
    this.releaseDate,
    this.rating,
    this.cast,
    this.director,
  });

  List<int> get seasonNumbers => seasons.keys.toList()..sort();
}

/// Programa de la guía (EPG corta).
class EpgEntry {
  final String title;
  final String description;
  final DateTime? start;
  final DateTime? end;

  const EpgEntry({
    required this.title,
    this.description = '',
    this.start,
    this.end,
  });

  bool isNowAt(DateTime now) =>
      start != null &&
      end != null &&
      !now.isBefore(start!) &&
      now.isBefore(end!);

  /// Progreso 0..1 del programa en [now].
  double progressAt(DateTime now) {
    if (start == null || end == null) return 0;
    final total = end!.difference(start!).inSeconds;
    if (total <= 0) return 0;
    return (now.difference(start!).inSeconds / total).clamp(0.0, 1.0);
  }
}

/// Programa actual y siguiente de un canal.
class NowNext {
  final EpgEntry? now;
  final EpgEntry? next;
  const NowNext(this.now, this.next);

  bool get isEmpty => now == null && next == null;

  static const empty = NowNext(null, null);

  /// Calcula ahora/después a partir de una lista ordenada.
  factory NowNext.from(List<EpgEntry> list, DateTime at) {
    if (list.isEmpty) return empty;
    for (var i = 0; i < list.length; i++) {
      final e = list[i];
      if (e.isNowAt(at)) {
        return NowNext(e, i + 1 < list.length ? list[i + 1] : null);
      }
    }
    // Sin horario válido: el primero es "ahora" si no hay fechas.
    final upcoming = list.where((e) => e.start != null && e.start!.isAfter(at));
    if (upcoming.isNotEmpty) return NowNext(null, upcoming.first);
    if (list.first.start == null) {
      return NowNext(list.first, list.length > 1 ? list[1] : null);
    }
    return empty;
  }
}

const Map<String, String> _accents = {
  'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'ã': 'a',
  'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e',
  'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
  'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'õ': 'o',
  'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u',
  'ñ': 'n', 'ç': 'c',
};

/// Normaliza texto para búsqueda: minúsculas y sin tildes.
String normalizeSearch(String input) {
  final lower = input.toLowerCase();
  final sb = StringBuffer();
  for (final rune in lower.runes) {
    final ch = String.fromCharCode(rune);
    sb.write(_accents[ch] ?? ch);
  }
  return sb.toString();
}
