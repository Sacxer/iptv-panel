import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:iptv_player/models/media_item.dart';
import 'package:iptv_player/services/m3u_parser.dart';

void main() {
  group('M3uParser.parse', () {
    test('parsea atributos EXTINF básicos', () {
      const content = '#EXTM3U\n'
          '#EXTINF:-1 tvg-id="canal1.co" tvg-name="Canal 1" tvg-logo="http://logo/1.png" group-title="Deportes",Canal 1 HD\n'
          'http://tv.example.com:25461/live/juan/abc123/10.ts\n';
      final entries = M3uParser.parse(content);
      expect(entries, hasLength(1));
      final e = entries.first;
      expect(e.name, 'Canal 1 HD');
      expect(e.tvgId, 'canal1.co');
      expect(e.tvgName, 'Canal 1');
      expect(e.tvgLogo, 'http://logo/1.png');
      expect(e.group, 'Deportes');
      expect(e.url, 'http://tv.example.com:25461/live/juan/abc123/10.ts');
      expect(e.type, ContentType.live);
    });

    test('tolera CRLF, BOM, KODIPROP, EXTVLCOPT y catchup', () {
      const content = '﻿#EXTM3U x-tvg-url="http://epg"\r\n'
          '#EXTINF:-1 catchup="default" catchup-days="3" tvg-id="a" group-title="Noticias",Canal A\r\n'
          '#KODIPROP:inputstream.adaptive.manifest_type=hls\r\n'
          '#EXTVLCOPT:http-user-agent=Mozilla/5.0\r\n'
          'http://host/a.m3u8\r\n'
          '\r\n'
          '#EXTINF:-1,Canal B\r\n'
          'http://host/b.ts\r\n';
      final entries = M3uParser.parse(content);
      expect(entries, hasLength(2));
      expect(entries[0].name, 'Canal A');
      expect(entries[0].group, 'Noticias');
      expect(entries[0].url, 'http://host/a.m3u8');
      expect(entries[1].name, 'Canal B');
      expect(entries[1].group, M3uParser.noGroup);
      expect(entries[1].url, 'http://host/b.ts');
    });

    test('usa EXTGRP cuando no hay group-title', () {
      const content = '#EXTM3U\n'
          '#EXTINF:-1 tvg-logo="x",Canal C\n'
          '#EXTGRP:Infantil\n'
          'http://host/c.ts\n';
      final e = M3uParser.parse(content).single;
      expect(e.group, 'Infantil');
    });

    test('coma dentro de atributos entre comillas', () {
      const content = '#EXTINF:-1 group-title="Cine, Series",Película, la mejor\n'
          'http://host/movie/u/p/5.mp4\n';
      final e = M3uParser.parse(content).single;
      expect(e.group, 'Cine, Series');
      expect(e.name, 'Película, la mejor');
      expect(e.type, ContentType.movie);
    });

    test('usa tvg-name o la URL si el título está vacío', () {
      const content = '#EXTINF:-1 tvg-name="Nombre TVG",\n'
          'http://host/x.ts\n'
          'http://host/sin_extinf.ts\n';
      final entries = M3uParser.parse(content);
      expect(entries, hasLength(2));
      expect(entries[0].name, 'Nombre TVG');
      expect(entries[1].name, 'sin_extinf.ts');
    });

    test('decodeBytes elimina BOM y cae a latin1', () {
      final utf = Uint8List.fromList(
          [0xEF, 0xBB, 0xBF, ...utf8.encode('#EXTM3U\n#EXTINF:-1,Canción\nhttp://h/1.ts')]);
      expect(M3uParser.decodeBytes(utf).startsWith('#EXTM3U'), isTrue);
      expect(M3uParser.decodeBytes(utf).contains('Canción'), isTrue);
      final lat = Uint8List.fromList(latin1.encode('#EXTINF:-1,Año\nhttp://h/1.ts'));
      expect(M3uParser.decodeBytes(lat).contains('Año'), isTrue);
    });
  });

  group('M3uParser.classify', () {
    test('clasifica por URL y extensión', () {
      expect(M3uParser.classify('http://h/live/u/p/1.ts'), ContentType.live);
      expect(M3uParser.classify('http://h/u/p/1'), ContentType.live);
      expect(M3uParser.classify('http://h/stream.m3u8'), ContentType.live);
      expect(M3uParser.classify('http://h/movie/u/p/1.mp4'), ContentType.movie);
      expect(M3uParser.classify('http://h/peli.MKV?token=1'), ContentType.movie);
      expect(M3uParser.classify('http://h/x.avi'), ContentType.movie);
      expect(M3uParser.classify('http://h/series/u/p/9.mkv'), ContentType.episode);
      expect(
          M3uParser.classify('http://h/v/show.mp4', name: 'Show S01E02'),
          ContentType.episode);
    });
  });

  group('M3uParser.buildPlaylist', () {
    test('agrupa categorías, películas y series', () {
      const content = '#EXTM3U\n'
          '#EXTINF:-1 group-title="Deportes",Canal 1\nhttp://h/live/u/p/1.ts\n'
          '#EXTINF:-1 group-title="Deportes",Canal 2\nhttp://h/live/u/p/2.ts\n'
          '#EXTINF:-1 group-title="Noticias",Canal 3\nhttp://h/live/u/p/3.ts\n'
          '#EXTINF:-1 group-title="Acción",Película 1\nhttp://h/movie/u/p/10.mp4\n'
          '#EXTINF:-1 group-title="Series Drama",Mi Serie S01E02\nhttp://h/series/u/p/21.mkv\n'
          '#EXTINF:-1 group-title="Series Drama",Mi Serie S01E01\nhttp://h/series/u/p/20.mkv\n'
          '#EXTINF:-1 group-title="Series Drama",Mi Serie S02E01\nhttp://h/series/u/p/22.mkv\n';
      final data = M3uParser.buildPlaylist(M3uParser.parse(content));
      expect(data.totalEntries, 7);
      expect(data.itemsOf(ContentType.live), hasLength(3));
      expect(data.categoriesOf(ContentType.live).map((c) => c.name),
          ['Deportes', 'Noticias']);
      expect(data.categoriesOf(ContentType.live).first.count, 2);
      expect(data.itemsOf(ContentType.movie), hasLength(1));
      expect(data.itemsOf(ContentType.movie).first.containerExtension, 'mp4');
      expect(data.hasSeries, isTrue);
      final series = data.itemsOf(ContentType.series).single;
      expect(series.name, 'Mi Serie');
      final eps = data.seriesEpisodes[series.id]!;
      expect(eps.map((e) => '${e.season}x${e.episodeNum}'), ['1x1', '1x2', '2x1']);
    });

    test('lista grande (50.000 entradas) en isolate', () async {
      final sb = StringBuffer('#EXTM3U\n');
      for (var i = 0; i < 50000; i++) {
        sb
          ..write('#EXTINF:-1 tvg-id="c$i" tvg-logo="http://l/$i.png" group-title="Grupo ${i % 50}",Canal $i\r\n')
          ..write('http://h:8080/live/u/p/$i.ts\r\n');
      }
      final data = await parsePlaylistInBackground(sb.toString());
      expect(data.itemsOf(ContentType.live), hasLength(50000));
      expect(data.categoriesOf(ContentType.live), hasLength(50));
      expect(data.itemsOf(ContentType.live).last.name, 'Canal 49999');
    });
  });
}
