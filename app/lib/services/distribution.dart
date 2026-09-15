import 'package:flutter/services.dart' show appFlavor;

/// Cómo se reparte esta compilación.
///
/// - `play`: Google Play (.aab). Play la actualiza; **no** incluye el actualizador propio.
/// - `portal`: APK repartido directamente (celulares, tabletas y TV box), con actualizador
///   desde el portal. Es la que se usa mientras la app no esté publicada en Play.
///
/// Se define al compilar con `--dart-define=DISTRIBUTION=play|portal` y además se respeta el
/// flavor de Gradle (`--flavor play` fija `appFlavor`). Si cualquiera de los dos dice `play`,
/// la compilación es Play. Son constantes: en la versión Play el compilador elimina el código
/// del actualizador que queda detrás de [AppDistribution.updaterEnabled].
class AppDistribution {
  AppDistribution._();

  static const String _define = String.fromEnvironment('DISTRIBUTION');

  static const bool isPlay = _define == 'play' || appFlavor == 'play';

  /// `play` o `portal` (por defecto, para compilaciones locales de prueba).
  static const String name = isPlay ? 'play' : 'portal';

  /// Actualizador propio desde el portal (solo versión portal).
  static const bool updaterEnabled = !isPlay;
}
