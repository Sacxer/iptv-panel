import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:iptv_player/models/media_item.dart';
import 'package:iptv_player/models/portal_models.dart';
import 'package:iptv_player/models/profile.dart';
import 'package:iptv_player/providers/library_provider.dart';
import 'package:iptv_player/providers/portal_provider.dart';
import 'package:iptv_player/providers/session_provider.dart';
import 'package:iptv_player/screens/home_screen.dart';
import 'package:iptv_player/screens/search_screen.dart';
import 'package:iptv_player/services/content_source.dart';
import 'package:iptv_player/services/storage.dart';
import 'package:iptv_player/theme.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Fuente de contenido en memoria que anota qué listas se pidieron.
class FakeSource extends ContentSource {
  final Map<ContentType, List<MediaItem>> data;
  final List<ContentType> requested = [];

  FakeSource(this.data);

  @override
  bool get supportsMovies => true;
  @override
  bool get supportsSeries => true;
  @override
  bool get supportsEpg => false;

  @override
  Future<List<MediaCategory>> categories(ContentType type) async => const [];

  @override
  Future<List<MediaItem>> items(ContentType type) async {
    requested.add(type);
    return data[type] ?? const [];
  }

  @override
  Future<bool> hasContent(ContentType type) async =>
      (data[type] ?? const []).isNotEmpty;

  @override
  Future<MovieDetail> movieDetail(MediaItem item) async =>
      MovieDetail(item: item);

  @override
  Future<SeriesDetail> seriesDetail(MediaItem item) async =>
      SeriesDetail(item: item, seasons: const {});

  @override
  Future<List<EpgEntry>> shortEpg(MediaItem item) async => const [];

  @override
  Future<List<EpgEntry>> fullEpg(MediaItem item) async => const [];

  @override
  String streamUrl(MediaItem item) => '';

  @override
  void clearCache() {}

  @override
  void dispose() {}
}

/// Portal activo cuyo `content` se cambia desde la prueba.
class TestPortal extends PortalProvider {
  TestPortal(super.storage);

  void setContent(PortalContent? content) {
    enabled = true;
    info = PortalInfo(
      user: const PortalUser(username: 'zz-prueba'),
      content: content,
    );
    notifyListeners();
  }
}

MediaItem live(String id, String name) =>
    MediaItem(id: id, type: ContentType.live, name: name);
MediaItem movie(String id, String name) =>
    MediaItem(id: id, type: ContentType.movie, name: name);

void main() {
  late Storage storage;
  late SessionProvider session;
  late LibraryProvider library;
  late TestPortal portal;
  late FakeSource source;

  const profile = Profile(
    id: 'p1',
    name: 'zz-prueba',
    type: ProfileType.xtream,
    serverUrl: 'http://10.0.0.1:25461',
    username: 'zz-prueba',
  );

  Future<void> setUpProviders(
    WidgetTester tester, {
    required Map<ContentType, List<MediaItem>> data,
    PortalContent? content,
    List<MediaItem> favorites = const [],
  }) async {
    SharedPreferences.setMockInitialValues({});
    storage = await Storage.init();
    await storage.saveFavorites(profile.id, favorites);
    session = SessionProvider(storage);
    source = FakeSource(data);
    session
      ..profile = profile
      ..source = source
      ..status = SessionStatus.ready;
    library = LibraryProvider(storage)..load(profile.id);
    portal = TestPortal(storage);
    if (content != null) portal.setContent(content);
  }

  Widget app(Widget home) => MultiProvider(
        providers: [
          Provider<Storage>.value(value: storage),
          ChangeNotifierProvider<SessionProvider>.value(value: session),
          ChangeNotifierProvider<LibraryProvider>.value(value: library),
          ChangeNotifierProvider<PortalProvider>.value(value: portal),
        ],
        child: MaterialApp(theme: AppTheme.dark(), home: home),
      );

  void phoneSize(WidgetTester tester) {
    tester.view.physicalSize = const Size(420, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
  }

  Future<void> settle(WidgetTester tester) async {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pump(const Duration(milliseconds: 700));
  }

  Finder navLabel(String label) => find.descendant(
      of: find.byType(NavigationBar), matching: find.text(label));

  testWidgets('el menú muestra solo las secciones del portal y cambia sin reiniciar',
      (tester) async {
    phoneSize(tester);
    await setUpProviders(
      tester,
      data: {ContentType.live: [live('1', 'Canal Uno')]},
      content: const PortalContent(sections: ['live', 'movies']),
    );
    await tester.pumpWidget(app(const HomeScreen()));
    await settle(tester);

    expect(navLabel('Inicio'), findsOneWidget);
    expect(navLabel('TV en vivo'), findsOneWidget);
    expect(navLabel('Películas'), findsOneWidget);
    expect(find.text('Series'), findsNothing);

    // El portal quita las películas: desaparecen del menú y de los accesos del inicio.
    portal.setContent(const PortalContent(sections: ['live']));
    await settle(tester);
    expect(find.text('Películas'), findsNothing);
    expect(find.text('Series'), findsNothing);
    expect(navLabel('TV en vivo'), findsOneWidget);

    // Y agrega todo.
    portal.setContent(const PortalContent());
    await settle(tester);
    expect(navLabel('Películas'), findsOneWidget);
    expect(navLabel('Series'), findsOneWidget);

    // Sin TV en vivo.
    portal.setContent(const PortalContent(sections: ['movies', 'series']));
    await settle(tester);
    expect(find.text('TV en vivo'), findsNothing);
    expect(navLabel('Películas'), findsOneWidget);

    // Con las secciones del portal no se descargan listas en el inicio.
    expect(source.requested, isEmpty);
  });

  testWidgets('Inicio no muestra favoritos de secciones no incluidas',
      (tester) async {
    phoneSize(tester);
    await setUpProviders(
      tester,
      data: {ContentType.live: [live('1', 'Canal Uno')]},
      content: const PortalContent(sections: ['live'], start: 'menu'),
      favorites: [live('1', 'Canal Uno'), movie('9', 'Película Nueve')],
    );
    await tester.pumpWidget(app(const HomeScreen()));
    await settle(tester);

    expect(find.text('Canales favoritos (1)'), findsOneWidget);
    expect(find.textContaining('Películas favoritas'), findsNothing);
    expect(find.text('Película Nueve'), findsNothing);
  });

  testWidgets(
      'solo canales: abre en TV en vivo, sin canales muestra la lista vacía y Atrás pregunta salir',
      (tester) async {
    phoneSize(tester);
    await setUpProviders(
      tester,
      data: {ContentType.movie: [movie('9', 'Oculta')]},
      content: const PortalContent(sections: ['live'], start: 'last_channel'),
    );
    await tester.pumpWidget(app(const HomeScreen()));
    await settle(tester);

    expect(find.text('No hay canales disponibles.'), findsOneWidget);
    expect(source.requested.toSet(), {ContentType.live});

    await tester.binding.handlePopRoute();
    await settle(tester);
    expect(find.text('¿Desea salir de IPTV Player?'), findsOneWidget);
    await tester.tap(find.text('Cancelar'));
    await settle(tester);
    expect(find.text('¿Desea salir de IPTV Player?'), findsNothing);
    expect(find.text('No hay canales disponibles.'), findsOneWidget);
  });

  testWidgets('sin portal: deduce las secciones (sin películas ni series)',
      (tester) async {
    phoneSize(tester);
    await setUpProviders(tester, data: {
      ContentType.live: const [],
      ContentType.series: [
        MediaItem(id: 's', type: ContentType.series, name: 'Serie'),
      ],
    });
    await session.detectSections();
    await tester.pumpWidget(app(const HomeScreen()));
    await settle(tester);

    expect(navLabel('Series'), findsOneWidget);
    expect(find.text('Películas'), findsNothing);
    // Hay series: no abre directo en TV en vivo.
    expect(find.text('No hay canales disponibles.'), findsNothing);
  });

  testWidgets('Buscar solo carga y muestra las secciones incluidas',
      (tester) async {
    phoneSize(tester);
    await setUpProviders(
      tester,
      data: {
        ContentType.live: [live('1', 'Noticias 24')],
        ContentType.movie: [movie('2', 'Noticias la película')],
      },
      content: const PortalContent(sections: ['live'], start: 'menu'),
    );
    await tester.pumpWidget(app(const SearchScreen(standalone: true)));
    await settle(tester);

    expect(find.text('Buscar canales'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'noticias');
    await tester.pump(const Duration(milliseconds: 400));
    await settle(tester);

    expect(find.text('Canales (1)'), findsOneWidget);
    expect(find.text('Noticias 24'), findsOneWidget);
    expect(find.text('Noticias la película'), findsNothing);
    expect(source.requested, [ContentType.live]);

    // El portal agrega películas: se cargan y aparecen en la búsqueda.
    portal.setContent(const PortalContent(sections: ['live', 'movies']));
    await settle(tester);
    expect(find.text('Noticias la película'), findsOneWidget);
    expect(source.requested, [ContentType.live, ContentType.movie]);
  });
}
