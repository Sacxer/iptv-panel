import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:iptv_player/models/profile.dart';
import 'package:iptv_player/providers/library_provider.dart';
import 'package:iptv_player/providers/portal_provider.dart';
import 'package:iptv_player/providers/profiles_provider.dart';
import 'package:iptv_player/providers/session_provider.dart';
import 'package:iptv_player/screens/profiles_screen.dart';
import 'package:iptv_player/services/storage.dart';
import 'package:iptv_player/theme.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Una sola prueba en este archivo: la entrada automática se hace una vez por arranque.
void main() {
  testWidgets(
      'entra sola con el último perfil al abrir la app (de fábrica) y no al cambiar de perfil',
      (tester) async {
    tester.view.physicalSize = const Size(420, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    // Lista M3U con dirección inválida: la conexión falla al instante (sin red).
    const profile = Profile(
      id: 'p1',
      name: 'zz-prueba lista',
      type: ProfileType.m3uUrl,
      m3uUrl: 'http://',
    );
    SharedPreferences.setMockInitialValues({'last_profile_id': profile.id});
    final storage = await Storage.init();
    expect(storage.autoLogin, isTrue); // nunca se tocó la opción
    final profiles = ProfilesProvider(storage);
    await profiles.save(profile);
    final session = SessionProvider(storage, profiles: profiles);

    final navigatorKey = GlobalKey<NavigatorState>();
    Widget app(Widget home) => MultiProvider(
          providers: [
            Provider<Storage>.value(value: storage),
            ChangeNotifierProvider<ProfilesProvider>.value(value: profiles),
            ChangeNotifierProvider<SessionProvider>.value(value: session),
            ChangeNotifierProvider(create: (_) => LibraryProvider(storage)),
            ChangeNotifierProvider(
                create: (_) => PortalProvider(storage, session: session)),
          ],
          child: MaterialApp(
            navigatorKey: navigatorKey,
            theme: AppTheme.dark(),
            home: home,
          ),
        );

    Future<void> settle() async {
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 200));
      }
    }

    // Al abrir la app: intenta entrar con el último perfil.
    await tester.pumpWidget(app(const ProfilesScreen(allowAutoLogin: true)));
    await settle();
    expect(find.text('No se pudo conectar a "zz-prueba lista"'), findsOneWidget);

    // "Cambiar perfil": vuelve a la lista y no entra otra vez.
    await tester.tap(find.text('Cambiar perfil'));
    await settle();
    expect(find.text('Seleccione un perfil'), findsOneWidget);
    expect(find.textContaining('No se pudo conectar'), findsNothing);

    // Cambiar de perfil desde la sesión abre una lista nueva (sin entrada automática)…
    navigatorKey.currentState!.pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const ProfilesScreen()),
      (_) => false,
    );
    await settle();
    expect(find.text('Seleccione un perfil'), findsOneWidget);
    expect(find.textContaining('No se pudo conectar'), findsNothing);

    // …e incluso otra pantalla "de arranque" no repite la entrada en la misma ejecución.
    navigatorKey.currentState!.pushAndRemoveUntil(
      MaterialPageRoute(
          builder: (_) => const ProfilesScreen(allowAutoLogin: true)),
      (_) => false,
    );
    await settle();
    expect(find.text('Seleccione un perfil'), findsOneWidget);
    expect(find.textContaining('No se pudo conectar'), findsNothing);
  });
}
