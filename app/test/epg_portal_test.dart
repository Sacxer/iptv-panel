import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:iptv_player/models/media_item.dart';
import 'package:iptv_player/models/portal_models.dart';
import 'package:iptv_player/models/xtream_models.dart';
import 'package:iptv_player/services/portal_api.dart';
import 'package:iptv_player/widgets/epg_widgets.dart';

String b64(String s) => base64.encode(utf8.encode(s));

void main() {
  group('EPG base64', () {
    test('decodeMaybeBase64 decodifica UTF-8 y respeta texto plano', () {
      expect(decodeMaybeBase64(b64('Fútbol: Nacional vs. Millonarios')),
          'Fútbol: Nacional vs. Millonarios');
      expect(decodeMaybeBase64(b64('Noticias')), 'Noticias');
      // Texto plano que no es base64 válido.
      expect(decodeMaybeBase64('Película de la noche'), 'Película de la noche');
      // Palabra de 4 letras que "parece" base64 pero decodifica a binario.
      expect(decodeMaybeBase64('News'), 'News');
      expect(decodeMaybeBase64(null), '');
      expect(decodeMaybeBase64(''), '');
    });

    test('get_short_epg con timestamps como string y número', () {
      final json = jsonDecode('''
      {"epg_listings": [
        {"id": "2", "epg_id": "1", "title": "${b64('Después')}", "lang": "es",
         "start": "2026-09-14 11:00:00", "end": "2026-09-14 12:00:00",
         "description": "${b64('Segundo programa')}", "channel_id": "canal1.co",
         "start_timestamp": "1726311600", "stop_timestamp": "1726315200"},
        {"id": "1", "epg_id": "1", "title": "${b64('Ahora')}", "lang": "es",
         "start": "2026-09-14 10:00:00", "end": "2026-09-14 11:00:00",
         "description": "${b64('Primer programa')}", "channel_id": "canal1.co",
         "start_timestamp": 1726308000, "stop_timestamp": 1726311600}
      ]}''');
      final list = parseXtreamShortEpg(json);
      expect(list, hasLength(2));
      // Se ordena por hora de inicio.
      expect(list.first.title, 'Ahora');
      expect(list.first.description, 'Primer programa');
      expect(list.last.title, 'Después');

      final at = DateTime.fromMillisecondsSinceEpoch(1726309800 * 1000);
      final nn = NowNext.from(list, at);
      expect(nn.now?.title, 'Ahora');
      expect(nn.next?.title, 'Después');
      expect(nn.now!.progressAt(at), closeTo(0.5, 0.001));
    });

    test('usa start/end en texto si faltan timestamps', () {
      final list = parseXtreamShortEpg({
        'epg_listings': [
          {
            'title': b64('Programa'),
            'start': '2026-09-14 10:00:00',
            'end': '2026-09-14 11:30:00',
          }
        ]
      });
      expect(list.single.start, DateTime(2026, 9, 14, 10));
      expect(list.single.end, DateTime(2026, 9, 14, 11, 30));
    });

    test('canal sin EPG devuelve vacío y NowNext vacío', () {
      expect(parseXtreamShortEpg({'epg_listings': []}), isEmpty);
      expect(parseXtreamShortEpg([]), isEmpty);
      expect(NowNext.from(const [], DateTime.now()).isEmpty, isTrue);
    });

    test('todayPrograms filtra la guía completa al día de hoy', () {
      final now = DateTime(2026, 9, 14, 15);
      final all = [
        EpgEntry(title: 'Ayer', start: DateTime(2026, 9, 13, 20), end: DateTime(2026, 9, 13, 21)),
        EpgEntry(title: 'Madrugada', start: DateTime(2026, 9, 13, 23), end: DateTime(2026, 9, 14, 1)),
        EpgEntry(title: 'Tarde', start: DateTime(2026, 9, 14, 14), end: DateTime(2026, 9, 14, 16)),
        EpgEntry(title: 'Mañana', start: DateTime(2026, 9, 15, 8), end: DateTime(2026, 9, 15, 9)),
      ];
      expect(todayPrograms(all, now).map((e) => e.title), ['Madrugada', 'Tarde']);
    });
  });

  group('Avisos y mensajes del portal', () {
    test('sortNotices: crítico primero, luego sort_order, estable', () {
      final notices = [
        const PortalNotice(id: 1, level: NoticeLevel.info, sortOrder: 0),
        const PortalNotice(id: 2, level: NoticeLevel.critical, sortOrder: 5),
        const PortalNotice(id: 3, level: NoticeLevel.warning, sortOrder: 1),
        const PortalNotice(id: 4, level: NoticeLevel.critical, sortOrder: 1),
        const PortalNotice(id: 5, level: NoticeLevel.info, sortOrder: 0),
      ];
      expect(sortNotices(notices).map((n) => n.id), [4, 2, 3, 1, 5]);
    });

    test('info con notice_settings, duration_seconds, kind y display', () {
      final info = PortalInfo.fromJson({
        'portal': true,
        'user': {'status': 'active'},
        'notice_settings': {'carousel': true, 'interval_seconds': 12},
        'notices': [
          {'id': 1, 'title': 'A', 'level': 'info', 'display': 'banner', 'sort_order': 2, 'duration_seconds': null},
          {'id': 2, 'title': 'B', 'level': 'critical', 'display': 'banner', 'sort_order': 9, 'duration_seconds': 20},
          {'id': 3, 'title': 'C', 'level': 'warning', 'display': 'ticker'},
        ],
        'messages': [
          {'id': 7, 'title': 'Pago', 'body': 'Hola Juan', 'kind': 'payment', 'display': 'popup', 'read': false, 'created_at': 1726300000},
          {'id': 8, 'title': 'Otro', 'body': '', 'kind': 'desconocido', 'read': true},
        ],
      });
      expect(info.noticeSettings.carousel, isTrue);
      expect(info.noticeSettings.intervalSeconds, 12);
      expect(info.notices.map((n) => n.id), [2, 3, 1]);
      expect(info.notices.first.durationSeconds, 20);
      expect(info.notices.last.durationSeconds, isNull);
      expect(info.messages.first.kind, MessageKind.payment);
      expect(info.messages.first.display, MessageDisplay.popup);
      expect(info.messages.last.kind, MessageKind.general);
      expect(info.messages.last.display, MessageDisplay.inbox);
      expect(info.unreadMessages, 1);
    });

    test('notice_settings ausente usa valores por defecto', () {
      final info = PortalInfo.fromJson({'user': {}});
      expect(info.noticeSettings.carousel, isTrue);
      expect(info.noticeSettings.intervalSeconds, 8);
    });

    test('respuesta de /api/client/playing', () {
      final r = PlayingResponse.fromJson(
          {'ok': true, 'connection_id': '123', 'interval_seconds': 30});
      expect(r.connectionId, 123);
      expect(r.intervalSeconds, 30);
      final d = PlayingResponse.fromJson({'ok': true});
      expect(d.connectionId, isNull);
      expect(d.intervalSeconds, 30);
    });

    test('outage vencido no está activo', () {
      final o = PortalOutage(
        id: 1,
        blockPlayback: true,
        startsAt: DateTime(2026, 9, 14, 8),
        endsAt: DateTime(2026, 9, 14, 9),
      );
      expect(o.isActiveAt(DateTime(2026, 9, 14, 8, 30)), isTrue);
      expect(o.isActiveAt(DateTime(2026, 9, 14, 10)), isFalse);
    });
  });
}
