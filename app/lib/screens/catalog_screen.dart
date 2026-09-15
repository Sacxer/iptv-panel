import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/media_item.dart';
import '../providers/session_provider.dart';
import '../services/api_exception.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/focusable_card.dart';
import '../widgets/media_cards.dart';
import 'navigation.dart';

/// Películas o Series: categorías + cuadrícula de pósters.
class CatalogScreen extends StatefulWidget {
  final ContentType type;
  const CatalogScreen({super.key, required this.type});

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  bool _loading = true;
  String? _error;
  List<MediaItem> _all = [];
  List<MediaCategory> _cats = [];
  String _selectedCat = MediaCategory.allId;
  List<MediaItem> _filtered = [];
  Timer? _debounce;

  bool get _isSeries => widget.type == ContentType.series;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load({bool refresh = false}) async {
    final session = context.read<SessionProvider>();
    if (session.source == null) return;
    if (!refresh) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      if (refresh) await session.refreshCatalog();
      final source = session.source!;
      final items = await source.items(widget.type);
      final cats = await source.categories(widget.type);
      if (!mounted) return;
      setState(() {
        _all = items;
        _cats = withAllCategory(cats, items.length);
        if (!_cats.any((c) => c.id == _selectedCat)) {
          _selectedCat = MediaCategory.allId;
        }
        _filtered = filterByCategory(items, _selectedCat);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      if (refresh) {
        showSnack(context, ApiException.from(e).message);
        return;
      }
      setState(() {
        _error = ApiException.from(e).message;
        _loading = false;
      });
    }
  }

  void _select(MediaCategory c) {
    if (c.id == _selectedCat) return;
    setState(() {
      _selectedCat = c.id;
      _filtered = filterByCategory(_all, c.id);
    });
  }

  Widget _grid() {
    if (_filtered.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => _load(refresh: true),
        child: ListView(children: const [
          SizedBox(height: 120),
          EmptyView(message: 'Esta categoría está vacía.'),
        ]),
      );
    }
    final narrow = MediaQuery.sizeOf(context).width < 500;
    return RefreshIndicator(
      onRefresh: () => _load(refresh: true),
      child: GridView.builder(
      key: PageStorageKey('${widget.type.name}_$_selectedCat'),
      physics: const AlwaysScrollableScrollPhysics(),
      padding: EdgeInsets.all(narrow ? 10 : 18),
      gridDelegate: narrow
          ? const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              childAspectRatio: 0.52,
              crossAxisSpacing: 10,
              mainAxisSpacing: 12,
            )
          : SliverGridDelegateWithMaxCrossAxisExtent(
              maxCrossAxisExtent: Responsive.posterMaxExtent(context),
              childAspectRatio: 0.56,
              crossAxisSpacing: 16,
              mainAxisSpacing: 18,
            ),
      itemCount: _filtered.length,
      itemBuilder: (context, i) {
        final item = _filtered[i];
        return PosterCard(
          item: item,
          onTap: () => openMediaItem(context, item, _filtered),
          onLongPress: () => toggleFavoriteWithSnack(context, item),
        );
      },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final label = _isSeries ? 'series' : 'películas';
    if (_loading) return LoadingView(message: 'Cargando $label…');
    if (_error != null) return ErrorView(message: _error!, onRetry: _load);
    if (_all.isEmpty) {
      return EmptyView(
        message: 'No hay $label disponibles.',
        icon: _isSeries ? Icons.video_library_outlined : Icons.movie_outlined,
      );
    }
    final wide = Responsive.isWide(context);
    if (wide) {
      return Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: MediaQuery.sizeOf(context).width >= 1200 ? 250 : 210,
            child: FocusTraversalGroup(
              child: CategoryListView(
                categories: _cats,
                selectedId: _selectedCat,
                onFocus: (c) {
                  _debounce?.cancel();
                  _debounce = Timer(
                      const Duration(milliseconds: 400), () => _select(c));
                },
                onSelect: (c) {
                  _debounce?.cancel();
                  _select(c);
                  FocusScope.of(context)
                      .focusInDirection(TraversalDirection.right);
                },
              ),
            ),
          ),
          const VerticalDivider(width: 1, color: AppColors.surfaceHigh),
          Expanded(child: FocusTraversalGroup(child: _grid())),
        ],
      );
    }
    return Column(
      children: [
        SizedBox(
          height: 56,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            itemCount: _cats.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (context, i) {
              final c = _cats[i];
              return TvChip(
                label: c.name,
                selected: c.id == _selectedCat,
                onTap: () => _select(c),
              );
            },
          ),
        ),
        Expanded(child: _grid()),
      ],
    );
  }
}
