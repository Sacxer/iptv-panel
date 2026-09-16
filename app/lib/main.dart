import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:media_kit/media_kit.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';

import 'constants.dart';
import 'providers/app_update_provider.dart';
import 'providers/library_provider.dart';
import 'providers/portal_provider.dart';
import 'providers/profiles_provider.dart';
import 'providers/session_provider.dart';
import 'screens/profiles_screen.dart';
import 'services/device.dart';
import 'services/distribution.dart';
import 'services/native_network.dart';
import 'services/storage.dart';
import 'theme.dart';
import 'widgets/app_update_widgets.dart';

final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

/// Para avisos breves que no dependen de una pantalla (p. ej. "Servidor encontrado…").
final GlobalKey<ScaffoldMessengerState> scaffoldMessengerKey =
    GlobalKey<ScaffoldMessengerState>();

void showGlobalNotice(String message) {
  scaffoldMessengerKey.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Row(
        children: [
          const Icon(Icons.wifi_tethering_rounded, color: AppColors.success),
          const SizedBox(width: 12),
          Expanded(child: Text(message)),
        ],
      ),
      duration: const Duration(seconds: 4),
    ));
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  MediaKit.ensureInitialized();

  if (Device.isWindows) {
    await windowManager.ensureInitialized();
    const options = WindowOptions(
      title: AppConfig.appName,
      size: Size(1280, 760),
      minimumSize: Size(800, 520),
      center: true,
      backgroundColor: AppColors.background,
    );
    windowManager.waitUntilReadyToShow(options, () async {
      await windowManager.show();
      await windowManager.focus();
    });
  }

  await Device.init();
  NativeNetworkInfo.install();
  final storage = await Storage.init();
  runApp(IptvApp(storage: storage));
}

class _BackIntent extends Intent {
  const _BackIntent();
}

class _FullScreenIntent extends Intent {
  const _FullScreenIntent();
}

class IptvApp extends StatelessWidget {
  final Storage storage;
  const IptvApp({super.key, required this.storage});

  /// Actualizador propio: solo versión portal en Android. En la versión Play la constante
  /// es `false` y el compilador descarta todo ese código.
  static bool get _updater =>
      AppDistribution.updaterEnabled && AppUpdateController.supported;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<Storage>.value(value: storage),
        ChangeNotifierProvider(create: (_) => ProfilesProvider(storage)),
        ChangeNotifierProvider(
          create: (ctx) => SessionProvider(
            storage,
            profiles: ctx.read<ProfilesProvider>(),
            onNotice: showGlobalNotice,
          ),
        ),
        ChangeNotifierProvider(create: (_) => LibraryProvider(storage)),
        ChangeNotifierProvider(
          create: (ctx) =>
              PortalProvider(storage, session: ctx.read<SessionProvider>()),
        ),
        if (AppDistribution.updaterEnabled && _updater)
          ChangeNotifierProvider(
            lazy: false,
            create: (ctx) => AppUpdateController(
              storage: storage,
              profiles: ctx.read<ProfilesProvider>(),
              session: ctx.read<SessionProvider>(),
              navigatorKey: navigatorKey,
            )..start(),
          ),
      ],
      child: MaterialApp(
        title: AppConfig.appName,
        debugShowCheckedModeBanner: false,
        theme: AppTheme.dark(),
        darkTheme: AppTheme.dark(),
        themeMode: ThemeMode.dark,
        navigatorKey: navigatorKey,
        scaffoldMessengerKey: scaffoldMessengerKey,
        shortcuts: {
          ...WidgetsApp.defaultShortcuts,
          // OK del control remoto.
          const SingleActivator(LogicalKeyboardKey.select): const ActivateIntent(),
          const SingleActivator(LogicalKeyboardKey.gameButtonA):
              const ActivateIntent(),
        },
        builder: (context, child) {
          return Shortcuts(
            shortcuts: const <ShortcutActivator, Intent>{
              SingleActivator(LogicalKeyboardKey.escape): _BackIntent(),
              SingleActivator(LogicalKeyboardKey.browserBack): _BackIntent(),
              SingleActivator(LogicalKeyboardKey.f11): _FullScreenIntent(),
              SingleActivator(LogicalKeyboardKey.enter, alt: true):
                  _FullScreenIntent(),
            },
            child: Actions(
              actions: <Type, Action<Intent>>{
                _BackIntent: CallbackAction<_BackIntent>(
                  onInvoke: (_) => navigatorKey.currentState?.maybePop(),
                ),
                _FullScreenIntent: CallbackAction<_FullScreenIntent>(
                  onInvoke: (_) => Device.toggleFullScreen(),
                ),
              },
              child: AppDistribution.updaterEnabled && _updater
                  ? AppUpdateGate(child: child ?? const SizedBox.shrink())
                  : child ?? const SizedBox.shrink(),
            ),
          );
        },
        home: const ProfilesScreen(allowAutoLogin: true),
      ),
    );
  }
}
