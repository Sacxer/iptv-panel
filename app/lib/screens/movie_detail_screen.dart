import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/media_item.dart';
import '../providers/library_provider.dart';
import '../providers/session_provider.dart';
import '../services/api_exception.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/focusable_card.dart';
import 'navigation.dart';

/// Fondo con imagen difuminada y degradado para las pantallas de detalle.
class DetailBackdrop extends StatelessWidget {
  final String? image;
  final Widget child;
  const DetailBackdrop({super.key, required this.image, required this.child});

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        if (image != null)
          Opacity(
            opacity: 0.28,
            child: NetImage(url: image, memCacheWidth: 640),
          ),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [AppColors.background, Color(0xCC0A0E16), Color(0x990A0E16)],
            ),
          ),
        ),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.bottomCenter,
              end: Alignment.center,
              colors: [AppColors.background, Colors.transparent],
            ),
          ),
        ),
        child,
      ],
    );
  }
}

/// Chips de metadatos (año, duración, calificación, género).
class MetaRow extends StatelessWidget {
  final List<(IconData, String)> items;
  const MetaRow({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 14,
      runSpacing: 6,
      children: [
        for (final (icon, text) in items)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon,
                  size: 16,
                  color: icon == Icons.star_rounded
                      ? AppColors.star
                      : AppColors.textSecondary),
              const SizedBox(width: 4),
              Text(text, style: const TextStyle(color: AppColors.textSecondary)),
            ],
          ),
      ],
    );
  }
}

class MovieDetailScreen extends StatefulWidget {
  final MediaItem item;
  const MovieDetailScreen({super.key, required this.item});

  @override
  State<MovieDetailScreen> createState() => _MovieDetailScreenState();
}

class _MovieDetailScreenState extends State<MovieDetailScreen> {
  MovieDetail? _detail;
  String? _error;
  bool _loading = true;

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
      final d = await source.movieDetail(widget.item);
      if (!mounted) return;
      setState(() {
        _detail = d;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        // Si falla el detalle, se permite reproducir igualmente.
        _detail = MovieDetail(item: widget.item, image: widget.item.logo);
        _error = ApiException.from(e).message;
        _loading = false;
      });
    }
  }

  MediaItem get _playable {
    final d = _detail;
    final item = widget.item;
    if (d?.containerExtension == null ||
        d!.containerExtension == item.containerExtension) {
      return item;
    }
    return MediaItem(
      id: item.id,
      type: item.type,
      name: item.name,
      logo: item.logo,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      url: item.url,
      containerExtension: d.containerExtension,
      rating: item.rating,
    );
  }

  @override
  Widget build(BuildContext context) {
    final library = context.watch<LibraryProvider>();
    final item = widget.item;
    final fav = library.isFavorite(item);
    final resume = library.resumePosition(item);
    final d = _detail;
    final wide = MediaQuery.sizeOf(context).width >= 700;

    Widget body;
    if (_loading) {
      body = const LoadingView(message: 'Cargando información…');
    } else {
      final poster = ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: SizedBox(
          width: wide ? 230 : 160,
          height: wide ? 345 : 240,
          child: NetImage(
              url: d?.image ?? item.logo,
              placeholderIcon: Icons.movie_outlined,
              memCacheWidth: 460),
        ),
      );
      final info = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(item.name,
              style: TextStyle(
                  fontSize: wide ? 30 : 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          MetaRow(items: [
            if (d?.releaseDate != null) (Icons.calendar_today_outlined, d!.releaseDate!),
            if (d?.duration != null) (Icons.schedule, d!.duration!),
            if ((d?.rating ?? item.rating) != null)
              (Icons.star_rounded, (d?.rating ?? item.rating)!),
            if (d?.genre != null) (Icons.theaters_outlined, d!.genre!),
          ]),
          const SizedBox(height: 18),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              TvButton(
                label: 'Reproducir',
                icon: Icons.play_arrow_rounded,
                primary: true,
                autofocus: true,
                onPressed: () => playItems(context, [_playable], 0),
              ),
              if (resume > Duration.zero)
                TvButton(
                  label: 'Continuar (${formatDuration(resume)})',
                  icon: Icons.replay_rounded,
                  onPressed: () =>
                      playItems(context, [_playable], 0, start: resume),
                ),
              TvButton(
                label: fav ? 'Quitar de favoritos' : 'Agregar a favoritos',
                icon: fav ? Icons.favorite : Icons.favorite_border,
                onPressed: () => toggleFavoriteWithSnack(context, item),
              ),
            ],
          ),
          const SizedBox(height: 18),
          if (d?.plot != null)
            Text(d!.plot!,
                style: const TextStyle(
                    fontSize: 15, height: 1.45, color: AppColors.text)),
          if (d?.director != null) ...[
            const SizedBox(height: 12),
            Text('Director: ${d!.director}',
                style: const TextStyle(color: AppColors.textSecondary)),
          ],
          if (d?.cast != null) ...[
            const SizedBox(height: 6),
            Text('Reparto: ${d!.cast}',
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppColors.textSecondary)),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text('No se pudo cargar la información completa: $_error',
                style: const TextStyle(color: AppColors.warning, fontSize: 13)),
          ],
        ],
      );
      body = SingleChildScrollView(
        padding: EdgeInsets.all(wide ? 40 : 18),
        child: wide
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  poster,
                  const SizedBox(width: 36),
                  Expanded(child: info),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [Center(child: poster), const SizedBox(height: 18), info],
              ),
      );
    }

    return Scaffold(
      appBar: AppBar(backgroundColor: Colors.transparent),
      extendBodyBehindAppBar: true,
      body: DetailBackdrop(
        image: d?.backdrop ?? d?.image ?? item.logo,
        child: SafeArea(child: body),
      ),
    );
  }
}
