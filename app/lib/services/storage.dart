import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/media_item.dart';
import '../models/profile.dart';

/// Persistencia local (perfiles, favoritos, recientes, ajustes).
class Storage {
  final SharedPreferences _prefs;

  Storage._(this._prefs);

  static Future<Storage> init() async {
    final prefs = await SharedPreferences.getInstance();
    return Storage._(prefs);
  }

  static const _kProfiles = 'profiles';
  static const _kLastProfile = 'last_profile_id';
  static const _kLiveFormat = 'settings_live_format';
  static const _kAutoLogin = 'settings_auto_login';

  // ---------- Perfiles ----------

  List<Profile> loadProfiles() {
    final raw = _prefs.getString(_kProfiles);
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = jsonDecode(raw) as List;
      return list
          .whereType<Map>()
          .map((m) => Profile.fromJson(Map<String, dynamic>.from(m)))
          .where((p) => p.id.isNotEmpty)
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveProfiles(List<Profile> profiles) => _prefs.setString(
      _kProfiles, jsonEncode(profiles.map((p) => p.toJson()).toList()));

  String? get lastProfileId => _prefs.getString(_kLastProfile);

  Future<void> setLastProfileId(String? id) async {
    if (id == null) {
      await _prefs.remove(_kLastProfile);
    } else {
      await _prefs.setString(_kLastProfile, id);
    }
  }

  // ---------- Ajustes ----------

  /// Formato de canales en vivo para Xtream: `ts` o `m3u8`.
  String get liveFormat => _prefs.getString(_kLiveFormat) ?? 'ts';
  Future<void> setLiveFormat(String v) => _prefs.setString(_kLiveFormat, v);

  bool get autoLogin => _prefs.getBool(_kAutoLogin) ?? false;
  Future<void> setAutoLogin(bool v) => _prefs.setBool(_kAutoLogin, v);

  // ---------- Actualizaciones ("Más tarde") ----------

  int? updateSnoozedUntil(String key) => _prefs.getInt('update_snooze_$key');
  Future<void> setUpdateSnoozedUntil(String key, int epochMs) =>
      _prefs.setInt('update_snooze_$key', epochMs);

  // ---------- Favoritos / Recientes ----------

  List<MediaItem> _loadItems(String key) {
    final raw = _prefs.getString(key);
    if (raw == null || raw.isEmpty) return [];
    try {
      return (jsonDecode(raw) as List)
          .whereType<Map>()
          .map((m) => MediaItem.fromJson(Map<String, dynamic>.from(m)))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> _saveItems(String key, List<MediaItem> items) =>
      _prefs.setString(key, jsonEncode(items.map((i) => i.toJson()).toList()));

  List<MediaItem> loadFavorites(String profileId) =>
      _loadItems('favorites_$profileId');
  Future<void> saveFavorites(String profileId, List<MediaItem> items) =>
      _saveItems('favorites_$profileId', items);

  List<MediaItem> loadRecents(String profileId) =>
      _loadItems('recents_$profileId');
  Future<void> saveRecents(String profileId, List<MediaItem> items) =>
      _saveItems('recents_$profileId', items);

  /// Posición guardada de VOD (segundos).
  int getResumePosition(String profileId, String key) =>
      _prefs.getInt('resume_${profileId}_$key') ?? 0;
  Future<void> setResumePosition(String profileId, String key, int seconds) =>
      seconds <= 0
          ? _prefs.remove('resume_${profileId}_$key')
          : _prefs.setInt('resume_${profileId}_$key', seconds);

  // ---------- Avisos popup ya mostrados ----------

  Set<String> seenPopupIds(String profileId) =>
      (_prefs.getStringList('seen_popups_$profileId') ?? const []).toSet();

  Future<void> markPopupSeen(String profileId, String noticeId) {
    final set = seenPopupIds(profileId)..add(noticeId);
    return _prefs.setStringList('seen_popups_$profileId', set.toList());
  }

  // ---------- Limpieza ----------

  Future<void> deleteProfileData(Profile profile) async {
    final keys = _prefs.getKeys().where((k) =>
        k == 'favorites_${profile.id}' ||
        k == 'recents_${profile.id}' ||
        k == 'seen_popups_${profile.id}' ||
        k.startsWith('resume_${profile.id}_'));
    for (final k in keys.toList()) {
      await _prefs.remove(k);
    }
    if (profile.filePath.isNotEmpty) {
      try {
        final f = File(profile.filePath);
        if (await f.exists()) await f.delete();
      } catch (_) {}
    }
  }

  /// Guarda una copia interna del archivo M3U elegido y devuelve su ruta.
  static Future<String> storePlaylistFile(
      String profileId, Uint8List bytes) async {
    final dir = await getApplicationSupportDirectory();
    final folder = Directory('${dir.path}${Platform.pathSeparator}playlists');
    if (!await folder.exists()) await folder.create(recursive: true);
    final file =
        File('${folder.path}${Platform.pathSeparator}$profileId.m3u');
    await file.writeAsBytes(bytes, flush: true);
    return file.path;
  }
}
