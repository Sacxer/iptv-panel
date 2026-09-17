import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:iptv_player/models/media_item.dart';
import 'package:iptv_player/services/channel_zapping.dart';

MediaItem channel(String id, {int? num}) =>
    MediaItem(id: id, type: ContentType.live, name: 'Canal $id', num: num);

void main() {
  group('números de canal', () {
    final withNum = [
      channel('a', num: 1),
      channel('b', num: 5),
      channel('c', num: 12),
      channel('d', num: 125),
    ];
    final withoutNum = [channel('x'), channel('y'), channel('z')];

    test('usa el num del canal o, si no tiene, la posición desde 1', () {
      expect(channelNumberAt(withNum, 2), 12);
      expect(channelNumberAt(withoutNum, 0), 1);
      expect(channelNumberAt(withoutNum, 2), 3);
      expect(channelNumberAt([channel('m', num: 40), channel('n')], 1), 2);
    });

    test('busca por número', () {
      expect(findChannelByNumber(withNum, 12), 2);
      expect(findChannelByNumber(withNum, 2), -1); // no es la posición
      expect(findChannelByNumber(withoutNum, 2), 1);
      expect(findChannelByNumber(withoutNum, 999), -1);
      expect(findChannelByNumber(const [], 1), -1);
    });

    test('cifras del canal más alto', () {
      expect(channelNumberDigits(withNum), 3);
      expect(channelNumberDigits(withoutNum), 1);
      expect(channelNumberDigits(const []), 1);
      expect(channelNumberDigits([channel('big', num: 1234567)]),
          ChannelNumberEntry.maxDigits);
    });

    test('con la lista completa: sigue en la categoría o pasa a todos', () {
      final all = [
        channel('a', num: 1),
        channel('b', num: 2),
        channel('c', num: 3),
      ];
      final category = [all[2], all[0]];
      final inCategory = resolveChannelNumber(1, category, all)!;
      expect(identical(inCategory.channels, category), isTrue);
      expect(inCategory.index, 1);
      final outside = resolveChannelNumber(2, category, all)!;
      expect(identical(outside.channels, all), isTrue);
      expect(outside.index, 1);
      expect(resolveChannelNumber(999, category, all), isNull);
      // Sin lista completa, solo la que se reproduce.
      final local = resolveChannelNumber(3, category)!;
      expect(identical(local.channels, category), isTrue);
      expect(local.index, 0);
      expect(resolveChannelNumber(2, category), isNull);
      expect(resolveChannelNumber(2, category, const []), isNull);
    });

    test('aviso de canal inexistente', () {
      expect(channelNotFoundMessage(999), 'Canal 999 no existe');
    });
  });

  group('ChannelNumberEntry', () {
    test('acumula cifras y muestra el recuadro', () {
      var e = const ChannelNumberEntry();
      expect(e.isEmpty, isTrue);
      expect(e.number, isNull);
      e = e.add(1, length: 3);
      expect(e.label, '1_');
      e = e.add(2, length: 3);
      expect(e.label, '12_');
      expect(e.number, 12);
      expect(e.isComplete, isFalse);
      e = e.add(5, length: 3);
      expect(e.isComplete, isTrue);
      expect(e.label, '125');
      expect(e.number, 125);
      // Tras completar, la siguiente cifra empieza otro número.
      e = e.add(7, length: 3);
      expect(e.digits, '7');
    });

    test('ceros a la izquierda y límite de cifras', () {
      var e = const ChannelNumberEntry().add(0, length: 3).add(7);
      expect(e.number, 7);
      expect(e.label, '07_');
      var long = const ChannelNumberEntry();
      for (var i = 0; i < ChannelNumberEntry.maxDigits; i++) {
        long = long.add(9, length: 99);
      }
      expect(long.isComplete, isTrue);
      expect(long.digits.length, ChannelNumberEntry.maxDigits);
      // Con un canal de una cifra, cada tecla cambia enseguida.
      expect(const ChannelNumberEntry().add(4, length: 1).isComplete, isTrue);
    });

    test('teclas numéricas del control y del teclado', () {
      expect(digitForKey(LogicalKeyboardKey.digit0), 0);
      expect(digitForKey(LogicalKeyboardKey.digit7), 7);
      expect(digitForKey(LogicalKeyboardKey.numpad3), 3);
      expect(digitForKey(LogicalKeyboardKey.numpad9), 9);
      expect(digitForKey(LogicalKeyboardKey.keyA), isNull);
      expect(digitForKey(LogicalKeyboardKey.select), isNull);
      expect(digitForKey(LogicalKeyboardKey.channelUp), isNull);
    });
  });

  group('canal con el que abre la sesión', () {
    final channels = [channel('1'), channel('2'), channel('3')];

    test('el último canal visto si sigue en la lista', () {
      final recents = [
        MediaItem(id: '9', type: ContentType.movie, name: 'Película'),
        channel('3'),
        channel('2'),
      ];
      expect(startChannelIndex(channels, recents), 2);
    });

    test('si ya no está (o no hay recientes), el primero', () {
      expect(startChannelIndex(channels, [channel('77'), channel('2')]), 0);
      expect(startChannelIndex(channels, const []), 0);
      expect(
          startChannelIndex(channels, [
            MediaItem(id: '1', type: ContentType.movie, name: 'Otra cosa'),
          ]),
          0);
    });

    test('sin canales: -1 (lista vacía normal)', () {
      expect(startChannelIndex(const [], [channel('1')]), -1);
    });
  });
}
