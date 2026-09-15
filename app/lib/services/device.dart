import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import 'package:window_manager/window_manager.dart';

import '../constants.dart';
import 'distribution.dart';

/// Información del dispositivo, cabeceras de identificación y utilidades de ventana.
class Device {
  Device._();

  /// `true` en Android TV / Google TV / Fire TV (leanback).
  static bool isTv = false;

  /// `mobile` | `tablet` | `tvbox` | `pc`.
  static String type = 'mobile';
  static String brand = '';
  static String model = '';
  static String os = '';
  static String deviceId = '';

  /// Versión instalada (`versionName`), p. ej. `1.0.1`.
  static String appVersion = AppConfig.appVersion;

  /// Número de compilación instalado (`versionCode`). Con `--split-per-abi` Flutter usa
  /// 1000×ABI + build (arm64-v8a: 2002), y así lo compara el portal.
  static String appBuild = '';
  static String packageName = '';

  /// Arquitecturas del equipo por preferencia (`Build.SUPPORTED_ABIS`).
  static List<String> supportedAbis = const [];

  /// Nivel de API de Android (`Build.VERSION.SDK_INT`).
  static int? sdkInt;

  static bool get isWindows => !kIsWeb && Platform.isWindows;
  static bool get isAndroid => !kIsWeb && Platform.isAndroid;

  /// `true` en teléfonos/tabletas (no TV ni escritorio).
  static bool get isMobile => isAndroid && !isTv;

  static const _kDeviceId = 'device_id';

  static Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      var id = prefs.getString(_kDeviceId);
      if (id == null || id.isEmpty) {
        id = const Uuid().v4();
        await prefs.setString(_kDeviceId, id);
      }
      deviceId = id;
    } catch (_) {
      deviceId = const Uuid().v4();
    }

    try {
      final pkg = await PackageInfo.fromPlatform();
      if (pkg.version.isNotEmpty) appVersion = pkg.version;
      appBuild = pkg.buildNumber;
      packageName = pkg.packageName;
    } catch (_) {}

    final info = DeviceInfoPlugin();
    try {
      if (isAndroid) {
        final a = await info.androidInfo;
        brand = _cap(a.brand.isNotEmpty ? a.brand : a.manufacturer);
        model = a.model;
        os = 'Android ${a.version.release}';
        supportedAbis = List.unmodifiable(a.supportedAbis);
        sdkInt = a.version.sdkInt;
        isTv = a.systemFeatures.contains('android.software.leanback') ||
            a.systemFeatures.contains('android.hardware.type.television');
        if (isTv) {
          type = 'tvbox';
        } else {
          type = _shortestSideDp() >= 600 ? 'tablet' : 'mobile';
        }
      } else if (isWindows) {
        final w = await info.windowsInfo;
        brand = 'PC';
        model = w.productName.isNotEmpty ? w.productName : 'Windows';
        os = 'Windows ${w.displayVersion}'.trim();
        type = 'pc';
      }
    } catch (_) {
      if (isWindows) type = 'pc';
    }
  }

  static double _shortestSideDp() {
    try {
      final views = PlatformDispatcher.instance.views;
      if (views.isEmpty) return 0;
      final v = views.first;
      final size = v.physicalSize / v.devicePixelRatio;
      return size.shortestSide;
    } catch (_) {
      return 0;
    }
  }

  static String _cap(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

  /// User-Agent tipo `IPTVPlayer/1.0 (Android 14; SM-A536E)`.
  static String get userAgent {
    final parts = [
      if (os.isNotEmpty) os,
      if (model.isNotEmpty) model,
    ];
    return parts.isEmpty
        ? AppConfig.userAgentBase
        : '${AppConfig.userAgentBase} (${parts.join('; ')})';
  }

  /// Cabeceras de identificación enviadas al portal, a la API Xtream y a los streams.
  static Map<String, String> get headers => {
        'User-Agent': userAgent,
        if (deviceId.isNotEmpty) 'X-Device-Id': deviceId,
        'X-Device-Type': type,
        if (brand.isNotEmpty) 'X-Device-Brand': _ascii(brand),
        if (model.isNotEmpty) 'X-Device-Model': _ascii(model),
        'X-App-Name': AppConfig.appName,
        'X-App-Version': _ascii(appVersion),
        if (appBuild.isNotEmpty) 'X-App-Build': _ascii(appBuild),
        'X-App-Distribution': AppDistribution.name,
      };

  /// Las cabeceras HTTP deben ser ASCII.
  static String _ascii(String s) =>
      s.replaceAll(RegExp(r'[^\x20-\x7E]'), '').trim();

  // ---------- Ventana (Windows) ----------

  static Future<bool> isFullScreen() async {
    if (!isWindows) return false;
    try {
      return await windowManager.isFullScreen();
    } catch (_) {
      return false;
    }
  }

  static Future<void> setFullScreen(bool value) async {
    if (!isWindows) return;
    try {
      await windowManager.setFullScreen(value);
    } catch (_) {}
  }

  static Future<void> toggleFullScreen() async {
    if (!isWindows) return;
    await setFullScreen(!await isFullScreen());
  }

  /// Cierra la aplicación.
  static Future<void> exitApp() async {
    if (isWindows) {
      try {
        await windowManager.close();
        return;
      } catch (_) {}
    }
    await SystemNavigator.pop();
  }
}
