import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/media_item.dart';
import '../providers/library_provider.dart';
import '../providers/portal_provider.dart';
import '../providers/session_provider.dart';
import '../widgets/common.dart';
import 'movie_detail_screen.dart';
import 'player_screen.dart';
import 'profiles_screen.dart';
import 'series_detail_screen.dart';

/// Abre un ítem: reproduce canales/episodios o muestra el detalle.
void openMediaItem(BuildContext context, MediaItem item, List<MediaItem> list) {
  switch (item.type) {
    case ContentType.movie:
      Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => MovieDetailScreen(item: item)));
    case ContentType.series:
      Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => SeriesDetailScreen(item: item)));
    case ContentType.live:
      final lives = list.where((e) => e.type == ContentType.live).toList();
      final idx = lives.indexWhere((e) => e.key == item.key);
      playItems(context, lives.isEmpty ? [item] : lives, idx < 0 ? 0 : idx);
    case ContentType.episode:
      final eps = list
          .where((e) =>
              e.type == ContentType.episode && e.seriesId == item.seriesId)
          .toList();
      final idx = eps.indexWhere((e) => e.key == item.key);
      playItems(context, idx < 0 ? [item] : eps, idx < 0 ? 0 : idx);
  }
}

/// Abre el reproductor con una lista (para cambiar de canal/episodio).
Future<void> playItems(BuildContext context, List<MediaItem> items, int index,
    {Duration? start}) {
  return Navigator.of(context).push(MaterialPageRoute(
    builder: (_) => PlayerScreen(
      playlist: items,
      initialIndex: index,
      startPosition: start,
    ),
  ));
}

Future<void> toggleFavoriteWithSnack(BuildContext context, MediaItem item) async {
  final added = await context.read<LibraryProvider>().toggleFavorite(item);
  if (context.mounted) {
    showSnack(context,
        added ? 'Agregado a Favoritos: ${item.name}' : 'Quitado de Favoritos: ${item.name}');
  }
}

/// Cierra la sesión y vuelve a la selección de perfiles.
void switchProfile(BuildContext context) {
  final nav = Navigator.of(context);
  context.read<PortalProvider>().stop();
  context.read<LibraryProvider>().clear();
  context.read<SessionProvider>().logout();
  nav.pushAndRemoveUntil(
    MaterialPageRoute(builder: (_) => const ProfilesScreen()),
    (_) => false,
  );
}
