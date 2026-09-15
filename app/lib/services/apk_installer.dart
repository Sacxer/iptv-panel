import 'package:flutter/services.dart';

/// Instalación del APK descargado (canal nativo que solo existe en la versión "portal",
/// ver `android/app/src/portal/kotlin/.../FlavorSetup.kt`).
class ApkInstaller {
  static const MethodChannel _channel = MethodChannel('iptv_player/installer');

  const ApkInstaller();

  /// Carpeta de la caché donde se guarda el APK (la única que el sistema puede leer).
  Future<String> updatesDir() async {
    final dir = await _channel.invokeMethod<String>('updatesDir');
    if (dir == null || dir.isEmpty) {
      throw PlatformException(code: 'NO_DIR', message: 'Sin carpeta de descargas');
    }
    return dir;
  }

  /// `true` si ya se permitió "Instalar apps desconocidas" para esta app.
  Future<bool> canInstall() async =>
      await _channel.invokeMethod<bool>('canInstall') ?? false;

  /// Abre el ajuste para permitirlo. `false` si el equipo no tiene esa pantalla.
  Future<bool> openPermissionSettings() async =>
      await _channel.invokeMethod<bool>('openInstallPermissionSettings') ??
      false;

  /// Abre el instalador del sistema con el APK.
  Future<void> install(String apkPath) =>
      _channel.invokeMethod<bool>('install', {'path': apkPath});
}
