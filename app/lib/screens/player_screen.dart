import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import 'package:provider/provider.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../constants.dart';
import '../models/media_item.dart';
import '../providers/library_provider.dart';
import '../providers/portal_provider.dart';
import '../providers/session_provider.dart';
import '../services/api_exception.dart';
import '../services/content_source.dart';
import '../services/device.dart';
import '../services/heartbeat.dart';
import '../services/playback_activity.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/epg_widgets.dart';
import '../widgets/focusable_card.dart';
import '../widgets/portal_widgets.dart';

class _AspectMode {
  final String label;
  final BoxFit fit;
  final double? ratio;
  const _AspectMode(this.label, this.fit, [this.ratio]);
}

const _aspectModes = [
  _AspectMode('Ajustar', BoxFit.contain),
  _AspectMode('Rellenar', BoxFit.cover),
  _AspectMode('16:9', BoxFit.contain, 16 / 9),
  _AspectMode('Estirar', BoxFit.fill),
  _AspectMode('4:3', BoxFit.contain, 4 / 3),
];

/// Reproductor a pantalla completa (en vivo y VOD).
class PlayerScreen extends StatefulWidget {
  final List<MediaItem> playlist;
  final int initialIndex;
  final Duration? startPosition;

  const PlayerScreen({
    super.key,
    required this.playlist,
    this.initialIndex = 0,
    this.startPosition,
  });

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen>
    with WidgetsBindingObserver {
  late final Player _player;
  late final VideoController _video;
  late final PortalProvider _portal;
  late final LibraryProvider _library;
  late final SessionProvider _session;
  PlaybackHeartbeat? _heartbeat;

  late int _index;
  Duration? _pendingStart;
  final List<StreamSubscription<dynamic>> _subs = [];

  final _position = ValueNotifier<Duration>(Duration.zero);
  final _duration = ValueNotifier<Duration>(Duration.zero);
  bool _playing = false;
  bool _buffering = true;
  bool _userPaused = false;
  DateTime? _bufferingSince;

  bool _overlay = true;
  bool _locked = false;
  int _aspect = 0;
  Timer? _hideTimer;
  DateTime _now = DateTime.now();
  Timer? _clockTimer;

  int _retries = 0;
  bool _reconnecting = false;
  String? _fatalError;
  String? _limitError;
  Timer? _retryTimer;
  Timer? _watchdog;
  Timer? _errorCheck;
  Timer? _bgTimer;
  bool _stoppedInBackground = false;
  DateTime _lastResumeSave = DateTime.now();

  String? _seekBubble;
  bool _seekBubbleRight = true;
  Timer? _seekBubbleTimer;
  Offset? _doubleTapPos;

  bool _wasWindowFullScreen = false;
  bool _wasBlocked = false;

  final FocusNode _rootFocus = FocusNode(debugLabel: 'player_root');
  final FocusNode _playFocus = FocusNode(debugLabel: 'player_play');

  MediaItem get _item => widget.playlist[_index];
  bool get _isLive => _item.type == ContentType.live;
  bool get _hasList => widget.playlist.length > 1;
  bool get _isBlocked =>
      _portal.blockingOutage != null || _portal.userBlocked;
  bool get _touchMode =>
      !Device.isTv &&
      FocusManager.instance.highlightMode == FocusHighlightMode.touch;

  @override
  void initState() {
    super.initState();
    _portal = context.read<PortalProvider>();
    _library = context.read<LibraryProvider>();
    _session = context.read<SessionProvider>();
    _index = widget.initialIndex.clamp(0, widget.playlist.length - 1);
    _pendingStart = widget.startPosition;
    if (_pendingStart == null && _item.type == ContentType.episode) {
      final r = _library.resumePosition(_item);
      if (r > Duration.zero) _pendingStart = r;
    }

    WidgetsBinding.instance.addObserver(this);
    PlaybackActivity.enter();
    WakelockPlus.enable().catchError((Object _) {});
    _enterFullscreen();

    _player = Player(
      configuration: const PlayerConfiguration(
        title: AppConfig.appName,
        bufferSize: 48 * 1024 * 1024,
      ),
    );
    final platform = _player.platform;
    if (platform is NativePlayer) {
      platform.setProperty('network-timeout', '20').catchError((Object _) {});
      platform.setProperty('user-agent', Device.userAgent).catchError((Object _) {});
    }
    _video = VideoController(_player);

    _subs.addAll([
      _player.stream.playing.listen((v) {
        if (mounted) setState(() => _playing = v);
      }),
      _player.stream.buffering.listen((v) {
        _bufferingSince = v ? DateTime.now() : null;
        if (mounted) setState(() => _buffering = v);
      }),
      _player.stream.position.listen(_onPosition),
      _player.stream.duration.listen((d) => _duration.value = d),
      _player.stream.error.listen(_onError),
      _player.stream.completed.listen(_onCompleted),
      _player.stream.tracks.listen((_) {
        if (mounted) setState(() {});
      }),
    ]);

    _heartbeat = _portal.createHeartbeat(onLimit: _onLimit);
    _portal.addListener(_onPortalChanged);
    _wasBlocked = _isBlocked;

    _clockTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
    _watchdog = Timer.periodic(const Duration(seconds: 5), (_) => _checkStall());
    _scheduleHide();
    WidgetsBinding.instance.addPostFrameCallback((_) => _open());
  }

  Future<void> _enterFullscreen() async {
    if (Device.isAndroid) {
      if (!Device.isTv) {
        await SystemChrome.setPreferredOrientations(const [
          DeviceOrientation.landscapeLeft,
          DeviceOrientation.landscapeRight,
        ]);
      }
      await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    } else if (Device.isWindows) {
      _wasWindowFullScreen = await Device.isFullScreen();
      if (!_wasWindowFullScreen) await Device.setFullScreen(true);
    }
  }

  Future<void> _exitFullscreen() async {
    if (Device.isAndroid) {
      await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
      if (!Device.isTv) {
        await SystemChrome.setPreferredOrientations(DeviceOrientation.values);
      }
    } else if (Device.isWindows && !_wasWindowFullScreen) {
      await Device.setFullScreen(false);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    PlaybackActivity.exit();
    _portal.removeListener(_onPortalChanged);
    _saveResume();
    for (final s in _subs) {
      s.cancel();
    }
    for (final t in [
      _hideTimer,
      _clockTimer,
      _retryTimer,
      _watchdog,
      _errorCheck,
      _bgTimer,
      _seekBubbleTimer,
    ]) {
      t?.cancel();
    }
    _heartbeat?.dispose();
    _player.dispose();
    _position.dispose();
    _duration.dispose();
    _rootFocus.dispose();
    _playFocus.dispose();
    _sliderFocus.dispose();
    WakelockPlus.disable().catchError((Object _) {});
    _exitFullscreen();
    super.dispose();
  }

  // ---------------------------------------------------------------------------
  // Reproducción
  // ---------------------------------------------------------------------------

  Future<void> _open() async {
    _retryTimer?.cancel();
    _errorCheck?.cancel();
    if (!mounted) return;
    if (_isBlocked) {
      await _player.stop();
      await _heartbeat?.stop();
      setState(() {});
      return;
    }
    final source = _session.source;
    final item = _item;
    final url = source?.streamUrl(item) ?? '';
    if (url.isEmpty) {
      setState(() => _fatalError = 'No hay una dirección de reproducción para este contenido.');
      return;
    }
    setState(() {
      _fatalError = null;
      _limitError = null;
      _buffering = true;
      _userPaused = false;
    });
    _bufferingSince = DateTime.now();
    _position.value = Duration.zero;
    _duration.value = Duration.zero;
    final start = _pendingStart;
    _pendingStart = null;
    try {
      await _player.open(
        Media(url, httpHeaders: Device.headers, start: start),
        play: true,
      );
    } catch (e) {
      _onError('$e');
      return;
    }
    if (!mounted || !identical(item, _item)) return;
    _library.addRecent(item);
    if (source is XtreamSource) {
      unawaited(_heartbeat?.start(item.id));
    }
  }

  void _onPosition(Duration p) {
    final prev = _position.value;
    _position.value = p;
    if (p > prev && p - prev < const Duration(seconds: 3)) {
      if (_reconnecting && mounted) setState(() => _reconnecting = false);
      if (_retries > 0 && p.inSeconds % 20 == 0) _retries = 0;
    }
    if (!_isLive &&
        DateTime.now().difference(_lastResumeSave) > const Duration(seconds: 30)) {
      _saveResume();
    }
  }

  void _saveResume() {
    if (_isLive) return;
    _lastResumeSave = DateTime.now();
    _library.saveResumePosition(_item, _position.value, _duration.value);
  }

  void _onError(String message) {
    if (!mounted || _fatalError != null || _limitError != null || _isBlocked) {
      return;
    }
    // Algunos errores de mpv no son fatales: comprobar si la reproducción avanza.
    final at = _position.value;
    _errorCheck?.cancel();
    _errorCheck = Timer(const Duration(seconds: 2), () {
      if (!mounted) return;
      final advancing = _position.value > at && _playing && !_buffering;
      if (!advancing) _retry();
    });
  }

  void _onCompleted(bool completed) {
    if (!completed || !mounted) return;
    if (_isLive) {
      _retry();
      return;
    }
    _library.saveResumePosition(_item, Duration.zero, Duration.zero);
    if (_index < widget.playlist.length - 1) {
      _goTo(_index + 1);
    } else {
      Navigator.of(context).maybePop();
    }
  }

  void _checkStall() {
    if (!mounted || _fatalError != null || _limitError != null || _userPaused) {
      return;
    }
    final since = _bufferingSince;
    if (_buffering &&
        since != null &&
        DateTime.now().difference(since) > const Duration(seconds: 25)) {
      _bufferingSince = DateTime.now();
      _retry();
    }
  }

  void _retry() {
    if (!mounted || _isBlocked || _limitError != null) return;
    _retryTimer?.cancel();
    if (_retries >= AppConfig.maxPlaybackRetries) {
      _heartbeat?.stop();
      _player.stop();
      setState(() {
        _reconnecting = false;
        _fatalError = _isLive
            ? 'No se pudo reproducir "${_item.name}". El canal puede no estar disponible en este momento.'
            : 'No se pudo reproducir "${_item.name}". Verifique su conexión e inténtelo de nuevo.';
      });
      return;
    }
    _retries++;
    if (!_isLive && _position.value > Duration.zero) {
      _pendingStart = _position.value;
    }
    setState(() => _reconnecting = true);
    _retryTimer = Timer(Duration(seconds: 2 * _retries), _open);
  }

  void _manualRetry() {
    _retries = 0;
    setState(() {
      _fatalError = null;
      _limitError = null;
    });
    _open();
  }

  void _onLimit(ApiException e) {
    if (!mounted) return;
    _player.stop();
    setState(() {
      _reconnecting = false;
      _limitError = 'Límite de conexiones alcanzado';
    });
  }

  void _onPortalChanged() {
    final blocked = _isBlocked;
    if (blocked == _wasBlocked) return;
    _wasBlocked = blocked;
    if (!mounted) return;
    if (blocked) {
      _player.stop();
      _heartbeat?.stop();
      setState(() {});
    } else {
      _manualRetry();
    }
  }

  void _goTo(int index) {
    if (widget.playlist.isEmpty) return;
    _saveResume();
    final len = widget.playlist.length;
    setState(() {
      _index = (index % len + len) % len;
      _retries = 0;
      _reconnecting = false;
      _pendingStart = null;
    });
    if (_item.type == ContentType.episode) {
      final r = _library.resumePosition(_item);
      if (r > Duration.zero) _pendingStart = r;
    }
    _showOverlay();
    _open();
  }

  void _changeChannel(int delta) {
    if (!_hasList) return;
    _goTo(_index + delta);
  }

  Future<void> _togglePlay() async {
    if (_playing) {
      _userPaused = true;
      await _player.pause();
    } else {
      _userPaused = false;
      await _player.play();
    }
    _showOverlay();
  }

  Future<void> _seekBy(int seconds) async {
    if (_isLive) return;
    final dur = _duration.value;
    var target = _position.value + Duration(seconds: seconds);
    if (target < Duration.zero) target = Duration.zero;
    if (dur > Duration.zero && target > dur) target = dur;
    await _player.seek(target);
    setState(() {
      _seekBubble = seconds > 0 ? '+${seconds}s' : '${seconds}s';
      _seekBubbleRight = seconds > 0;
    });
    _seekBubbleTimer?.cancel();
    _seekBubbleTimer = Timer(const Duration(milliseconds: 700), () {
      if (mounted) setState(() => _seekBubble = null);
    });
  }

  // ---------------------------------------------------------------------------
  // Ciclo de vida (segundo plano)
  // ---------------------------------------------------------------------------

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
        _bgTimer?.cancel();
        _bgTimer = Timer(AppConfig.backgroundStopDelay, () {
          _stoppedInBackground = true;
          _heartbeat?.stop();
          _player.pause();
        });
      case AppLifecycleState.resumed:
        _bgTimer?.cancel();
        final wasStopped = _stoppedInBackground;
        _stoppedInBackground = false;
        if (_fatalError != null || _limitError != null || _isBlocked) break;
        if (_isLive && !_userPaused) {
          // En vivo: reconectar para no mostrar contenido atrasado.
          _manualRetry();
        } else if (wasStopped && _session.source is XtreamSource) {
          _heartbeat?.start(_item.id);
        }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Capa de controles
  // ---------------------------------------------------------------------------

  void _scheduleHide() {
    _hideTimer?.cancel();
    _hideTimer = Timer(AppConfig.overlayHideDelay, () {
      if (mounted && _playing && !_buffering) setState(() => _overlay = false);
    });
  }

  void _showOverlay({bool focusPlay = false}) {
    if (!_overlay) setState(() => _overlay = true);
    _scheduleHide();
    if (focusPlay && !_touchMode) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _playFocus.canRequestFocus) _playFocus.requestFocus();
      });
    }
  }

  void _hideOverlay() {
    _hideTimer?.cancel();
    setState(() => _overlay = false);
    _rootFocus.requestFocus();
  }

  void _toggleOverlay() {
    if (_locked) {
      setState(() => _overlay = !_overlay);
      if (_overlay) _scheduleHide();
      return;
    }
    if (_overlay) {
      _hideOverlay();
    } else {
      _showOverlay();
    }
  }

  void _handleBack() {
    if (_locked) {
      setState(() {
        _locked = false;
        _overlay = true;
      });
      _scheduleHide();
      return;
    }
    if (_overlay && !_touchMode && _fatalError == null && _limitError == null) {
      _hideOverlay();
      return;
    }
    Navigator.of(context).pop();
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is KeyUpEvent) return KeyEventResult.ignored;
    final key = event.logicalKey;

    if (key == LogicalKeyboardKey.channelUp || key == LogicalKeyboardKey.pageUp) {
      _changeChannel(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.channelDown ||
        key == LogicalKeyboardKey.pageDown) {
      _changeChannel(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.mediaPlayPause ||
        key == LogicalKeyboardKey.mediaPlay ||
        key == LogicalKeyboardKey.mediaPause) {
      _togglePlay();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.mediaFastForward) {
      _seekBy(30);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.mediaRewind) {
      _seekBy(-30);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyF && Device.isWindows) {
      Device.toggleFullScreen();
      return KeyEventResult.handled;
    }
    if (_fatalError != null || _limitError != null || _isBlocked) {
      return KeyEventResult.ignored;
    }

    final isLive = _isLive;
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.arrowDown) {
      if (isLive && _hasList && !_overlay) {
        _changeChannel(key == LogicalKeyboardKey.arrowUp ? -1 : 1);
        return KeyEventResult.handled;
      }
      if (!_overlay) {
        _showOverlay(focusPlay: true);
        return KeyEventResult.handled;
      }
      _scheduleHide();
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.arrowLeft || key == LogicalKeyboardKey.arrowRight) {
      if (!_overlay) {
        if (!isLive) {
          _seekBy(key == LogicalKeyboardKey.arrowLeft ? -10 : 10);
        } else {
          _showOverlay(focusPlay: true);
        }
        return KeyEventResult.handled;
      }
      _scheduleHide();
      return KeyEventResult.ignored;
    }
    if (activateKeys.contains(key)) {
      if (!_overlay) {
        _showOverlay(focusPlay: true);
        return KeyEventResult.handled;
      }
      _scheduleHide();
      return KeyEventResult.ignored;
    }
    if (!_overlay) _showOverlay();
    return KeyEventResult.ignored;
  }

  // ---------------------------------------------------------------------------
  // Diálogos
  // ---------------------------------------------------------------------------

  String _trackLabel(String id, String? title, String? language, int n) {
    if (id == 'auto') return 'Automático';
    if (id == 'no') return 'Desactivado';
    final parts = [
      if (title != null && title.isNotEmpty) title,
      if (language != null && language.isNotEmpty) language.toUpperCase(),
    ];
    return parts.isEmpty ? 'Pista $n' : parts.join(' · ');
  }

  Future<void> _pickTrack({required bool audio}) async {
    _hideTimer?.cancel();
    final tracks = _player.state.tracks;
    final current = _player.state.track;
    final options = <(String, bool, VoidCallback)>[];
    if (audio) {
      var n = 0;
      for (final t in tracks.audio) {
        if (t.id == 'no') continue;
        n++;
        options.add((
          _trackLabel(t.id, t.title, t.language, n),
          t.id == current.audio.id,
          () => _player.setAudioTrack(t),
        ));
      }
    } else {
      var n = 0;
      for (final t in tracks.subtitle) {
        if (t.id == 'auto') continue;
        n++;
        options.add((
          _trackLabel(t.id, t.title, t.language, n),
          t.id == current.subtitle.id,
          () => _player.setSubtitleTrack(t),
        ));
      }
    }
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(audio ? 'Pista de audio' : 'Subtítulos'),
        content: SizedBox(
          width: 360,
          child: options.isEmpty
              ? Text(audio
                  ? 'No hay pistas de audio adicionales.'
                  : 'Este contenido no tiene subtítulos.')
              : ListView(
                  shrinkWrap: true,
                  children: [
                    for (var i = 0; i < options.length; i++)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: FocusableCard(
                          autofocus: options[i].$2 || i == 0,
                          selected: options[i].$2,
                          color: AppColors.surfaceHigh,
                          padding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 12),
                          onTap: () {
                            options[i].$3();
                            Navigator.of(ctx).pop();
                          },
                          child: Row(
                            children: [
                              Icon(
                                options[i].$2
                                    ? Icons.radio_button_checked
                                    : Icons.radio_button_unchecked,
                                size: 20,
                              ),
                              const SizedBox(width: 10),
                              Expanded(child: Text(options[i].$1)),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
        ),
      ),
    );
    _scheduleHide();
  }

  void _cycleAspect() {
    setState(() => _aspect = (_aspect + 1) % _aspectModes.length);
    showSnack(context, 'Aspecto: ${_aspectModes[_aspect].label}');
    _scheduleHide();
  }

  Future<void> _openChannelList() async {
    _hideTimer?.cancel();
    final selected = await showGeneralDialog<int>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Cerrar',
      barrierColor: Colors.black54,
      transitionDuration: const Duration(milliseconds: 200),
      pageBuilder: (ctx, _, _) {
        final width = MediaQuery.sizeOf(ctx).width;
        return Align(
          alignment: Alignment.centerRight,
          child: Material(
            color: AppColors.surface,
            child: SizedBox(
              width: width < 500 ? width * 0.85 : 380,
              height: double.infinity,
              child: SafeArea(
                left: false,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              _isLive ? 'Canales' : 'Episodios',
                              style: const TextStyle(
                                  fontSize: 18, fontWeight: FontWeight.w700),
                            ),
                          ),
                          IconButton(
                            tooltip: 'Cerrar',
                            icon: const Icon(Icons.close),
                            onPressed: () => Navigator.of(ctx).pop(),
                          ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: ListView.builder(
                        controller: ScrollController(
                            initialScrollOffset:
                                (_index > 2 ? (_index - 2) * 64.0 : 0)),
                        itemCount: widget.playlist.length,
                        itemExtent: 64,
                        itemBuilder: (context, i) {
                          final it = widget.playlist[i];
                          final current = i == _index;
                          return Padding(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 3),
                            child: FocusableCard(
                              autofocus: current,
                              selected: current,
                              color: AppColors.surfaceHigh,
                              focusScale: 1.02,
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 10),
                              onTap: () => Navigator.of(ctx).pop(i),
                              child: Row(
                                children: [
                                  SizedBox(
                                    width: 52,
                                    height: 38,
                                    child: NetImage(
                                        url: it.logo,
                                        fit: BoxFit.contain,
                                        memCacheWidth: 120),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Text(
                                      '${it.num != null && _isLive ? '${it.num}  ' : ''}${it.name}',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                          fontWeight: current
                                              ? FontWeight.w700
                                              : FontWeight.w500),
                                    ),
                                  ),
                                  if (current)
                                    const Icon(Icons.play_arrow_rounded,
                                        color: AppColors.accent),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
      transitionBuilder: (ctx, anim, _, child) => SlideTransition(
        position: Tween(begin: const Offset(1, 0), end: Offset.zero)
            .animate(CurvedAnimation(parent: anim, curve: Curves.easeOut)),
        child: child,
      ),
    );
    if (selected != null && selected != _index && mounted) {
      _goTo(selected);
    } else {
      _scheduleHide();
    }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    context.watch<PortalProvider>();
    final blockedView = _blockedView();
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _handleBack();
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Focus(
          focusNode: _rootFocus,
          autofocus: true,
          onKeyEvent: _onKey,
          child: blockedView ?? _playerStack(),
        ),
      ),
    );
  }

  Widget? _blockedView() {
    final back = TvButton(
      label: 'Volver',
      icon: Icons.arrow_back,
      autofocus: true,
      onPressed: () => Navigator.of(context).pop(),
    );
    final outage = _portal.blockingOutage;
    if (outage != null) return OutageView(outage: outage, actions: [back]);
    if (_portal.userBlocked) {
      return AccountBlockedView(user: _portal.info!.user, actions: [back]);
    }
    if (_limitError != null) {
      return BlockedView(
        title: 'Límite de conexiones alcanzado',
        message:
            'Ya hay otros dispositivos reproduciendo con esta cuenta.\nCierre la reproducción en otro equipo e inténtelo de nuevo.',
        icon: Icons.devices_other_rounded,
        color: AppColors.warning,
        footer: 'Si el problema continúa, contacta a tu proveedor.',
        actions: [
          TvButton(
            label: 'Reintentar',
            icon: Icons.refresh,
            primary: true,
            autofocus: true,
            onPressed: _manualRetry,
          ),
          TvButton(
            label: 'Volver',
            icon: Icons.arrow_back,
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      );
    }
    return null;
  }

  Widget _playerStack() {
    final mode = _aspectModes[_aspect];
    final showSpinner = (_buffering || _reconnecting) && _fatalError == null;
    return Stack(
      fit: StackFit.expand,
      children: [
        Video(
          controller: _video,
          controls: NoVideoControls,
          fit: mode.fit,
          aspectRatio: mode.ratio,
          wakelock: false,
          pauseUponEnteringBackgroundMode: true,
          resumeUponEnteringForegroundMode: false,
          subtitleViewConfiguration: const SubtitleViewConfiguration(
            style: TextStyle(
              fontSize: 36,
              color: Colors.white,
              backgroundColor: Color(0x99000000),
            ),
          ),
        ),
        _gestureLayer(),
        if (showSpinner)
          IgnorePointer(
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(
                    width: 54,
                    height: 54,
                    child: CircularProgressIndicator(strokeWidth: 4),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: Colors.black54,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      _reconnecting
                          ? 'Reconectando… (intento $_retries de ${AppConfig.maxPlaybackRetries})'
                          : 'Cargando…',
                    ),
                  ),
                ],
              ),
            ),
          ),
        if (_seekBubble != null)
          IgnorePointer(
            child: Align(
              alignment: _seekBubbleRight
                  ? const Alignment(0.6, 0)
                  : const Alignment(-0.6, 0),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  borderRadius: BorderRadius.circular(30),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(_seekBubbleRight
                        ? Icons.fast_forward_rounded
                        : Icons.fast_rewind_rounded),
                    const SizedBox(width: 6),
                    Text(_seekBubble!,
                        style: const TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
            ),
          ),
        if (_locked)
          _lockedLayer()
        else
          IgnorePointer(
            ignoring: !_overlay,
            child: AnimatedOpacity(
              opacity: _overlay ? 1 : 0,
              duration: const Duration(milliseconds: 220),
              child: _overlayControls(),
            ),
          ),
        if (_fatalError != null) _errorPanel(),
      ],
    );
  }

  Widget _gestureLayer() {
    final vod = !_isLive;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: _toggleOverlay,
      onDoubleTapDown: (d) => _doubleTapPos = d.localPosition,
      onDoubleTap: (_locked)
          ? null
          : Device.isWindows
              ? () => Device.toggleFullScreen()
              : vod
                  ? () {
                      final width = MediaQuery.sizeOf(context).width;
                      final x = _doubleTapPos?.dx ?? width / 2;
                      if (x < width * 0.4) {
                        _seekBy(-10);
                      } else if (x > width * 0.6) {
                        _seekBy(10);
                      } else {
                        _togglePlay();
                      }
                    }
                  : null,
      onVerticalDragEnd: (!_isLive || !_hasList || _locked)
          ? null
          : (details) {
              final v = details.primaryVelocity ?? 0;
              if (v < -250) {
                _changeChannel(1);
              } else if (v > 250) {
                _changeChannel(-1);
              }
            },
    );
  }

  Widget _lockedLayer() {
    return IgnorePointer(
      ignoring: !_overlay,
      child: AnimatedOpacity(
        opacity: _overlay ? 1 : 0,
        duration: const Duration(milliseconds: 200),
        child: SafeArea(
          child: Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TvIconButton(
                    icon: Icons.lock_rounded,
                    tooltip: 'Desbloquear controles',
                    size: 60,
                    color: Colors.black54,
                    onPressed: () {
                      setState(() => _locked = false);
                      _showOverlay();
                    },
                  ),
                  const SizedBox(height: 8),
                  const Text('Controles bloqueados',
                      style: TextStyle(fontSize: 12)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _overlayControls() {
    final item = _item;
    final width = MediaQuery.sizeOf(context).width;
    final compact = width < 700;
    final epgEnabled = _session.epg?.enabled ?? false;
    final fav = context.select<LibraryProvider, bool>((l) => l.isFavorite(item));
    final subtitle = [
      if (item.type == ContentType.episode && item.seriesName != null)
        '${item.seriesName} · T${item.season ?? 1} E${item.episodeNum ?? ''}',
      if (item.categoryName != null) item.categoryName!,
      if (_isLive && item.num != null) 'Canal ${item.num}',
    ].join(' · ');

    return Stack(
      fit: StackFit.expand,
      children: [
        // Degradados.
        const IgnorePointer(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Color(0xCC000000),
                  Color(0x00000000),
                  Color(0x00000000),
                  Color(0xDD000000),
                ],
                stops: [0, 0.3, 0.6, 1],
              ),
            ),
          ),
        ),
        SafeArea(
          child: Padding(
            padding: EdgeInsets.symmetric(
                horizontal: compact ? 12 : 28, vertical: compact ? 6 : 18),
            child: Column(
              children: [
                // Barra superior.
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    TvIconButton(
                      icon: Icons.arrow_back_rounded,
                      tooltip: 'Volver',
                      size: 44,
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                    const SizedBox(width: 10),
                    if (item.logo != null)
                      Container(
                        width: compact ? 44 : 60,
                        height: compact ? 44 : 60,
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: Colors.black38,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: NetImage(
                            url: item.logo,
                            fit: BoxFit.contain,
                            memCacheWidth: 160),
                      ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Row(
                            children: [
                              if (_isLive)
                                Container(
                                  margin: const EdgeInsets.only(right: 8),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: AppColors.live,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: const Text('EN VIVO',
                                      style: TextStyle(
                                          fontSize: 10,
                                          fontWeight: FontWeight.w800)),
                                ),
                              Expanded(
                                child: Text(
                                  item.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                      fontSize: compact ? 17 : 22,
                                      fontWeight: FontWeight.w800),
                                ),
                              ),
                            ],
                          ),
                          if (subtitle.isNotEmpty)
                            Text(subtitle,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 13)),
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(formatTime(_now),
                        style: TextStyle(
                            fontSize: compact ? 18 : 26,
                            fontWeight: FontWeight.w700)),
                  ],
                ),
                const Spacer(),
                // Controles centrales.
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (_isLive && _hasList)
                      TvIconButton(
                        icon: Icons.skip_previous_rounded,
                        tooltip: 'Canal anterior',
                        size: compact ? 50 : 60,
                        onPressed: () => _changeChannel(-1),
                      ),
                    if (!_isLive)
                      TvIconButton(
                        icon: Icons.replay_10_rounded,
                        tooltip: 'Retroceder 10 segundos',
                        size: compact ? 50 : 60,
                        onPressed: () => _seekBy(-10),
                      ),
                    SizedBox(width: compact ? 24 : 36),
                    TvIconButton(
                      icon: _playing
                          ? Icons.pause_rounded
                          : Icons.play_arrow_rounded,
                      tooltip: _playing ? 'Pausar' : 'Reproducir',
                      size: compact ? 66 : 80,
                      focusNode: _playFocus,
                      color: AppColors.accent.withValues(alpha: 0.85),
                      onPressed: _togglePlay,
                    ),
                    SizedBox(width: compact ? 24 : 36),
                    if (_isLive && _hasList)
                      TvIconButton(
                        icon: Icons.skip_next_rounded,
                        tooltip: 'Canal siguiente',
                        size: compact ? 50 : 60,
                        onPressed: () => _changeChannel(1),
                      ),
                    if (!_isLive)
                      TvIconButton(
                        icon: Icons.forward_10_rounded,
                        tooltip: 'Adelantar 10 segundos',
                        size: compact ? 50 : 60,
                        onPressed: () => _seekBy(10),
                      ),
                  ],
                ),
                const Spacer(),
                // Barra inferior.
                if (_isLive && epgEnabled)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 560),
                      child: EpgNowNext(
                          key: ValueKey(item.key), item: item, large: true),
                    ),
                  ),
                if (!_isLive) _seekBar(),
                const SizedBox(height: 6),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  clipBehavior: Clip.none,
                  child: Row(
                    children: [
                      if (_hasList)
                        _ActionButton(
                          icon: Icons.format_list_bulleted_rounded,
                          label: _isLive ? 'Canales' : 'Episodios',
                          onTap: _openChannelList,
                        ),
                      if (_isLive && epgEnabled)
                        _ActionButton(
                          icon: Icons.event_note_rounded,
                          label: 'EPG',
                          onTap: () async {
                            _hideTimer?.cancel();
                            await showEpgSheet(context, item);
                            _scheduleHide();
                          },
                        ),
                      _ActionButton(
                        icon: Icons.audiotrack_rounded,
                        label: 'Audio',
                        onTap: () => _pickTrack(audio: true),
                      ),
                      _ActionButton(
                        icon: Icons.closed_caption_rounded,
                        label: 'Subtítulos',
                        onTap: () => _pickTrack(audio: false),
                      ),
                      _ActionButton(
                        icon: Icons.aspect_ratio_rounded,
                        label: _aspectModes[_aspect].label,
                        onTap: _cycleAspect,
                      ),
                      _ActionButton(
                        icon: fav ? Icons.favorite : Icons.favorite_border,
                        label: 'Favorito',
                        onTap: () async {
                          final added = await _library.toggleFavorite(item);
                          if (mounted) {
                            showSnack(context,
                                added ? 'Agregado a Favoritos' : 'Quitado de Favoritos');
                          }
                        },
                      ),
                      if (!Device.isTv)
                        _ActionButton(
                          icon: Icons.lock_open_rounded,
                          label: 'Bloquear',
                          onTap: () {
                            setState(() => _locked = true);
                            _scheduleHide();
                          },
                        ),
                      if (Device.isWindows)
                        _ActionButton(
                          icon: Icons.fullscreen_rounded,
                          label: 'Pantalla',
                          onTap: Device.toggleFullScreen,
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _seekBar() {
    return ValueListenableBuilder<Duration>(
      valueListenable: _duration,
      builder: (context, dur, _) => ValueListenableBuilder<Duration>(
        valueListenable: _position,
        builder: (context, pos, _) {
          final max = dur.inMilliseconds.toDouble();
          final value =
              max <= 0 ? 0.0 : pos.inMilliseconds.clamp(0, max).toDouble();
          return Row(
            children: [
              Text(formatDuration(pos), style: const TextStyle(fontSize: 13)),
              Expanded(
                child: Slider(
                  value: value,
                  max: max <= 0 ? 1 : max,
                  focusNode: _sliderFocus,
                  onChangeStart: (_) => _hideTimer?.cancel(),
                  onChanged: max <= 0
                      ? null
                      : (v) => _position.value =
                          Duration(milliseconds: v.round()),
                  onChangeEnd: max <= 0
                      ? null
                      : (v) {
                          _player.seek(Duration(milliseconds: v.round()));
                          _scheduleHide();
                        },
                ),
              ),
              Text(formatDuration(dur), style: const TextStyle(fontSize: 13)),
            ],
          );
        },
      ),
    );
  }

  final FocusNode _sliderFocus =
      FocusNode(canRequestFocus: false, skipTraversal: true);

  Widget _errorPanel() {
    return Container(
      color: Colors.black87,
      alignment: Alignment.center,
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.signal_wifi_connected_no_internet_4_rounded,
                    size: 56, color: AppColors.warning),
                const SizedBox(height: 14),
                const Text('No se pudo reproducir',
                    style:
                        TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text(_fatalError ?? '',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: AppColors.textSecondary)),
                const SizedBox(height: 22),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  alignment: WrapAlignment.center,
                  children: [
                    TvButton(
                      label: 'Reintentar',
                      icon: Icons.refresh,
                      primary: true,
                      autofocus: true,
                      onPressed: _manualRetry,
                    ),
                    if (_isLive && _hasList)
                      TvButton(
                        label: 'Canal siguiente',
                        icon: Icons.skip_next_rounded,
                        onPressed: () => _changeChannel(1),
                      ),
                    TvButton(
                      label: 'Volver',
                      icon: Icons.arrow_back,
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FocusableCard(
        onTap: onTap,
        color: Colors.black45,
        borderRadius: 22,
        focusScale: 1.08,
        ensureVisible: false,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        semanticLabel: label,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 20),
            const SizedBox(width: 6),
            Text(label, style: const TextStyle(fontSize: 13.5)),
          ],
        ),
      ),
    );
  }
}
