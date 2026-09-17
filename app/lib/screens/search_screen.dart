import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/media_item.dart';
import '../providers/session_provider.dart';
import '../services/content_sections.dart';
import '../services/device.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/media_cards.dart';
import 'navigation.dart';

/// Búsqueda global en canales, películas y series.
class SearchScreen extends StatefulWidget {
  final bool standalone;
  const SearchScreen({super.key, this.standalone = false});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _controller = TextEditingController();
  Timer? _debounce;
  bool _loadingCatalog = false;
  String? _catalogError;
  final Map<ContentType, List<MediaItem>> _catalog = {};
  Map<ContentType, List<MediaItem>> _results = {};
  String _query = '';

  /// Secciones que ve el cliente: solo se descarga y se busca en ellas.
  late ContentSections _sections;

  static const _limit = 80;

  @override
  void initState() {
    super.initState();
    _sections = readSections(context);
    _loadCatalog();
  }

  /// El portal cambió las secciones en plena sesión.
  void _onSectionsChanged(ContentSections sections) {
    if (sections == _sections) return;
    _sections = sections;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _catalog.removeWhere((type, _) => !_sections.allows(type));
      _search(_query);
      _loadCatalog();
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _loadCatalog() async {
    final source = context.read<SessionProvider>().source;
    if (source == null) return;
    // Solo las secciones visibles que aún no se cargaron.
    final types =
        _sections.types.where((t) => !_catalog.containsKey(t)).toList();
    if (types.isEmpty) return;
    setState(() {
      _loadingCatalog = true;
      _catalogError = null;
    });
    final errors = <String>[];
    await Future.wait(types.map((t) async {
      try {
        final items = await source.items(t);
        if (_sections.allows(t)) _catalog[t] = items;
      } catch (e) {
        errors.add(t.label);
      }
    }));
    if (!mounted) return;
    setState(() {
      _loadingCatalog = false;
      if (errors.isNotEmpty) {
        _catalogError = 'No se pudo cargar: ${errors.join(', ')}';
      }
    });
    if (_query.isNotEmpty) _search(_query);
  }

  void _onChanged(String text) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () => _search(text));
  }

  void _search(String text) {
    final results = searchCatalog(_catalog, text, _sections, limit: _limit);
    if (!mounted) return;
    setState(() {
      _query = text.trim();
      _results = results;
    });
  }

  @override
  Widget build(BuildContext context) {
    _onSectionsChanged(watchSections(context));
    final total = _results.values.fold<int>(0, (a, b) => a + b.length);
    final narrow = MediaQuery.sizeOf(context).width < 600;
    final content = Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(narrow ? 12 : 20, 12, narrow ? 12 : 20, 4),
          child: TvTextField(
            controller: _controller,
            label: 'Buscar ${_sections.describe()}',
            autofocus: !Device.isTv,
            textInputAction: TextInputAction.search,
            prefixIcon: const Icon(Icons.search),
            suffix: _controller.text.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Limpiar',
                    icon: const Icon(Icons.clear),
                    onPressed: () {
                      _controller.clear();
                      _search('');
                    },
                  ),
            onChanged: (t) {
              setState(() {});
              _onChanged(t);
            },
            onSubmitted: _search,
          ),
        ),
        if (_loadingCatalog)
          const Padding(
            padding: EdgeInsets.all(8),
            child: LinearProgressIndicator(),
          ),
        if (_catalogError != null)
          Padding(
            padding: const EdgeInsets.all(8),
            child: Text(_catalogError!,
                style: const TextStyle(color: AppColors.warning)),
          ),
        Expanded(
          child: _query.length < 2
              ? const EmptyView(
                  icon: Icons.manage_search_rounded,
                  message: 'Escriba al menos 2 letras para buscar.',
                )
              : total == 0
                  ? EmptyView(
                      icon: Icons.search_off_rounded,
                      message: _loadingCatalog
                          ? 'Buscando…'
                          : 'Sin resultados para "$_query".',
                    )
                  : ListView(
                      padding: EdgeInsets.symmetric(
                          horizontal: narrow ? 10 : 20, vertical: 4),
                      children: [
                        MediaRow(
                          title: 'Canales',
                          items: _results[ContentType.live] ?? const [],
                          onOpen: (i, l) => openMediaItem(context, i, l),
                        ),
                        MediaRow(
                          title: 'Películas',
                          items: _results[ContentType.movie] ?? const [],
                          onOpen: (i, l) => openMediaItem(context, i, l),
                        ),
                        MediaRow(
                          title: 'Series',
                          items: _results[ContentType.series] ?? const [],
                          onOpen: (i, l) => openMediaItem(context, i, l),
                        ),
                        const SizedBox(height: 24),
                      ],
                    ),
        ),
      ],
    );
    if (!widget.standalone) return content;
    return Scaffold(
      appBar: AppBar(title: const Text('Buscar')),
      body: SafeArea(top: false, child: content),
    );
  }
}
