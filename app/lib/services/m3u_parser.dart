import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../models/media_item.dart';

/// Entrada cruda de una lista M3U.
class M3uEntry {
  final String name;
  final String url;
  final String? tvgId;
  final String? tvgName;
  final String? tvgLogo;
  final String group;
  final ContentType type;

  const M3uEntry({
    required this.name,
    required this.url,
    required this.group,
    required this.type,
    this.tvgId,
    this.tvgName,
    this.tvgLogo,
  });
}

/// Resultado de procesar una lista: categorías e ítems por tipo.
class PlaylistData {
  final Map<ContentType, List<MediaCategory>> categories;
  final Map<ContentType, List<MediaItem>> items;

  /// id de serie → episodios (ordenados por temporada/episodio).
  final Map<String, List<MediaItem>> seriesEpisodes;
  final int totalEntries;

  const PlaylistData({
    required this.categories,
    required this.items,
    required this.seriesEpisodes,
    required this.totalEntries,
  });

  List<MediaCategory> categoriesOf(ContentType t) => categories[t] ?? const [];
  List<MediaItem> itemsOf(ContentType t) => items[t] ?? const [];
  bool get hasSeries => itemsOf(ContentType.series).isNotEmpty;
  bool get hasMovies => itemsOf(ContentType.movie).isNotEmpty;
}

class M3uParser {
  M3uParser._();

  static const String noGroup = 'Sin categoría';

  static const _vodExtensions = {
    '.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.flv', '.webm', '.mpg', '.mpeg',
  };

  static final RegExp _quotedAttr = RegExp(r'([A-Za-z0-9_\-]+)\s*=\s*"([^"]*)"');
  static final RegExp _unquotedAttr =
      RegExp(r'''([A-Za-z0-9_\-]+)=([^\s",']+)''');
  static final RegExp _seasonEpisode =
      RegExp(r'^(.*?)[\s\-_.:|]*\b[Ss](\d{1,3})\s*[Ee](\d{1,4})');
  static final RegExp _seasonXEpisode =
      RegExp(r'^(.*?)[\s\-_.:|]*\b(\d{1,2})[xX](\d{1,3})\b');

  /// Decodifica bytes (UTF-8 con BOM opcional; si falla, Latin-1).
  static String decodeBytes(Uint8List bytes) {
    var start = 0;
    if (bytes.length >= 3 &&
        bytes[0] == 0xEF &&
        bytes[1] == 0xBB &&
        bytes[2] == 0xBF) {
      start = 3;
    }
    final view = Uint8List.sublistView(bytes, start);
    try {
      return utf8.decode(view);
    } on FormatException {
      return latin1.decode(view, allowInvalid: true);
    }
  }

  /// Analiza el texto M3U y devuelve las entradas.
  static List<M3uEntry> parse(String content) {
    final entries = <M3uEntry>[];
    if (content.isEmpty) return entries;
    var text = content;
    if (text.codeUnitAt(0) == 0xFEFF) text = text.substring(1);

    String? pendingName;
    Map<String, String>? pendingAttrs;
    String? pendingGroup;

    final lines = const LineSplitter().convert(text);
    for (var raw in lines) {
      final line = raw.trim();
      if (line.isEmpty) continue;

      if (line.startsWith('#')) {
        final upper = line.length >= 8 ? line.substring(0, 8).toUpperCase() : line.toUpperCase();
        if (upper.startsWith('#EXTINF')) {
          final parsed = _parseExtInf(line);
          pendingName = parsed.$1;
          pendingAttrs = parsed.$2;
        } else if (upper.startsWith('#EXTGRP')) {
          final idx = line.indexOf(':');
          if (idx >= 0) {
            final g = line.substring(idx + 1).trim();
            if (g.isNotEmpty) pendingGroup = g;
          }
        }
        // #EXTM3U, #KODIPROP, #EXTVLCOPT, #EXT-X-* y comentarios se ignoran.
        continue;
      }

      // Línea de URL.
      final url = line;
      final attrs = pendingAttrs ?? const <String, String>{};
      final tvgName = _nz(attrs['tvg-name']);
      var name = _nz(pendingName) ?? tvgName ?? _nameFromUrl(url);
      final group =
          _nz(attrs['group-title']) ?? _nz(pendingGroup) ?? noGroup;
      entries.add(M3uEntry(
        name: name,
        url: url,
        tvgId: _nz(attrs['tvg-id']),
        tvgName: tvgName,
        tvgLogo: _nz(attrs['tvg-logo']) ?? _nz(attrs['logo']),
        group: group,
        type: classify(url, name: name, group: group),
      ));
      pendingName = null;
      pendingAttrs = null;
      pendingGroup = null;
    }
    return entries;
  }

  static String? _nz(String? s) {
    if (s == null) return null;
    final t = s.trim();
    return t.isEmpty ? null : t;
  }

  /// Devuelve (título, atributos) de una línea `#EXTINF`.
  static (String, Map<String, String>) _parseExtInf(String line) {
    final colon = line.indexOf(':');
    final body = colon >= 0 ? line.substring(colon + 1) : '';
    // Buscar la primera coma fuera de comillas.
    var inQuotes = false;
    var commaIdx = -1;
    for (var i = 0; i < body.length; i++) {
      final c = body.codeUnitAt(i);
      if (c == 0x22) {
        inQuotes = !inQuotes;
      } else if (c == 0x2C && !inQuotes) {
        commaIdx = i;
        break;
      }
    }
    final attrPart = commaIdx >= 0 ? body.substring(0, commaIdx) : body;
    final title = commaIdx >= 0 ? body.substring(commaIdx + 1).trim() : '';
    final attrs = <String, String>{};
    for (final m in _quotedAttr.allMatches(attrPart)) {
      attrs[m.group(1)!.toLowerCase()] = m.group(2)!;
    }
    for (final m in _unquotedAttr.allMatches(attrPart)) {
      attrs.putIfAbsent(m.group(1)!.toLowerCase(), () => m.group(2)!);
    }
    return (title, attrs);
  }

  static String _nameFromUrl(String url) {
    final uri = Uri.tryParse(url);
    final segs = uri?.pathSegments.where((s) => s.isNotEmpty).toList() ?? const [];
    if (segs.isEmpty) return url;
    return Uri.decodeComponent(segs.last);
  }

  /// Clasifica heurísticamente: `/movie/` o extensión de video → película,
  /// `/series/` → episodio de serie; resto en vivo.
  static ContentType classify(String url, {String name = '', String group = ''}) {
    var path = url.toLowerCase();
    final q = path.indexOf('?');
    if (q >= 0) path = path.substring(0, q);
    if (path.contains('/series/')) return ContentType.episode;
    if (path.contains('/movie/') || path.contains('/movies/')) {
      return ContentType.movie;
    }
    final dot = path.lastIndexOf('.');
    final slash = path.lastIndexOf('/');
    if (dot > slash && dot >= 0) {
      final ext = path.substring(dot);
      if (_vodExtensions.contains(ext)) {
        if (_seasonEpisode.hasMatch(name) ||
            group.toLowerCase().contains('serie')) {
          return ContentType.episode;
        }
        return ContentType.movie;
      }
    }
    return ContentType.live;
  }

  static String? _extensionOf(String url) {
    var path = url;
    final q = path.indexOf('?');
    if (q >= 0) path = path.substring(0, q);
    final dot = path.lastIndexOf('.');
    final slash = path.lastIndexOf('/');
    if (dot > slash && dot >= 0 && path.length - dot <= 6) {
      return path.substring(dot + 1).toLowerCase();
    }
    return null;
  }

  /// Agrupa las entradas en categorías e ítems (incluye series detectadas).
  static PlaylistData buildPlaylist(List<M3uEntry> entries) {
    final cats = <ContentType, Map<String, int>>{
      ContentType.live: {},
      ContentType.movie: {},
      ContentType.series: {},
    };
    final items = <ContentType, List<MediaItem>>{
      ContentType.live: [],
      ContentType.movie: [],
      ContentType.series: [],
    };
    final seriesMap = <String, MediaItem>{};
    final episodes = <String, List<MediaItem>>{};
    var liveNum = 0;

    for (final e in entries) {
      switch (e.type) {
        case ContentType.live:
          liveNum++;
          cats[ContentType.live]!.update(e.group, (v) => v + 1, ifAbsent: () => 1);
          items[ContentType.live]!.add(MediaItem(
            id: e.url,
            type: ContentType.live,
            name: e.name,
            logo: e.tvgLogo,
            categoryId: e.group,
            categoryName: e.group,
            url: e.url,
            num: liveNum,
            epgChannelId: e.tvgId,
          ));
        case ContentType.movie:
          cats[ContentType.movie]!.update(e.group, (v) => v + 1, ifAbsent: () => 1);
          items[ContentType.movie]!.add(MediaItem(
            id: e.url,
            type: ContentType.movie,
            name: e.name,
            logo: e.tvgLogo,
            categoryId: e.group,
            categoryName: e.group,
            url: e.url,
            containerExtension: _extensionOf(e.url),
          ));
        case ContentType.episode:
        case ContentType.series:
          var seriesName = e.name;
          int? season;
          int? epNum;
          final m = _seasonEpisode.firstMatch(e.name) ??
              _seasonXEpisode.firstMatch(e.name);
          if (m != null) {
            final base = m.group(1)!.trim();
            if (base.isNotEmpty) seriesName = base;
            season = int.tryParse(m.group(2)!);
            epNum = int.tryParse(m.group(3)!);
          }
          final seriesId = 'm3u:${e.group}|${normalizeSearch(seriesName)}';
          var series = seriesMap[seriesId];
          if (series == null) {
            series = MediaItem(
              id: seriesId,
              type: ContentType.series,
              name: seriesName,
              logo: e.tvgLogo,
              categoryId: e.group,
              categoryName: e.group,
            );
            seriesMap[seriesId] = series;
            items[ContentType.series]!.add(series);
            cats[ContentType.series]!
                .update(e.group, (v) => v + 1, ifAbsent: () => 1);
          }
          final list = episodes.putIfAbsent(seriesId, () => []);
          list.add(MediaItem(
            id: e.url,
            type: ContentType.episode,
            name: e.name,
            logo: e.tvgLogo ?? series.logo,
            url: e.url,
            categoryId: e.group,
            categoryName: e.group,
            containerExtension: _extensionOf(e.url),
            seriesId: seriesId,
            seriesName: seriesName,
            season: season ?? 1,
            episodeNum: epNum ?? list.length + 1,
          ));
      }
    }

    for (final list in episodes.values) {
      list.sort((a, b) {
        final s = (a.season ?? 0).compareTo(b.season ?? 0);
        return s != 0 ? s : (a.episodeNum ?? 0).compareTo(b.episodeNum ?? 0);
      });
    }

    List<MediaCategory> toCats(Map<String, int> m) => m.entries
        .map((e) => MediaCategory(id: e.key, name: e.key, count: e.value))
        .toList();

    return PlaylistData(
      categories: {
        ContentType.live: toCats(cats[ContentType.live]!),
        ContentType.movie: toCats(cats[ContentType.movie]!),
        ContentType.series: toCats(cats[ContentType.series]!),
      },
      items: items,
      seriesEpisodes: episodes,
      totalEntries: entries.length,
    );
  }
}

PlaylistData _parseTextIsolate(String content) =>
    M3uParser.buildPlaylist(M3uParser.parse(content));

PlaylistData _parseBytesIsolate(Uint8List bytes) =>
    M3uParser.buildPlaylist(M3uParser.parse(M3uParser.decodeBytes(bytes)));

/// Analiza el texto en un isolate (para listas grandes).
Future<PlaylistData> parsePlaylistInBackground(String content) =>
    compute(_parseTextIsolate, content);

/// Decodifica y analiza bytes en un isolate.
Future<PlaylistData> parsePlaylistBytesInBackground(Uint8List bytes) =>
    compute(_parseBytesIsolate, bytes);
