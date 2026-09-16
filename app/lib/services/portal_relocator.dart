/// Reencontrar el portal si su dirección cambió (IP nueva tras un corte, otra red, puerto de
/// clientes separado del panel). Contrato: `docs/API.md` → "Identidad del portal y reconexión".
///
/// El portal se reconoce por su identificador (`id`): nunca se cambia a un portal con otro `id`.
/// No depende de Flutter (solo `http` y el descubrimiento en red local), así que se prueba con
/// servidores locales y con ping/búsqueda inyectados.
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/json_utils.dart';
import 'server_discovery.dart';

/// Lo que la app sabe del portal de un perfil (se guarda con el perfil).
class PortalIdentity {
  /// Identificador del portal ('' si todavía no se conoce).
  final String id;

  /// Direcciones del portal por preferencia (de `server.urls`).
  final List<String> urls;

  /// Puertos para clientes (de `/api/client/ping`).
  final List<int> clientPorts;

  const PortalIdentity({
    this.id = '',
    this.urls = const [],
    this.clientPorts = const [],
  });

  /// Hay con qué reconocerlo (si no, el perfil se comporta como un Xtream cualquiera).
  bool get isKnown => id.isNotEmpty || urls.isNotEmpty;
}

enum PingStatus {
  /// Respondió como portal.
  portal,

  /// Es el puerto del panel: los clientes usan otro (404 "Los clientes usan el puerto N").
  panelPort,

  /// Respondió, pero no es el portal.
  notPortal,

  /// No respondió (conexión rechazada, tiempo agotado, sin ruta…).
  unreachable,
}

/// Resultado de `GET {url}/api/client/ping`.
class PingResult {
  final PingStatus status;
  final String? id;
  final String name;
  final List<int> clientPorts;
  final List<int> ports;

  /// Puerto de clientes que indica el 404 del puerto del panel.
  final int? suggestedPort;

  const PingResult(
    this.status, {
    this.id,
    this.name = '',
    this.clientPorts = const [],
    this.ports = const [],
    this.suggestedPort,
  });

  static const unreachable = PingResult(PingStatus.unreachable);
  static const notPortal = PingResult(PingStatus.notPortal);

  @override
  String toString() => 'PingResult(${status.name}, id: $id, clientPorts: $clientPorts, '
      'suggested: $suggestedPort)';
}

typedef PortalPinger = Future<PingResult> Function(String baseUrl);

/// Busca portales en la red local; recibe el `id` buscado (para terminar antes al encontrarlo).
typedef PortalLanSearch = Future<List<DiscoveredServer>> Function(String portalId,
    {DiscoveryProgressCallback? onProgress});

enum RelocationOutcome {
  /// Se encontró el portal en otra dirección ([RelocationResult.url]).
  found,

  /// La dirección actual responde: no hay nada que cambiar.
  currentWorks,

  /// No apareció en ninguna dirección conocida ni en la red local.
  notFound,

  /// Se buscó hace menos de 20 s (o el perfil cambió mientras tanto).
  skipped,

  /// El perfil no tiene datos del portal para reconocerlo.
  unknownPortal,
}

enum RelocationVia { savedUrl, clientPort, localNetwork }

class RelocationResult {
  final RelocationOutcome outcome;

  /// Dirección nueva (solo con [RelocationOutcome.found]).
  final String? url;

  /// Dirección con la que se empezó a buscar.
  final String? previousUrl;
  final String? portalId;
  final List<int> clientPorts;
  final RelocationVia? via;

  const RelocationResult(
    this.outcome, {
    this.url,
    this.previousUrl,
    this.portalId,
    this.clientPorts = const [],
    this.via,
  });

  bool get found => outcome == RelocationOutcome.found && url != null;

  @override
  String toString() => 'RelocationResult(${outcome.name}, $previousUrl -> $url, via: ${via?.name})';
}

class PortalRelocator {
  static const Duration defaultInterval = Duration(seconds: 20);
  static const Duration defaultPingTimeout = Duration(milliseconds: 2500);

  final PortalPinger ping;

  /// `null` = no buscar en la red local.
  final PortalLanSearch? lanSearch;

  /// Mínimo entre dos búsquedas automáticas.
  final Duration minInterval;
  final DateTime Function() now;

  PortalRelocator({
    PortalPinger? pinger,
    PortalLanSearch? lanSearch,
    bool searchLocalNetwork = true,
    this.minInterval = defaultInterval,
    DateTime Function()? clock,
    Duration pingTimeout = defaultPingTimeout,
    Map<String, String> headers = const {},
  })  : ping = pinger ?? httpPinger(timeout: pingTimeout, headers: headers),
        lanSearch = searchLocalNetwork ? (lanSearch ?? searchLan) : null,
        now = clock ?? DateTime.now;

  Future<RelocationResult>? _running;
  DateTime? _lastFinished;
  RelocationResult? _last;

  bool get isRunning => _running != null;

  /// Busca el portal. Una sola búsqueda a la vez (quien llega mientras tanto recibe el mismo
  /// resultado) y, salvo [force] (botón "Buscar servidor"), como máximo una cada [minInterval].
  Future<RelocationResult> relocate({
    required String currentUrl,
    required PortalIdentity identity,
    int? suggestedPort,
    bool force = false,
    DiscoveryProgressCallback? onProgress,
  }) {
    final running = _running;
    if (running != null) return running;

    final current = normalizeBase(currentUrl);
    final last = _lastFinished;
    if (!force && last != null && now().difference(last) < minInterval) {
      final prev = _last;
      // Quien falló con la dirección vieja justo después de encontrarse la nueva la recibe también.
      if (prev != null && prev.found && prev.previousUrl == current) {
        return Future.value(prev);
      }
      return Future.value(
          RelocationResult(RelocationOutcome.skipped, previousUrl: current));
    }

    final future = _run(current, identity, suggestedPort, onProgress).then((result) {
      _last = result;
      return result;
    }).whenComplete(() {
      _running = null;
      _lastFinished = now();
    });
    _running = future;
    return future;
  }

  Future<RelocationResult> _run(String current, PortalIdentity identity,
      int? suggestedPort, DiscoveryProgressCallback? onProgress) async {
    if (!identity.isKnown) {
      return RelocationResult(RelocationOutcome.unknownPortal,
          previousUrl: current);
    }
    bool accepts(PingResult r) =>
        r.status == PingStatus.portal &&
        (identity.id.isEmpty ? true : r.id == identity.id);
    RelocationResult found(String url, PingResult r, RelocationVia via) =>
        RelocationResult(
          RelocationOutcome.found,
          url: url,
          previousUrl: current,
          portalId: r.id ?? (identity.id.isEmpty ? null : identity.id),
          clientPorts: r.clientPorts,
          via: via,
        );

    // 0) Si la dirección actual responde como este portal, no se cambia nada
    //    (p. ej. una lista grande que tardó, no un cambio de IP).
    final now0 = await ping(current);
    if (accepts(now0)) {
      return RelocationResult(RelocationOutcome.currentWorks,
          url: current,
          previousUrl: current,
          portalId: now0.id,
          clientPorts: now0.clientPorts);
    }

    // 1) Puerto del panel: el mismo equipo con el puerto de clientes (lo dice el propio portal).
    final panel = now0.status == PingStatus.panelPort || suggestedPort != null;
    final sameHost = <String>[];
    if (panel) {
      for (final p in [
        ?suggestedPort,
        ?now0.suggestedPort,
        ...identity.clientPorts,
      ]) {
        final u = withPort(current, p);
        if (u != null && u != current && !sameHost.contains(u)) sameHost.add(u);
      }
    }
    // 2) Direcciones guardadas, en su orden, sin la actual.
    final saved = <String>[];
    for (final raw in identity.urls) {
      final u = normalizeBase(raw);
      if (u.isEmpty || u == current || sameHost.contains(u) || saved.contains(u)) {
        continue;
      }
      saved.add(u);
    }
    final candidates = [
      for (final u in sameHost) (u, RelocationVia.clientPort),
      for (final u in saved) (u, RelocationVia.savedUrl),
    ];
    // Se consultan todas a la vez y se elige la primera de la lista que responda como este portal.
    final pings = [for (final (u, _) in candidates) ping(u)];
    for (var i = 0; i < candidates.length; i++) {
      final r = await pings[i];
      if (accepts(r)) return found(candidates[i].$1, r, candidates[i].$2);
    }

    // 3) Red local (UDP + barrido HTTP). Solo con id: es lo único que distingue a este portal
    //    de cualquier otro de la red.
    final search = lanSearch;
    if (search != null && identity.id.isNotEmpty) {
      final servers = await search(identity.id, onProgress: onProgress).catchError(
          (Object _) => const <DiscoveredServer>[]);
      for (final s in servers) {
        if (s.id != identity.id) continue;
        final u = normalizeBase(s.url);
        if (u.isEmpty || u == current) continue;
        final r = await ping(u); // confirmar que responde y es el mismo
        if (accepts(r)) return found(u, r, RelocationVia.localNetwork);
      }
    }
    return RelocationResult(RelocationOutcome.notFound, previousUrl: current);
  }

  // ---------------------------------------------------------------------------

  /// Ping HTTP real con tiempo límite. Nunca lanza.
  static PortalPinger httpPinger({
    Duration timeout = defaultPingTimeout,
    Map<String, String> headers = const {},
    http.Client Function()? clientFactory,
  }) {
    return (base) async {
      final url = normalizeBase(base);
      if (url.isEmpty) return PingResult.unreachable;
      final client = (clientFactory ?? http.Client.new)();
      try {
        final res = await client.get(Uri.parse('$url/api/client/ping'), headers: {
          ...headers,
          'Accept': 'application/json',
        }).timeout(timeout);
        return parsePing(
            res.statusCode, utf8.decode(res.bodyBytes, allowMalformed: true));
      } catch (_) {
        return PingResult.unreachable;
      } finally {
        client.close();
      }
    };
  }

  /// Interpreta la respuesta de `/api/client/ping`.
  static PingResult parsePing(int status, String body) {
    final hinted = panelPortHint(body);
    if (status == 404 && hinted != null) {
      return PingResult(PingStatus.panelPort, suggestedPort: hinted);
    }
    if (status != 200) return PingResult.notPortal;
    Map<String, dynamic>? j;
    try {
      final json = jsonDecode(body.trim());
      if (json is Map) j = asMap(json);
    } catch (_) {}
    if (j == null) return PingResult.notPortal;
    if (str(j['type']) != ServerDiscovery.portalType && !asBool(j['portal'])) {
      return PingResult.notPortal;
    }
    return PingResult(
      PingStatus.portal,
      id: nonEmpty(j['id']),
      name: str(j['name']),
      clientPorts: _ports(j['client_ports']),
      ports: _ports(j['ports']),
    );
  }

  /// Puerto de clientes en el mensaje "Este es el puerto del panel. Los clientes usan el puerto N."
  static int? panelPortHint(String text) => ServerDiscovery.panelPortHint(text);

  /// Búsqueda real en la red local; termina en cuanto aparece el portal buscado.
  static Future<List<DiscoveredServer>> searchLan(String portalId,
      {DiscoveryProgressCallback? onProgress}) async {
    final result = await const ServerDiscovery()
        .discover(expectedId: portalId, onProgress: onProgress);
    return result.servers;
  }

  static List<int> _ports(dynamic v) {
    final out = <int>[];
    for (final p in asList(v)) {
      final n = asInt(p);
      if (n != null && n > 0 && n < 65536 && !out.contains(n)) out.add(n);
    }
    return out;
  }

  /// `http://host:puerto` (sin `/` final ni `player_api.php`). '' si no es válida.
  static String normalizeBase(String input) {
    var s = input.trim();
    if (s.isEmpty) return '';
    if (!s.contains('://')) s = 'http://$s';
    final lower = s.toLowerCase();
    for (final suffix in ['/player_api.php', '/get.php', '/panel_api.php']) {
      final i = lower.indexOf(suffix);
      if (i >= 0) {
        s = s.substring(0, i);
        break;
      }
    }
    final q = s.indexOf('?');
    if (q >= 0) s = s.substring(0, q);
    while (s.endsWith('/')) {
      s = s.substring(0, s.length - 1);
    }
    final uri = Uri.tryParse(s);
    if (uri == null ||
        uri.host.isEmpty ||
        (uri.scheme != 'http' && uri.scheme != 'https')) {
      return '';
    }
    return s;
  }

  /// La misma dirección con otro puerto.
  static String? withPort(String base, int port) {
    final uri = Uri.tryParse(normalizeBase(base));
    if (uri == null || uri.host.isEmpty) return null;
    final host = uri.host.contains(':') ? '[${uri.host}]' : uri.host;
    final path = uri.path;
    return '${uri.scheme}://$host:$port$path';
  }
}
