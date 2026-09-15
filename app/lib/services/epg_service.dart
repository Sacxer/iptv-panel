import 'dart:async';
import 'dart:collection';

import '../constants.dart';
import '../models/media_item.dart';
import 'content_source.dart';

class _CacheEntry {
  final List<EpgEntry> entries;
  final DateTime fetchedAt;
  _CacheEntry(this.entries, this.fetchedAt);
}

/// Carga perezosa y caché (5 min) de la EPG corta, con concurrencia limitada.
class EpgService {
  final ContentSource source;
  final int maxConcurrent;

  EpgService(this.source, {this.maxConcurrent = 4});

  final Map<String, _CacheEntry> _cache = {};
  final Map<String, Future<List<EpgEntry>>> _inFlight = {};
  final Queue<(MediaItem, Completer<List<EpgEntry>>)> _queue = Queue();
  int _running = 0;

  bool get enabled => source.supportsEpg;

  /// Ahora/después si ya está en caché (no hace peticiones).
  NowNext? peek(MediaItem item, [DateTime? at]) {
    final c = _cache[item.id];
    if (c == null) return null;
    if (DateTime.now().difference(c.fetchedAt) > AppConfig.epgCacheTtl) {
      return null;
    }
    return NowNext.from(c.entries, at ?? DateTime.now());
  }

  /// Obtiene la EPG corta (desde caché si está fresca).
  Future<List<EpgEntry>> shortEpg(MediaItem item) {
    if (!enabled || item.type != ContentType.live) {
      return Future.value(const []);
    }
    final c = _cache[item.id];
    if (c != null &&
        DateTime.now().difference(c.fetchedAt) <= AppConfig.epgCacheTtl) {
      return Future.value(c.entries);
    }
    final existing = _inFlight[item.id];
    if (existing != null) return existing;
    final completer = Completer<List<EpgEntry>>();
    // LIFO: lo último que se ve en pantalla se carga primero.
    _queue.addFirst((item, completer));
    while (_queue.length > 40) {
      final dropped = _queue.removeLast();
      _inFlight.remove(dropped.$1.id);
      dropped.$2.complete(const []);
    }
    _inFlight[item.id] = completer.future;
    _pump();
    return completer.future;
  }

  void _pump() {
    while (_running < maxConcurrent && _queue.isNotEmpty) {
      final (item, completer) = _queue.removeFirst();
      _running++;
      source.shortEpg(item).then((entries) {
        _cache[item.id] = _CacheEntry(entries, DateTime.now());
        if (!completer.isCompleted) completer.complete(entries);
      }).catchError((Object _) {
        // Canal sin EPG o error: se guarda vacío para no insistir.
        _cache[item.id] = _CacheEntry(const [], DateTime.now());
        if (!completer.isCompleted) completer.complete(const []);
      }).whenComplete(() {
        _running--;
        _inFlight.remove(item.id);
        _pump();
      });
    }
  }

  /// Guía completa del día (sin caché compartida).
  Future<List<EpgEntry>> fullEpg(MediaItem item) async {
    if (!enabled || item.type != ContentType.live) return const [];
    return source.fullEpg(item);
  }

  void clear() {
    _cache.clear();
  }
}
