import 'package:flutter/foundation.dart';

/// Reproductores abiertos. Sirve para no interrumpir lo que se está viendo
/// (por ejemplo, el aviso de actualización espera a que se cierre el reproductor).
class PlaybackActivity {
  PlaybackActivity._();

  static final ValueNotifier<int> active = ValueNotifier<int>(0);

  static bool get isPlaying => active.value > 0;

  static void enter() => active.value = active.value + 1;

  static void exit() => active.value = active.value > 0 ? active.value - 1 : 0;
}
