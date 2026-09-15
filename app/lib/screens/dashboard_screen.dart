import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/media_item.dart';
import '../providers/library_provider.dart';
import '../providers/portal_provider.dart';
import '../providers/session_provider.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/focusable_card.dart';
import '../widgets/media_cards.dart';
import 'navigation.dart';

/// Inicio: accesos rápidos, recientes y favoritos.
class DashboardScreen extends StatelessWidget {
  /// Cambia de sección en el inicio (TV en vivo, Películas, Series, Mensajes…).
  final void Function(String section) onNavigate;

  const DashboardScreen({super.key, required this.onNavigate});

  @override
  Widget build(BuildContext context) {
    final library = context.watch<LibraryProvider>();
    final portal = context.watch<PortalProvider>();
    final session = context.watch<SessionProvider>();
    final source = session.source;
    final narrow = MediaQuery.sizeOf(context).width < 600;

    final recents = library.recents;
    final favs = library.favorites;
    final recentLive = recents.where((e) => e.type == ContentType.live).toList();
    final continueVod = recents.where((e) => e.isVod).toList();
    final favLive = favs.where((e) => e.type == ContentType.live).toList();
    final favMovies = favs.where((e) => e.type == ContentType.movie).toList();
    final favSeries = favs.where((e) => e.type == ContentType.series).toList();

    final user = portal.enabled ? portal.info?.user : null;
    final exp = user?.expDate ?? session.auth?.userInfo.expDate;
    final daysLeft = exp?.difference(DateTime.now()).inDays;

    final quick = <(IconData, String, String)>[
      (Icons.live_tv_rounded, 'TV en vivo', 'live'),
      if (source?.supportsMovies ?? false) (Icons.movie_outlined, 'Películas', 'movies'),
      if (source?.supportsSeries ?? false)
        (Icons.video_library_outlined, 'Series', 'series'),
      (Icons.search_rounded, 'Buscar', 'search'),
    ];

    return RefreshIndicator(
      onRefresh: portal.enabled ? portal.refresh : () async {},
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.symmetric(horizontal: narrow ? 12 : 24, vertical: 12),
        children: [
          Text(
            'Hola${session.profile != null ? ', ${session.profile!.name}' : ''}',
            style: TextStyle(
                fontSize: narrow ? 22 : 28, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 12),
          if (daysLeft != null && daysLeft <= 7)
            _InfoTile(
              icon: Icons.event_busy_outlined,
              color: daysLeft < 0 ? AppColors.danger : AppColors.warning,
              text: daysLeft < 0
                  ? 'Tu suscripción venció el ${formatDate(exp!)}.'
                  : daysLeft == 0
                      ? 'Tu suscripción vence hoy.'
                      : 'Tu suscripción vence en $daysLeft día${daysLeft == 1 ? '' : 's'} (${formatDate(exp!)}).',
              onTap: () => onNavigate('account'),
            ),
          if (portal.unreadCount > 0)
            _InfoTile(
              icon: Icons.mark_email_unread_outlined,
              color: AppColors.accent,
              text:
                  'Tienes ${portal.unreadCount} mensaje${portal.unreadCount == 1 ? '' : 's'} sin leer.',
              onTap: () => onNavigate('messages'),
            ),
          const SizedBox(height: 4),
          LayoutBuilder(builder: (context, c) {
            final cols = c.maxWidth < 420 ? 2 : 4;
            final w = (c.maxWidth - (cols - 1) * 10) / cols;
            return Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final (icon, label, key) in quick)
                  SizedBox(
                    width: w,
                    height: 78,
                    child: FocusableCard(
                      color: AppColors.surfaceHigh,
                      borderRadius: 14,
                      onTap: () => onNavigate(key),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(icon, color: AppColors.accent, size: 26),
                          const SizedBox(width: 10),
                          Flexible(
                            child: Text(label,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 15, fontWeight: FontWeight.w700)),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            );
          }),
          MediaRow(
            title: 'Canales vistos recientemente',
            items: recentLive.take(20).toList(),
            onOpen: (i, l) => openMediaItem(context, i, l),
          ),
          MediaRow(
            title: 'Continuar viendo',
            items: continueVod.take(20).toList(),
            onOpen: (i, l) => openMediaItem(context, i, [i]),
          ),
          MediaRow(
            title: 'Canales favoritos',
            items: favLive,
            onOpen: (i, l) => openMediaItem(context, i, l),
          ),
          MediaRow(
            title: 'Películas favoritas',
            items: favMovies,
            onOpen: (i, l) => openMediaItem(context, i, l),
          ),
          MediaRow(
            title: 'Series favoritas',
            items: favSeries,
            onOpen: (i, l) => openMediaItem(context, i, l),
          ),
          if (recents.isEmpty && favs.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 40),
              child: EmptyView(
                icon: Icons.tv_rounded,
                message:
                    'Empieza a ver canales, películas o series.\nTus recientes y favoritos aparecerán aquí.',
              ),
            ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String text;
  final VoidCallback onTap;

  const _InfoTile({
    required this.icon,
    required this.color,
    required this.text,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: FocusableCard(
        onTap: onTap,
        color: Color.alphaBlend(color.withValues(alpha: 0.15), AppColors.surface),
        focusScale: 1.02,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Icon(icon, color: color),
            const SizedBox(width: 12),
            Expanded(child: Text(text)),
            const Icon(Icons.chevron_right, color: AppColors.textSecondary),
          ],
        ),
      ),
    );
  }
}
