/// Utilidades tolerantes para JSON de APIs Xtream (que mezclan números y strings).
library;

int? asInt(dynamic v) {
  if (v == null) return null;
  if (v is int) return v;
  if (v is double) return v.isFinite ? v.toInt() : null;
  if (v is bool) return v ? 1 : 0;
  if (v is String) {
    final s = v.trim();
    if (s.isEmpty || s.toLowerCase() == 'null') return null;
    return int.tryParse(s) ?? double.tryParse(s)?.toInt();
  }
  return null;
}

double? asDouble(dynamic v) {
  if (v == null) return null;
  if (v is double) return v;
  if (v is int) return v.toDouble();
  if (v is String) {
    final s = v.trim().replaceAll(',', '.');
    if (s.isEmpty) return null;
    return double.tryParse(s);
  }
  return null;
}

String? asString(dynamic v) {
  if (v == null) return null;
  if (v is String) return v;
  if (v is num || v is bool) return v.toString();
  return null;
}

/// String no nulo (vacío si no hay valor).
String str(dynamic v) => asString(v) ?? '';

/// String no vacío o `null`.
String? nonEmpty(dynamic v) {
  final s = asString(v)?.trim();
  return (s == null || s.isEmpty) ? null : s;
}

bool asBool(dynamic v, {bool fallback = false}) {
  if (v == null) return fallback;
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.trim().toLowerCase();
    if (s == '1' || s == 'true' || s == 'yes' || s == 'si' || s == 'sí') {
      return true;
    }
    if (s == '0' || s == 'false' || s == 'no' || s.isEmpty) return false;
  }
  return fallback;
}

/// Convierte segundos unix (int o string) a [DateTime] local.
DateTime? asUnixDate(dynamic v) {
  final n = asInt(v);
  if (n == null || n <= 0) return null;
  return DateTime.fromMillisecondsSinceEpoch(n * 1000);
}

Map<String, dynamic> asMap(dynamic v) {
  if (v is Map<String, dynamic>) return v;
  if (v is Map) return v.map((k, val) => MapEntry(k.toString(), val));
  return const {};
}

List<dynamic> asList(dynamic v) {
  if (v is List) return v;
  if (v is Map) return v.values.toList();
  return const [];
}

List<String> asStringList(dynamic v) {
  if (v is List) {
    return v.map(asString).whereType<String>().where((s) => s.isNotEmpty).toList();
  }
  final s = nonEmpty(v);
  return s == null ? const [] : [s];
}
