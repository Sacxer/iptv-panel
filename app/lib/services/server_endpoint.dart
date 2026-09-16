/// Dirección del servidor que comparten la API Xtream, la del portal, el latido y el
/// reproductor. Si el portal cambia de dirección se actualiza aquí una sola vez y todas las
/// peticiones siguientes (y los reintentos del reproductor) usan la nueva.
class ServerEndpoint {
  String _url;

  ServerEndpoint(String url) : _url = normalize(url);

  String get url => _url;

  set url(String value) => _url = normalize(value);

  /// Agrega `http://`, quita `/` final, `?…` y `player_api.php` / `get.php` / `panel_api.php`.
  static String normalize(String input) {
    var s = input.trim();
    if (s.isEmpty) return s;
    if (!s.contains('://')) s = 'http://$s';
    final lower = s.toLowerCase();
    for (final suffix in ['/player_api.php', '/get.php', '/panel_api.php']) {
      final idx = lower.indexOf(suffix);
      if (idx >= 0) {
        s = s.substring(0, idx);
        break;
      }
    }
    final q = s.indexOf('?');
    if (q >= 0) s = s.substring(0, q);
    while (s.endsWith('/')) {
      s = s.substring(0, s.length - 1);
    }
    return s;
  }

  @override
  String toString() => 'ServerEndpoint($_url)';
}
