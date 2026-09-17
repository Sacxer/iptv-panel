import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:iptv_player/services/auto_start.dart';
import 'package:iptv_player/services/storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Entrar con el último perfil', () {
    test('activado de fábrica si nunca se tocó', () async {
      SharedPreferences.setMockInitialValues({});
      final storage = await Storage.init();
      expect(storage.autoLogin, isTrue);
    });

    test('quien lo apagó a mano lo conserva apagado', () async {
      SharedPreferences.setMockInitialValues({'settings_auto_login': false});
      final storage = await Storage.init();
      expect(storage.autoLogin, isFalse);
      await storage.setAutoLogin(true);
      expect(storage.autoLogin, isTrue);
      await storage.setAutoLogin(false);
      expect((await Storage.init()).autoLogin, isFalse);
    });

    test('el aviso del TV box se recuerda', () async {
      SharedPreferences.setMockInitialValues({});
      final storage = await Storage.init();
      expect(storage.autoStartAsked, isFalse);
      await storage.setAutoStartAsked(true);
      expect((await Storage.init()).autoStartAsked, isTrue);
    });
  });

  group('Abrir al encender el equipo', () {
    test('estado según versión, equipo y Android', () {
      AutoStartState state({
        bool portal = true,
        bool isTv = true,
        int? sdk = 30,
        bool canDraw = false,
      }) =>
          autoStartStateFor(
              portal: portal, isTv: isTv, sdkInt: sdk, canDrawOverlays: canDraw);

      expect(state(portal: false), AutoStartState.unsupported);
      expect(state(isTv: false), AutoStartState.unsupported);
      expect(state(sdk: null), AutoStartState.unsupported);
      // Android 9 o anterior: sin permiso.
      expect(state(sdk: 28), AutoStartState.active);
      expect(state(sdk: 24), AutoStartState.active);
      // Android 10+: depende del permiso.
      expect(state(sdk: 29), AutoStartState.needsPermission);
      expect(state(sdk: 34, canDraw: true), AutoStartState.active);
    });

    test('se pregunta una sola vez y solo si falta el permiso', () {
      const missing = AutoStartStatus(AutoStartState.needsPermission);
      const ok = AutoStartStatus(AutoStartState.active);
      expect(shouldAskAutoStartPermission(missing, alreadyAsked: false), isTrue);
      expect(shouldAskAutoStartPermission(missing, alreadyAsked: true), isFalse);
      expect(shouldAskAutoStartPermission(ok, alreadyAsked: false), isFalse);
      expect(
          shouldAskAutoStartPermission(AutoStartStatus.unsupported,
              alreadyAsked: false),
          isFalse);
    });

    group('canal nativo', () {
      final calls = <String>[];
      Map<String, Object?> answers = {};
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

      setUp(() {
        calls.clear();
        answers = {};
        AutoStart.debugAvailable = true;
        messenger.setMockMethodCallHandler(AutoStart.channel, (call) async {
          calls.add(call.method);
          if (!answers.containsKey(call.method)) {
            throw MissingPluginException();
          }
          final value = answers[call.method];
          if (value is PlatformException) throw value;
          return value;
        });
      });

      tearDown(() {
        AutoStart.debugAvailable = null;
        messenger.setMockMethodCallHandler(AutoStart.channel, null);
      });

      test('TV box Android 11 sin permiso y sin la pantalla del permiso', () async {
        answers = {
          'isTv': true,
          'sdkInt': 30,
          'canDrawOverlays': false,
          'hasOverlaySettings': false,
        };
        final s = await AutoStart.status();
        expect(s.state, AutoStartState.needsPermission);
        expect(s.sdkInt, 30);
        expect(s.hasOverlaySettings, isFalse);
      });

      test('TV box con permiso: activo', () async {
        answers = {'isTv': true, 'sdkInt': 33, 'canDrawOverlays': true};
        final s = await AutoStart.status();
        expect(s.state, AutoStartState.active);
        expect(calls, isNot(contains('hasOverlaySettings')));
      });

      test('celular: no aplica', () async {
        answers = {'isTv': false, 'sdkInt': 33, 'canDrawOverlays': false};
        expect((await AutoStart.status()).supported, isFalse);
      });

      test('versión play (el canal responde "no disponible"): no aplica', () async {
        answers = {
          'isTv': PlatformException(code: 'UNAVAILABLE'),
        };
        expect((await AutoStart.status()).supported, isFalse);
      });

      test('sin la versión portal no se llama al canal', () async {
        AutoStart.debugAvailable = false;
        expect((await AutoStart.status()).supported, isFalse);
        expect(await AutoStart.openOverlaySettings(), OverlaySettingsScreen.none);
        expect(calls, isEmpty);
      });

      test('abrir ajustes informa qué pantalla abrió', () async {
        answers = {'openOverlaySettings': 'app'};
        expect(await AutoStart.openOverlaySettings(), OverlaySettingsScreen.app);
        answers = {'openOverlaySettings': ''};
        expect(await AutoStart.openOverlaySettings(), OverlaySettingsScreen.none);
        answers = {'openOverlaySettings': 'overlay'};
        expect(
            await AutoStart.openOverlaySettings(), OverlaySettingsScreen.overlay);
      });
    });
  });
}
