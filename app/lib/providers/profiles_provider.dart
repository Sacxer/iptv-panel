import 'package:flutter/foundation.dart';

import '../models/profile.dart';
import '../services/storage.dart';

class ProfilesProvider extends ChangeNotifier {
  final Storage storage;
  final List<Profile> _profiles;

  ProfilesProvider(this.storage) : _profiles = storage.loadProfiles();

  List<Profile> get profiles => List.unmodifiable(_profiles);

  String? get lastProfileId => storage.lastProfileId;

  Profile? byId(String? id) {
    if (id == null) return null;
    for (final p in _profiles) {
      if (p.id == id) return p;
    }
    return null;
  }

  /// Perfiles ordenados con el último usado primero.
  List<Profile> get ordered {
    final last = lastProfileId;
    final list = [..._profiles];
    list.sort((a, b) {
      if (a.id == last) return -1;
      if (b.id == last) return 1;
      return a.createdAt.compareTo(b.createdAt);
    });
    return list;
  }

  static String newId() => DateTime.now().microsecondsSinceEpoch.toString();

  Future<void> save(Profile profile) async {
    final idx = _profiles.indexWhere((p) => p.id == profile.id);
    if (idx >= 0) {
      _profiles[idx] = profile;
    } else {
      _profiles.add(profile);
    }
    await storage.saveProfiles(_profiles);
    notifyListeners();
  }

  Future<void> delete(Profile profile) async {
    _profiles.removeWhere((p) => p.id == profile.id);
    await storage.saveProfiles(_profiles);
    await storage.deleteProfileData(profile);
    if (storage.lastProfileId == profile.id) {
      await storage.setLastProfileId(null);
    }
    notifyListeners();
  }

  Future<void> markUsed(Profile profile) async {
    await storage.setLastProfileId(profile.id);
    notifyListeners();
  }
}
