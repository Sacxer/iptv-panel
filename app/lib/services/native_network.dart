import 'package:flutter/services.dart';

import 'device.dart';
import 'server_discovery.dart';

/// Redes del equipo con máscara y puerta de enlace reales (Android, canal nativo
/// `iptv_player/network`). En otras plataformas devuelve `null` y la búsqueda usa /24.
class NativeNetworkInfo {
  NativeNetworkInfo._();

  static const MethodChannel _channel = MethodChannel('iptv_player/network');

  static Future<List<LocalNetwork>?> localNetworks() async {
    if (!Device.isAndroid) return null;
    try {
      final raw = await _channel.invokeListMethod<dynamic>('localNetworks');
      if (raw == null) return null;
      return ServerDiscovery.fromPlatformInfo(raw);
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  /// La búsqueda en red (y la reconexión del portal) usa estos datos.
  static void install() {
    if (Device.isAndroid) ServerDiscovery.platformNetworks = localNetworks;
  }
}
