/// Consulta de actualizaciones de la app en el portal (solo versión "portal").
///
/// Contrato en `docs/API.md` → "Actualización de la app propia". No depende de Flutter
/// (solo `http`), así que se prueba con un cliente HTTP falso.
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/json_utils.dart';

/// Versión ofrecida.
class AppUpdateRelease {
  final int id;
  final String versionName;

  /// `versionCode` del APK ofrecido (con split-per-abi incluye el prefijo de la arquitectura).
  final int versionCode;
  final String notes;
  final DateTime? publishedAt;
  final String channel;

  const AppUpdateRelease({
    required this.id,
    required this.versionName,
    required this.versionCode,
    this.notes = '',
    this.publishedAt,
    this.channel = 'stable',
  });
}

/// APK a descargar.
class AppUpdateFile {
  final int id;
  final String abi;
  final int size;
  final String sha256;

  /// Ruta tal como llega (`/api/client/app-update/download/{id}`).
  final String url;

  const AppUpdateFile({
    required this.id,
    required this.abi,
    required this.size,
    required this.sha256,
    required this.url,
  });
}

class AppUpdateInfo {
  final bool mandatory;
  final AppUpdateRelease release;
  final AppUpdateFile file;

  /// URL absoluta para descargar el APK.
  final Uri downloadUri;

  const AppUpdateInfo({
    required this.mandatory,
    required this.release,
    required this.file,
    required this.downloadUri,
  });

  /// Clave para "Más tarde" (una por versión ofrecida).
  String get snoozeKey => '${release.versionName}+${release.versionCode}';
}

/// Datos del equipo que se envían al portal.
class AppUpdateQuery {
  final String packageName;
  final int versionCode;
  final String versionName;
  final List<String> abis;
  final String deviceType;
  final String deviceId;
  final int? sdk;
  final String? channel;

  const AppUpdateQuery({
    required this.packageName,
    required this.versionCode,
    required this.versionName,
    this.abis = const [],
    this.deviceType = '',
    this.deviceId = '',
    this.sdk,
    this.channel,
  });

  Map<String, String> toQueryParameters() => {
        'package': packageName,
        'version_code': '$versionCode',
        'version_name': versionName,
        'abis': abis.join(','),
        if (deviceType.isNotEmpty) 'device_type': deviceType,
        if (deviceId.isNotEmpty) 'device_id': deviceId,
        if (sdk != null) 'sdk': '$sdk',
        if (channel != null && channel!.isNotEmpty) 'channel': channel!,
      };
}

enum AppUpdateStatus {
  /// Hay una versión nueva para este equipo.
  available,

  /// El portal respondió que no hay nada nuevo.
  upToDate,

  /// No se pudo saber (sin red, servidor que no es el portal, respuesta rara). Silencioso.
  unavailable,
}

class AppUpdateCheck {
  final AppUpdateStatus status;
  final AppUpdateInfo? info;
  final String? reason;

  const AppUpdateCheck.available(AppUpdateInfo this.info)
      : status = AppUpdateStatus.available,
        reason = null;

  const AppUpdateCheck.upToDate()
      : status = AppUpdateStatus.upToDate,
        info = null,
        reason = null;

  const AppUpdateCheck.unavailable([this.reason])
      : status = AppUpdateStatus.unavailable,
        info = null;
}

/// Cliente de `GET /api/client/app-update`. Nunca lanza excepciones.
class AppUpdateApi {
  final http.Client _client;
  final Map<String, String> headers;
  final Duration timeout;

  AppUpdateApi({
    http.Client? client,
    this.headers = const {},
    this.timeout = const Duration(seconds: 15),
  }) : _client = client ?? http.Client();

  /// `http://host:puerto` sin `/` final (agrega `http://` si falta). `null` si no es válida.
  static String? normalizeServer(String? raw) {
    var s = (raw ?? '').trim();
    if (s.isEmpty) return null;
    if (!s.contains('://')) s = 'http://$s';
    final uri = Uri.tryParse(s);
    if (uri == null || uri.host.isEmpty) return null;
    if (uri.scheme != 'http' && uri.scheme != 'https') return null;
    var path = uri.path;
    for (final suffix in ['/player_api.php', '/get.php', '/panel_api.php']) {
      final i = path.toLowerCase().indexOf(suffix);
      if (i >= 0) path = path.substring(0, i);
    }
    while (path.endsWith('/')) {
      path = path.substring(0, path.length - 1);
    }
    return Uri(
      scheme: uri.scheme,
      host: uri.host,
      port: uri.hasPort ? uri.port : null,
      path: path,
    ).toString();
  }

  static Uri checkUri(String server, AppUpdateQuery query) =>
      Uri.parse('$server/api/client/app-update')
          .replace(queryParameters: query.toQueryParameters());

  /// Interpreta la respuesta. Lo que no tenga la forma del portal cuenta como "no disponible".
  static AppUpdateCheck parse(dynamic json, String server) {
    if (json is! Map || !json.containsKey('update')) {
      return const AppUpdateCheck.unavailable('Respuesta que no es del portal');
    }
    final j = asMap(json);
    if (!asBool(j['update'])) return const AppUpdateCheck.upToDate();

    final r = asMap(j['release']);
    final f = asMap(j['file']);
    final versionCode = asInt(r['version_code']);
    final url = nonEmpty(f['url']);
    final sha = (nonEmpty(f['sha256']) ?? '').toLowerCase();
    if (versionCode == null ||
        url == null ||
        !RegExp(r'^[0-9a-f]{64}$').hasMatch(sha)) {
      return const AppUpdateCheck.unavailable('Respuesta incompleta');
    }
    final base = Uri.parse('$server/');
    final download = Uri.tryParse(url);
    if (download == null) {
      return const AppUpdateCheck.unavailable('URL de descarga inválida');
    }
    return AppUpdateCheck.available(AppUpdateInfo(
      mandatory: asBool(j['mandatory']),
      release: AppUpdateRelease(
        id: asInt(r['id']) ?? 0,
        versionName: nonEmpty(r['version_name']) ?? '$versionCode',
        versionCode: versionCode,
        notes: str(r['notes']).trim(),
        publishedAt: asUnixDate(r['published_at']),
        channel: nonEmpty(r['channel']) ?? 'stable',
      ),
      file: AppUpdateFile(
        id: asInt(f['id']) ?? 0,
        abi: nonEmpty(f['abi']) ?? '',
        size: asInt(f['size']) ?? 0,
        sha256: sha,
        url: url,
      ),
      downloadUri: download.hasScheme ? download : base.resolveUri(download),
    ));
  }

  Future<AppUpdateCheck> check(String serverUrl, AppUpdateQuery query) async {
    final server = normalizeServer(serverUrl);
    if (server == null) {
      return const AppUpdateCheck.unavailable('Servidor inválido');
    }
    try {
      final res = await _client.get(checkUri(server, query), headers: {
        ...headers,
        'Accept': 'application/json',
      }).timeout(timeout);
      if (res.statusCode != 200) {
        return AppUpdateCheck.unavailable('HTTP ${res.statusCode}');
      }
      return parse(
          jsonDecode(utf8.decode(res.bodyBytes, allowMalformed: true)), server);
    } catch (e) {
      return AppUpdateCheck.unavailable('$e');
    }
  }

  void close() => _client.close();
}

/// Dónde se recuerda "Más tarde" (hasta cuándo, en milisegundos unix).
abstract class UpdateSnoozeStore {
  int? snoozedUntil(String key);
  Future<void> setSnoozedUntil(String key, int epochMs);
}

class MemorySnoozeStore implements UpdateSnoozeStore {
  final Map<String, int> values = {};

  @override
  int? snoozedUntil(String key) => values[key];

  @override
  Future<void> setSnoozedUntil(String key, int epochMs) async =>
      values[key] = epochMs;
}

/// Qué hacer con el resultado.
enum UpdateAction {
  /// Nada (no hay versión nueva o no se pudo consultar).
  none,

  /// Preguntar "Actualizar / Más tarde".
  prompt,

  /// Obligatoria: pantalla que no deja seguir sin actualizar.
  block,

  /// Hay versión nueva, pero el usuario pidió "Más tarde" hace menos de 24 h.
  snoozed,
}

class AppUpdateDecision {
  final AppUpdateCheck check;
  final UpdateAction action;

  const AppUpdateDecision(this.check, this.action);

  AppUpdateInfo? get info => check.info;
}

/// Consulta + reglas (obligatoria, "Más tarde" por 24 h, búsqueda manual).
class AppUpdateChecker {
  static const Duration snoozeDuration = Duration(hours: 24);

  final AppUpdateApi api;
  final UpdateSnoozeStore snoozeStore;
  final DateTime Function() now;

  AppUpdateChecker({
    required this.api,
    required this.snoozeStore,
    DateTime Function()? clock,
  }) : now = clock ?? DateTime.now;

  Future<AppUpdateDecision> run(String serverUrl, AppUpdateQuery query,
      {bool manual = false}) async {
    return decide(await api.check(serverUrl, query), manual: manual);
  }

  /// Obligatoria siempre bloquea; la búsqueda manual ignora "Más tarde".
  AppUpdateDecision decide(AppUpdateCheck check, {bool manual = false}) {
    final info = check.info;
    if (check.status != AppUpdateStatus.available || info == null) {
      return AppUpdateDecision(check, UpdateAction.none);
    }
    if (info.mandatory) return AppUpdateDecision(check, UpdateAction.block);
    if (!manual && isSnoozed(info)) {
      return AppUpdateDecision(check, UpdateAction.snoozed);
    }
    return AppUpdateDecision(check, UpdateAction.prompt);
  }

  bool isSnoozed(AppUpdateInfo info) {
    final until = snoozeStore.snoozedUntil(info.snoozeKey);
    return until != null && now().millisecondsSinceEpoch < until;
  }

  /// "Más tarde": no volver a preguntar por esta versión durante 24 h.
  Future<void> snooze(AppUpdateInfo info) => snoozeStore.setSnoozedUntil(
      info.snoozeKey, now().add(snoozeDuration).millisecondsSinceEpoch);
}
