import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/auto_start.dart';
import '../services/storage.dart';
import '../theme.dart';
import 'focusable_card.dart';

/// Texto del permiso, igual en el aviso y en Cuenta.
const String autoStartPermissionMessage =
    'Para que la app se abra sola al encender el equipo, permita “Mostrar sobre otras apps”.';

/// Cuando el equipo no tiene la pantalla del permiso.
const String autoStartNoScreenMessage =
    'Este equipo no muestra ese permiso directamente: se abrirán los ajustes de la app para '
    'buscarlo. Algunos equipos no permiten que las apps se abran solas al encender.';

/// Abre el permiso y espera a que el usuario vuelva a la app.
Future<void> openAutoStartPermission() async {
  final opened = await AutoStart.openOverlaySettings();
  if (opened != OverlaySettingsScreen.none) await AutoStart.waitForReturn();
}

/// TV box con la versión portal y Android 10+ sin el permiso: la primera vez que se entra
/// (una sola vez por equipo) explica para qué es y ofrece abrir el ajuste.
Future<void> maybeAskAutoStartPermission(BuildContext context) async {
  if (!AutoStart.available) return;
  final storage = context.read<Storage>();
  if (storage.autoStartAsked) return;
  final status = await AutoStart.status();
  if (!context.mounted ||
      !shouldAskAutoStartPermission(status,
          alreadyAsked: storage.autoStartAsked)) {
    return;
  }
  await storage.setAutoStartAsked(true);
  if (!context.mounted) return;
  final allow = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      icon: const Icon(Icons.power_settings_new_rounded,
          color: AppColors.accent, size: 40),
      title: const Text('Abrir al encender el equipo'),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Text(status.hasOverlaySettings
            ? autoStartPermissionMessage
            : '$autoStartPermissionMessage\n\n$autoStartNoScreenMessage'),
      ),
      actions: [
        TvButton(
          label: 'Ahora no',
          dense: true,
          onPressed: () => Navigator.of(ctx).pop(false),
        ),
        TvButton(
          label: 'Permitir',
          icon: Icons.check_rounded,
          primary: true,
          autofocus: true,
          dense: true,
          onPressed: () => Navigator.of(ctx).pop(true),
        ),
      ],
    ),
  );
  if (allow == true) await openAutoStartPermission();
}
