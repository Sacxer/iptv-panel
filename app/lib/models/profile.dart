import '../services/portal_relocator.dart';
import 'json_utils.dart';

enum ProfileType { xtream, m3uUrl, m3uFile }

extension ProfileTypeLabel on ProfileType {
  String get label {
    switch (this) {
      case ProfileType.xtream:
        return 'Xtream Codes';
      case ProfileType.m3uUrl:
        return 'Lista M3U (URL)';
      case ProfileType.m3uFile:
        return 'Lista M3U (archivo)';
    }
  }
}

/// Perfil guardado (una cuenta / lista).
class Profile {
  final String id;
  final String name;
  final ProfileType type;

  /// Xtream: URL del servidor `http://host:puerto`.
  final String serverUrl;
  final String username;
  final String password;

  /// M3U por URL.
  final String m3uUrl;

  /// M3U local: ruta de la copia interna del archivo.
  final String filePath;

  /// Nombre original del archivo elegido (solo informativo).
  final String fileName;

  final int createdAt;

  /// Portal propio: identificador (de `/api/client/info` → `server.id`). '' si no es un portal
  /// o aún no se conoce.
  final String portalId;

  /// Portal propio: todas sus direcciones conocidas, por preferencia (`server.urls`).
  final List<String> portalUrls;

  /// Portal propio: puertos para clientes (`client_ports` del ping).
  final List<int> clientPorts;

  const Profile({
    required this.id,
    required this.name,
    required this.type,
    this.serverUrl = '',
    this.username = '',
    this.password = '',
    this.m3uUrl = '',
    this.filePath = '',
    this.fileName = '',
    this.createdAt = 0,
    this.portalId = '',
    this.portalUrls = const [],
    this.clientPorts = const [],
  });

  bool get isXtream => type == ProfileType.xtream;

  /// Datos para reencontrar el portal si cambia de dirección.
  PortalIdentity get portalIdentity => isXtream
      ? PortalIdentity(id: portalId, urls: portalUrls, clientPorts: clientPorts)
      : const PortalIdentity();

  String get subtitle {
    switch (type) {
      case ProfileType.xtream:
        return '$username · ${Uri.tryParse(serverUrl)?.host ?? serverUrl}';
      case ProfileType.m3uUrl:
        return Uri.tryParse(m3uUrl)?.host ?? m3uUrl;
      case ProfileType.m3uFile:
        return fileName.isNotEmpty ? fileName : 'Archivo local';
    }
  }

  Profile copyWith({
    String? name,
    ProfileType? type,
    String? serverUrl,
    String? username,
    String? password,
    String? m3uUrl,
    String? filePath,
    String? fileName,
    String? portalId,
    List<String>? portalUrls,
    List<int>? clientPorts,
  }) {
    return Profile(
      id: id,
      name: name ?? this.name,
      type: type ?? this.type,
      serverUrl: serverUrl ?? this.serverUrl,
      username: username ?? this.username,
      password: password ?? this.password,
      m3uUrl: m3uUrl ?? this.m3uUrl,
      filePath: filePath ?? this.filePath,
      fileName: fileName ?? this.fileName,
      createdAt: createdAt,
      portalId: portalId ?? this.portalId,
      portalUrls: portalUrls ?? this.portalUrls,
      clientPorts: clientPorts ?? this.clientPorts,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'type': type.name,
        'serverUrl': serverUrl,
        'username': username,
        'password': password,
        'm3uUrl': m3uUrl,
        'filePath': filePath,
        'fileName': fileName,
        'createdAt': createdAt,
        if (portalId.isNotEmpty) 'portalId': portalId,
        if (portalUrls.isNotEmpty) 'portalUrls': portalUrls,
        if (clientPorts.isNotEmpty) 'clientPorts': clientPorts,
      };

  factory Profile.fromJson(Map<String, dynamic> j) {
    final typeName = str(j['type']);
    return Profile(
      id: str(j['id']),
      name: str(j['name']),
      type: ProfileType.values.firstWhere(
        (t) => t.name == typeName,
        orElse: () => ProfileType.xtream,
      ),
      serverUrl: str(j['serverUrl']),
      username: str(j['username']),
      password: str(j['password']),
      m3uUrl: str(j['m3uUrl']),
      filePath: str(j['filePath']),
      fileName: str(j['fileName']),
      createdAt: asInt(j['createdAt']) ?? 0,
      portalId: str(j['portalId']),
      portalUrls: asStringList(j['portalUrls']),
      clientPorts: [
        for (final p in asList(j['clientPorts']))
          if (asInt(p) case final n? when n > 0 && n < 65536) n,
      ],
    );
  }
}
