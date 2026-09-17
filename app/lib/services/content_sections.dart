import '../models/media_item.dart';
import '../models/portal_models.dart';
import 'content_source.dart';

/// Qué secciones de contenido ve el cliente: TV en vivo, Películas y Series.
///
/// - Portal propio que manda `content` en `/api/client/info` (desde 1.0.3): solo lo que diga
///   el portal ([ContentSections.fromPortal]). Lo demás no existe para el cliente: no aparece
///   en el menú, el inicio, Buscar, Favoritos ni Recientes, y sus listas no se descargan.
/// - Sin esa información (XtreamUI, portal anterior o listas M3U) la app lo deduce
///   ([ContentSections.detect]): oculta Películas o Series si no tienen nada.
class ContentSections {
  final bool live;
  final bool movies;
  final bool series;

  /// Al abrir la sesión, entrar directo al último canal visto (solo cuenta si [liveOnly]).
  final bool startInLastChannel;

  const ContentSections({
    this.live = true,
    this.movies = true,
    this.series = true,
    this.startInLastChannel = false,
  });

  /// Todo visible (como antes de 1.0.3).
  static const ContentSections all = ContentSections();

  factory ContentSections.fromPortal(PortalContent content) => ContentSections(
        live: content.sections.contains(PortalContent.live),
        movies: content.sections.contains(PortalContent.movies),
        series: content.sections.contains(PortalContent.series),
        startInLastChannel: content.startInLastChannel,
      );

  /// Lo que admite la fuente, mientras no se sabe más (sin abrir el último canal).
  factory ContentSections.supportedBy(ContentSource source) => ContentSections(
        movies: source.supportsMovies,
        series: source.supportsSeries,
      );

  /// Lo que manda el portal si lo manda; si no, lo deducido.
  static ContentSections effective(
          PortalContent? portal, ContentSections detected) =>
      portal != null ? ContentSections.fromPortal(portal) : detected;

  /// Deduce las secciones sin datos del portal.
  ///
  /// - Xtream: Películas/Series se ocultan si sus categorías **y** su lista vienen vacías
  ///   (la lista solo se pide si no hay categorías). TV en vivo siempre se muestra.
  /// - M3U: lo que traiga la lista; TV en vivo también se oculta si no trae canales
  ///   (pero nunca se oculta todo).
  /// - Ante un error o demora se muestra la sección, como antes.
  /// - Si solo quedan canales, la sesión abre directo en el último canal.
  static Future<ContentSections> detect(
    ContentSource source, {
    Duration timeout = const Duration(seconds: 12),
  }) async {
    Future<bool> has(ContentType type) async {
      try {
        return await source.hasContent(type).timeout(timeout);
      } catch (_) {
        return true;
      }
    }

    final m3u = source is M3uSource;
    final results = await Future.wait([
      source.supportsMovies ? has(ContentType.movie) : Future.value(false),
      source.supportsSeries ? has(ContentType.series) : Future.value(false),
      if (m3u) has(ContentType.live),
    ]);
    final movies = results[0];
    final series = results[1];
    final live = m3u ? (results[2] || (!movies && !series)) : true;
    return ContentSections(
      live: live,
      movies: movies,
      series: series,
      startInLastChannel: live && !movies && !series,
    );
  }

  /// Solo canales en vivo.
  bool get liveOnly => live && !movies && !series;

  /// Abrir directo en el último canal al iniciar la sesión.
  bool get opensLastChannel => liveOnly && startInLastChannel;

  /// Si el cliente puede ver ese tipo (los episodios van con Series).
  bool allows(ContentType type) {
    switch (type) {
      case ContentType.live:
        return live;
      case ContentType.movie:
        return movies;
      case ContentType.series:
      case ContentType.episode:
        return series;
    }
  }

  /// Quita los ítems de secciones no incluidas (favoritos, recientes…).
  List<MediaItem> filter(Iterable<MediaItem> items) =>
      items.where((i) => allows(i.type)).toList();

  /// Tipos de contenido visibles, en el orden de la app.
  List<ContentType> get types => [
        if (live) ContentType.live,
        if (movies) ContentType.movie,
        if (series) ContentType.series,
      ];

  /// "canales, películas y series", "canales y películas", "canales"… ([conjunction]: `y` u `o`).
  String describe({String conjunction = 'y'}) =>
      _join([
        if (live) 'canales',
        if (movies) 'películas',
        if (series) 'series',
      ], conjunction);

  /// "un canal, película o serie", "un canal"…
  String describeOne() {
    final words = [
      if (live) 'canal',
      if (movies) 'película',
      if (series) 'serie',
    ];
    if (words.isEmpty) return 'un contenido';
    final article = words.first == 'canal' ? 'un' : 'una';
    return '$article ${_join(words, 'o')}';
  }

  static String _join(List<String> words, String conjunction) {
    if (words.isEmpty) return 'contenido';
    if (words.length == 1) return words.first;
    return '${words.sublist(0, words.length - 1).join(', ')} $conjunction ${words.last}';
  }

  @override
  bool operator ==(Object other) =>
      other is ContentSections &&
      other.live == live &&
      other.movies == movies &&
      other.series == series &&
      other.startInLastChannel == startInLastChannel;

  @override
  int get hashCode => Object.hash(live, movies, series, startInLastChannel);

  @override
  String toString() =>
      'ContentSections(live: $live, movies: $movies, series: $series, '
      'startInLastChannel: $startInLastChannel)';
}

/// Búsqueda global sin distinguir tildes: todas las palabras deben aparecer en el nombre.
/// Solo busca en las secciones visibles; hasta [limit] resultados por tipo.
/// Con menos de 2 letras no devuelve nada.
Map<ContentType, List<MediaItem>> searchCatalog(
  Map<ContentType, List<MediaItem>> catalog,
  String query,
  ContentSections sections, {
  int limit = 80,
}) {
  final q = normalizeSearch(query.trim());
  final results = <ContentType, List<MediaItem>>{};
  if (q.length < 2) return results;
  final words = q.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  catalog.forEach((type, items) {
    if (!sections.allows(type)) return;
    final found = <MediaItem>[];
    for (final item in items) {
      if (!sections.allows(item.type)) continue;
      final key = item.searchKey;
      if (words.every(key.contains)) {
        found.add(item);
        if (found.length >= limit) break;
      }
    }
    results[type] = found;
  });
  return results;
}
