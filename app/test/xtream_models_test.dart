import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:iptv_player/models/json_utils.dart';
import 'package:iptv_player/models/media_item.dart';
import 'package:iptv_player/models/portal_models.dart';
import 'package:iptv_player/models/xtream_models.dart';
import 'package:iptv_player/services/xtream_api.dart';

void main() {
  group('json_utils', () {
    test('asInt tolera strings, dobles y nulos', () {
      expect(asInt('12'), 12);
      expect(asInt(12), 12);
      expect(asInt(12.7), 12);
      expect(asInt('7.5'), 7);
      expect(asInt(''), isNull);
      expect(asInt(null), isNull);
      expect(asInt('abc'), isNull);
    });

    test('asBool tolera 1/0, "1"/"0" y true/false', () {
      expect(asBool(1), isTrue);
      expect(asBool('1'), isTrue);
      expect(asBool('true'), isTrue);
      expect(asBool(0), isFalse);
      expect(asBool('0'), isFalse);
      expect(asBool(null), isFalse);
    });
  });

  group('Autenticación Xtream', () {
    test('user_info con números como string', () {
      final json = jsonDecode('''
      {
        "user_info": {
          "username": "juan", "password": "abc123", "message": "",
          "auth": 1, "status": "Active", "exp_date": "1767225600", "is_trial": "0",
          "active_cons": "0", "created_at": "1700000000", "max_connections": "1",
          "allowed_output_formats": ["m3u8", "ts"]
        },
        "server_info": {
          "url": "tv.midominio.com", "port": "25461", "https_port": "443",
          "server_protocol": "http", "rtmp_port": "0", "timezone": "UTC",
          "timestamp_now": 1726300000, "time_now": "2026-09-14 10:00:00", "process": true
        }
      }''');
      final r = XtreamAuthResponse.fromJson(json);
      expect(r.userInfo.auth, isTrue);
      expect(r.userInfo.isActive, isTrue);
      expect(r.userInfo.maxConnections, 1);
      expect(r.userInfo.isTrial, isFalse);
      expect(r.userInfo.expDate,
          DateTime.fromMillisecondsSinceEpoch(1767225600 * 1000));
      expect(r.userInfo.allowedOutputFormats, ['m3u8', 'ts']);
      expect(r.serverInfo.port, '25461');
      expect(r.serverInfo.timestampNow, 1726300000);
    });

    test('números como enteros, exp_date null y auth 0', () {
      final r = XtreamAuthResponse.fromJson({
        'user_info': {
          'auth': '1',
          'status': 'Expired',
          'exp_date': null,
          'max_connections': 3,
          'is_trial': 1,
          'message': 'Falta de pago',
        },
      });
      expect(r.userInfo.auth, isTrue);
      expect(r.userInfo.isActive, isFalse);
      expect(r.userInfo.expDate, isNull);
      expect(r.userInfo.maxConnections, 3);
      expect(r.userInfo.isTrial, isTrue);
      expect(r.userInfo.statusMessage, 'Su suscripción ha vencido.');

      final bad = XtreamAuthResponse.fromJson({
        'user_info': {'auth': 0}
      });
      expect(bad.userInfo.auth, isFalse);
    });
  });

  group('Listados Xtream', () {
    test('categorías con category_id numérico o string', () {
      final cats = parseXtreamCategories([
        {'category_id': '1', 'category_name': 'Deportes', 'parent_id': 0},
        {'category_id': 2, 'category_name': 'Noticias', 'parent_id': '0'},
      ]);
      expect(cats.map((c) => c.id), ['1', '2']);
      expect(cats[1].name, 'Noticias');
    });

    test('canales en vivo', () {
      final items = parseXtreamLive([
        {
          'num': 1, 'name': 'Canal 1', 'stream_type': 'live', 'stream_id': 10,
          'stream_icon': 'http://logo', 'epg_channel_id': 'canal1.co',
          'added': '1700000000', 'category_id': '1', 'tv_archive': 0,
        },
        {
          'num': '2', 'name': 'Canal 2', 'stream_id': '11',
          'stream_icon': '', 'epg_channel_id': null, 'category_id': 1,
        },
      ]);
      expect(items, hasLength(2));
      expect(items[0].id, '10');
      expect(items[0].type, ContentType.live);
      expect(items[0].logo, 'http://logo');
      expect(items[0].num, 1);
      expect(items[1].id, '11');
      expect(items[1].num, 2);
      expect(items[1].logo, isNull);
      expect(items[1].categoryId, '1');
    });

    test('películas con rating string o número', () {
      final items = parseXtreamVod([
        {
          'num': 1, 'name': 'Película', 'stream_type': 'movie', 'stream_id': 20,
          'rating': '7.5', 'rating_5based': 3.75, 'category_id': '5',
          'container_extension': 'mp4',
        },
        {'stream_id': '21', 'name': 'Otra', 'rating': 8, 'container_extension': 'mkv'},
      ]);
      expect(items[0].rating, '7.5');
      expect(items[0].containerExtension, 'mp4');
      expect(items[1].rating, '8');
      expect(items[1].id, '21');
    });

    test('series', () {
      final items = parseXtreamSeries([
        {
          'num': 1, 'name': 'Serie', 'series_id': 3, 'cover': 'http://c',
          'plot': 'Trama', 'rating': '', 'backdrop_path': [], 'category_id': '7',
        }
      ]);
      expect(items.single.id, '3');
      expect(items.single.type, ContentType.series);
      expect(items.single.logo, 'http://c');
      expect(items.single.rating, isNull);
    });

    test('respuesta no lista devuelve vacío', () {
      expect(parseXtreamLive(null), isEmpty);
      expect(parseXtreamLive({}), isEmpty);
    });
  });

  group('Detalles Xtream', () {
    test('get_vod_info', () {
      final movie = MediaItem(id: '20', type: ContentType.movie, name: 'Película');
      final d = parseXtreamVodInfo({
        'info': {
          'movie_image': 'http://img', 'plot': 'Trama', 'genre': 'Acción',
          'releasedate': '2020-01-01', 'rating': '6.8', 'duration': '',
          'duration_secs': '5400', 'backdrop_path': ['http://bd'],
        },
        'movie_data': {'stream_id': 20, 'container_extension': 'mkv'},
      }, movie);
      expect(d.image, 'http://img');
      expect(d.plot, 'Trama');
      expect(d.rating, '6.8');
      expect(d.duration, '1h 30min');
      expect(d.backdrop, 'http://bd');
      expect(d.containerExtension, 'mkv');
    });

    test('get_vod_info con info como lista vacía', () {
      final movie = MediaItem(
          id: '20', type: ContentType.movie, name: 'P', containerExtension: 'mp4');
      final d = parseXtreamVodInfo({'info': [], 'movie_data': []}, movie);
      expect(d.containerExtension, 'mp4');
      expect(d.plot, isNull);
    });

    test('get_series_info con episodios como mapa', () {
      final series = MediaItem(id: '3', type: ContentType.series, name: 'Serie');
      final d = parseXtreamSeriesInfo({
        'seasons': [],
        'info': {'name': 'Serie', 'plot': 'Trama', 'rating': 9},
        'episodes': {
          '1': [
            {'id': '56', 'episode_num': '2', 'title': 'Capítulo 2', 'container_extension': 'mp4', 'season': '1'},
            {'id': '55', 'episode_num': 1, 'title': 'Capítulo 1', 'container_extension': 'mp4', 'info': {'plot': '', 'duration': ''}, 'season': 1},
          ],
          '2': [
            {'id': 60, 'episode_num': 1, 'title': 'T2', 'container_extension': 'mkv'},
          ],
        },
      }, series);
      expect(d.seasonNumbers, [1, 2]);
      expect(d.seasons[1]!.map((e) => e.id), ['55', '56']);
      expect(d.seasons[2]!.single.id, '60');
      expect(d.seasons[2]!.single.season, 2);
      expect(d.seasons[2]!.single.containerExtension, 'mkv');
      expect(d.seasons[1]!.first.seriesName, 'Serie');
      expect(d.rating, '9');
    });

    test('get_series_info con episodios como lista de listas', () {
      final series = MediaItem(id: '3', type: ContentType.series, name: 'Serie');
      final d = parseXtreamSeriesInfo({
        'info': [],
        'episodes': [
          [
            {'id': '1', 'episode_num': 1, 'season': 1},
          ],
          [
            {'id': '2', 'episode_num': 1, 'season': 2},
          ],
        ],
      }, series);
      expect(d.seasonNumbers, [1, 2]);
    });

    test('get_short_epg decodifica base64', () {
      final epg = parseXtreamShortEpg({
        'epg_listings': [
          {
            'title': base64.encode(utf8.encode('Noticias de la mañana')),
            'description': base64.encode(utf8.encode('Resumen')),
            'start_timestamp': '1726300000',
            'stop_timestamp': 1726303600,
          }
        ]
      });
      expect(epg.single.title, 'Noticias de la mañana');
      expect(epg.single.description, 'Resumen');
      expect(epg.single.start, isNotNull);
    });
  });

  group('XtreamApi', () {
    test('normaliza la URL del servidor', () {
      expect(XtreamApi.normalizeServerUrl('tv.example.com:25461'),
          'http://tv.example.com:25461');
      expect(XtreamApi.normalizeServerUrl('http://tv.example.com:8080/'),
          'http://tv.example.com:8080');
      expect(
          XtreamApi.normalizeServerUrl(
              'http://tv.example.com:8080/player_api.php?username=a&password=b'),
          'http://tv.example.com:8080');
      expect(XtreamApi.isValidServerUrl('http://tv.example.com'), isTrue);
      expect(XtreamApi.isValidServerUrl(''), isFalse);
    });

    test('construye URLs de reproducción', () {
      final api = XtreamApi(
          serverUrl: 'http://h:25461', username: 'juan', password: 'abc 123');
      expect(api.liveUrl('10'), 'http://h:25461/live/juan/abc%20123/10.ts');
      expect(api.liveUrl('10', format: 'm3u8'),
          'http://h:25461/live/juan/abc%20123/10.m3u8');
      expect(api.movieUrl('20', 'mkv'),
          'http://h:25461/movie/juan/abc%20123/20.mkv');
      expect(api.episodeUrl('55', null),
          'http://h:25461/series/juan/abc%20123/55.mp4');
      api.close();
    });
  });

  group('Portal', () {
    test('info completa', () {
      final info = PortalInfo.fromJson({
        'portal': true,
        'server_name': 'Mi IPTV',
        'user': {
          'username': 'juan', 'exp_date': 1767225600, 'max_connections': 1,
          'is_trial': false, 'status': 'suspended', 'suspension_reason': 'Falta de pago',
        },
        'outage': {
          'id': 2, 'title': 'Mantenimiento', 'reason': 'Cambio de servidor',
          'starts_at': 1726300000, 'ends_at': 1726310000, 'block_playback': true,
        },
        'notices': [
          {'id': 1, 'title': 'Nuevo canal', 'body': 'Ya está', 'level': 'warning',
           'display': 'ticker', 'starts_at': 1726300000, 'ends_at': null},
        ],
        'messages': [
          {'id': 4, 'title': 'Pago', 'body': 'Vence', 'created_at': 1726300000, 'read': false},
        ],
        'unread_messages': 1,
      });
      expect(info.user.isBlocked, isTrue);
      expect(info.user.suspensionReason, 'Falta de pago');
      expect(info.outage!.blockPlayback, isTrue);
      expect(info.notices.single.level, NoticeLevel.warning);
      expect(info.notices.single.display, NoticeDisplay.ticker);
      expect(info.notices.single.endsAt, isNull);
      expect(info.messages.single.read, isFalse);
      expect(info.unreadMessages, 1);
    });

    test('outage null', () {
      final info = PortalInfo.fromJson({
        'user': {'status': 'active'},
        'outage': null,
        'notices': [],
        'messages': [],
      });
      expect(info.outage, isNull);
      expect(info.user.isBlocked, isFalse);
      expect(info.unreadMessages, 0);
    });
  });
}
