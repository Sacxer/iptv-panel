import 'package:flutter/foundation.dart';

import '../constants.dart';
import '../models/media_item.dart';
import '../services/storage.dart';

/// Favoritos, recientes y posiciones de reanudación por perfil.
class LibraryProvider extends ChangeNotifier {
  final Storage storage;

  LibraryProvider(this.storage);

  String? _profileId;
  List<MediaItem> _favorites = [];
  List<MediaItem> _recents = [];
  Set<String> _favKeys = {};

  List<MediaItem> get favorites => List.unmodifiable(_favorites);
  List<MediaItem> get recents => List.unmodifiable(_recents);

  void load(String profileId) {
    _profileId = profileId;
    _favorites = storage.loadFavorites(profileId);
    _recents = storage.loadRecents(profileId);
    _favKeys = _favorites.map((e) => e.key).toSet();
    notifyListeners();
  }

  void clear() {
    _profileId = null;
    _favorites = [];
    _recents = [];
    _favKeys = {};
    notifyListeners();
  }

  bool isFavorite(MediaItem item) => _favKeys.contains(item.key);

  Future<bool> toggleFavorite(MediaItem item) async {
    final pid = _profileId;
    if (pid == null) return false;
    final added = !isFavorite(item);
    if (added) {
      _favorites.insert(0, item);
      _favKeys.add(item.key);
    } else {
      _favorites.removeWhere((e) => e.key == item.key);
      _favKeys.remove(item.key);
    }
    notifyListeners();
    await storage.saveFavorites(pid, _favorites);
    return added;
  }

  Future<void> addRecent(MediaItem item) async {
    final pid = _profileId;
    if (pid == null) return;
    _recents.removeWhere((e) => e.key == item.key);
    _recents.insert(0, item);
    if (_recents.length > AppConfig.maxRecents) {
      _recents = _recents.sublist(0, AppConfig.maxRecents);
    }
    notifyListeners();
    await storage.saveRecents(pid, _recents);
  }

  Future<void> removeRecent(MediaItem item) async {
    final pid = _profileId;
    if (pid == null) return;
    _recents.removeWhere((e) => e.key == item.key);
    notifyListeners();
    await storage.saveRecents(pid, _recents);
  }

  Future<void> clearRecents() async {
    final pid = _profileId;
    if (pid == null) return;
    _recents = [];
    notifyListeners();
    await storage.saveRecents(pid, _recents);
  }

  Duration resumePosition(MediaItem item) {
    final pid = _profileId;
    if (pid == null) return Duration.zero;
    return Duration(seconds: storage.getResumePosition(pid, item.key));
  }

  Future<void> saveResumePosition(
      MediaItem item, Duration position, Duration duration) async {
    final pid = _profileId;
    if (pid == null || !item.isVod) return;
    var secs = position.inSeconds;
    // No guardar si apenas empezó o si ya casi termina.
    if (secs < 30 ||
        (duration.inSeconds > 0 && secs > duration.inSeconds - 60)) {
      secs = 0;
    }
    await storage.setResumePosition(pid, item.key, secs);
  }
}
