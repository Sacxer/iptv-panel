import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme.dart';

/// Teclas que activan un elemento (OK del control remoto, Enter, etc.).
final Set<LogicalKeyboardKey> activateKeys = {
  LogicalKeyboardKey.select,
  LogicalKeyboardKey.enter,
  LogicalKeyboardKey.numpadEnter,
  LogicalKeyboardKey.gameButtonA,
  LogicalKeyboardKey.space,
};

/// Contenedor enfocable con resaltado visible (escala + borde), compatible con
/// control remoto (D-pad), teclado, ratón y táctil.
///
/// - OK / Enter / Select → [onTap].
/// - Mantener OK, tecla Menú o clic derecho → [onLongPress].
class FocusableCard extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final ValueChanged<bool>? onFocusChange;
  final bool autofocus;
  final FocusNode? focusNode;
  final double borderRadius;
  final double focusScale;
  final Color? color;
  final Color? focusedColor;
  final EdgeInsetsGeometry? padding;
  final bool selected;
  final bool ensureVisible;
  final double ensureVisibleAlignment;
  final String? semanticLabel;

  const FocusableCard({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.onFocusChange,
    this.autofocus = false,
    this.focusNode,
    this.borderRadius = 12,
    this.focusScale = 1.05,
    this.color,
    this.focusedColor,
    this.padding,
    this.selected = false,
    this.ensureVisible = true,
    this.ensureVisibleAlignment = 0.5,
    this.semanticLabel,
  });

  @override
  State<FocusableCard> createState() => _FocusableCardState();
}

class _FocusableCardState extends State<FocusableCard> {
  bool _focused = false;
  bool _hovered = false;
  bool _keyDown = false;
  bool _longPressFired = false;
  late bool _traditional;

  @override
  void initState() {
    super.initState();
    _traditional =
        FocusManager.instance.highlightMode == FocusHighlightMode.traditional;
    FocusManager.instance.addHighlightModeListener(_onHighlightMode);
  }

  @override
  void dispose() {
    FocusManager.instance.removeHighlightModeListener(_onHighlightMode);
    super.dispose();
  }

  void _onHighlightMode(FocusHighlightMode mode) {
    final t = mode == FocusHighlightMode.traditional;
    if (t != _traditional && mounted) setState(() => _traditional = t);
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.contextMenu ||
        key == LogicalKeyboardKey.gameButtonY) {
      if (event is KeyDownEvent && widget.onLongPress != null) {
        widget.onLongPress!();
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    }
    if (!activateKeys.contains(key)) return KeyEventResult.ignored;
    if (widget.onTap == null && widget.onLongPress == null) {
      return KeyEventResult.ignored;
    }
    if (event is KeyDownEvent) {
      _keyDown = true;
      _longPressFired = false;
      return KeyEventResult.handled;
    }
    if (event is KeyRepeatEvent) {
      if (_keyDown && !_longPressFired && widget.onLongPress != null) {
        _longPressFired = true;
        widget.onLongPress!();
      }
      return KeyEventResult.handled;
    }
    if (event is KeyUpEvent) {
      final shouldTap = _keyDown && !_longPressFired;
      _keyDown = false;
      _longPressFired = false;
      if (shouldTap) widget.onTap?.call();
      return shouldTap ? KeyEventResult.handled : KeyEventResult.ignored;
    }
    return KeyEventResult.ignored;
  }

  void _handleFocus(bool focused) {
    setState(() => _focused = focused);
    if (!focused) _keyDown = false;
    widget.onFocusChange?.call(focused);
    if (focused && widget.ensureVisible) {
      Scrollable.ensureVisible(
        context,
        alignment: widget.ensureVisibleAlignment,
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final showFocus = _focused && _traditional;
    final radius = BorderRadius.circular(widget.borderRadius);
    final baseColor = widget.color ?? AppColors.surface;
    final bg = showFocus
        ? (widget.focusedColor ?? AppColors.surfaceHighest)
        : widget.selected
            ? AppColors.accentSoft
            : _hovered
                ? Color.lerp(baseColor, Colors.white, 0.06)!
                : baseColor;
    final scale = showFocus ? widget.focusScale : (_hovered ? 1.02 : 1.0);

    return Semantics(
      button: widget.onTap != null,
      label: widget.semanticLabel,
      child: Focus(
        focusNode: widget.focusNode,
        autofocus: widget.autofocus,
        onFocusChange: _handleFocus,
        onKeyEvent: _onKey,
        child: MouseRegion(
          cursor: widget.onTap != null
              ? SystemMouseCursors.click
              : MouseCursor.defer,
          onEnter: (_) => setState(() => _hovered = true),
          onExit: (_) => setState(() => _hovered = false),
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: widget.onTap,
            onLongPress: widget.onLongPress,
            onSecondaryTap: widget.onLongPress,
            child: AnimatedScale(
              scale: scale,
              duration: const Duration(milliseconds: 140),
              curve: Curves.easeOut,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 140),
                padding: widget.padding,
                decoration: BoxDecoration(
                  color: bg,
                  borderRadius: radius,
                  border: Border.all(
                    color: showFocus ? AppColors.focus : Colors.transparent,
                    width: 2.5,
                  ),
                  boxShadow: showFocus
                      ? [
                          BoxShadow(
                            color: AppColors.accent.withValues(alpha: 0.35),
                            blurRadius: 18,
                            spreadRadius: 1,
                          ),
                        ]
                      : null,
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(
                      (widget.borderRadius - 2).clamp(0, 100).toDouble()),
                  child: widget.child,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Botón con icono y texto, enfocable.
class TvButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool primary;
  final bool autofocus;
  final FocusNode? focusNode;
  final bool danger;
  final bool dense;

  /// Ocupa todo el ancho disponible con el contenido centrado (botones en columna del teléfono).
  final bool expand;

  const TvButton({
    super.key,
    required this.label,
    this.icon,
    this.onPressed,
    this.primary = false,
    this.autofocus = false,
    this.focusNode,
    this.danger = false,
    this.dense = false,
    this.expand = false,
  });

  @override
  Widget build(BuildContext context) {
    final color = danger
        ? AppColors.danger.withValues(alpha: 0.85)
        : primary
            ? AppColors.accent
            : AppColors.surfaceHigh;
    final enabled = onPressed != null;
    return Opacity(
      opacity: enabled ? 1 : 0.5,
      child: FocusableCard(
        onTap: onPressed,
        autofocus: autofocus,
        focusNode: focusNode,
        color: color,
        focusedColor: danger
            ? AppColors.danger
            : primary
                ? const Color(0xFF6A9DFF)
                : AppColors.surfaceHighest,
        borderRadius: 10,
        ensureVisible: false,
        padding: EdgeInsets.symmetric(
            horizontal: dense ? 14 : 20, vertical: dense ? 8 : 12),
        child: Row(
          mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
          mainAxisAlignment:
              expand ? MainAxisAlignment.center : MainAxisAlignment.start,
          children: [
            if (icon != null) ...[
              Icon(icon, size: dense ? 18 : 20, color: AppColors.text),
              const SizedBox(width: 8),
            ],
            Flexible(
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: dense ? 13 : 15,
                  fontWeight: FontWeight.w600,
                  color: AppColors.text,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Botón circular de icono (reproductor, barras).
class TvIconButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final FocusNode? focusNode;
  final bool autofocus;
  final double size;
  final Color? color;
  final Widget? badge;

  const TvIconButton({
    super.key,
    required this.icon,
    required this.tooltip,
    this.onPressed,
    this.focusNode,
    this.autofocus = false,
    this.size = 48,
    this.color,
    this.badge,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: FocusableCard(
        onTap: onPressed,
        focusNode: focusNode,
        autofocus: autofocus,
        borderRadius: size / 2,
        focusScale: 1.12,
        ensureVisible: false,
        color: color ?? Colors.black.withValues(alpha: 0.35),
        semanticLabel: tooltip,
        child: SizedBox(
          width: size,
          height: size,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Icon(icon, size: size * 0.5, color: AppColors.text),
              if (badge != null) Positioned(top: 4, right: 4, child: badge!),
            ],
          ),
        ),
      ),
    );
  }
}

/// Chip seleccionable enfocable.
class TvChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final IconData? icon;
  final bool autofocus;
  final ValueChanged<bool>? onFocusChange;

  const TvChip({
    super.key,
    required this.label,
    this.selected = false,
    this.onTap,
    this.icon,
    this.autofocus = false,
    this.onFocusChange,
  });

  @override
  Widget build(BuildContext context) {
    return FocusableCard(
      onTap: onTap,
      selected: selected,
      autofocus: autofocus,
      onFocusChange: onFocusChange,
      borderRadius: 20,
      color: AppColors.surfaceHigh,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 16, color: AppColors.text),
            const SizedBox(width: 6),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: 14,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              color: selected ? AppColors.text : AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}
