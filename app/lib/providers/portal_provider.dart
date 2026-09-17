import 'dart:async';

import 'package:flutter/foundation.dart';

import '../constants.dart';
import '../models/portal_models.dart';
import '../models/profile.dart';
import '../services/api_exception.dart';
import '../services/heartbeat.dart';
import '../services/portal_api.dart';
import '../services/portal_relocator.dart';
import '../services/server_endpoint.dart';
import '../services/storage.dart';
import 'session_provider.dart';

/// Integración con el portal propio: avisos, mensajes, cortes, estado y latido.
///
/// Solo se activa si `GET /api/client/ping` responde `portal: true`.
class PortalProvider extends ChangeNotifier {
  final Storage storage;

  /// Sesión activa: comparte la dirección del servidor, reencuentra el portal si cambia y
  /// guarda su identidad en el perfil.
  final SessionProvider? session;

  PortalProvider(this.storage, {this.session});

  PortalApi? _api;
  Timer? _timer;
  Profile? _profile;
  List<int>? _clientPorts;
  bool enabled = false;
  PortalInfo? info;
  DateTime? lastUpdate;
  final Set<int> _dismissedBanners = {};
  final Set<int> _shownThisSession = {};

  bool get userBlocked => enabled && (info?.user.isBlocked ?? false);

  int get unreadCount => enabled ? (info?.unreadMessages ?? 0) : 0;

  List<PortalMessage> get messages => enabled ? (info?.messages ?? const []) : const [];

  /// Secciones que el portal deja ver a este cliente (`null`: el portal no lo dice y la app
  /// lo deduce, ver [SessionProvider.sectionsWith]).
  PortalContent? get content => enabled ? info?.content : null;

  NoticeSettings get noticeSettings => info?.noticeSettings ?? const NoticeSettings();

  PortalOutage? get activeOutage {
    if (!enabled) return null;
    final o = info?.outage;
    if (o == null || !o.isActiveAt(DateTime.now())) return null;
    return o;
  }

  /// Corte activo que bloquea la reproducción (o `null`).
  PortalOutage? get blockingOutage {
    final o = activeOutage;
    return (o != null && o.blockPlayback) ? o : null;
  }

  List<PortalNotice> notices(NoticeDisplay display) {
    if (!enabled || info == null) return const [];
    final now = DateTime.now();
    return info!.notices
        .where((n) => n.display == display && n.isActiveAt(now))
        .where((n) =>
            display != NoticeDisplay.banner || !_dismissedBanners.contains(n.id))
        .toList();
  }

  void dismissBanner(PortalNotice n) {
    _dismissedBanners.add(n.id);
    notifyListeners();
  }

  /// Avisos popup aún no mostrados en este perfil.
  List<PortalNotice> pendingPopupNotices() {
    final pid = _profile?.id;
    if (pid == null) return const [];
    final seen = storage.seenPopupIds(pid);
    return notices(NoticeDisplay.popup)
        .where((n) => !seen.contains('notice:${n.id}'))
        .toList();
  }

  /// Mensajes no leídos con `display: popup` aún no mostrados.
  List<PortalMessage> pendingPopupMessages() {
    final pid = _profile?.id;
    if (pid == null || !enabled) return const [];
    final seen = storage.seenPopupIds(pid);
    return messages
        .where((m) =>
            !m.read &&
            m.display == MessageDisplay.popup &&
            !seen.contains('message:${m.id}') &&
            !_shownThisSession.contains(m.id))
        .toList();
  }

  bool get hasPendingPopups =>
      pendingPopupNotices().isNotEmpty || pendingPopupMessages().isNotEmpty;

  Future<void> markNoticeSeen(PortalNotice n) async {
    final pid = _profile?.id;
    if (pid == null) return;
    await storage.markPopupSeen(pid, 'notice:${n.id}');
  }

  Future<void> markPopupMessageShown(PortalMessage m) async {
    final pid = _profile?.id;
    if (pid == null) return;
    _shownThisSession.add(m.id);
    await storage.markPopupSeen(pid, 'message:${m.id}');
    await markRead(m);
  }

  /// Detecta el portal y carga la información inicial. Nunca lanza.
  Future<void> start(Profile profile) async {
    stop(notify: false);
    if (profile.type != ProfileType.xtream) {
      notifyListeners();
      return;
    }
    _profile = profile;
    final api = PortalApi(
      serverUrl: profile.serverUrl,
      username: profile.username,
      password: profile.password,
      endpoint: _sessionEndpoint(profile),
      onConnectionLost: session?.handleConnectionLost,
    );
    _api = api;
    final ping = await api.pingDetails();
    if (!identical(_api, api)) return; // se detuvo mientras tanto
    if (ping.status != PingStatus.portal) {
      api.close();
      _api = null;
      notifyListeners();
      return;
    }
    _clientPorts = ping.clientPorts;
    enabled = true;
    await refresh();
    _timer = Timer.periodic(AppConfig.portalPollInterval, (_) => refresh());
  }

  /// La dirección compartida de la sesión, si es la de este perfil.
  ServerEndpoint? _sessionEndpoint(Profile profile) {
    final s = session;
    if (s == null || s.profile?.id != profile.id) return null;
    return s.endpoint;
  }

  /// Consulta el portal. Si el servidor no responde, la sesión lo busca en otras direcciones
  /// (el sondeo cada 5 minutos también detecta un cambio de IP mientras la app está abierta).
  Future<void> refresh() async {
    final api = _api;
    if (api == null) return;
    try {
      final result = await api.info();
      if (!identical(_api, api)) return;
      info = result;
      lastUpdate = DateTime.now();
      notifyListeners();
      final server = result.server;
      final s = session;
      if (server != null && s != null && s.profile?.id == _profile?.id) {
        await s.rememberPortal(server, clientPorts: _clientPorts);
      }
    } catch (_) {
      // Silencioso: se reintenta en el siguiente ciclo.
    }
  }

  Future<void> markRead(PortalMessage message) async {
    final api = _api;
    final current = info;
    if (api == null || current == null || message.read) return;
    final updated = current.messages
        .map((m) => m.id == message.id ? m.markRead() : m)
        .toList();
    info = current.copyWith(
      messages: updated,
      unreadMessages: updated.where((m) => !m.read).length,
    );
    notifyListeners();
    try {
      await api.markMessageRead(message.id);
    } catch (_) {}
  }

  /// Crea un latido de reproducción si el portal está activo.
  PlaybackHeartbeat? createHeartbeat({void Function(ApiException)? onLimit}) {
    final p = _profile;
    if (!enabled || p == null) return null;
    return PlaybackHeartbeat(
      PortalApi(
        serverUrl: p.serverUrl,
        username: p.username,
        password: p.password,
        // Misma dirección que la sesión: tras reencontrar el portal, el latido sigue solo.
        endpoint: _sessionEndpoint(p),
      ),
      onLimitReached: onLimit,
    );
  }

  void stop({bool notify = true}) {
    _timer?.cancel();
    _timer = null;
    _api?.close();
    _api = null;
    _profile = null;
    _clientPorts = null;
    enabled = false;
    info = null;
    lastUpdate = null;
    _dismissedBanners.clear();
    _shownThisSession.clear();
    if (notify) notifyListeners();
  }

  @override
  void dispose() {
    stop(notify: false);
    super.dispose();
  }
}
