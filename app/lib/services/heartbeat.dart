import 'dart:async';

import 'api_exception.dart';
import 'portal_api.dart';

/// Latido de reproducción hacia el portal (`/api/client/playing` y `/stopped`).
class PlaybackHeartbeat {
  final PortalApi api;

  /// Se llama si el portal responde 429 (límite de conexiones).
  final void Function(ApiException error)? onLimitReached;

  PlaybackHeartbeat(this.api, {this.onLimitReached});

  int? _connectionId;
  String? _streamId;
  Timer? _timer;
  bool _active = false;
  int _generation = 0;

  bool get isActive => _active;
  int? get connectionId => _connectionId;

  /// Empieza (o cambia) el latido para el `stream_id` indicado.
  Future<void> start(String streamId) async {
    if (_active && _streamId == streamId) return;
    if (_active) await stop();
    _streamId = streamId;
    _active = true;
    final gen = ++_generation;
    await _beat(gen);
  }

  Future<void> _beat(int gen) async {
    final streamId = _streamId;
    if (!_active || streamId == null || gen != _generation) return;
    try {
      final res = await api.playing(streamId, connectionId: _connectionId);
      if (gen != _generation || !_active) {
        // Se detuvo mientras esperábamos: cerrar la conexión recién abierta.
        final id = res.connectionId;
        if (id != null && id != _connectionId) {
          unawaited(api.stopped(connectionId: id).catchError((Object _) {}));
        }
        return;
      }
      _connectionId = res.connectionId ?? _connectionId;
      _schedule(gen, res.intervalSeconds);
    } on ApiException catch (e) {
      if (gen != _generation) return;
      if (e.statusCode == 429) {
        _active = false;
        _timer?.cancel();
        onLimitReached?.call(e);
      } else {
        _schedule(gen, 30);
      }
    } catch (_) {
      if (gen == _generation) _schedule(gen, 30);
    }
  }

  void _schedule(int gen, int seconds) {
    _timer?.cancel();
    _timer = Timer(Duration(seconds: seconds), () => _beat(gen));
  }

  /// Informa al portal que se detuvo la reproducción.
  Future<void> stop() async {
    _generation++;
    _timer?.cancel();
    _timer = null;
    final wasActive = _active;
    final id = _connectionId;
    _active = false;
    _connectionId = null;
    if (!wasActive && id == null) return;
    try {
      await api.stopped(connectionId: id);
    } catch (_) {}
  }

  Future<void> dispose() async {
    await stop();
    api.close();
  }
}
