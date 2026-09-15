import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/media_item.dart';
import '../providers/session_provider.dart';
import '../theme.dart';
import 'common.dart';

/// "Ahora: … / Después: …" con barra de progreso (carga perezosa y en caché).
class EpgNowNext extends StatefulWidget {
  final MediaItem item;
  final bool showNext;
  final bool large;

  const EpgNowNext({
    super.key,
    required this.item,
    this.showNext = true,
    this.large = false,
  });

  @override
  State<EpgNowNext> createState() => _EpgNowNextState();
}

class _EpgNowNextState extends State<EpgNowNext> {
  NowNext _data = NowNext.empty;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant EpgNowNext oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.item.key != widget.item.key) {
      _data = NowNext.empty;
      _load();
    }
  }

  void _load() {
    final epg = context.read<SessionProvider>().epg;
    if (epg == null || !epg.enabled || widget.item.type != ContentType.live) {
      return;
    }
    final cached = epg.peek(widget.item);
    if (cached != null) {
      _data = cached;
      return;
    }
    final item = widget.item;
    epg.shortEpg(item).then((list) {
      if (!mounted || widget.item.key != item.key) return;
      setState(() => _data = NowNext.from(list, DateTime.now()));
    });
  }

  @override
  Widget build(BuildContext context) {
    final now = _data.now;
    final next = _data.next;
    if (now == null && next == null) return const SizedBox.shrink();
    final fs = widget.large ? 14.0 : 12.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (now != null) ...[
          Text.rich(
            TextSpan(children: [
              TextSpan(
                  text: 'Ahora: ',
                  style: TextStyle(
                      color: AppColors.accent,
                      fontWeight: FontWeight.w700,
                      fontSize: fs)),
              TextSpan(text: now.title, style: TextStyle(fontSize: fs)),
              if (widget.large && now.start != null && now.end != null)
                TextSpan(
                    text:
                        '  ${formatTime(now.start!)} - ${formatTime(now.end!)}',
                    style: TextStyle(
                        fontSize: fs - 1, color: AppColors.textSecondary)),
            ]),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 3),
          ClipRRect(
            borderRadius: BorderRadius.circular(2),
            child: LinearProgressIndicator(
              value: now.progressAt(DateTime.now()),
              minHeight: widget.large ? 4 : 3,
              backgroundColor: AppColors.surfaceHighest,
              color: AppColors.accent,
            ),
          ),
        ],
        if (widget.showNext && next != null) ...[
          const SizedBox(height: 3),
          Text.rich(
            TextSpan(children: [
              TextSpan(
                  text: 'Después: ',
                  style: TextStyle(
                      color: AppColors.textSecondary,
                      fontWeight: FontWeight.w700,
                      fontSize: fs)),
              TextSpan(
                  text: next.title,
                  style:
                      TextStyle(fontSize: fs, color: AppColors.textSecondary)),
              if (widget.large && next.start != null)
                TextSpan(
                    text: '  ${formatTime(next.start!)}',
                    style: TextStyle(
                        fontSize: fs - 1, color: AppColors.textMuted)),
            ]),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ],
    );
  }
}

/// Programas del día de hoy (a partir de la guía completa).
List<EpgEntry> todayPrograms(List<EpgEntry> all, DateTime now) {
  final startOfDay = DateTime(now.year, now.month, now.day);
  final endOfDay = startOfDay.add(const Duration(days: 1));
  return all.where((e) {
    final s = e.start;
    final en = e.end ?? s;
    if (s == null) return false;
    return s.isBefore(endOfDay) && (en ?? s).isAfter(startOfDay);
  }).toList();
}

/// Hoja inferior con la guía de hoy del canal.
Future<void> showEpgSheet(BuildContext context, MediaItem item) {
  final epg = context.read<SessionProvider>().epg;
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: AppColors.surface,
    isScrollControlled: true,
    showDragHandle: true,
    constraints: const BoxConstraints(maxWidth: 720),
    builder: (ctx) => SizedBox(
      height: MediaQuery.sizeOf(ctx).height * 0.75,
      child: FutureBuilder<List<EpgEntry>>(
        future: epg?.fullEpg(item) ?? Future.value(const []),
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const LoadingView(message: 'Cargando guía…');
          }
          if (snap.hasError) {
            return const EmptyView(
                message: 'No se pudo cargar la guía.',
                icon: Icons.event_busy_outlined);
          }
          final now = DateTime.now();
          final list = todayPrograms(snap.data ?? const [], now);
          if (list.isEmpty) {
            return const EmptyView(
                message: 'Este canal no tiene guía para hoy.',
                icon: Icons.event_busy_outlined);
          }
          final currentIndex = list.indexWhere((e) => e.isNowAt(now));
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
                child: Text('Guía de hoy · ${item.name}',
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w700)),
              ),
              Expanded(
                child: ListView.builder(
                  controller: ScrollController(
                      initialScrollOffset: currentIndex > 1
                          ? (currentIndex - 1) * 72.0
                          : 0),
                  itemCount: list.length,
                  itemBuilder: (context, i) {
                    final e = list[i];
                    final isNow = i == currentIndex;
                    final past = e.end != null && e.end!.isBefore(now);
                    return Container(
                      constraints: const BoxConstraints(minHeight: 72),
                      color: isNow ? AppColors.accentSoft : null,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 20, vertical: 10),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            width: 56,
                            child: Text(
                              e.start != null ? formatTime(e.start!) : '',
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                color: past
                                    ? AppColors.textMuted
                                    : AppColors.text,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(e.title,
                                    style: TextStyle(
                                      fontWeight: isNow
                                          ? FontWeight.w700
                                          : FontWeight.w500,
                                      color: past
                                          ? AppColors.textMuted
                                          : AppColors.text,
                                    )),
                                if (e.description.isNotEmpty)
                                  Text(e.description,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                          fontSize: 12.5,
                                          color: AppColors.textSecondary)),
                                if (isNow) ...[
                                  const SizedBox(height: 6),
                                  LinearProgressIndicator(
                                    value: e.progressAt(now),
                                    minHeight: 3,
                                    backgroundColor: AppColors.surfaceHighest,
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          );
        },
      ),
    ),
  );
}
