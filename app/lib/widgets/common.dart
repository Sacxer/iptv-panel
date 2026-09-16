import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/device.dart';
import '../theme.dart';
import 'focusable_card.dart';

/// Ayudas de diseño adaptable.
class Responsive {
  Responsive._();

  /// Pantalla grande (TV, escritorio, tablet horizontal): barra lateral.
  static bool isWide(BuildContext context) =>
      Device.isTv || MediaQuery.sizeOf(context).width >= 840;

  static bool isTv(BuildContext context) => Device.isTv;

  static double posterMaxExtent(BuildContext context) =>
      Device.isTv ? 150 : (MediaQuery.sizeOf(context).width < 500 ? 130 : 165);
}

/// Imagen de red en caché con marcador de posición.
class NetImage extends StatelessWidget {
  final String? url;
  final BoxFit fit;
  final IconData placeholderIcon;
  final double? width;
  final double? height;
  final int? memCacheWidth;

  const NetImage({
    super.key,
    required this.url,
    this.fit = BoxFit.cover,
    this.placeholderIcon = Icons.tv,
    this.width,
    this.height,
    this.memCacheWidth = 320,
  });

  Widget _placeholder() => Container(
        width: width,
        height: height,
        color: AppColors.surfaceHigh,
        alignment: Alignment.center,
        child: Icon(placeholderIcon, color: AppColors.textMuted, size: 28),
      );

  @override
  Widget build(BuildContext context) {
    final u = url;
    if (u == null || u.isEmpty || !(u.startsWith('http'))) {
      return _placeholder();
    }
    return CachedNetworkImage(
      imageUrl: u,
      fit: fit,
      width: width,
      height: height,
      memCacheWidth: memCacheWidth,
      fadeInDuration: const Duration(milliseconds: 150),
      placeholder: (_, _) => _placeholder(),
      errorWidget: (_, _, _) => _placeholder(),
    );
  }
}

/// Indicador de carga con mensaje.
class LoadingView extends StatelessWidget {
  final String message;
  const LoadingView({super.key, this.message = 'Cargando…'});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
              width: 42, height: 42, child: CircularProgressIndicator()),
          const SizedBox(height: 16),
          Text(message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textSecondary)),
        ],
      ),
    );
  }
}

/// Mensaje de error con botón Reintentar.
class ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  final String title;

  /// Acción adicional junto a "Reintentar" (p. ej. "Buscar servidor").
  final Widget? secondary;

  const ErrorView({
    super.key,
    required this.message,
    this.onRetry,
    this.title = 'Algo salió mal',
    this.secondary,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_rounded,
                  size: 56, color: AppColors.textMuted),
              const SizedBox(height: 12),
              Text(title,
                  style: const TextStyle(
                      fontSize: 20, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              Text(message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.textSecondary)),
              if (onRetry != null || secondary != null) ...[
                const SizedBox(height: 20),
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    if (onRetry != null)
                      TvButton(
                        label: 'Reintentar',
                        icon: Icons.refresh,
                        primary: true,
                        autofocus: true,
                        onPressed: onRetry,
                      ),
                    ?secondary,
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Estado vacío.
class EmptyView extends StatelessWidget {
  final String message;
  final IconData icon;
  final Widget? action;

  const EmptyView({
    super.key,
    required this.message,
    this.icon = Icons.inbox_outlined,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: AppColors.textMuted),
            const SizedBox(height: 12),
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 16)),
            if (action != null) ...[const SizedBox(height: 20), action!],
          ],
        ),
      ),
    );
  }
}

/// Campo de texto que permite salir con flechas arriba/abajo (D-pad).
class TvTextField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String? hint;
  final bool obscure;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;
  final FocusNode? focusNode;
  final Widget? prefixIcon;
  final Widget? suffix;
  final String? errorText;

  const TvTextField({
    super.key,
    required this.controller,
    required this.label,
    this.hint,
    this.obscure = false,
    this.keyboardType,
    this.textInputAction,
    this.onChanged,
    this.onSubmitted,
    this.autofocus = false,
    this.focusNode,
    this.prefixIcon,
    this.suffix,
    this.errorText,
  });

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: const <ShortcutActivator, Intent>{
        SingleActivator(LogicalKeyboardKey.arrowDown):
            DirectionalFocusIntent(TraversalDirection.down),
        SingleActivator(LogicalKeyboardKey.arrowUp):
            DirectionalFocusIntent(TraversalDirection.up),
      },
      child: TextField(
        controller: controller,
        focusNode: focusNode,
        autofocus: autofocus,
        obscureText: obscure,
        keyboardType: keyboardType,
        textInputAction: textInputAction ?? TextInputAction.next,
        onChanged: onChanged,
        onSubmitted: onSubmitted,
        autocorrect: false,
        enableSuggestions: !obscure,
        style: const TextStyle(fontSize: 16),
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          prefixIcon: prefixIcon,
          suffixIcon: suffix,
          errorText: errorText,
        ),
      ),
    );
  }
}

/// Encabezado de sección.
class SectionTitle extends StatelessWidget {
  final String title;
  final Widget? trailing;
  const SectionTitle(this.title, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 8, 4, 10),
      child: Row(
        children: [
          Expanded(
            child: Text(title,
                style: const TextStyle(
                    fontSize: 20, fontWeight: FontWeight.w700)),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

String two(int n) => n.toString().padLeft(2, '0');

String formatTime(DateTime d) => '${two(d.hour)}:${two(d.minute)}';

String formatDate(DateTime d) => '${two(d.day)}/${two(d.month)}/${d.year}';

String formatDateTime(DateTime d) => '${formatDate(d)} ${formatTime(d)}';

String formatDuration(Duration d) {
  final h = d.inHours;
  final m = d.inMinutes.remainder(60);
  final s = d.inSeconds.remainder(60);
  return h > 0 ? '$h:${two(m)}:${two(s)}' : '${two(m)}:${two(s)}';
}

void showSnack(BuildContext context, String message) {
  ScaffoldMessenger.maybeOf(context)
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

/// Diálogo de confirmación enfocable.
Future<bool> confirmDialog(
  BuildContext context, {
  required String title,
  required String message,
  String confirm = 'Aceptar',
  String cancel = 'Cancelar',
  bool danger = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TvButton(
          label: cancel,
          autofocus: true,
          dense: true,
          onPressed: () => Navigator.of(ctx).pop(false),
        ),
        TvButton(
          label: confirm,
          primary: !danger,
          danger: danger,
          dense: true,
          onPressed: () => Navigator.of(ctx).pop(true),
        ),
      ],
    ),
  );
  return result ?? false;
}
