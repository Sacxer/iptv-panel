import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/media_item.dart';
import '../providers/library_provider.dart';
import '../providers/session_provider.dart';
import '../services/api_exception.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/server_search_button.dart';
import '../widgets/epg_widgets.dart';
import '../widgets/focusable_card.dart';
import '../widgets/media_cards.dart';
import 'navigation.dart';

/// Pide a TV en vivo mostrar y enfocar un canal (p. ej. al volver del reproductor).
class ChannelFocusRequest extends ChangeNotifier {
  String? channelKey;

  void request(String key) {
    channelKey = key;
    notifyListeners();
  }
}

/// TV en vivo: categorías + canales (con EPG ahora/después) + panel de información.
class LiveScreen extends StatefulWidget {
  /// Canal a enfocar cuando se pida (opcional).
  final ChannelFocusRequest? focusRequest;

  const LiveScreen({super.key, this.focusRequest});

  @override
  State<LiveScreen> createState() => _LiveScreenState();
}

class _LiveScreenState extends State<LiveScreen> {
  bool _loading = true;
  String? _error;
  bool _errorCanRelocate = false;
  List<MediaItem> _all = [];
  List<MediaCategory> _cats = [];
  String _selectedCat = MediaCategory.allId;
  List<MediaItem> _filtered = [];
  MediaItem? _focused;
  Timer? _catDebounce;

  // Canal pedido por [LiveScreen.focusRequest]: la fila [_requestIndex] de la categoría
  // [_requestCat] usa [_requestNode].
  final ScrollController _scroll = ScrollController();
  final FocusNode _requestNode = FocusNode(debugLabel: 'live_requested');
  String? _pendingKey;
  String? _requestCat;
  int? _requestIndex;

  @override
  void initState() {
    super.initState();
    widget.focusRequest?.addListener(_onFocusRequest);
    _load();
  }

  @override
  void didUpdateWidget(LiveScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.focusRequest != widget.focusRequest) {
      oldWidget.focusRequest?.removeListener(_onFocusRequest);
      widget.focusRequest?.addListener(_onFocusRequest);
    }
  }

  @override
  void dispose() {
    widget.focusRequest?.removeListener(_onFocusRequest);
    _catDebounce?.cancel();
    _scroll.dispose();
    _requestNode.dispose();
    super.dispose();
  }

  void _onFocusRequest() {
    final key = widget.focusRequest?.channelKey;
    if (key == null || !mounted) return;
    _pendingKey = key;
    _applyFocusRequest();
  }

  /// Muestra el canal pedido en la lista (en "Todos" si no está en la categoría) y lo enfoca.
  void _applyFocusRequest() {
    final key = _pendingKey;
    if (key == null || _loading || _error != null) return;
    var index = _filtered.indexWhere((c) => c.key == key);
    if (index < 0 && _selectedCat != MediaCategory.allId) {
      final all = filterByCategory(_all, MediaCategory.allId);
      index = all.indexWhere((c) => c.key == key);
      if (index >= 0) {
        _selectedCat = MediaCategory.allId;
        _filtered = all;
      }
    }
    if (index < 0) {
      _pendingKey = null;
      return;
    }
    setState(() {
      _requestCat = _selectedCat;
      _requestIndex = index;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (_scroll.hasClients) {
        final target = (index - 2) * _rowExtent;
        _scroll.jumpTo(
            target.clamp(0.0, _scroll.position.maxScrollExtent).toDouble());
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _pendingKey != key) return;
        _pendingKey = null;
        if (_requestNode.context != null) _requestNode.requestFocus();
      });
    });
  }

  static const double _rowExtent = 78;

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
      final items = await source.items(ContentType.live);
      final cats = await source.categories(ContentType.live);
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
      if (_pendingKey != null) _applyFocusRequest();
    } catch (e) {
      if (!mounted) return;
      if (refresh) {
        showSnack(context, ApiException.from(e).message);
        return;
      }
      setState(() {
        _error = ApiException.from(e).message;
        _errorCanRelocate = ApiException.from(e).canRelocate;
        _loading = false;
      });
    }
  }

  void _selectCategory(MediaCategory c) {
    if (c.id == _selectedCat) return;
    setState(() {
      _selectedCat = c.id;
      _filtered = filterByCategory(_all, c.id);
    });
  }

  void _play(int index) => playItems(context, _filtered, index);

  Widget _channelList({required bool wide}) {
    return RefreshIndicator(
      onRefresh: () => _load(refresh: true),
      child: _filtered.isEmpty
          ? ListView(children: const [
              SizedBox(height: 120),
              EmptyView(message: 'Esta categoría no tiene canales.'),
            ])
          : ListView.builder(
              key: PageStorageKey('live_$_selectedCat'),
              controller: _scroll,
              physics: const AlwaysScrollableScrollPhysics(),
              padding: EdgeInsets.all(wide ? 10 : 6),
              itemCount: _filtered.length,
              itemExtent: _rowExtent,
              itemBuilder: (context, i) {
                final item = _filtered[i];
                return ChannelTile(
                  item: item,
                  focusNode:
                      (_requestCat == _selectedCat && _requestIndex == i)
                          ? _requestNode
                          : null,
                  onFocus: wide ? () => setState(() => _focused = item) : null,
                  onTap: () => _play(i),
                  onLongPress: () => toggleFavoriteWithSnack(context, item),
                );
              },
            ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingView(message: 'Cargando canales…');
    if (_error != null) {
      return ErrorView(
        message: _error!,
        onRetry: _load,
        secondary: _errorCanRelocate ? ServerSearchButton(onFound: _load) : null,
      );
    }
    if (_all.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => _load(refresh: true),
        child: ListView(children: const [
          SizedBox(height: 120),
          EmptyView(
              message: 'No hay canales disponibles.',
              icon: Icons.tv_off_outlined),
        ]),
      );
    }
    final wide = Responsive.isWide(context);
    if (!wide) {
      return Column(
        children: [
          SizedBox(
            height: 56,
            child: ListView.separated(
              key: const PageStorageKey('live_cats'),
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              itemCount: _cats.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final c = _cats[i];
                return TvChip(
                  label: c.count > 0 ? '${c.name} (${c.count})' : c.name,
                  selected: c.id == _selectedCat,
                  onTap: () => _selectCategory(c),
                );
              },
            ),
          ),
          Expanded(child: _channelList(wide: false)),
        ],
      );
    }
    return LayoutBuilder(builder: (context, constraints) {
      final showInfo = constraints.maxWidth >= 780;
      return Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: constraints.maxWidth >= 1000 ? 250 : 210,
            child: FocusTraversalGroup(
              child: CategoryListView(
                categories: _cats,
                selectedId: _selectedCat,
                onFocus: (c) {
                  _catDebounce?.cancel();
                  _catDebounce = Timer(const Duration(milliseconds: 350),
                      () => _selectCategory(c));
                },
                onSelect: (c) {
                  _catDebounce?.cancel();
                  _selectCategory(c);
                  FocusScope.of(context)
                      .focusInDirection(TraversalDirection.right);
                },
              ),
            ),
          ),
          const VerticalDivider(width: 1, color: AppColors.surfaceHigh),
          Expanded(child: FocusTraversalGroup(child: _channelList(wide: true))),
          if (showInfo)
            SizedBox(
              width: constraints.maxWidth >= 1100 ? 320 : 270,
              child: _InfoPanel(item: _focused),
            ),
        ],
      );
    });
  }
}

/// Fila de canal con logo, nombre y EPG ahora/después.
class ChannelTile extends StatelessWidget {
  final MediaItem item;
  final VoidCallback? onFocus;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  final bool autofocus;
  final bool highlighted;
  final FocusNode? focusNode;

  const ChannelTile({
    super.key,
    required this.item,
    required this.onTap,
    this.autofocus = false,
    this.highlighted = false,
    this.onFocus,
    this.onLongPress,
    this.focusNode,
  });

  @override
  Widget build(BuildContext context) {
    final fav =
        context.select<LibraryProvider, bool>((l) => l.isFavorite(item));
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 4),
      child: FocusableCard(
        onTap: onTap,
        onLongPress: onLongPress,
        autofocus: autofocus,
        focusNode: focusNode,
        selected: highlighted,
        onFocusChange: (f) {
          if (f) onFocus?.call();
        },
        focusScale: 1.02,
        color: AppColors.surface,
        borderRadius: 10,
        semanticLabel: item.name,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        child: Row(
          children: [
            if (item.num != null)
              SizedBox(
                width: 36,
                child: Text(
                  '${item.num}',
                  style:
                      const TextStyle(color: AppColors.textMuted, fontSize: 12),
                ),
              ),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Container(
                width: 60,
                height: 44,
                color: AppColors.surfaceHigh,
                padding: const EdgeInsets.all(3),
                child: NetImage(
                  url: item.logo,
                  fit: BoxFit.contain,
                  memCacheWidth: 160,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  EpgNowNext(item: item),
                ],
              ),
            ),
            if (fav)
              const Padding(
                padding: EdgeInsets.only(left: 6),
                child: Icon(Icons.favorite, size: 16, color: AppColors.danger),
              ),
          ],
        ),
      ),
    );
  }
}

class _InfoPanel extends StatelessWidget {
  final MediaItem? item;

  const _InfoPanel({required this.item});

  @override
  Widget build(BuildContext context) {
    final it = item;
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.all(18),
      child: it == null
          ? const Center(
              child: Text(
                'Seleccione un canal para ver su información',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textMuted),
              ),
            )
          : SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    height: 130,
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceHigh,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    padding: const EdgeInsets.all(16),
                    child: NetImage(url: it.logo, fit: BoxFit.contain),
                  ),
                  const SizedBox(height: 14),
                  Text(it.name,
                      style: const TextStyle(
                          fontSize: 19, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.live,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text('EN VIVO',
                            style: TextStyle(
                                fontSize: 10, fontWeight: FontWeight.w800)),
                      ),
                      const SizedBox(width: 8),
                      if (it.num != null)
                        Text('Canal ${it.num}',
                            style: const TextStyle(
                                color: AppColors.textSecondary)),
                    ],
                  ),
                  if (it.categoryName != null) ...[
                    const SizedBox(height: 6),
                    Text(it.categoryName!,
                        style: const TextStyle(color: AppColors.textSecondary)),
                  ],
                  const SizedBox(height: 16),
                  EpgNowNext(key: ValueKey(it.key), item: it, large: true),
                  const SizedBox(height: 16),
                  const Text(
                    'OK: ver canal\nMantener OK: agregar/quitar de favoritos',
                    style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
    );
  }
}
