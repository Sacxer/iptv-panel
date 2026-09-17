import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import 'device.dart';
import 'distribution.dart';

/// "Abrir al encender el equipo" en TV box (solo versión portal).
///
/// El receptor nativo (`android/app/src/portal/.../BootReceiver.kt`) abre la app al encender,
/// solo en televisores. En Android 10+ necesita el permiso "Mostrar sobre otras apps"; en
/// Android 9 o anterior funciona sin permiso. No se puede apagar (decisión del operador).
enum AutoStartState {
  /// No aplica: versión Play, celular/tableta, otra plataforma o sin respuesta del equipo.
  unsupported,

  /// Funciona: Android 9 o anterior, o ya tiene el permiso.
  active,

  /// Falta el permiso "Mostrar sobre otras apps" (Android 10+).
  needsPermission,
}

class AutoStartStatus {
  final AutoStartState state;
  final int? sdkInt;

  /// El equipo tiene la pantalla del permiso "Mostrar sobre otras apps" (muchos TV box no).
  final bool hasOverlaySettings;

  const AutoStartStatus(this.state,
      {this.sdkInt, this.hasOverlaySettings = true});

  static const AutoStartStatus unsupported =
      AutoStartStatus(AutoStartState.unsupported);

  bool get supported => state != AutoStartState.unsupported;
}

/// Android 10 (API 29): desde ahí abrir una pantalla al arrancar exige el permiso.
const int autoStartPermissionSdk = 29;

/// Estado según la versión y el equipo.
AutoStartState autoStartStateFor({
  required bool portal,
  required bool isTv,
  required int? sdkInt,
  required bool canDrawOverlays,
}) {
  if (!portal || !isTv || sdkInt == null) return AutoStartState.unsupported;
  if (sdkInt < autoStartPermissionSdk) return AutoStartState.active;
  return canDrawOverlays
      ? AutoStartState.active
      : AutoStartState.needsPermission;
}

/// Se pregunta una sola vez por equipo, y solo si falta el permiso.
bool shouldAskAutoStartPermission(AutoStartStatus status,
        {required bool alreadyAsked}) =>
    !alreadyAsked && status.state == AutoStartState.needsPermission;

/// Qué pantalla abrió [AutoStart.openOverlaySettings].
enum OverlaySettingsScreen {
  /// El permiso "Mostrar sobre otras apps".
  overlay,

  /// Los datos de la app (el equipo no tiene la pantalla del permiso).
  app,

  /// Los Ajustes generales.
  settings,

  /// Nada.
  none,
}

/// Canal nativo `iptv_player/autostart` (ver `AutoStartChannel.kt`).
class AutoStart {
  AutoStart._();

  static const MethodChannel channel = MethodChannel('iptv_player/autostart');

  /// Para pruebas: fuerza [available].
  @visibleForTesting
  static bool? debugAvailable;

  /// Solo la versión portal en Android lo incluye (y solo actúa en TV).
  static bool get available =>
      debugAvailable ?? (AppDistribution.bootStartEnabled && Device.isAndroid);

  static Future<AutoStartStatus> status() async {
    if (!available) return AutoStartStatus.unsupported;
    try {
      final isTv = await channel.invokeMethod<bool>('isTv') ?? false;
      final sdkInt = await channel.invokeMethod<int>('sdkInt');
      final canDraw =
          await channel.invokeMethod<bool>('canDrawOverlays') ?? false;
      final state = autoStartStateFor(
        portal: true,
        isTv: isTv,
        sdkInt: sdkInt,
        canDrawOverlays: canDraw,
      );
      final hasScreen = state == AutoStartState.needsPermission
          ? await channel.invokeMethod<bool>('hasOverlaySettings') ?? false
          : true;
      return AutoStartStatus(state,
          sdkInt: sdkInt, hasOverlaySettings: hasScreen);
    } on PlatformException {
      return AutoStartStatus.unsupported;
    } on MissingPluginException {
      return AutoStartStatus.unsupported;
    }
  }

  /// Abre el permiso "Mostrar sobre otras apps" o, si el equipo no tiene esa pantalla, los
  /// datos de la app o los Ajustes.
  static Future<OverlaySettingsScreen> openOverlaySettings() async {
    if (!available) return OverlaySettingsScreen.none;
    try {
      final opened = await channel.invokeMethod<String>('openOverlaySettings');
      return OverlaySettingsScreen.values.firstWhere((s) => s.name == opened,
          orElse: () => OverlaySettingsScreen.none);
    } on PlatformException {
      return OverlaySettingsScreen.none;
    } on MissingPluginException {
      return OverlaySettingsScreen.none;
    }
  }

  /// Espera a que el usuario vuelva a la app después de abrir los ajustes. Si la app no llega a
  /// salir de primer plano en [leaveTimeout], no espera más.
  static Future<void> waitForReturn(
      {Duration leaveTimeout = const Duration(seconds: 3)}) async {
    final done = Completer<void>();
    var left = false;
    final listener = AppLifecycleListener(onStateChange: (state) {
      if (state != AppLifecycleState.resumed) {
        left = true;
      } else if (left && !done.isCompleted) {
        done.complete();
      }
    });
    final timer = Timer(leaveTimeout, () {
      if (!left && !done.isCompleted) done.complete();
    });
    try {
      await done.future;
    } finally {
      timer.cancel();
      listener.dispose();
    }
  }
}
