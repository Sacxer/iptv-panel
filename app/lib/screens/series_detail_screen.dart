import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/media_item.dart';
import '../providers/library_provider.dart';
import '../providers/session_provider.dart';
import '../services/api_exception.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/server_search_button.dart';
import '../widgets/focusable_card.dart';
import 'movie_detail_screen.dart';
import 'navigation.dart';

/// Detalle de serie: información, temporadas y episodios.
class SeriesDetailScreen extends StatefulWidget {
  final MediaItem item;
  const SeriesDetailScreen({super.key, required this.item});

  @override
  State<SeriesDetailScreen> createState() => _SeriesDetailScreenState();
}

class _SeriesDetailScreenState extends State<SeriesDetailScreen> {
  SeriesDetail? _detail;
  String? _error;
  bool _errorCanRelocate = false;
  bool _loading = true;
  int? _season;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final source = context.read<SessionProvider>().source;
    if (source == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final d = await source.seriesDetail(widget.item);
      if (!mounted) return;
      setState(() {
        _detail = d;
        _season = d.seasonNumbers.isEmpty ? null : d.seasonNumbers.first;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = ApiException.from(e).message;
        _errorCanRelocate = ApiException.from(e).canRelocate;
        _loading = false;
      });
    }
  }

  List<MediaItem> get _episodes =>
      _season == null ? const [] : (_detail?.seasons[_season] ?? const []);

  void _playEpisode(int index) => playItems(context, _episodes, index);

  @override
  Widget build(BuildContext context) {
    final library = context.watch<LibraryProvider>();
    final item = widget.item;
    final fav = library.isFavorite(item);
    final d = _detail;
    final wide = MediaQuery.sizeOf(context).width >= 700;

    Widget body;
    if (_loading) {
      body = const LoadingView(message: 'Cargando temporadas…');
    } else if (_error != null) {
      body = ErrorView(
        message: _error!,
        onRetry: _load,
        secondary: _errorCanRelocate ? ServerSearchButton(onFound: _load) : null,
      );
    } else {
      final seasons = d!.seasonNumbers;
      final header = Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: wide ? 180 : 110,
              height: wide ? 270 : 165,
              child: NetImage(
                url: d.cover ?? item.logo,
                placeholderIcon: Icons.video_library_outlined,
                memCacheWidth: 360,
              ),
            ),
          ),
          SizedBox(width: wide ? 28 : 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.name,
                    style: TextStyle(
                        fontSize: wide ? 28 : 20,
                        fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                MetaRow(items: [
                  if (d.releaseDate != null)
                    (Icons.calendar_today_outlined, d.releaseDate!),
                  if (d.rating != null) (Icons.star_rounded, d.rating!),
                  if (d.genre != null) (Icons.theaters_outlined, d.genre!),
                  (Icons.layers_outlined,
                      '${seasons.length} temporada${seasons.length == 1 ? '' : 's'}'),
                ]),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    if (_episodes.isNotEmpty)
                      TvButton(
                        label: 'Reproducir T${_season ?? 1}',
                        icon: Icons.play_arrow_rounded,
                        primary: true,
                        autofocus: true,
                        dense: !wide,
                        onPressed: () => _playEpisode(0),
                      ),
                    TvButton(
                      label: fav ? 'En favoritos' : 'Favorito',
                      icon: fav ? Icons.favorite : Icons.favorite_border,
                      dense: !wide,
                      onPressed: () => toggleFavoriteWithSnack(context, item),
                    ),
                  ],
                ),
                if (wide && d.plot != null) ...[
                  const SizedBox(height: 14),
                  Text(d.plot!,
                      maxLines: 5,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(height: 1.4)),
                ],
              ],
            ),
          ),
        ],
      );

      body = CustomScrollView(
        slivers: [
          SliverPadding(
            padding: EdgeInsets.fromLTRB(wide ? 36 : 14, 8, wide ? 36 : 14, 8),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                header,
                if (!wide && d.plot != null) ...[
                  const SizedBox(height: 12),
                  Text(d.plot!,
                      maxLines: 6,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          height: 1.4, color: AppColors.textSecondary)),
                ],
                const SizedBox(height: 18),
                if (seasons.isEmpty)
                  const EmptyView(
                      message: 'Esta serie aún no tiene episodios.')
                else
                  SizedBox(
                    height: 48,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      clipBehavior: Clip.none,
                      itemCount: seasons.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 8),
                      itemBuilder: (context, i) => Center(
                        child: TvChip(
                          label: 'Temporada ${seasons[i]}',
                          selected: seasons[i] == _season,
                          onTap: () => setState(() => _season = seasons[i]),
                        ),
                      ),
                    ),
                  ),
                const SizedBox(height: 10),
              ]),
            ),
          ),
          SliverPadding(
            padding: EdgeInsets.fromLTRB(wide ? 36 : 10, 0, wide ? 36 : 10, 24),
            sliver: SliverList.builder(
              itemCount: _episodes.length,
              itemBuilder: (context, i) {
                final ep = _episodes[i];
                final resume = library.resumePosition(ep);
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: FocusableCard(
                    onTap: () => _playEpisode(i),
                    focusScale: 1.02,
                    padding: const EdgeInsets.all(10),
                    child: Row(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: SizedBox(
                            width: wide ? 160 : 110,
                            height: wide ? 90 : 62,
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                NetImage(
                                    url: ep.logo,
                                    placeholderIcon: Icons.play_circle_outline,
                                    memCacheWidth: 320),
                                const Center(
                                  child: Icon(Icons.play_circle_fill,
                                      color: Colors.white70, size: 30),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'E${ep.episodeNum ?? i + 1} · ${ep.name}',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w600, fontSize: 15),
                              ),
                              if (ep.plot != null) ...[
                                const SizedBox(height: 4),
                                Text(ep.plot!,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        fontSize: 12.5,
                                        color: AppColors.textSecondary)),
                              ],
                              if (resume > Duration.zero) ...[
                                const SizedBox(height: 4),
                                Text('Continuar desde ${formatDuration(resume)}',
                                    style: const TextStyle(
                                        fontSize: 12, color: AppColors.accent)),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      );
    }

    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: Text(item.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
      body: DetailBackdrop(
        image: d?.backdrop ?? d?.cover ?? item.logo,
        child: body,
      ),
    );
  }
}
