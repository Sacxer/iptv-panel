import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/media_item.dart';
import '../providers/library_provider.dart';
import '../widgets/common.dart';
import '../widgets/focusable_card.dart';
import '../widgets/media_cards.dart';
import 'navigation.dart';

/// Filas agrupadas por tipo de contenido.
class GroupedMediaRows extends StatelessWidget {
  final List<MediaItem> items;
  final void Function(MediaItem item)? onLongPress;
  final Widget? header;

  const GroupedMediaRows({
    super.key,
    required this.items,
    this.onLongPress,
    this.header,
  });

  @override
  Widget build(BuildContext context) {
    List<MediaItem> of(ContentType t) => items.where((e) => e.type == t).toList();
    final narrow = MediaQuery.sizeOf(context).width < 600;
    return ListView(
      padding: EdgeInsets.symmetric(horizontal: narrow ? 10 : 20, vertical: 8),
      children: [
        ?header,
        MediaRow(
          title: 'Canales',
          items: of(ContentType.live),
          onOpen: (i, l) => openMediaItem(context, i, l),
          onLongPress: onLongPress,
        ),
        MediaRow(
          title: 'Películas',
          items: of(ContentType.movie),
          onOpen: (i, l) => openMediaItem(context, i, l),
          onLongPress: onLongPress,
        ),
        MediaRow(
          title: 'Series',
          items: of(ContentType.series),
          onOpen: (i, l) => openMediaItem(context, i, l),
          onLongPress: onLongPress,
        ),
        MediaRow(
          title: 'Episodios',
          items: of(ContentType.episode),
          onOpen: (i, l) => openMediaItem(context, i, [i]),
          onLongPress: onLongPress,
        ),
        const SizedBox(height: 24),
      ],
    );
  }
}

class FavoritesScreen extends StatelessWidget {
  const FavoritesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final favorites = context.watch<LibraryProvider>().favorites;
    if (favorites.isEmpty) {
      return const EmptyView(
        icon: Icons.favorite_border_rounded,
        message:
            'Aún no tiene favoritos.\nMantenga presionado un canal, película o serie para agregarlo.',
      );
    }
    return GroupedMediaRows(
      items: favorites,
      header: const Padding(
        padding: EdgeInsets.fromLTRB(4, 8, 4, 0),
        child: Text('Mantenga presionado para quitar de favoritos.',
            style: TextStyle(fontSize: 12.5, color: Colors.white54)),
      ),
      onLongPress: (item) => toggleFavoriteWithSnack(context, item),
    );
  }
}

class RecentsScreen extends StatelessWidget {
  const RecentsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final library = context.watch<LibraryProvider>();
    final recents = library.recents;
    if (recents.isEmpty) {
      return const EmptyView(
        icon: Icons.history_rounded,
        message: 'Aquí aparecerá lo que haya visto recientemente.',
      );
    }
    return GroupedMediaRows(
      items: recents,
      header: Align(
        alignment: Alignment.centerLeft,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
          child: TvButton(
            label: 'Borrar historial',
            icon: Icons.delete_sweep_outlined,
            dense: true,
            onPressed: () async {
              final ok = await confirmDialog(
                context,
                title: 'Borrar historial',
                message: '¿Desea borrar la lista de vistos recientemente?',
                confirm: 'Borrar',
                danger: true,
              );
              if (ok) await library.clearRecents();
            },
          ),
        ),
      ),
      onLongPress: (item) async {
        await library.removeRecent(item);
        if (context.mounted) showSnack(context, 'Quitado de recientes');
      },
    );
  }
}

/// Envoltorio con AppBar para abrir Favoritos/Recientes desde "Más".
class StandalonePage extends StatelessWidget {
  final String title;
  final Widget child;
  const StandalonePage({super.key, required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: SafeArea(top: false, child: child),
    );
  }
}
