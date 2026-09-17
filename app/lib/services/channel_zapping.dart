/// Cambio de canal estilo decodificador: números del control y canal con el que abre la sesión.
/// Funciones puras (sin estado de pantalla) para poder probarlas.
library;

import 'package:flutter/services.dart';

import '../models/media_item.dart';

/// Número con el que se sintoniza el canal [index]: su `num` o, si no tiene, su posición
/// (desde 1) en [channels].
int channelNumberAt(List<MediaItem> channels, int index) =>
    channels[index].num ?? index + 1;

/// Posición del primer canal con ese número, o -1.
int findChannelByNumber(List<MediaItem> channels, int number) {
  for (var i = 0; i < channels.length; i++) {
    if (channelNumberAt(channels, i) == number) return i;
  }
  return -1;
}

/// Cifras del número de canal más alto (de 1 a [ChannelNumberEntry.maxDigits]): al escribir
/// tantas cifras se cambia de canal sin esperar.
int channelNumberDigits(List<MediaItem> channels) {
  var max = 0;
  for (var i = 0; i < channels.length; i++) {
    final n = channelNumberAt(channels, i);
    if (n > max) max = n;
  }
  return '$max'.length.clamp(1, ChannelNumberEntry.maxDigits);
}

/// Canal elegido por número: la lista con la que seguir y su posición en ella.
class ChannelTarget {
  final List<MediaItem> channels;
  final int index;
  const ChannelTarget(this.channels, this.index);
}

/// Busca el canal [number]. Si se conoce la lista completa ([all]), el número se busca ahí
/// (así coincide venga de la categoría que venga) y se sigue en [playlist] si el canal está en
/// ella; si no, se pasa a la lista completa. `null` si el canal no existe.
ChannelTarget? resolveChannelNumber(int number, List<MediaItem> playlist,
    [List<MediaItem>? all]) {
  if (all != null && all.isNotEmpty) {
    final i = findChannelByNumber(all, number);
    if (i < 0) return null;
    final key = all[i].key;
    final inPlaylist = playlist.indexWhere((c) => c.key == key);
    return inPlaylist >= 0
        ? ChannelTarget(playlist, inPlaylist)
        : ChannelTarget(all, i);
  }
  final i = findChannelByNumber(playlist, number);
  return i < 0 ? null : ChannelTarget(playlist, i);
}

/// Aviso breve cuando el número no corresponde a ningún canal.
String channelNotFoundMessage(int number) => 'Canal $number no existe';

/// Posición del canal con el que abre la sesión de un cliente solo con canales: el último
/// canal visto ([recents], el más reciente primero) si sigue en [channels]; si no, el primero.
/// -1 si no hay canales.
int startChannelIndex(List<MediaItem> channels, List<MediaItem> recents) {
  if (channels.isEmpty) return -1;
  MediaItem? last;
  for (final r in recents) {
    if (r.type == ContentType.live) {
      last = r;
      break;
    }
  }
  if (last == null) return 0;
  final key = last.key;
  final i = channels.indexWhere((c) => c.key == key);
  return i < 0 ? 0 : i;
}

/// Número de canal que se está escribiendo con el control.
class ChannelNumberEntry {
  /// Espera sin más cifras antes de cambiar de canal.
  static const Duration timeout = Duration(seconds: 2);

  /// Cifras como máximo (canal 99999).
  static const int maxDigits = 5;

  final String digits;

  /// Cifras del canal más alto: con tantas cifras se cambia enseguida.
  final int length;

  const ChannelNumberEntry({this.digits = '', this.length = maxDigits});

  bool get isEmpty => digits.isEmpty;

  /// Ya no caben más cifras: se cambia de canal sin esperar.
  bool get isComplete => digits.length >= length.clamp(1, maxDigits);

  /// Número escrito (`null` si no hay cifras).
  int? get number => digits.isEmpty ? null : int.tryParse(digits);

  /// Texto del recuadro: `12_` mientras se escribe, `125` al completar.
  String get label => isComplete ? digits : '${digits}_';

  /// Agrega una cifra (0-9). Si ya estaba completo, empieza un número nuevo.
  ChannelNumberEntry add(int digit, {int? length}) {
    assert(digit >= 0 && digit <= 9);
    final max = (length ?? this.length).clamp(1, maxDigits);
    final base = digits.length >= max ? '' : digits;
    return ChannelNumberEntry(digits: '$base$digit', length: max);
  }
}

/// Cifra de una tecla numérica (fila de números, teclado numérico o control remoto), o `null`.
int? digitForKey(LogicalKeyboardKey key) => _digitKeys[key];

final Map<LogicalKeyboardKey, int> _digitKeys = {
  LogicalKeyboardKey.digit0: 0,
  LogicalKeyboardKey.digit1: 1,
  LogicalKeyboardKey.digit2: 2,
  LogicalKeyboardKey.digit3: 3,
  LogicalKeyboardKey.digit4: 4,
  LogicalKeyboardKey.digit5: 5,
  LogicalKeyboardKey.digit6: 6,
  LogicalKeyboardKey.digit7: 7,
  LogicalKeyboardKey.digit8: 8,
  LogicalKeyboardKey.digit9: 9,
  LogicalKeyboardKey.numpad0: 0,
  LogicalKeyboardKey.numpad1: 1,
  LogicalKeyboardKey.numpad2: 2,
  LogicalKeyboardKey.numpad3: 3,
  LogicalKeyboardKey.numpad4: 4,
  LogicalKeyboardKey.numpad5: 5,
  LogicalKeyboardKey.numpad6: 6,
  LogicalKeyboardKey.numpad7: 7,
  LogicalKeyboardKey.numpad8: 8,
  LogicalKeyboardKey.numpad9: 9,
};
