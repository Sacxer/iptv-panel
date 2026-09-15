import 'package:flutter/foundation.dart';

import '../models/profile.dart';
import '../models/xtream_models.dart';
import '../services/api_exception.dart';
import '../services/content_source.dart';
import '../services/epg_service.dart';
import '../services/storage.dart';
import '../services/xtream_api.dart';

/// Motivo de bloqueo de la cuenta (pantalla completa).
class BlockInfo {
  final String title;
  final String message;
  const BlockInfo(this.title, this.message);
}

enum SessionStatus { idle, loading, ready, error, blocked }

/// Sesión activa: perfil elegido y su fuente de contenido.
class SessionProvider extends ChangeNotifier {
  final Storage storage;

  SessionProvider(this.storage);

  SessionStatus status = SessionStatus.idle;
  Profile? profile;
  ContentSource? source;
  EpgService? epg;
  XtreamAuthResponse? auth;
  String? error;
  BlockInfo? block;
  String progress = '';

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
    block = null;
    notifyListeners();
    try {
      if (p.type == ProfileType.xtream) {
        _setProgress('Conectando con el servidor…');
        final api = XtreamApi(
          serverUrl: p.serverUrl,
          username: p.username,
          password: p.password,
        );
        final res = await api.authenticate();
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
      status = SessionStatus.ready;
      progress = '';
      notifyListeners();
      return true;
    } catch (e) {
      error = ApiException.from(e).message;
      status = SessionStatus.error;
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
    error = null;
    block = null;
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
  }
}
