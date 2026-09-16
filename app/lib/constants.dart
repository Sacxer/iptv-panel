/// Constantes globales de la aplicación.
///
/// Para cambiar el nombre visible de la app basta con modificar [AppConfig.appName]
/// (y el `android:label` en `android/app/src/main/AndroidManifest.xml`, ver README).
class AppConfig {
  AppConfig._();

  /// Nombre visible de la aplicación (título de ventana, pantallas, etc.).
  static const String appName = 'IPTV Player';

  /// Versión de respaldo si no se puede leer la instalada (la real sale de pubspec.yaml,
  /// ver `Device.appVersion`).
  static const String appVersion = '1.0.2';

  /// Base del User-Agent (se completa con sistema y modelo en `Device.userAgent`).
  static const String userAgentBase = 'IPTVPlayer/1.0';

  /// Duración de la caché de la guía EPG corta.
  static const Duration epgCacheTtl = Duration(minutes: 5);

  /// Tiempo en segundo plano tras el cual se informa al portal que se detuvo.
  static const Duration backgroundStopDelay = Duration(minutes: 1);

  /// Tiempo máximo de espera para peticiones normales de la API.
  static const Duration apiTimeout = Duration(seconds: 25);

  /// Tiempo máximo para descargar listas M3U grandes o catálogos completos.
  static const Duration longTimeout = Duration(seconds: 90);

  /// Tiempo máximo para detectar el portal (`/api/client/ping`).
  static const Duration pingTimeout = Duration(seconds: 6);

  /// Intervalo de consulta de avisos/mensajes del portal.
  static const Duration portalPollInterval = Duration(minutes: 5);

  /// Tiempo en que se oculta la capa de información del reproductor.
  static const Duration overlayHideDelay = Duration(seconds: 5);

  /// Número máximo de elementos en "Recientes".
  static const int maxRecents = 60;

  /// Reintentos automáticos de reproducción antes de mostrar el error.
  static const int maxPlaybackRetries = 4;
}
