import 'json_utils.dart';

enum NoticeLevel { info, warning, critical }

enum NoticeDisplay { banner, popup, ticker }

/// Tipo de mensaje del portal.
enum MessageKind { payment, expiration, maintenance, promotion, support, general }

/// Cómo se muestra un mensaje: bandeja o ventana al abrir la app.
enum MessageDisplay { inbox, popup }

extension MessageKindLabel on MessageKind {
  String get label {
    switch (this) {
      case MessageKind.payment:
        return 'Pago';
      case MessageKind.expiration:
        return 'Vencimiento';
      case MessageKind.maintenance:
        return 'Mantenimiento';
      case MessageKind.promotion:
        return 'Promoción';
      case MessageKind.support:
        return 'Soporte';
      case MessageKind.general:
        return 'General';
    }
  }
}

class PortalUser {
  final String username;
  final DateTime? expDate;
  final int maxConnections;
  final bool isTrial;

  /// `active` | `expired` | `suspended` | `disabled`.
  final String status;
  final String? suspensionReason;

  const PortalUser({
    this.username = '',
    this.expDate,
    this.maxConnections = 0,
    this.isTrial = false,
    this.status = 'active',
    this.suspensionReason,
  });

  bool get isBlocked {
    final s = status.toLowerCase();
    return s == 'expired' || s == 'suspended' || s == 'disabled';
  }

  String get statusLabel {
    switch (status.toLowerCase()) {
      case 'active':
        return 'Activa';
      case 'expired':
        return 'Vencida';
      case 'suspended':
        return 'Suspendida';
      case 'disabled':
        return 'Deshabilitada';
      default:
        return status;
    }
  }

  String get blockTitle {
    switch (status.toLowerCase()) {
      case 'expired':
        return 'Suscripción vencida';
      case 'suspended':
        return 'Servicio suspendido';
      case 'disabled':
        return 'Cuenta deshabilitada';
      default:
        return 'Cuenta no disponible';
    }
  }

  factory PortalUser.fromJson(Map<String, dynamic> j) => PortalUser(
        username: str(j['username']),
        expDate: asUnixDate(j['exp_date']),
        maxConnections: asInt(j['max_connections']) ?? 0,
        isTrial: asBool(j['is_trial']),
        status: nonEmpty(j['status']) ?? 'active',
        suspensionReason: nonEmpty(j['suspension_reason']),
      );
}

class PortalOutage {
  final int id;
  final String title;
  final String reason;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final bool blockPlayback;

  const PortalOutage({
    required this.id,
    this.title = '',
    this.reason = '',
    this.startsAt,
    this.endsAt,
    this.blockPlayback = false,
  });

  bool isActiveAt(DateTime now) {
    if (startsAt != null && now.isBefore(startsAt!)) return false;
    if (endsAt != null && now.isAfter(endsAt!)) return false;
    return true;
  }

  factory PortalOutage.fromJson(Map<String, dynamic> j) => PortalOutage(
        id: asInt(j['id']) ?? 0,
        title: nonEmpty(j['title']) ?? 'Servicio en mantenimiento',
        reason: str(j['reason']),
        startsAt: asUnixDate(j['starts_at']),
        endsAt: asUnixDate(j['ends_at']),
        blockPlayback: asBool(j['block_playback']),
      );
}

class PortalNotice {
  final int id;
  final String title;
  final String body;
  final NoticeLevel level;
  final NoticeDisplay display;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final int sortOrder;

  /// Segundos en pantalla dentro del carrusel (`null` = intervalo general).
  final int? durationSeconds;

  const PortalNotice({
    required this.id,
    this.title = '',
    this.body = '',
    this.level = NoticeLevel.info,
    this.display = NoticeDisplay.banner,
    this.startsAt,
    this.endsAt,
    this.sortOrder = 0,
    this.durationSeconds,
  });

  bool isActiveAt(DateTime now) {
    if (startsAt != null && now.isBefore(startsAt!)) return false;
    if (endsAt != null && now.isAfter(endsAt!)) return false;
    return true;
  }

  factory PortalNotice.fromJson(Map<String, dynamic> j) {
    final level = str(j['level']).toLowerCase();
    final display = str(j['display']).toLowerCase();
    final duration = asInt(j['duration_seconds']);
    return PortalNotice(
      id: asInt(j['id']) ?? 0,
      title: str(j['title']),
      body: str(j['body']),
      level: NoticeLevel.values.firstWhere((l) => l.name == level,
          orElse: () => NoticeLevel.info),
      display: NoticeDisplay.values.firstWhere((d) => d.name == display,
          orElse: () => NoticeDisplay.banner),
      startsAt: asUnixDate(j['starts_at']),
      endsAt: asUnixDate(j['ends_at']),
      sortOrder: asInt(j['sort_order']) ?? 0,
      durationSeconds: (duration != null && duration > 0) ? duration : null,
    );
  }
}

/// Ordena los avisos: nivel (crítico primero) y luego `sort_order`.
/// El orden es estable: a igualdad se conserva el orden del servidor.
List<PortalNotice> sortNotices(List<PortalNotice> notices) {
  final indexed = notices.asMap().entries.toList();
  indexed.sort((a, b) {
    final byLevel = b.value.level.index.compareTo(a.value.level.index);
    if (byLevel != 0) return byLevel;
    final bySort = a.value.sortOrder.compareTo(b.value.sortOrder);
    if (bySort != 0) return bySort;
    return a.key.compareTo(b.key);
  });
  return indexed.map((e) => e.value).toList();
}

class NoticeSettings {
  final bool carousel;
  final int intervalSeconds;

  const NoticeSettings({this.carousel = true, this.intervalSeconds = 8});

  factory NoticeSettings.fromJson(dynamic json) {
    final j = asMap(json);
    final interval = asInt(j['interval_seconds']) ?? 8;
    return NoticeSettings(
      carousel: asBool(j['carousel'], fallback: true),
      intervalSeconds: interval <= 0 ? 8 : interval,
    );
  }
}

class PortalMessage {
  final int id;
  final String title;
  final String body;
  final DateTime? createdAt;
  final bool read;
  final MessageKind kind;
  final MessageDisplay display;

  const PortalMessage({
    required this.id,
    this.title = '',
    this.body = '',
    this.createdAt,
    this.read = false,
    this.kind = MessageKind.general,
    this.display = MessageDisplay.inbox,
  });

  PortalMessage markRead() => PortalMessage(
        id: id,
        title: title,
        body: body,
        createdAt: createdAt,
        read: true,
        kind: kind,
        display: display,
      );

  factory PortalMessage.fromJson(Map<String, dynamic> j) {
    final kind = str(j['kind']).toLowerCase();
    final display = str(j['display']).toLowerCase();
    return PortalMessage(
      id: asInt(j['id']) ?? 0,
      title: str(j['title']),
      body: str(j['body']),
      createdAt: asUnixDate(j['created_at']),
      read: asBool(j['read']),
      kind: MessageKind.values.firstWhere((k) => k.name == kind,
          orElse: () => MessageKind.general),
      display: MessageDisplay.values.firstWhere((d) => d.name == display,
          orElse: () => MessageDisplay.inbox),
    );
  }
}

/// Respuesta de `GET /api/client/info`.
class PortalInfo {
  final String serverName;
  final PortalUser user;
  final PortalOutage? outage;
  final List<PortalNotice> notices;
  final NoticeSettings noticeSettings;
  final List<PortalMessage> messages;
  final int unreadMessages;

  const PortalInfo({
    this.serverName = '',
    this.user = const PortalUser(),
    this.outage,
    this.notices = const [],
    this.noticeSettings = const NoticeSettings(),
    this.messages = const [],
    this.unreadMessages = 0,
  });

  PortalInfo copyWith({List<PortalMessage>? messages, int? unreadMessages}) =>
      PortalInfo(
        serverName: serverName,
        user: user,
        outage: outage,
        notices: notices,
        noticeSettings: noticeSettings,
        messages: messages ?? this.messages,
        unreadMessages: unreadMessages ?? this.unreadMessages,
      );

  factory PortalInfo.fromJson(dynamic json) {
    final j = asMap(json);
    final outageRaw = j['outage'];
    final messages = asList(j['messages'])
        .map((m) => PortalMessage.fromJson(asMap(m)))
        .toList();
    return PortalInfo(
      serverName: str(j['server_name']),
      user: PortalUser.fromJson(asMap(j['user'])),
      outage: outageRaw is Map ? PortalOutage.fromJson(asMap(outageRaw)) : null,
      notices: sortNotices(asList(j['notices'])
          .map((n) => PortalNotice.fromJson(asMap(n)))
          .toList()),
      noticeSettings: NoticeSettings.fromJson(j['notice_settings']),
      messages: messages,
      unreadMessages: asInt(j['unread_messages']) ??
          messages.where((m) => !m.read).length,
    );
  }
}
