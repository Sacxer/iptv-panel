import 'package:flutter/material.dart';

import '../services/device.dart';
import '../services/server_discovery.dart';
import '../theme.dart';
import 'focusable_card.dart';

/// Busca el portal en la red local y deja elegir uno.
///
/// Devuelve la URL elegida (`http://IP:puerto`, o la de "Fuera de casa") o
/// `null` si se cancela. En teléfonos se muestra como hoja inferior y en TV /
/// pantallas anchas como diálogo; todo es enfocable con el control remoto.
Future<String?> showServerDiscovery(
  BuildContext context, {
  ServerDiscovery discovery = const ServerDiscovery(),
}) {
  final size = MediaQuery.sizeOf(context);
  final panel = ServerDiscoveryPanel(discovery: discovery);
  if (Device.isTv || size.width >= 600) {
    return showDialog<String>(
      context: context,
      builder: (_) => Dialog(
        child: ConstrainedBox(
          constraints:
              BoxConstraints(maxWidth: 560, maxHeight: size.height * 0.85),
          child: panel,
        ),
      ),
    );
  }
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: AppColors.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
    ),
    builder: (_) => ConstrainedBox(
      constraints: BoxConstraints(maxHeight: size.height * 0.85),
      child: panel,
    ),
  );
}

enum _Phase { searching, found, empty, noNetwork }

/// Contenido de la búsqueda (progreso, resultados o mensaje).
class ServerDiscoveryPanel extends StatefulWidget {
  final ServerDiscovery discovery;

  const ServerDiscoveryPanel({super.key, required this.discovery});

  @override
  State<ServerDiscoveryPanel> createState() => _ServerDiscoveryPanelState();
}

class _ServerDiscoveryPanelState extends State<ServerDiscoveryPanel> {
  _Phase _phase = _Phase.searching;
  List<DiscoveredServer> _servers = const [];
  List<LocalNetwork> _networks = const [];
  DiscoveryProgress? _progress;
  DiscoveredServer? _selected;
  DiscoveryCancelToken? _token;

  final _cancelFocus = FocusNode(debugLabel: 'discovery-cancel');
  final _useFocus = FocusNode(debugLabel: 'discovery-use');
  final _firstItemFocus = FocusNode(debugLabel: 'discovery-first');
  final _retryFocus = FocusNode(debugLabel: 'discovery-retry');

  @override
  void initState() {
    super.initState();
    _search();
  }

  @override
  void dispose() {
    _token?.cancel();
    for (final n in [_cancelFocus, _useFocus, _firstItemFocus, _retryFocus]) {
      n.dispose();
    }
    super.dispose();
  }

  Future<void> _search() async {
    _token?.cancel();
    final token = DiscoveryCancelToken();
    _token = token;
    if (_phase != _Phase.searching || _servers.isNotEmpty) {
      setState(() {
        _phase = _Phase.searching;
        _servers = const [];
        _selected = null;
        _progress = null;
      });
    }
    _focusLater(_cancelFocus);

    final result = await widget.discovery.discover(
      cancelToken: token,
      onUpdate: (servers) {
        if (mounted && !token.isCancelled) setState(() => _servers = servers);
      },
      onProgress: (progress) {
        if (mounted && !token.isCancelled) setState(() => _progress = progress);
      },
    );
    if (!mounted || token.isCancelled) return;
    setState(() {
      _servers = result.servers;
      _networks = result.networks;
      _selected = result.servers.length == 1 ? result.servers.first : null;
      _phase = result.noLocalNetwork
          ? _Phase.noNetwork
          : result.servers.isEmpty
              ? _Phase.empty
              : _Phase.found;
    });
    _focusLater(switch (_phase) {
      _Phase.found => _servers.length == 1 ? _useFocus : _firstItemFocus,
      _Phase.searching => _cancelFocus,
      _ => _retryFocus,
    });
  }

  FocusNode? _pendingFocus;

  /// Enfoca [node] cuando ya esté en pantalla (para el control remoto).
  void _focusLater(FocusNode node, [int attempts = 5]) {
    _pendingFocus = node;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _pendingFocus != node) return;
      if (node.context != null) {
        _pendingFocus = null;
        node.requestFocus();
      } else if (attempts > 0) {
        _focusLater(node, attempts - 1);
        WidgetsBinding.instance.scheduleFrame();
      }
    });
  }

  void _use(String url) {
    _token?.cancel();
    Navigator.of(context).pop(url);
  }

  void _close() {
    _token?.cancel();
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(),
          if (_servers.isNotEmpty) ...[
            const SizedBox(height: 16),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                padding: const EdgeInsets.all(4),
                itemCount: _servers.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (_, i) => _serverTile(_servers[i],
                    focusNode: i == 0 ? _firstItemFocus : null),
              ),
            ),
          ],
          if (_phase == _Phase.empty && _networks.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              'IP de este equipo: ${_networks.map((n) => n.address).join(', ')}',
              style: const TextStyle(fontSize: 12.5, color: AppColors.textMuted),
            ),
          ],
          const SizedBox(height: 18),
          Wrap(
            alignment: WrapAlignment.end,
            spacing: 10,
            runSpacing: 10,
            children: _actions(),
          ),
        ],
      ),
    );
  }

  Widget _header() {
    final (IconData? icon, String title, String message) = switch (_phase) {
      _Phase.searching => (
          null,
          'Buscando en la red Wi-Fi…',
          _servers.isNotEmpty
              ? 'Ya puedes elegir tu servidor mientras termina la búsqueda.'
              : _progress?.label ??
                  'Buscando el servidor en la red de este equipo. Tarda unos segundos.',
        ),
      _Phase.found => (
          Icons.wifi_find,
          _servers.length == 1
              ? 'Servidor encontrado'
              : 'Se encontraron ${_servers.length} servidores',
          _servers.length == 1
              ? 'Confirma que es tu servidor para usarlo.'
              : 'Elige tu servidor.',
        ),
      _Phase.empty => (
          Icons.search_off_rounded,
          'Sin resultados',
          'No se encontró el servidor. Comprueba que el equipo esté conectado '
              'a la misma red Wi-Fi que el servidor, o escribe la dirección '
              'que te dio tu proveedor.',
        ),
      _Phase.noNetwork => (
          Icons.signal_wifi_off_rounded,
          'Sin conexión Wi-Fi',
          'Este equipo no está conectado a una red Wi-Fi ni por cable (solo '
              'datos móviles o sin conexión). Conéctate a la misma red Wi-Fi '
              'que el servidor y vuelve a buscar, o escribe la dirección que '
              'te dio tu proveedor.',
        ),
    };
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 32,
          height: 32,
          child: icon == null
              ? const Padding(
                  padding: EdgeInsets.all(4),
                  child: CircularProgressIndicator(strokeWidth: 3),
                )
              : Icon(icon,
                  size: 30,
                  color: _phase == _Phase.found
                      ? AppColors.accent
                      : AppColors.textSecondary),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style: const TextStyle(
                      fontSize: 19, fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              Text(message,
                  style: const TextStyle(
                      fontSize: 14.5, color: AppColors.textSecondary)),
              if (_phase == _Phase.searching && _progress != null) ...[
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: _progress!.fraction,
                    minHeight: 6,
                    backgroundColor: AppColors.surfaceHigh,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  List<Widget> _actions() {
    switch (_phase) {
      case _Phase.searching:
        return [
          TvButton(
            label: 'Cancelar',
            icon: Icons.close,
            focusNode: _cancelFocus,
            onPressed: _close,
          ),
        ];
      case _Phase.found:
        final selected = _selected;
        return [
          TvButton(
            label: 'Buscar de nuevo',
            icon: Icons.refresh,
            focusNode: _retryFocus,
            onPressed: _search,
          ),
          TvButton(label: 'Cancelar', onPressed: _close),
          if (selected != null)
            TvButton(
              label: 'Usar este servidor',
              icon: Icons.check,
              primary: true,
              focusNode: _useFocus,
              onPressed: () => _use(selected.url),
            ),
        ];
      case _Phase.empty:
      case _Phase.noNetwork:
        return [
          TvButton(label: 'Cerrar', onPressed: _close),
          TvButton(
            label: 'Buscar de nuevo',
            icon: Icons.refresh,
            primary: true,
            focusNode: _retryFocus,
            onPressed: _search,
          ),
        ];
    }
  }

  Widget _serverTile(DiscoveredServer server, {FocusNode? focusNode}) {
    final selected = _selected != null && _selected!.url == server.url;
    final outside = server.outsideUrl;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FocusableCard(
          focusNode: focusNode,
          selected: selected,
          color: AppColors.surfaceHigh,
          focusScale: 1.02,
          padding: const EdgeInsets.all(14),
          semanticLabel: 'Usar ${server.name}, ${server.url}',
          onTap: () => _use(server.url),
          child: Row(
            children: [
              const Icon(Icons.dns_rounded, color: AppColors.accent, size: 28),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(server.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(server.url,
                        style: const TextStyle(
                            fontSize: 15, color: AppColors.text)),
                    if (server.version.isNotEmpty)
                      Text('Versión ${server.version}',
                          style: const TextStyle(
                              fontSize: 12.5, color: AppColors.textMuted)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                selected ? Icons.check_circle : Icons.chevron_right,
                color: selected ? AppColors.accent : AppColors.textMuted,
              ),
            ],
          ),
        ),
        if (outside != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 0, 2),
            child: Row(
              children: [
                const Icon(Icons.public,
                    size: 16, color: AppColors.textMuted),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Fuera de casa: $outside',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 13, color: AppColors.textSecondary),
                  ),
                ),
                const SizedBox(width: 8),
                TvButton(
                  label: 'Usar esta',
                  dense: true,
                  onPressed: () => _use(outside),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
