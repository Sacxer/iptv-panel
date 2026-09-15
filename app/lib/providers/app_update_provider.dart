import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import '../models/profile.dart';
import '../services/apk_installer.dart';
import '../services/app_update.dart';
import '../services/device.dart';
import '../services/distribution.dart';
import '../services/playback_activity.dart';
import '../services/storage.dart';
import '../widgets/app_update_widgets.dart';
import 'profiles_provider.dart';
import 'session_provider.dart';

/// "Más tarde" guardado en las preferencias.
class StorageSnoozeStore implements UpdateSnoozeStore {
  final Storage storage;
  const StorageSnoozeStore(this.storage);

  @override
  int? snoozedUntil(String key) => storage.updateSnoozedUntil(key);

  @override
  Future<void> setSnoozedUntil(String key, int epochMs) =>
      storage.setUpdateSnoozedUntil(key, epochMs);
}

/// Actualizador propio de la versión "portal" (el APK que se instala en celulares, tabletas y
/// TV box sin pasar por Google Play).
///
/// - Consulta al iniciar (con el perfil activo o el último usado), cada 6 h y al volver a la
///   app si pasó ese tiempo. Envía el tipo real de equipo (`mobile`, `tablet`, `tvbox`) para que
///   el portal pueda limitar a quién ofrece cada versión. Si el servidor no es el portal, no pasa nada.
/// - Opcional: pregunta "Actualizar / Más tarde" (24 h por versión), sin interrumpir el
///   reproductor ni la carga de un perfil.
/// - Obligatoria: la app entera pasa a la pantalla de actualización ([AppUpdateGate]).
class AppUpdateController extends ChangeNotifier with WidgetsBindingObserver {
  static const Duration checkInterval = Duration(hours: 6);
  static const Duration startupDelay = Duration(seconds: 3);

  /// Solo la versión portal en Android tiene actualizador.
  static bool get supported => AppDistribution.updaterEnabled && Device.isAndroid;

  final Storage storage;
  final ProfilesProvider profiles;
  final SessionProvider session;
  final GlobalKey<NavigatorState> navigatorKey;
  final AppUpdateChecker checker;
  final ApkInstaller installer;

  AppUpdateController({
    required this.storage,
    required this.profiles,
    required this.session,
    required this.navigatorKey,
    AppUpdateChecker? checker,
    this.installer = const ApkInstaller(),
  }) : checker = checker ??
            AppUpdateChecker(
              api: AppUpdateApi(headers: Device.headers),
              snoozeStore: StorageSnoozeStore(storage),
            );

  /// Última versión ofrecida para este equipo.
  AppUpdateInfo? available;

  /// Actualización obligatoria en curso: la app muestra solo la pantalla de actualización.
  bool blocking = false;
  bool checking = false;
  DateTime? lastCheck;

  bool _started = false;
  bool _disposed = false;
  bool _pendingPrompt = false;
  bool _pendingBlock = false;
  bool _promptOpen = false;
  AppLifecycleState _lifecycle = AppLifecycleState.resumed;
  Timer? _startupTimer;
  Timer? _periodic;

  void start() {
    if (!supported || _started) return;
    _started = true;
    WidgetsBinding.instance.addObserver(this);
    PlaybackActivity.active.addListener(_onConditionsChanged);
    session.addListener(_onConditionsChanged);
    _startupTimer = Timer(startupDelay, () => check());
    _periodic = Timer.periodic(checkInterval, (_) => check());
  }

  @override
  void dispose() {
    _disposed = true;
    _startupTimer?.cancel();
    _periodic?.cancel();
    if (_started) {
      WidgetsBinding.instance.removeObserver(this);
      PlaybackActivity.active.removeListener(_onConditionsChanged);
      session.removeListener(_onConditionsChanged);
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _lifecycle = state;
    if (state != AppLifecycleState.resumed) return;
    final last = lastCheck;
    if (last != null && DateTime.now().difference(last) >= checkInterval) {
      check();
    } else {
      _onConditionsChanged();
    }
  }

  /// URL del portal: la del perfil en uso, o la del último usado (o el único) antes de entrar.
  String? activeServerUrl() {
    final p = session.profile ??
        profiles.byId(profiles.lastProfileId) ??
        (profiles.profiles.length == 1 ? profiles.profiles.first : null);
    if (p == null) return null;
    switch (p.type) {
      case ProfileType.xtream:
        return AppUpdateApi.normalizeServer(p.serverUrl);
      case ProfileType.m3uUrl:
        final uri = Uri.tryParse(p.m3uUrl.trim());
        if (uri == null || uri.host.isEmpty) return null;
        return AppUpdateApi.normalizeServer(
            '${uri.scheme}://${uri.host}${uri.hasPort ? ':${uri.port}' : ''}');
      case ProfileType.m3uFile:
        return null;
    }
  }

  AppUpdateQuery currentQuery() => AppUpdateQuery(
        packageName: Device.packageName.isNotEmpty
            ? Device.packageName
            : 'com.iptvplayer.app',
        versionCode: int.tryParse(Device.appBuild) ?? 0,
        versionName: Device.appVersion,
        abis: Device.supportedAbis,
        deviceType: Device.type,
        deviceId: Device.deviceId,
        sdk: Device.sdkInt,
      );

  /// Consulta el portal. Con [manual] ignora "Más tarde" y no abre el aviso (lo decide quien
  /// llama). Devuelve `null` si no hay perfil con servidor o ya hay una consulta en curso.
  Future<AppUpdateDecision?> check({bool manual = false}) async {
    if (!supported || _disposed || checking) return null;
    final server = activeServerUrl();
    if (server == null) return null;
    checking = true;
    notifyListeners();
    try {
      final decision =
          await checker.run(server, currentQuery(), manual: manual);
      if (_disposed) return decision;
      if (decision.check.status != AppUpdateStatus.unavailable) {
        lastCheck = DateTime.now();
      }
      switch (decision.action) {
        case UpdateAction.block:
          available = decision.info;
          _pendingBlock = true;
        case UpdateAction.prompt:
          available = decision.info;
          if (!manual) _pendingPrompt = true;
        case UpdateAction.snoozed:
          available = decision.info;
        case UpdateAction.none:
          if (decision.check.status == AppUpdateStatus.upToDate) {
            available = null;
            blocking = false;
            _pendingBlock = false;
            _pendingPrompt = false;
            unawaited(_deleteDownloads());
          }
      }
      return decision;
    } finally {
      checking = false;
      if (!_disposed) {
        notifyListeners();
        _onConditionsChanged();
      }
    }
  }

  /// Muestra "Actualizar / Más tarde" para [info] (también desde "Buscar actualizaciones").
  Future<void> prompt(BuildContext context, AppUpdateInfo info) async {
    if (_promptOpen) return;
    _promptOpen = true;
    _pendingPrompt = false;
    final choice = await showAppUpdateDialog(context, info);
    _promptOpen = false;
    if (_disposed) return;
    switch (choice) {
      case UpdatePromptChoice.update:
        openUpdateScreen(info);
      case UpdatePromptChoice.later:
        await checker.snooze(info);
      case null:
        // Se cerró por navegación (p. ej. al terminar de cargar un perfil): se vuelve a ofrecer.
        _pendingPrompt = true;
    }
  }

  void openUpdateScreen(AppUpdateInfo info) {
    navigatorKey.currentState?.push(MaterialPageRoute(
      builder: (_) => AppUpdateScreen(
        info: info,
        mandatory: false,
        installer: installer,
        onLater: () => snooze(info),
      ),
    ));
  }

  Future<void> snooze(AppUpdateInfo info) => checker.snooze(info);

  bool get _idle =>
      _lifecycle == AppLifecycleState.resumed &&
      !PlaybackActivity.isPlaying &&
      session.status != SessionStatus.loading;

  void _onConditionsChanged() {
    if (_disposed || !_idle) return;
    final info = available;
    if (info == null) return;
    if (_pendingBlock && info.mandatory) {
      _pendingBlock = false;
      if (!blocking) {
        blocking = true;
        notifyListeners();
      }
      return;
    }
    if (_pendingPrompt && !info.mandatory && !blocking && !_promptOpen) {
      final context = navigatorKey.currentContext;
      if (context == null) return;
      // Deja terminar la transición en curso antes de abrir el aviso.
      Future<void>.delayed(const Duration(milliseconds: 600), () {
        final ctx = navigatorKey.currentContext;
        if (_disposed || !_idle || ctx == null || !_pendingPrompt) return;
        if (!ctx.mounted || available?.snoozeKey != info.snoozeKey) return;
        prompt(ctx, info);
      });
    }
  }

  Future<void> _deleteDownloads() async {
    try {
      final dir = Directory(await installer.updatesDir());
      await for (final f in dir.list()) {
        if (f is File) await f.delete();
      }
    } catch (_) {}
  }
}
