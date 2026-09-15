import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/media_item.dart';
import '../providers/library_provider.dart';
import '../theme.dart';
import 'common.dart';
import 'focusable_card.dart';

/// Tarjeta tipo póster (películas / series).
class PosterCard extends StatelessWidget {
  final MediaItem item;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final bool autofocus;
  final ValueChanged<bool>? onFocusChange;

  const PosterCard({
    super.key,
    required this.item,
    this.onTap,
    this.onLongPress,
    this.autofocus = false,
    this.onFocusChange,
  });

  @override
  Widget build(BuildContext context) {
    final fav = context.select<LibraryProvider, bool>((l) => l.isFavorite(item));
    return FocusableCard(
      onTap: onTap,
      onLongPress: onLongPress,
      autofocus: autofocus,
      onFocusChange: onFocusChange,
      borderRadius: 10,
      focusScale: 1.07,
      semanticLabel: item.name,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                NetImage(
                  url: item.logo,
                  placeholderIcon: item.type == ContentType.series
                      ? Icons.video_library_outlined
                      : Icons.movie_outlined,
                ),
                if (item.rating != null)
                  Positioned(
                    top: 6,
                    left: 6,
                    child: _Badge(
                      icon: Icons.star_rounded,
                      text: item.rating!,
                      color: Colors.black.withValues(alpha: 0.7),
                      iconColor: AppColors.star,
                    ),
                  ),
                if (fav)
                  const Positioned(
                    top: 6,
                    right: 6,
                    child: Icon(Icons.favorite, color: AppColors.danger, size: 18),
                  ),
              ],
            ),
          ),
          Container(
            height: 42,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            alignment: Alignment.centerLeft,
            child: Text(
              item.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12.5, height: 1.15),
            ),
          ),
        ],
      ),
    );
  }
}

/// Tarjeta horizontal de canal (logo + nombre).
class ChannelCard extends StatelessWidget {
  final MediaItem item;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final double width;

  const ChannelCard({
    super.key,
    required this.item,
    this.onTap,
    this.onLongPress,
    this.width = 180,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: FocusableCard(
        onTap: onTap,
        onLongPress: onLongPress,
        borderRadius: 10,
        semanticLabel: item.name,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Container(
                color: AppColors.surfaceHigh,
                padding: const EdgeInsets.all(10),
                child: NetImage(url: item.logo, fit: BoxFit.contain),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Text(
                item.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final IconData? icon;
  final String text;
  final Color color;
  final Color iconColor;

  const _Badge({
    this.icon,
    required this.text,
    required this.color,
    this.iconColor = AppColors.text,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) Icon(icon, size: 13, color: iconColor),
          if (icon != null) const SizedBox(width: 2),
          Text(text,
              style:
                  const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

/// Fila horizontal con título (usada en Favoritos, Recientes, Buscar).
class MediaRow extends StatelessWidget {
  final String title;
  final List<MediaItem> items;
  final void Function(MediaItem item, List<MediaItem> list) onOpen;
  final void Function(MediaItem item)? onLongPress;

  const MediaRow({
    super.key,
    required this.title,
    required this.items,
    required this.onOpen,
    this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    final isChannelRow = items.first.type == ContentType.live ||
        items.first.type == ContentType.episode;
    final height = isChannelRow ? 130.0 : 230.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 12, 4, 8),
          child: Text('$title (${items.length})',
              style:
                  const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        ),
        SizedBox(
          height: height,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            clipBehavior: Clip.none,
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(width: 14),
            itemBuilder: (context, i) {
              final item = items[i];
              if (isChannelRow) {
                return ChannelCard(
                  item: item,
                  width: 190,
                  onTap: () => onOpen(item, items),
                  onLongPress:
                      onLongPress == null ? null : () => onLongPress!(item),
                );
              }
              return SizedBox(
                width: 140,
                child: PosterCard(
                  item: item,
                  onTap: () => onOpen(item, items),
                  onLongPress:
                      onLongPress == null ? null : () => onLongPress!(item),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

/// Lista vertical de categorías.
class CategoryListView extends StatelessWidget {
  final List<MediaCategory> categories;
  final String? selectedId;
  final ValueChanged<MediaCategory> onSelect;
  final ValueChanged<MediaCategory>? onFocus;
  final bool autofocusSelected;

  const CategoryListView({
    super.key,
    required this.categories,
    required this.selectedId,
    required this.onSelect,
    this.onFocus,
    this.autofocusSelected = false,
  });

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
      itemCount: categories.length,
      itemExtent: 52,
      itemBuilder: (context, i) {
        final c = categories[i];
        final selected = c.id == selectedId;
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: FocusableCard(
            selected: selected,
            autofocus: autofocusSelected && selected,
            color: Colors.transparent,
            focusScale: 1.03,
            borderRadius: 10,
            onTap: () => onSelect(c),
            onFocusChange: (f) {
              if (f) onFocus?.call(c);
            },
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    c.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                      color: selected ? AppColors.text : AppColors.textSecondary,
                    ),
                  ),
                ),
                if (c.count > 0)
                  Text('${c.count}',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.textMuted)),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Agrega la categoría "Todos" al inicio.
List<MediaCategory> withAllCategory(
    List<MediaCategory> cats, int totalCount) {
  return [
    MediaCategory(id: MediaCategory.allId, name: 'Todos', count: totalCount),
    ...cats.where((c) => c.count > 0 || totalCount == 0),
  ];
}

List<MediaItem> filterByCategory(List<MediaItem> items, String? categoryId) {
  if (categoryId == null || categoryId == MediaCategory.allId) return items;
  return items.where((i) => i.categoryId == categoryId).toList();
}
