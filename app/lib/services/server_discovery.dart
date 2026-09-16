/// Búsqueda del portal IPTV en la red local (para el inicio con Xtream Codes).
///
/// Usa a la vez dos métodos (ver `docs/API.md` → "Descubrimiento del servidor
/// en la red local") y une los resultados:
///
/// 1. **UDP**: envía `IPTV-DISCOVER v1` por difusión al puerto 25460 y recoge
///    las respuestas JSON de los portales.
/// 2. **Barrido HTTP**: `GET http://<ip>:<puerto>/api/client/ping` a las IPs de
///    la subred /24 del equipo (por si el router bloquea la difusión).
///
/// No depende de Flutter (solo `dart:io`), así que se puede probar con
/// servidores locales inyectando puertos, destinos y equipos.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../models/json_utils.dart';

/// Cómo se encontró el servidor.
enum DiscoverySource { udp, http }

/// Portal encontrado en la red local.
class DiscoveredServer {
  final String name;

  /// URL para usar como servidor Xtream: `http://IP:puerto`.
  final String url;
  final String version;

  /// URL para usar fuera de la red local (si el portal la tiene configurada).
  final String? publicUrl;

  /// Puertos en los que atiende el portal.
  final List<int> ports;
  final DiscoverySource source;

  /// Identificador fijo del portal (`null` en portales anteriores a 1.0.2 de la app).
  final String? id;

  const DiscoveredServer({
    required this.name,
    required this.url,
    this.version = '',
    this.publicUrl,
    this.ports = const [],
    this.source = DiscoverySource.udp,
    this.id,
  });

  Uri get _uri => Uri.parse(url);

  String get host => _uri.host;

  int get port => _uri.port;

  /// `public_url` solo si existe y es distinta de [url].
  String? get outsideUrl {
    final p = publicUrl;
    if (p == null || p.isEmpty) return null;
    return ServerDiscovery.urlKey(p) == ServerDiscovery.urlKey(url) ? null : p;
  }

  /// Mismo portal: misma URL, o mismo equipo y el puerto de uno está entre
  /// los puertos del otro (p. ej. 8080 por UDP y 25461 por barrido).
  bool isSameServer(DiscoveredServer other) {
    // Dos portales distintos en el mismo equipo nunca se unen.
    if (id != null && other.id != null && id != other.id) return false;
    if (ServerDiscovery.urlKey(url) == ServerDiscovery.urlKey(other.url)) {
      return true;
    }
    if (host.toLowerCase() != other.host.toLowerCase()) return false;
    return ports.contains(other.port) || other.ports.contains(port);
  }

  DiscoveredServer copyWith({
    String? version,
    String? publicUrl,
    List<int>? ports,
    String? id,
  }) =>
      DiscoveredServer(
        name: name,
        url: url,
        version: version ?? this.version,
        publicUrl: publicUrl ?? this.publicUrl,
        ports: ports ?? this.ports,
        source: source,
        id: id ?? this.id,
      );

  @override
  bool operator ==(Object other) =>
      other is DiscoveredServer &&
      other.name == name &&
      other.url == url &&
      other.version == version &&
      other.publicUrl == publicUrl &&
      other.source == source &&
      other.id == id &&
      _sameInts(other.ports, ports);

  @override
  int get hashCode => Object.hash(
      name, url, version, publicUrl, source, id, Object.hashAll(ports));

  @override
  String toString() =>
      'DiscoveredServer($name, $url, v$version, id: $id, public: $publicUrl, '
      'ports: $ports, ${source.name})';
}

bool _sameInts(List<int> a, List<int> b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

/// Red IPv4 local (Wi-Fi / cable) del equipo.
class LocalNetwork {
  final String interfaceName;
  final String address;

  /// `dart:io` no informa la máscara: se asume /24.
  final int prefixLength;

  /// `true` si el nombre parece Wi-Fi o Ethernet (se barre primero).
  final bool preferred;

  const LocalNetwork({
    required this.interfaceName,
    required this.address,
    this.prefixLength = 24,
    this.preferred = false,
  });

  String get broadcast =>
      ServerDiscovery.broadcastAddress(address, prefixLength) ?? '255.255.255.255';

  @override
  String toString() => '$interfaceName $address/$prefixLength';
}

/// Resultado de una búsqueda.
class DiscoveryResult {
  final List<DiscoveredServer> servers;
  final List<LocalNetwork> networks;

  /// El equipo no tiene Wi-Fi ni cable (p. ej. solo datos móviles).
  final bool noLocalNetwork;
  final bool cancelled;
  final Duration elapsed;

  const DiscoveryResult({
    this.servers = const [],
    this.networks = const [],
    this.noLocalNetwork = false,
    this.cancelled = false,
    this.elapsed = Duration.zero,
  });
}

/// Permite cancelar una búsqueda en curso.
class DiscoveryCancelToken {
  final _completer = Completer<void>();

  bool get isCancelled => _completer.isCompleted;

  Future<void> get whenCancelled => _completer.future;

  void cancel() {
    if (!_completer.isCompleted) _completer.complete();
  }
}

typedef InterfaceLister = Future<List<NetworkInterface>> Function();

/// Consulta `/api/client/ping` en `host:port`; `null` si no es un portal.
typedef PingProber = Future<DiscoveredServer?> Function(String host, int port);

typedef DiscoveryUpdate = void Function(List<DiscoveredServer> servers);

/// Busca portales en la red local. Todos los parámetros son inyectables para
/// las pruebas; los valores por defecto son los del contrato del portal.
class ServerDiscovery {
  static const String magic = 'IPTV-DISCOVER v1';
  static const String portalType = 'iptv-portal';
  static const int defaultUdpPort = 25460;
  static const List<int> defaultHttpPorts = [8080, 25461, 80];
  static const String limitedBroadcast = '255.255.255.255';

  /// Máximo de redes locales que se barren por HTTP.
  static const int maxSweepNetworks = 4;

  final int udpPort;
  final List<int> httpPorts;

  /// Destinos de la difusión UDP. `null` = `255.255.255.255` + difusión de
  /// cada red local.
  final List<String>? udpTargets;

  /// Equipos del barrido HTTP. `null` = IPs de la /24 de cada red local.
  final List<String>? sweepHosts;

  /// `null` = [NetworkInterface.list].
  final InterfaceLister? interfaceLister;

  /// `null` = petición HTTP real con [httpTimeout].
  final PingProber? prober;

  final bool enableUdp;
  final bool enableSweep;

  /// Tiempo total escuchando respuestas UDP.
  final Duration udpDuration;

  /// Veces que se envía la difusión dentro de [udpDuration].
  final int udpRounds;
  final Duration httpTimeout;

  /// Peticiones HTTP simultáneas como máximo.
  final int concurrency;

  /// Si UDP ya encontró algo, se termina al pasar este tiempo.
  final Duration minDuration;

  /// Duración máxima de la búsqueda.
  final Duration maxDuration;

  const ServerDiscovery({
    this.udpPort = defaultUdpPort,
    this.httpPorts = defaultHttpPorts,
    this.udpTargets,
    this.sweepHosts,
    this.interfaceLister,
    this.prober,
    this.enableUdp = true,
    this.enableSweep = true,
    this.udpDuration = const Duration(milliseconds: 2500),
    this.udpRounds = 3,
    this.httpTimeout = const Duration(milliseconds: 600),
    this.concurrency = 48,
    this.minDuration = const Duration(milliseconds: 1500),
    this.maxDuration = const Duration(seconds: 8),
  });

  // ---------------------------------------------------------------------------
  // Búsqueda
  // ---------------------------------------------------------------------------

  /// Ejecuta la búsqueda. [onUpdate] recibe la lista (ya unida) cada vez que
  /// aparece un servidor nuevo, para mostrarlos mientras sigue buscando.
  /// Nunca lanza excepciones.
  Future<DiscoveryResult> discover({
    DiscoveryUpdate? onUpdate,
    DiscoveryCancelToken? cancelToken,
  }) async {
    final clock = Stopwatch()..start();
    var networks = const <LocalNetwork>[];
    var listed = false;
    try {
      final lister = interfaceLister ?? _listInterfaces;
      networks = selectLocalNetworks(await lister());
      listed = true;
    } catch (_) {
      // Sin lista de interfaces: se intenta igual la difusión general.
    }

    if (cancelToken?.isCancelled ?? false) {
      return DiscoveryResult(
          networks: networks, cancelled: true, elapsed: clock.elapsed);
    }
    if (listed && networks.isEmpty && udpTargets == null && sweepHosts == null) {
      return DiscoveryResult(noLocalNetwork: true, elapsed: clock.elapsed);
    }

    final session = _Session(clock, onUpdate);
    cancelToken?.whenCancelled.then((_) => session.stop());
    final maxTimer = Timer(maxDuration, session.stop);
    Timer? minTimer;
    session.onUdpHit = () {
      final remaining = minDuration - clock.elapsed;
      if (remaining <= Duration.zero) {
        session.stop();
      } else {
        minTimer ??= Timer(remaining, session.stop);
      }
    };

    final tasks = Future.wait<void>([
      if (enableUdp) _runUdp(session, udpTargets ?? udpTargetsFor(networks)),
      if (enableSweep)
        _runSweep(session, sweepHosts ?? sweepHostsFor(networks)),
    ]);
    await Future.any<void>([tasks, session.whenStopped]);
    session.stop();
    maxTimer.cancel();
    minTimer?.cancel();
    // Deja que se cierren los sockets (nunca bloquea más de un momento).
    await tasks.timeout(const Duration(seconds: 2), onTimeout: () => const []);

    return DiscoveryResult(
      servers: session.servers,
      networks: networks,
      cancelled: cancelToken?.isCancelled ?? false,
      elapsed: clock.elapsed,
    );
  }

  static Future<List<NetworkInterface>> _listInterfaces() =>
      NetworkInterface.list(
        includeLoopback: false,
        includeLinkLocal: false,
        type: InternetAddressType.IPv4,
      );

  Future<void> _runUdp(_Session session, List<String> targets) async {
    RawDatagramSocket? socket;
    StreamSubscription<RawSocketEvent>? sub;
    try {
      final s = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      socket = s;
      s.broadcastEnabled = true;
      session.whenStopped.then((_) => s.close());
      // Un datagrama por evento de lectura (Dart avisa de nuevo si hay más).
      sub = s.listen((event) {
        if (event != RawSocketEvent.read) return;
        final d = s.receive();
        if (d == null) return;
        final server = parseUdpReply(d.data, sender: d.address);
        if (server != null) session.add(server);
      }, onError: (_) {});

      final addresses = <InternetAddress>[
        for (final t in targets.toSet())
          if (InternetAddress.tryParse(t) case final a?)
            if (a.type == InternetAddressType.IPv4) a,
      ];
      final payload = ascii.encode(magic);
      final rounds = udpRounds < 1 ? 1 : udpRounds;
      final gap = udpDuration ~/ rounds;
      final start = session.clock.elapsed;
      for (var round = 0; round < rounds && !session.stopped; round++) {
        final roundStart = session.clock.elapsed;
        for (final a in addresses) {
          if (session.stopped) break;
          try {
            if (s.send(payload, a, udpPort) == 0) {
              await session.sleep(const Duration(milliseconds: 10));
              if (!session.stopped) s.send(payload, a, udpPort);
            }
          } catch (_) {
            // Red inalcanzable para ese destino: se sigue con los demás.
          }
          // Pausa corta entre envíos: en Windows, dos envíos seguidos por el
          // mismo socket pueden perder el segundo datagrama.
          if (addresses.length > 1) {
            await session.sleep(const Duration(milliseconds: 5));
          }
        }
        if (round < rounds - 1) {
          await session.sleep(gap - (session.clock.elapsed - roundStart));
        }
      }
      final left = udpDuration - (session.clock.elapsed - start);
      if (left > Duration.zero) await session.sleep(left);
    } catch (_) {
      // UDP no disponible: queda el barrido HTTP.
    } finally {
      await sub?.cancel();
      socket?.close();
    }
  }

  Future<void> _runSweep(_Session session, List<String> hosts) async {
    final targets = <(String, int)>[
      for (final port in httpPorts)
        for (final host in hosts) (host, port),
    ];
    if (targets.isEmpty) return;

    HttpClient? client;
    final PingProber probe;
    if (prober case final injected?) {
      probe = injected;
    } else {
      final c = HttpClient()
        ..connectionTimeout = httpTimeout
        ..idleTimeout = const Duration(seconds: 1)
        ..findProxy = ((_) => 'DIRECT')
        ..userAgent = 'IPTVPlayer-discovery';
      client = c;
      session.whenStopped.then((_) => c.close(force: true));
      probe = (host, port) => probePing(c, host, port, timeout: httpTimeout);
    }

    var next = 0;
    Future<void> worker() async {
      while (!session.stopped && next < targets.length) {
        final (host, port) = targets[next++];
        try {
          final server = await probe(host, port);
          if (server != null) session.add(server);
        } catch (_) {
          // Un equipo que falla no detiene el barrido.
        }
      }
    }

    final workers = concurrency < 1 ? 1 : concurrency;
    try {
      await Future.wait([
        for (var i = 0; i < workers && i < targets.length; i++) worker(),
      ]);
    } finally {
      client?.close(force: true);
    }
  }

  /// `GET http://host:port/api/client/ping`. `null` si no responde a tiempo o
  /// no es un portal. Nunca lanza excepciones.
  static Future<DiscoveredServer?> probePing(
    HttpClient client,
    String host,
    int port, {
    Duration timeout = const Duration(milliseconds: 600),
  }) {
    Future<DiscoveredServer?> run() async {
      final uri =
          Uri(scheme: 'http', host: host, port: port, path: '/api/client/ping');
      final req = await client.getUrl(uri);
      req.followRedirects = false;
      req.headers.set(HttpHeaders.acceptHeader, 'application/json');
      final res = await req.close();
      if (res.statusCode != 200) {
        res.listen(null, cancelOnError: true).cancel();
        return null;
      }
      final bytes = <int>[];
      await for (final chunk in res) {
        bytes.addAll(chunk);
        if (bytes.length > 64 * 1024) return null;
      }
      return parsePingResponse(
          utf8.decode(bytes, allowMalformed: true), host, port);
    }

    // Conexión + respuesta: el portal en la LAN contesta en milisegundos.
    return run()
        .timeout(timeout * 2, onTimeout: () => null)
        .catchError((Object _) => null);
  }

  // ---------------------------------------------------------------------------
  // Análisis de respuestas
  // ---------------------------------------------------------------------------

  /// Respuesta UDP del portal. Solo acepta `"type": "iptv-portal"`.
  static DiscoveredServer? parseUdpReply(List<int> data,
      {InternetAddress? sender}) {
    final j = _decodeMap(utf8.decode(data, allowMalformed: true));
    if (j == null || str(j['type']) != portalType) return null;

    final ports = _ports(j['ports']);
    final port = asInt(j['port']);
    var uri = _httpUri(nonEmpty(j['url']));
    if (uri == null) {
      final host = nonEmpty(j['host']) ?? sender?.address;
      final p = port ?? (ports.isNotEmpty ? ports.first : null);
      if (host == null || p == null) return null;
      uri = _httpUri('http://$host:$p');
      if (uri == null) return null;
    }
    // Si el portal anuncia una IP que no sirve desde otro equipo, se usa la
    // IP desde la que respondió.
    final s = sender;
    if (s != null &&
        !s.isLoopback &&
        s.type == InternetAddressType.IPv4 &&
        (uri.host == '0.0.0.0' ||
            uri.host == 'localhost' ||
            (InternetAddress.tryParse(uri.host)?.isLoopback ?? false))) {
      uri = uri.replace(host: s.address);
    }

    final url = _formatUrl(uri);
    final effectivePort = uri.port;
    return DiscoveredServer(
      name: nonEmpty(j['name']) ?? 'Servidor IPTV',
      url: url,
      version: nonEmpty(j['version']) ?? '',
      publicUrl: _cleanUrl(nonEmpty(j['public_url'])),
      ports: ports.contains(effectivePort) ? ports : [effectivePort, ...ports],
      source: DiscoverySource.udp,
      id: nonEmpty(j['id']),
    );
  }

  /// Cuerpo de `/api/client/ping`. Acepta `"type": "iptv-portal"` y también
  /// `"portal": true` (portales anteriores). La URL es `http://host:port`.
  static DiscoveredServer? parsePingResponse(String body, String host, int port) {
    final j = _decodeMap(body);
    if (j == null) return null;
    if (str(j['type']) != portalType && !asBool(j['portal'])) return null;
    final ports = _ports(j['ports']);
    final uri = _httpUri('http://$host:$port');
    if (uri == null) return null;
    return DiscoveredServer(
      name: nonEmpty(j['name']) ?? 'Servidor IPTV',
      url: _formatUrl(uri, forcePort: true),
      version: nonEmpty(j['version']) ?? '',
      publicUrl: _cleanUrl(nonEmpty(j['public_url'])),
      ports: ports.contains(port) ? ports : [...ports, port],
      source: DiscoverySource.http,
      id: nonEmpty(j['id']),
    );
  }

  static Map<String, dynamic>? _decodeMap(String text) {
    try {
      final json = jsonDecode(text.trim());
      return json is Map ? asMap(json) : null;
    } catch (_) {
      return null;
    }
  }

  static List<int> _ports(dynamic v) {
    final out = <int>[];
    for (final p in asList(v)) {
      final n = asInt(p);
      if (n != null && n > 0 && n < 65536 && !out.contains(n)) out.add(n);
    }
    return out;
  }

  static Uri? _httpUri(String? raw) {
    if (raw == null) return null;
    var s = raw.trim();
    if (s.isEmpty) return null;
    if (!s.contains('://')) s = 'http://$s';
    final uri = Uri.tryParse(s);
    if (uri == null || uri.host.isEmpty) return null;
    if (uri.scheme != 'http' && uri.scheme != 'https') return null;
    return uri;
  }

  static String _formatUrl(Uri uri, {bool forcePort = false}) {
    final host = uri.host.contains(':') ? '[${uri.host}]' : uri.host;
    final showPort = forcePort || uri.hasPort;
    var path = uri.path;
    while (path.endsWith('/')) {
      path = path.substring(0, path.length - 1);
    }
    return '${uri.scheme}://$host${showPort ? ':${uri.port}' : ''}$path';
  }

  static String? _cleanUrl(String? raw) {
    final uri = _httpUri(raw);
    return uri == null ? null : _formatUrl(uri);
  }

  /// Clave para comparar URLs: `esquema://host:puerto` en minúsculas.
  static String urlKey(String url) {
    final uri = _httpUri(url);
    if (uri == null) return url.trim().toLowerCase();
    return '${uri.scheme}://${uri.host}:${uri.port}'.toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // Unión de resultados
  // ---------------------------------------------------------------------------

  /// Une servidores repetidos (por URL, o mismo equipo con puertos en común).
  /// Prefiere la respuesta UDP y, entre iguales, la del puerto principal.
  /// Conserva el orden en que aparecieron.
  static List<DiscoveredServer> mergeServers(Iterable<DiscoveredServer> items) {
    final out = <DiscoveredServer>[];
    for (final s in items) {
      final i = out.indexWhere((e) => e.isSameServer(s));
      if (i < 0) {
        out.add(s);
      } else {
        out[i] = _pick(out[i], s);
      }
    }
    return out;
  }

  static DiscoveredServer _pick(DiscoveredServer a, DiscoveredServer b) {
    var best = a;
    var other = b;
    if (a.source != b.source) {
      if (b.source == DiscoverySource.udp) {
        best = b;
        other = a;
      }
    } else if (b.ports.isNotEmpty &&
        b.port == b.ports.first &&
        !(a.ports.isNotEmpty && a.port == a.ports.first)) {
      best = b;
      other = a;
    }
    return best.copyWith(
      version: best.version.isEmpty ? other.version : null,
      publicUrl: best.publicUrl ?? other.publicUrl,
      id: best.id ?? other.id,
      ports: [
        ...best.ports,
        for (final p in other.ports)
          if (!best.ports.contains(p)) p,
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Redes locales
  // ---------------------------------------------------------------------------

  /// Interfaces de datos móviles, VPN o virtuales que no son la red de la casa.
  static final RegExp _excludedInterface = RegExp(
    r'^lo\d*$|'
    r'^(rmnet|rev_rmnet|ccmni|pdp|seth|wwan|clat|v4-|radio|qmi|dummy|tun|'
    r'ppp|ipsec|sit|gre|ip6|ifb|nlmon|teredo|isatap)|'
    r'virtualbox|vmware|vethernet|hyper-v|zerotier|tailscale|wireguard|'
    r'openvpn|wintun|tap-|docker|wsl|npcap|bluetooth|loopback|vpn',
    caseSensitive: false,
  );

  static final RegExp _preferredInterface = RegExp(
    r'^(wlan|wifi|wi-fi|eth|en|ap|swlan|wl)|wi-fi|wireless|inal[aá]mbrica|ethernet',
    caseSensitive: false,
  );

  /// Redes IPv4 privadas (Wi-Fi / cable) aptas para buscar el portal: excluye
  /// datos móviles, VPN, adaptadores virtuales, loopback, link-local e IPs
  /// públicas. Primero las que parecen Wi-Fi o Ethernet.
  static List<LocalNetwork> selectLocalNetworks(
      Iterable<NetworkInterface> interfaces) {
    final out = <LocalNetwork>[];
    for (final iface in interfaces) {
      if (_excludedInterface.hasMatch(iface.name)) continue;
      for (final a in iface.addresses) {
        if (a.type != InternetAddressType.IPv4) continue;
        if (!isLanAddress(a.address)) continue;
        if (out.any((n) => n.address == a.address)) continue;
        out.add(LocalNetwork(
          interfaceName: iface.name,
          address: a.address,
          preferred: _preferredInterface.hasMatch(iface.name),
        ));
      }
    }
    // Orden estable: preferidas primero.
    return [
      ...out.where((n) => n.preferred),
      ...out.where((n) => !n.preferred),
    ];
  }

  static List<int>? _octets(String ip) {
    final parts = ip.trim().split('.');
    if (parts.length != 4) return null;
    final out = <int>[];
    for (final p in parts) {
      final n = int.tryParse(p);
      if (n == null || n < 0 || n > 255) return null;
      out.add(n);
    }
    return out;
  }

  /// IPv4 de red local: 10/8, 172.16/12, 192.168/16 o CGNAT 100.64/10.
  static bool isLanAddress(String ip) {
    final o = _octets(ip);
    if (o == null) return false;
    if (o[0] == 10) return true;
    if (o[0] == 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] == 192 && o[1] == 168) return true;
    if (o[0] == 100 && o[1] >= 64 && o[1] <= 127) return true;
    return false;
  }

  /// Dirección de difusión de `ip/prefixLength` (p. ej. 192.168.1.255).
  static String? broadcastAddress(String ip, [int prefixLength = 24]) {
    final o = _octets(ip);
    if (o == null || prefixLength < 0 || prefixLength > 32) return null;
    final value = (o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3];
    final mask = prefixLength == 0
        ? 0
        : (0xFFFFFFFF << (32 - prefixLength)) & 0xFFFFFFFF;
    final b = (value & mask) | (~mask & 0xFFFFFFFF);
    return '${(b >> 24) & 255}.${(b >> 16) & 255}.${(b >> 8) & 255}.${b & 255}';
  }

  /// Equipos de la /24 de [ip]: `a.b.c.1` … `a.b.c.254` (incluye la propia IP,
  /// por si el portal corre en este mismo equipo).
  static List<String> hostsInSubnet24(String ip) {
    final o = _octets(ip);
    if (o == null) return const [];
    final prefix = '${o[0]}.${o[1]}.${o[2]}';
    return [for (var i = 1; i <= 254; i++) '$prefix.$i'];
  }

  /// Destinos UDP: difusión general + difusión de cada red local.
  static List<String> udpTargetsFor(List<LocalNetwork> networks) => {
        limitedBroadcast,
        for (final n in networks) n.broadcast,
      }.toList();

  /// Equipos del barrido HTTP (redes preferidas primero, sin repetir).
  static List<String> sweepHostsFor(List<LocalNetwork> networks) => {
        for (final n in networks.take(maxSweepNetworks))
          ...hostsInSubnet24(n.address),
      }.toList();
}

/// Estado compartido de una búsqueda en curso.
class _Session {
  final Stopwatch clock;
  final DiscoveryUpdate? onUpdate;
  final _stop = Completer<void>();
  void Function()? onUdpHit;
  List<DiscoveredServer> servers = const [];

  _Session(this.clock, this.onUpdate);

  bool get stopped => _stop.isCompleted;

  Future<void> get whenStopped => _stop.future;

  void stop() {
    if (!_stop.isCompleted) _stop.complete();
  }

  /// Espera [d] o hasta que se detenga la búsqueda.
  Future<void> sleep(Duration d) {
    if (stopped || d <= Duration.zero) return Future.value();
    final done = Completer<void>();
    final timer = Timer(d, () {
      if (!done.isCompleted) done.complete();
    });
    whenStopped.then((_) {
      timer.cancel();
      if (!done.isCompleted) done.complete();
    });
    return done.future;
  }

  void add(DiscoveredServer server) {
    if (stopped) return;
    final merged = ServerDiscovery.mergeServers([...servers, server]);
    var changed = merged.length != servers.length;
    for (var i = 0; !changed && i < merged.length; i++) {
      changed = merged[i] != servers[i];
    }
    if (changed) {
      servers = List.unmodifiable(merged);
      onUpdate?.call(servers);
    }
    if (server.source == DiscoverySource.udp) onUdpHit?.call();
  }
}
