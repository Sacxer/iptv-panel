import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/portal_models.dart';
import '../models/profile.dart';
import '../models/xtream_models.dart';
import '../services/api_exception.dart';
import '../services/content_sections.dart';
import '../services/content_source.dart';
import '../services/device.dart';
import '../services/epg_service.dart';
import '../services/portal_relocator.dart';
import '../services/server_endpoint.dart';
import '../services/storage.dart';
import '../services/xtream_api.dart';
import 'profiles_provider.dart';

/// Motivo de bloqueo de la cuenta (pantalla completa).
class BlockInfo {
  final String title;
  final String message;
  const BlockInfo(this.title, this.message);
}

enum SessionStatus { idle, loading, ready, error, blocked }

/// Sesión activa: perfil elegido y su fuente de contenido.
///
/// Si el perfil es del portal propio y el servidor deja de responder (cambio de IP, puerto del
/// panel…), busca el portal en sus otras direcciones y en la red local, actualiza el perfil y
/// repite la petición (ver [PortalRelocator]).
class SessionProvider extends ChangeNotifier {
  static const String relocatedMessage = 'Servidor encontrado en la nueva dirección';

  final Storage storage;
  final ProfilesProvider? profiles;
  final PortalRelocator relocator;

  /// Aviso breve para el usuario (lo muestra la app como SnackBar).
  void Function(String message)? onNotice;

  SessionProvider(
    this.storage, {
    this.profiles,
    PortalRelocator? relocator,
    this.onNotice,
  }) : relocator = relocator ?? PortalRelocator(headers: Device.headers);

  SessionStatus status = SessionStatus.idle;
  Profile? profile;
  ContentSource? source;
  EpgService? epg;
  XtreamAuthResponse? auth;
  String? error;

  /// El último error fue de conexión (se puede ofrecer "Buscar servidor").
  bool errorCanRelocate = false;
  BlockInfo? block;
  String progress = '';

  /// Dirección del servidor de la sesión (Xtream): la comparten la API, el portal y el reproductor.
  ServerEndpoint? endpoint;

  /// Buscando el portal en otra dirección.
  bool relocating = false;

  /// Secciones deducidas del contenido, para cuando el portal no dice cuáles ve el cliente
  /// (XtreamUI, portal anterior o M3U). Ver [detectSections] y [sectionsWith].
  ContentSections detectedSections = ContentSections.all;
  bool _sectionsDetected = false;

  /// Secciones que ve el cliente: las del portal si las manda ([PortalProvider.content]);
  /// si no, las deducidas.
  ContentSections sectionsWith(PortalContent? portalContent) =>
      ContentSections.effective(portalContent, detectedSections);

  /// Deduce qué secciones tienen contenido (ver [ContentSections.detect]). Nunca lanza.
  Future<void> detectSections() async {
    final s = source;
    if (s == null) return;
    _sectionsDetected = true;
    final result = await ContentSections.detect(s);
    if (!identical(source, s)) return; // se cerró o cambió la sesión
    if (result != detectedSections) {
      detectedSections = result;
      notifyListeners();
    }
  }

  String get liveFormat => storage.liveFormat;

  Future<void> setLiveFormat(String format) async {
    await storage.setLiveFormat(format);
    final s = source;
    if (s is XtreamSource) s.liveFormat = _effectiveFormat(format);
    notifyListeners();
  }

  String _effectiveFormat(String preferred) {
    final allowed = auth?.userInfo.allowedOutputFormats ?? const [];
    if (allowed.isEmpty || allowed.contains(preferred)) return preferred;
    if (allowed.contains('ts')) return 'ts';
    if (allowed.contains('m3u8')) return 'm3u8';
    return preferred;
  }

  void _setProgress(String p) {
    progress = p;
    notifyListeners();
  }

  /// Inicia sesión con el perfil. Devuelve `true` si quedó listo.
  Future<bool> login(Profile p) async {
    logout(notify: false);
    profile = p;
    status = SessionStatus.loading;
    error = null;
    errorCanRelocate = false;
    block = null;
    notifyListeners();
    try {
      if (p.type == ProfileType.xtream) {
        _setProgress('Conectando con el servidor…');
        final ep = ServerEndpoint(p.serverUrl);
        endpoint = ep;
        final api = XtreamApi(
          serverUrl: p.serverUrl,
          username: p.username,
          password: p.password,
          endpoint: ep,
          onConnectionLost: handleConnectionLost,
        );
        // Si el servidor guardado no responde, se busca antes de mostrar el error.
        final res = await api.authenticate();
        if (!identical(endpoint, ep)) {
          api.close();
          return false; // se cerró la sesión mientras tanto
        }
        if (!res.userInfo.auth) {
          api.close();
          throw const ApiException(
              'Usuario o contraseña incorrectos. Verifique sus datos de acceso.');
        }
        auth = res;
        if (!res.userInfo.isActive) {
          api.close();
          final reason = res.userInfo.message.trim();
          block = BlockInfo(
            _blockTitle(res.userInfo.status),
            [
              res.userInfo.statusMessage,
              if (reason.isNotEmpty) 'Motivo: $reason',
            ].join('\n'),
          );
          status = SessionStatus.blocked;
          notifyListeners();
          return false;
        }
        source = XtreamSource(api, liveFormat: _effectiveFormat(liveFormat));
      } else {
        _setProgress(p.type == ProfileType.m3uUrl
            ? 'Descargando la lista de canales…'
            : 'Leyendo la lista de canales…');
        final data = await M3uSource.loadPlaylist(p);
        if (data.totalEntries == 0) {
          throw const ApiException(
              'La lista está vacía o no tiene un formato M3U válido.');
        }
        source = M3uSource(p, data);
      }
      epg = EpgService(source!);
      detectedSections = ContentSections.supportedBy(source!);
      status = SessionStatus.ready;
      progress = '';
      notifyListeners();
      return true;
    } catch (e) {
      final ex = ApiException.from(e);
      error = ex.message;
      errorCanRelocate = p.isXtream && ex.canRelocate;
      status = SessionStatus.error;
      progress = '';
      notifyListeners();
      return false;
    }
  }

  static String _blockTitle(String status) {
    switch (status.toLowerCase()) {
      case 'expired':
        return 'Suscripción vencida';
      case 'banned':
        return 'Cuenta suspendida';
      case 'disabled':
        return 'Cuenta deshabilitada';
      default:
        return 'Cuenta no disponible';
    }
  }

  void logout({bool notify = true}) {
    source?.dispose();
    source = null;
    epg = null;
    auth = null;
    profile = null;
    endpoint = null;
    error = null;
    errorCanRelocate = false;
    block = null;
    detectedSections = ContentSections.all;
    _sectionsDetected = false;
    status = SessionStatus.idle;
    if (notify) notifyListeners();
  }

  /// Vuelve a descargar el catálogo (deslizar para actualizar).
  Future<void> refreshCatalog() async {
    final s = source;
    if (s == null) return;
    epg?.clear();
    if (s is XtreamSource) {
      s.clearCache();
    } else if (s is M3uSource) {
      s.data = await M3uSource.loadPlaylist(s.profile);
    }
    notifyListeners();
    // Si las secciones se dedujeron, se vuelven a revisar con el contenido nuevo.
    if (_sectionsDetected) unawaited(detectSections());
  }

  // ---------------------------------------------------------------------------
  // Portal: identidad y reconexión
  // ---------------------------------------------------------------------------

  /// El perfil activo es del portal propio y hay con qué reconocerlo.
  bool get canRelocateAutomatically =>
      profile?.portalIdentity.isKnown ?? false;

  /// Para [XtreamApi.onConnectionLost] / [PortalApi.onConnectionLost]: busca el portal y devuelve
  /// `true` si ya está en otra dirección (la petición se repite una vez).
  Future<bool> handleConnectionLost(ApiException error) async {
    if (!canRelocateAutomatically) return false; // servidor Xtream ajeno: como siempre
    final result = await relocateServer(reason: error);
    return result.found;
  }

  /// El reproductor no logra reproducir: si el servidor no responde, buscarlo.
  /// Devuelve `true` si ahora está en otra dirección.
  Future<bool> checkServer() async {
    if (!canRelocateAutomatically) return false;
    return (await relocateServer()).found;
  }

  /// Busca el portal del perfil activo en sus otras direcciones y en la red local.
  /// Con [manual] (botón "Buscar servidor") no espera los 20 s entre búsquedas.
  Future<RelocationResult> relocateServer(
      {ApiException? reason, bool manual = false}) async {
    final p = profile;
    final ep = endpoint;
    if (p == null || ep == null || !p.isXtream) {
      return const RelocationResult(RelocationOutcome.skipped);
    }
    final wasLoading = status == SessionStatus.loading;
    final previousProgress = progress;
    relocating = true;
    if (wasLoading) progress = 'Buscando el servidor en otras direcciones…';
    notifyListeners();
    try {
      final result = await relocator.relocate(
        currentUrl: ep.url,
        identity: p.portalIdentity,
        suggestedPort: reason?.clientPort,
        force: manual,
        onProgress: (lan) {
          if (status != SessionStatus.loading || !identical(endpoint, ep)) return;
          _setProgress('Buscando el servidor en la red local…\n${lan.label}');
        },
      );
      if (!identical(endpoint, ep)) {
        return const RelocationResult(RelocationOutcome.skipped);
      }
      if (result.found) {
        // Quizá otra petición ya aplicó el mismo cambio.
        if (ServerEndpoint.normalize(result.url!) != ep.url) {
          await _applyServer(result.url!, clientPorts: result.clientPorts);
          onNotice?.call(relocatedMessage);
        }
      } else if (result.outcome == RelocationOutcome.currentWorks &&
          result.clientPorts.isNotEmpty) {
        await _updateProfile((q) => q.copyWith(clientPorts: result.clientPorts));
      }
      return result;
    } finally {
      relocating = false;
      if (wasLoading && status == SessionStatus.loading) {
        progress = previousProgress;
      }
      notifyListeners();
    }
  }

  /// Usa [url] como servidor del perfil activo (elegido por el usuario o encontrado).
  Future<void> useServer(String url) => _applyServer(url);

  Future<void> _applyServer(String url, {List<int>? clientPorts}) async {
    final ep = endpoint;
    final clean = ServerEndpoint.normalize(url);
    if (ep != null) ep.url = clean;
    await _updateProfile((q) => q.copyWith(
          serverUrl: clean,
          clientPorts:
              (clientPorts != null && clientPorts.isNotEmpty) ? clientPorts : null,
        ));
  }

  /// Guarda la identidad y las direcciones del portal que devolvió `/api/client/info`.
  Future<void> rememberPortal(PortalServer server, {List<int>? clientPorts}) async {
    final p = profile;
    if (p == null || !p.isXtream) return;
    final urls = <String>[];
    for (final u in server.urls) {
      final clean = ServerEndpoint.normalize(u);
      if (clean.isNotEmpty && !urls.contains(clean)) urls.add(clean);
      if (urls.length >= 24) break;
    }
    final id = server.id.isNotEmpty ? server.id : p.portalId;
    final ports = clientPorts ?? p.clientPorts;
    if (id == p.portalId &&
        listEquals(urls, p.portalUrls) &&
        listEquals(ports, p.clientPorts)) {
      return;
    }
    await _updateProfile((q) =>
        q.copyWith(portalId: id, portalUrls: urls, clientPorts: ports));
  }

  Future<void> _updateProfile(Profile Function(Profile) change) async {
    final p = profile;
    if (p == null) return;
    final updated = change(p);
    profile = updated;
    final registry = profiles;
    if (registry != null) {
      await registry.save(updated);
    } else {
      final list = storage.loadProfiles();
      final i = list.indexWhere((x) => x.id == updated.id);
      if (i >= 0) {
        list[i] = updated;
        await storage.saveProfiles(list);
      }
    }
    notifyListeners();
  }
}
