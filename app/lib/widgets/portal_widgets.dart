import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/portal_models.dart';
import '../providers/portal_provider.dart';
import '../theme.dart';
import 'common.dart';
import 'focusable_card.dart';

IconData messageKindIcon(MessageKind kind) {
  switch (kind) {
    case MessageKind.payment:
      return Icons.payments_outlined;
    case MessageKind.expiration:
      return Icons.event_busy_outlined;
    case MessageKind.maintenance:
      return Icons.construction_rounded;
    case MessageKind.promotion:
      return Icons.local_offer_outlined;
    case MessageKind.support:
      return Icons.support_agent_rounded;
    case MessageKind.general:
      return Icons.mail_outline_rounded;
  }
}

Color messageKindColor(MessageKind kind) {
  switch (kind) {
    case MessageKind.payment:
      return const Color(0xFF22C55E);
    case MessageKind.expiration:
      return AppColors.warning;
    case MessageKind.maintenance:
      return const Color(0xFFF97316);
    case MessageKind.promotion:
      return const Color(0xFFA855F7);
    case MessageKind.support:
      return const Color(0xFF06B6D4);
    case MessageKind.general:
      return AppColors.info;
  }
}

/// Barra superior del inicio: corte activo, carrusel de banners y cinta.
class PortalNoticesBar extends StatelessWidget {
  const PortalNoticesBar({super.key});

  @override
  Widget build(BuildContext context) {
    final portal = context.watch<PortalProvider>();
    if (!portal.enabled) return const SizedBox.shrink();
    final outage = portal.activeOutage;
    final banners = portal.notices(NoticeDisplay.banner);
    final tickers = portal.notices(NoticeDisplay.ticker);
    if (outage == null && banners.isEmpty && tickers.isEmpty) {
      return const SizedBox.shrink();
    }
    final settings = portal.noticeSettings;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (outage != null) _OutageBanner(outage: outage),
        if (banners.isNotEmpty)
          settings.carousel && banners.length > 1
              ? NoticeCarousel(
                  notices: banners,
                  intervalSeconds: settings.intervalSeconds,
                  onClose: portal.dismissBanner,
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final n in banners.take(3))
                      NoticeBanner(
                          notice: n, onClose: () => portal.dismissBanner(n)),
                  ],
                ),
        if (tickers.isNotEmpty) NoticeTicker(notices: tickers),
      ],
    );
  }
}

class _OutageBanner extends StatelessWidget {
  final PortalOutage outage;
  const _OutageBanner({required this.outage});

  @override
  Widget build(BuildContext context) {
    final color = outage.blockPlayback ? AppColors.danger : AppColors.warning;
    final until = outage.endsAt != null
        ? ' · Hasta ${formatDateTime(outage.endsAt!)}'
        : '';
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.18),
        border: Border.all(color: color.withValues(alpha: 0.7)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(Icons.construction_rounded, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '${outage.title}${outage.reason.isNotEmpty ? ': ${outage.reason}' : ''}$until',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// Banner de un aviso, coloreado por nivel.
class NoticeBanner extends StatelessWidget {
  final PortalNotice notice;
  final VoidCallback? onClose;
  final double? height;
  const NoticeBanner({super.key, required this.notice, this.onClose, this.height});

  @override
  Widget build(BuildContext context) {
    final color = AppColors.forLevel(notice.level);
    return Container(
      width: double.infinity,
      height: height,
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.fromLTRB(14, 8, 6, 8),
      decoration: BoxDecoration(
        color: Color.alphaBlend(color.withValues(alpha: 0.16), AppColors.surface),
        border: Border(left: BorderSide(color: color, width: 4)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(AppColors.iconForLevel(notice.level), color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (notice.title.isNotEmpty)
                  Text(notice.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                if (notice.body.isNotEmpty)
                  Text(notice.body,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: AppColors.textSecondary, fontSize: 13)),
              ],
            ),
          ),
          if (onClose != null)
            TvIconButton(
              icon: Icons.close,
              tooltip: 'Cerrar aviso',
              size: 36,
              color: Colors.transparent,
              onPressed: onClose,
            ),
        ],
      ),
    );
  }
}

/// Carrusel de avisos tipo banner con puntos indicadores.
class NoticeCarousel extends StatefulWidget {
  final List<PortalNotice> notices;
  final int intervalSeconds;
  final void Function(PortalNotice)? onClose;

  const NoticeCarousel({
    super.key,
    required this.notices,
    required this.intervalSeconds,
    this.onClose,
  });

  @override
  State<NoticeCarousel> createState() => _NoticeCarouselState();
}

class _NoticeCarouselState extends State<NoticeCarousel> {
  final PageController _page = PageController();
  Timer? _timer;
  int _index = 0;

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  @override
  void didUpdateWidget(covariant NoticeCarousel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_index >= widget.notices.length) {
      _index = 0;
      if (_page.hasClients) _page.jumpToPage(0);
    }
    _schedule();
  }

  void _schedule() {
    _timer?.cancel();
    if (widget.notices.length < 2) return;
    final current = widget.notices[_index.clamp(0, widget.notices.length - 1)];
    final secs = current.durationSeconds ?? widget.intervalSeconds;
    _timer = Timer(Duration(seconds: secs.clamp(2, 600)), _next);
  }

  void _next() {
    if (!mounted || widget.notices.isEmpty) return;
    final next = (_index + 1) % widget.notices.length;
    if (_page.hasClients) {
      if (next == 0) {
        _page.jumpToPage(0);
      } else {
        _page.animateToPage(next,
            duration: const Duration(milliseconds: 450), curve: Curves.easeInOut);
      }
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _page.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final notices = widget.notices;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          height: 76,
          child: PageView.builder(
            controller: _page,
            itemCount: notices.length,
            onPageChanged: (i) {
              setState(() => _index = i);
              _schedule();
            },
            itemBuilder: (context, i) => NoticeBanner(
              notice: notices[i],
              height: 68,
              onClose: widget.onClose == null
                  ? null
                  : () => widget.onClose!(notices[i]),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var i = 0; i < notices.length; i++)
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: i == _index ? 16 : 6,
                height: 6,
                decoration: BoxDecoration(
                  color: i == _index
                      ? AppColors.forLevel(notices[i].level)
                      : AppColors.surfaceHighest,
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// Texto desplazándose horizontalmente (cinta).
class NoticeTicker extends StatefulWidget {
  final List<PortalNotice> notices;
  const NoticeTicker({super.key, required this.notices});

  @override
  State<NoticeTicker> createState() => _NoticeTickerState();
}

class _NoticeTickerState extends State<NoticeTicker>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: _duration())
      ..repeat();
  }

  String get _text => widget.notices
      .map((n) => [n.title, n.body].where((s) => s.isNotEmpty).join(': '))
      .join('     •     ');

  Duration _duration() =>
      Duration(milliseconds: (_text.length * 160).clamp(8000, 120000));

  @override
  void didUpdateWidget(covariant NoticeTicker oldWidget) {
    super.didUpdateWidget(oldWidget);
    final d = _duration();
    if (_controller.duration != d) {
      _controller
        ..duration = d
        ..repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    var level = NoticeLevel.info;
    for (final n in widget.notices) {
      if (n.level.index > level.index) level = n.level;
    }
    final color = AppColors.forLevel(level);
    const style = TextStyle(fontSize: 14, fontWeight: FontWeight.w600);
    final text = _text;
    return Container(
      height: 34,
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      decoration: BoxDecoration(
        color: Color.alphaBlend(color.withValues(alpha: 0.2), AppColors.surface),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Container(
            height: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              color: color,
              borderRadius:
                  const BorderRadius.horizontal(left: Radius.circular(8)),
            ),
            child: Icon(AppColors.iconForLevel(level), size: 18),
          ),
          Expanded(
            child: ClipRect(
              child: LayoutBuilder(builder: (context, constraints) {
                final painter = TextPainter(
                  text: TextSpan(text: text, style: style),
                  maxLines: 1,
                  textDirection: TextDirection.ltr,
                )..layout();
                final textWidth = painter.width;
                painter.dispose();
                final total = constraints.maxWidth + textWidth;
                return AnimatedBuilder(
                  animation: _controller,
                  builder: (context, child) {
                    final dx = constraints.maxWidth - _controller.value * total;
                    return Transform.translate(offset: Offset(dx, 0), child: child);
                  },
                  child: OverflowBox(
                    alignment: Alignment.centerLeft,
                    maxWidth: double.infinity,
                    child:
                        Text(text, maxLines: 1, style: style, softWrap: false),
                  ),
                );
              }),
            ),
          ),
        ],
      ),
    );
  }
}

/// Muestra mensajes y avisos popup pendientes, uno tras otro (una vez por id).
Future<void> showPendingPopups(BuildContext context) async {
  final portal = context.read<PortalProvider>();
  for (final m in portal.pendingPopupMessages()) {
    if (!context.mounted) return;
    await portal.markPopupMessageShown(m);
    if (!context.mounted) return;
    await showMessageDialog(context, m);
  }
  for (final n in portal.pendingPopupNotices()) {
    if (!context.mounted) return;
    await portal.markNoticeSeen(n);
    if (!context.mounted) return;
    final color = AppColors.forLevel(n.level);
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: color, width: 2),
        ),
        icon: Icon(AppColors.iconForLevel(n.level), color: color, size: 40),
        title: Text(n.title.isEmpty ? 'Aviso' : n.title),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: SingleChildScrollView(child: Text(n.body)),
        ),
        actions: [
          TvButton(
            label: 'Entendido',
            primary: true,
            autofocus: true,
            dense: true,
            onPressed: () => Navigator.of(ctx).pop(),
          ),
        ],
      ),
    );
  }
}

/// Diálogo con el contenido de un mensaje.
Future<void> showMessageDialog(BuildContext context, PortalMessage m) {
  final color = messageKindColor(m.kind);
  return showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: color.withValues(alpha: 0.8), width: 1.5),
      ),
      icon: Icon(messageKindIcon(m.kind), color: color, size: 40),
      title: Text(m.title.isEmpty ? m.kind.label : m.title),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '${m.kind.label}${m.createdAt != null ? ' · ${formatDateTime(m.createdAt!)}' : ''}',
                style: TextStyle(color: color, fontSize: 12.5),
              ),
              const SizedBox(height: 10),
              Text(m.body, style: const TextStyle(fontSize: 15, height: 1.4)),
            ],
          ),
        ),
      ),
      actions: [
        TvButton(
          label: 'Cerrar',
          primary: true,
          autofocus: true,
          dense: true,
          onPressed: () => Navigator.of(ctx).pop(),
        ),
      ],
    ),
  );
}

/// Pantalla de bloqueo (cuenta suspendida/vencida o corte de servicio).
class BlockedView extends StatelessWidget {
  final String title;
  final String message;
  final IconData icon;
  final Color color;
  final List<Widget> actions;
  final String footer;

  const BlockedView({
    super.key,
    required this.title,
    required this.message,
    this.icon = Icons.lock_outline,
    this.color = AppColors.danger,
    this.actions = const [],
    this.footer = 'Contacta a tu proveedor.',
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.background,
      alignment: Alignment.center,
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(28),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, size: 64, color: color),
                ),
                const SizedBox(height: 22),
                Text(title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        fontSize: 26, fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                Text(message,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        fontSize: 16,
                        color: AppColors.textSecondary,
                        height: 1.4)),
                if (footer.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  Text(footer,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w700)),
                ],
                if (actions.isNotEmpty) ...[
                  const SizedBox(height: 28),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    alignment: WrapAlignment.center,
                    children: actions,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Vista de corte / mantenimiento.
class OutageView extends StatelessWidget {
  final PortalOutage outage;
  final List<Widget> actions;

  const OutageView({super.key, required this.outage, this.actions = const []});

  @override
  Widget build(BuildContext context) {
    final lines = <String>[
      if (outage.title.isNotEmpty) outage.title,
      if (outage.reason.isNotEmpty) 'Motivo: ${outage.reason}',
      if (outage.endsAt != null)
        'Finaliza: ${formatDateTime(outage.endsAt!)}',
    ];
    return BlockedView(
      title: 'Servicio en corte/mantenimiento',
      message: lines.join('\n'),
      icon: Icons.construction_rounded,
      color: AppColors.warning,
      footer: 'Contacta a tu proveedor.',
      actions: actions,
    );
  }
}

/// Vista de cuenta bloqueada según el portal.
class AccountBlockedView extends StatelessWidget {
  final PortalUser user;
  final List<Widget> actions;

  const AccountBlockedView({super.key, required this.user, this.actions = const []});

  @override
  Widget build(BuildContext context) {
    final reason = user.suspensionReason;
    final lines = <String>[
      switch (user.status.toLowerCase()) {
        'expired' => 'Tu suscripción ha vencido.',
        'suspended' => 'Tu servicio está suspendido.',
        'disabled' => 'Tu cuenta está deshabilitada.',
        _ => 'Tu cuenta no está activa.',
      },
      if (reason != null && reason.isNotEmpty) 'Motivo: $reason',
      if (user.expDate != null) 'Vencimiento: ${formatDate(user.expDate!)}',
    ];
    return BlockedView(
      title: user.blockTitle,
      message: lines.join('\n'),
      actions: actions,
    );
  }
}
