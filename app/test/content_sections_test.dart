import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:iptv_player/models/media_item.dart';
import 'package:iptv_player/models/portal_models.dart';
import 'package:iptv_player/models/profile.dart';
import 'package:iptv_player/providers/session_provider.dart';
import 'package:iptv_player/services/content_sections.dart';
import 'package:iptv_player/services/content_source.dart';
import 'package:iptv_player/services/m3u_parser.dart';
import 'package:iptv_player/services/storage.dart';
import 'package:iptv_player/services/xtream_api.dart';
import 'package:shared_preferences/shared_preferences.dart';

MediaItem item(ContentType type, String id, String name) =>
    MediaItem(id: id, type: type, name: name);

/// Servidor Xtream falso: [responses] por `action` (lista JSON o código de error).
(XtreamSource, List<String>) xtream(Map<String, Object> responses) {
  final actions = <String>[];
  final client = MockClient((req) async {
    final action = req.url.queryParameters['action'] ?? '';
    actions.add(action);
    final body = responses[action] ?? <Object>[];
    if (body is int) return http.Response('error', body);
    return http.Response(jsonEncode(body), 200);
  });
  final api = XtreamApi(
    serverUrl: 'http://10.0.0.1:25461',
    username: 'zz-prueba',
    password: 'x',
    client: client,
  );
  return (XtreamSource(api), actions);
}

M3uSource m3u(String content) {
  final data = M3uParser.buildPlaylist(M3uParser.parse(content));
  return M3uSource(
    const Profile(id: 'm3u', name: 'Lista', type: ProfileType.m3uUrl),
    data,
  );
}

const liveEntry = '#EXTINF:-1 group-title="Noticias",Canal 1\n'
    'http://host/live/1.ts\n';
const movieEntry = '#EXTINF:-1 group-title="Cine",Película 1\n'
    'http://host/movie/1.mp4\n';

void main() {
  group('PortalContent.fromJson', () {
    test('lee secciones, modo e inicio', () {
      final c = PortalContent.fromJson({
        'sections': ['live', 'movies', 'series'],
        'mode': 'manual',
        'start': 'menu',
      })!;
      expect(c.sections, ['live', 'movies', 'series']);
      expect(c.mode, 'manual');
      expect(c.start, 'menu');
      expect(c.startInLastChannel, isFalse);
    });

    test('ordena, quita repetidos y desconocidos, y acepta sinónimos', () {
      final c = PortalContent.fromJson({
        'sections': ['series', 'VOD', 'radio', 'series', ' Live '],
      })!;
      expect(c.sections, ['live', 'movies', 'series']);
      expect(c.mode, 'auto');
    });

    test('solo canales: sin "start" abre en el último canal', () {
      final c = PortalContent.fromJson({
        'sections': ['live'],
      })!;
      expect(c.start, 'last_channel');
      expect(c.startInLastChannel, isTrue);
      // Si el portal dice "menu", se respeta.
      final menu = PortalContent.fromJson({
        'sections': ['live'],
        'start': 'menu',
      })!;
      expect(menu.startInLastChannel, isFalse);
      // Con más secciones, sin "start" se entra al menú.
      expect(
          PortalContent.fromJson({
            'sections': ['live', 'movies'],
          })!
              .start,
          'menu');
    });

    test('valores inválidos: null (la app decide sola)', () {
      expect(PortalContent.fromJson(null), isNull);
      expect(PortalContent.fromJson('live'), isNull);
      expect(PortalContent.fromJson({'sections': []}), isNull);
      expect(PortalContent.fromJson({'sections': ['radio']}), isNull);
      expect(PortalContent.fromJson({'mode': 'auto'}), isNull);
      // Un modo o inicio desconocido toma el valor seguro.
      final c = PortalContent.fromJson({
        'sections': ['movies'],
        'mode': 'otro',
        'start': 'algo',
      })!;
      expect(c.mode, 'auto');
      expect(c.start, 'menu');
    });

    test('PortalInfo: portal anterior sin "content" → null', () {
      final old = PortalInfo.fromJson({
        'server_name': 'Mi IPTV',
        'user': {'username': 'zz-prueba', 'status': 'active'},
      });
      expect(old.content, isNull);

      final info = PortalInfo.fromJson({
        'user': {'username': 'zz-prueba', 'status': 'active'},
        'content': {
          'sections': ['live'],
          'mode': 'auto',
          'start': 'last_channel',
        },
      });
      expect(info.content?.sections, ['live']);
      expect(info.content?.startInLastChannel, isTrue);
      // copyWith (al marcar mensajes leídos) conserva las secciones.
      expect(info.copyWith(unreadMessages: 0).content, info.content);
    });

    test('igualdad por valor', () {
      expect(
        PortalContent.fromJson({
          'sections': ['live', 'series'],
        }),
        PortalContent.fromJson({
          'sections': ['series', 'live'],
          'mode': 'auto',
        }),
      );
    });
  });

  group('ContentSections', () {
    test('desde el portal y prioridad sobre lo deducido', () {
      final onlyLive = ContentSections.fromPortal(PortalContent.fromJson({
        'sections': ['live'],
      })!);
      expect(onlyLive.live, isTrue);
      expect(onlyLive.movies, isFalse);
      expect(onlyLive.series, isFalse);
      expect(onlyLive.liveOnly, isTrue);
      expect(onlyLive.opensLastChannel, isTrue);

      const detected = ContentSections(series: false);
      expect(ContentSections.effective(null, detected), detected);
      expect(
        ContentSections.effective(
            const PortalContent(sections: ['movies']), detected),
        const ContentSections(live: false, movies: true, series: false),
      );
    });

    test('abrir en el último canal solo si únicamente hay canales', () {
      const withMovies = ContentSections(
          movies: true, series: false, startInLastChannel: true);
      expect(withMovies.opensLastChannel, isFalse);
      const noStart = ContentSections(movies: false, series: false);
      expect(noStart.liveOnly, isTrue);
      expect(noStart.opensLastChannel, isFalse);
    });

    test('filtra favoritos y recientes por tipo (episodios con Series)', () {
      final items = [
        item(ContentType.live, '1', 'Canal 1'),
        item(ContentType.movie, '2', 'Película'),
        item(ContentType.series, '3', 'Serie'),
        item(ContentType.episode, '4', 'Episodio'),
        item(ContentType.live, '5', 'Canal 2'),
      ];
      const onlyLive = ContentSections(movies: false, series: false);
      expect(onlyLive.filter(items).map((e) => e.id), ['1', '5']);
      const noLive = ContentSections(live: false);
      expect(noLive.filter(items).map((e) => e.id), ['2', '3', '4']);
      const onlySeries = ContentSections(live: false, movies: false);
      expect(onlySeries.filter(items).map((e) => e.id), ['3', '4']);
      expect(ContentSections.all.filter(items), hasLength(5));
      expect(onlyLive.types, [ContentType.live]);
      expect(ContentSections.all.types,
          [ContentType.live, ContentType.movie, ContentType.series]);
    });

    test('textos sin nombrar lo que no ve el cliente', () {
      expect(ContentSections.all.describe(), 'canales, películas y series');
      expect(ContentSections.all.describe(conjunction: 'o'),
          'canales, películas o series');
      expect(ContentSections.all.describeOne(), 'un canal, película o serie');
      const onlyLive = ContentSections(movies: false, series: false);
      expect(onlyLive.describe(), 'canales');
      expect(onlyLive.describeOne(), 'un canal');
      const vod = ContentSections(live: false);
      expect(vod.describe(), 'películas y series');
      expect(vod.describeOne(), 'una película o serie');
    });
  });

  group('searchCatalog', () {
    final catalog = {
      ContentType.live: [
        item(ContentType.live, '1', 'Noticias Caracol'),
        item(ContentType.live, '2', 'Deportes'),
      ],
      ContentType.movie: [item(ContentType.movie, '3', 'Noticias de ayer')],
      ContentType.series: [item(ContentType.series, '4', 'Las noticías')],
    };

    test('busca sin tildes en todas las secciones visibles', () {
      final r = searchCatalog(catalog, 'NOTICIAS', ContentSections.all);
      expect(r[ContentType.live]!.map((e) => e.id), ['1']);
      expect(r[ContentType.movie]!.map((e) => e.id), ['3']);
      expect(r[ContentType.series]!.map((e) => e.id), ['4']);
    });

    test('no busca ni muestra tipos no incluidos', () {
      const onlyLive = ContentSections(movies: false, series: false);
      final r = searchCatalog(catalog, 'noticias', onlyLive);
      expect(r.keys, [ContentType.live]);
      expect(r[ContentType.live]!.single.id, '1');
    });

    test('todas las palabras, mínimo 2 letras y límite', () {
      expect(searchCatalog(catalog, 'n', ContentSections.all), isEmpty);
      expect(
          searchCatalog(catalog, 'noticias caracol', ContentSections.all)[
                  ContentType.live]!
              .single
              .id,
          '1');
      final many = {
        ContentType.live: [
          for (var i = 0; i < 10; i++) item(ContentType.live, '$i', 'Canal $i')
        ],
      };
      expect(
          searchCatalog(many, 'canal', ContentSections.all, limit: 3)[
                  ContentType.live],
          hasLength(3));
    });
  });

  group('ContentSections.detect (sin datos del portal)', () {
    test('Xtream: películas vacías se ocultan; series con categorías no piden la lista',
        () async {
      final (source, actions) = xtream({
        'get_vod_categories': <Object>[],
        'get_vod_streams': <Object>[],
        'get_series_categories': [
          {'category_id': '1', 'category_name': 'Drama'},
        ],
      });
      final s = await ContentSections.detect(source);
      expect(s, const ContentSections(movies: false, series: true));
      expect(s.opensLastChannel, isFalse);
      expect(actions, contains('get_vod_streams'));
      expect(actions, isNot(contains('get_series')));
      expect(actions, isNot(contains('get_live_streams')));
    });

    test('Xtream: sin películas ni series → solo canales y abre el último canal',
        () async {
      final (source, _) = xtream({});
      final s = await ContentSections.detect(source);
      expect(s.liveOnly, isTrue);
      expect(s.opensLastChannel, isTrue);
    });

    test('Xtream: sin categorías pero con películas → se muestran', () async {
      final (source, _) = xtream({
        'get_vod_streams': [
          {'stream_id': 9, 'name': 'Película', 'container_extension': 'mp4'},
        ],
      });
      final s = await ContentSections.detect(source);
      expect(s.movies, isTrue);
      expect(s.series, isFalse);
    });

    test('Xtream: ante un error se muestra la sección', () async {
      final (source, _) = xtream({
        'get_vod_categories': 500,
        'get_series_categories': 503,
      });
      final s = await ContentSections.detect(source);
      expect(s, const ContentSections());
    });

    test('M3U: solo canales', () async {
      final s = await ContentSections.detect(m3u('#EXTM3U\n$liveEntry'));
      expect(s.liveOnly, isTrue);
      expect(s.opensLastChannel, isTrue);
    });

    test('M3U: sin canales se oculta TV en vivo', () async {
      final s = await ContentSections.detect(m3u('#EXTM3U\n$movieEntry'));
      expect(s, const ContentSections(live: false, movies: true, series: false));
    });

    test('M3U: canales y películas', () async {
      final s =
          await ContentSections.detect(m3u('#EXTM3U\n$liveEntry$movieEntry'));
      expect(s, const ContentSections(live: true, movies: true, series: false));
    });
  });

  group('SessionProvider', () {
    late SessionProvider session;

    setUp(() async {
      SharedPreferences.setMockInitialValues({});
      session = SessionProvider(await Storage.init());
    });

    test('deduce las secciones y el portal manda si trae "content"', () async {
      expect(session.sectionsWith(null), ContentSections.all);
      final (source, _) = xtream({});
      session.source = source;
      var notified = 0;
      session.addListener(() => notified++);
      await session.detectSections();
      expect(notified, 1);
      expect(session.sectionsWith(null).liveOnly, isTrue);
      expect(
        session.sectionsWith(const PortalContent()),
        ContentSections.all,
      );
      session.logout();
      expect(session.detectedSections, ContentSections.all);
    });
  });
}
