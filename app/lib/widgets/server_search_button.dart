import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/session_provider.dart';
import '../services/portal_relocator.dart';
import 'common.dart';
import 'focusable_card.dart';
import 'server_discovery_sheet.dart';

/// "Buscar servidor" junto a un error de conexión.
///
/// - Perfil del portal propio: busca el mismo portal (por su identificador) en sus otras
///   direcciones y en la red local, sin esperar los 20 s entre búsquedas.
/// - Otro servidor Xtream: abre la búsqueda en la red local y el usuario elige.
class ServerSearchButton extends StatefulWidget {
  /// Se llama cuando el servidor quedó en una dirección que responde (p. ej. para reintentar).
  final VoidCallback? onFound;
  final bool primary;
  final bool autofocus;

  const ServerSearchButton({
    super.key,
    this.onFound,
    this.primary = false,
    this.autofocus = false,
  });

  @override
  State<ServerSearchButton> createState() => _ServerSearchButtonState();
}

class _ServerSearchButtonState extends State<ServerSearchButton> {
  bool _busy = false;

  Future<void> _search() async {
    final session = context.read<SessionProvider>();
    final profile = session.profile;
    if (profile == null || !profile.isXtream) return;
    setState(() => _busy = true);
    try {
      if (session.canRelocateAutomatically) {
        final result = await session.relocateServer(manual: true);
        if (!mounted) return;
        switch (result.outcome) {
          case RelocationOutcome.found:
            widget.onFound?.call(); // el aviso "Servidor encontrado…" lo muestra la sesión
          case RelocationOutcome.currentWorks:
            showSnack(context, 'El servidor ya responde. Reintentando…');
            widget.onFound?.call();
          case RelocationOutcome.skipped:
            showSnack(context, 'Ya se está buscando el servidor. Espera un momento.');
          case RelocationOutcome.notFound:
          case RelocationOutcome.unknownPortal:
            showSnack(
              context,
              'No se encontró el servidor en sus otras direcciones ni en esta red. '
              'Comprueba que esté encendido y que estés en la misma red, o edita el perfil.',
            );
        }
        return;
      }
      final url = await showServerDiscovery(context);
      if (!mounted || url == null) return;
      await session.useServer(url);
      if (!mounted) return;
      showSnack(context, 'Servidor cambiado a $url');
      widget.onFound?.call();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return TvButton(
      label: _busy ? 'Buscando servidor…' : 'Buscar servidor',
      icon: Icons.wifi_find,
      primary: widget.primary,
      autofocus: widget.autofocus,
      onPressed: _busy ? null : _search,
    );
  }
}
