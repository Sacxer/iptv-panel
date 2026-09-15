import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../constants.dart';
import '../providers/app_update_provider.dart';
import '../services/apk_downloader.dart';
import '../services/apk_installer.dart';
import '../services/app_update.dart';
import '../services/device.dart';
import '../theme.dart';
import 'focusable_card.dart';

enum UpdatePromptChoice { update, later }

/// `31,2 MB`
String formatBytes(int bytes) {
  if (bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).ceil()} KB';
  final mb = bytes / (1024 * 1024);
  return '${mb.toStringAsFixed(1).replaceAll('.', ',')} MB';
}

/// "Toca" en pantallas táctiles, "Pulsa" con control remoto.
String get _tap => Device.isTv ? 'Pulsa' : 'Toca';

/// "Hay una actualización": Actualizar / Más tarde. Atrás equivale a "Más tarde".
Future<UpdatePromptChoice?> showAppUpdateDialog(
    BuildContext context, AppUpdateInfo info) {
  return showDialog<UpdatePromptChoice>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(ctx).pop(UpdatePromptChoice.later);
      },
      child: AlertDialog(
        icon: const Icon(Icons.system_update_rounded,
            size: 40, color: AppColors.accent),
        title: const Text('Hay una actualización'),
        scrollable: true,
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Versión ${info.release.versionName}'
                '${info.file.size > 0 ? ' · ${formatBytes(info.file.size)}' : ''}',
                style:
                    const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 4),
              Text('Tienes la versión ${Device.appVersion}.',
                  style: const TextStyle(color: AppColors.textSecondary)),
              if (info.release.notes.isNotEmpty) ...[
                const SizedBox(height: 14),
                const Text('Novedades',
                    style: TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text(info.release.notes),
              ],
            ],
          ),
        ),
        actionsOverflowButtonSpacing: 8,
        actions: [
          TvButton(
            label: 'Más tarde',
            onPressed: () => Navigator.of(ctx).pop(UpdatePromptChoice.later),
          ),
          TvButton(
            label: 'Actualizar',
            icon: Icons.download_rounded,
            primary: true,
            autofocus: true,
            onPressed: () => Navigator.of(ctx).pop(UpdatePromptChoice.update),
          ),
        ],
      ),
    ),
  );
}

/// Si hay una actualización obligatoria, reemplaza toda la app por la pantalla de
/// actualización (con su propio Navigator: no se puede salir de ella navegando).
class AppUpdateGate extends StatelessWidget {
  final Widget child;
  const AppUpdateGate({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppUpdateController>();
    final info = controller.available;
    if (!controller.blocking || info == null) return child;
    return Navigator(
      key: ValueKey('app-update-${info.snoozeKey}'),
      onGenerateRoute: (_) => MaterialPageRoute(
        builder: (_) => AppUpdateScreen(
          info: info,
          mandatory: true,
          installer: controller.installer,
        ),
      ),
    );
  }
}

enum _Step { ready, downloading, verifying, permission, installing, notInstalled, error }

/// Descarga, verifica e instala la actualización. Sirve con pantalla táctil (vertical u
/// horizontal) y con control remoto.
class AppUpdateScreen extends StatefulWidget {
  final AppUpdateInfo info;
  final bool mandatory;
  final ApkInstaller installer;

  /// "Más tarde" (solo opcional). `null` = no se muestra.
  final Future<void> Function()? onLater;

  /// Empezar a descargar al abrir (la opcional viene de pulsar "Actualizar").
  final bool autoStart;
  final ApkDownloader? downloader;

  const AppUpdateScreen({
    super.key,
    required this.info,
    required this.mandatory,
    this.installer = const ApkInstaller(),
    this.onLater,
    bool? autoStart,
    this.downloader,
  }) : autoStart = autoStart ?? !mandatory;

  @override
  State<AppUpdateScreen> createState() => _AppUpdateScreenState();
}

class _AppUpdateScreenState extends State<AppUpdateScreen>
    with WidgetsBindingObserver {
  _Step _step = _Step.ready;
  int _received = 0;
  int _total = 0;
  String? _error;
  String? _hint;
  String? _apkPath;
  bool _autoRetryOnReturn = false;
  bool _leftApp = false;
  bool _disposed = false;
  AppLifecycleState _lifecycle = AppLifecycleState.resumed;
  Completer<void>? _foreground;
  DownloadCancelToken? _cancel;
  DateTime _lastProgressUi = DateTime.fromMillisecondsSinceEpoch(0);
  final _primaryFocus = FocusNode(debugLabel: 'update-primary');

  AppUpdateInfo get _info => widget.info;
  bool get _mandatory => widget.mandatory;

  late final ApkDownloader _downloader =
      widget.downloader ?? ApkDownloader(headers: Device.headers);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _lifecycle = WidgetsBinding.instance.lifecycleState ?? AppLifecycleState.resumed;
    _total = _info.file.size;
    if (widget.autoStart) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _download());
    } else {
      _focusPrimary();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _cancel?.cancel();
    _foreground?.complete();
    _foreground = null;
    _keepScreenOn(false);
    _primaryFocus.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _lifecycle = state;
    if (state != AppLifecycleState.resumed) {
      _leftApp = true;
      return;
    }
    _foreground?.complete();
    _foreground = null;
    if (!_leftApp) return;
    _leftApp = false;
    switch (_step) {
      case _Step.permission:
        _afterPermission();
      case _Step.installing:
        // Si la app sigue abierta al volver, el instalador se canceló o falló.
        _setStep(_Step.notInstalled);
      case _Step.error:
        // Se cortó la red con la pantalla apagada o en segundo plano: continuar sola.
        if (_autoRetryOnReturn) _download();
      default:
        break;
    }
  }

  /// Los reintentos de la descarga esperan a que la app vuelva a primer plano.
  Future<void> _waitForeground() {
    if (_disposed || _lifecycle == AppLifecycleState.resumed) {
      return Future.value();
    }
    return (_foreground ??= Completer<void>()).future;
  }

  void _keepScreenOn(bool on) {
    (on ? WakelockPlus.enable() : WakelockPlus.disable())
        .catchError((Object _) {});
  }

  void _setStep(_Step step, {String? error, String? hint}) {
    if (!mounted) return;
    setState(() {
      _step = step;
      _error = error;
      _hint = hint;
    });
    _focusPrimary();
  }

  void _focusPrimary() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _primaryFocus.context != null) _primaryFocus.requestFocus();
    });
  }

  Future<void> _download() async {
    _cancel?.cancel();
    final token = DownloadCancelToken();
    _cancel = token;
    _autoRetryOnReturn = false;
    if (!mounted) return;
    setState(() {
      _received = 0;
      _total = _info.file.size;
    });
    _setStep(_Step.downloading);
    _keepScreenOn(true);
    try {
      final dir = await widget.installer.updatesDir();
      final name = 'iptv-player-${_info.release.versionCode}.apk';
      await _downloader.removeOtherDownloads(dir, name);
      final file = await _downloader.download(
        uri: _info.downloadUri,
        targetPath: '$dir${Platform.pathSeparator}$name',
        sha256: _info.file.sha256,
        expectedSize: _info.file.size,
        cancelToken: token,
        beforeRetry: _waitForeground,
        onProgress: (received, total) {
          if (!mounted || token.isCancelled) return;
          final now = DateTime.now();
          final done = total > 0 && received >= total;
          if (!done && now.difference(_lastProgressUi).inMilliseconds < 200) {
            return;
          }
          _lastProgressUi = now;
          setState(() {
            _received = received;
            _total = total;
            if (done) _step = _Step.verifying;
          });
        },
      );
      if (!mounted || token.isCancelled) return;
      _apkPath = file.path;
      _keepScreenOn(false);
      await _install();
    } on ApkDownloadCancelled {
      if (!_disposed) _setStep(_Step.ready);
    } on ApkDownloadException catch (e) {
      if (!token.isCancelled) {
        _autoRetryOnReturn = e.retryable && !e.corrupted;
        _setStep(_Step.error, error: e.message);
      }
    } on PlatformException catch (e) {
      _setStep(_Step.error,
          error: 'No se pudo preparar la descarga: ${e.message ?? e.code}');
    } catch (e) {
      if (!token.isCancelled) {
        _autoRetryOnReturn = true;
        _setStep(_Step.error, error: 'No se pudo descargar la actualización: $e');
      }
    } finally {
      if (_step != _Step.downloading && _step != _Step.verifying) {
        _keepScreenOn(false);
      }
    }
  }

  Future<void> _install() async {
    final path = _apkPath;
    if (path == null) return _download();
    try {
      if (!await widget.installer.canInstall()) {
        _setStep(_Step.permission);
        return;
      }
      _setStep(_Step.installing);
      await widget.installer.install(path);
    } on PlatformException catch (e) {
      _setStep(_Step.error,
          error: e.code == 'NO_INSTALLER'
              ? 'Este equipo no tiene instalador de aplicaciones.'
              : 'No se pudo abrir el instalador: ${e.message ?? e.code}');
    }
  }

  Future<void> _openSettings() async {
    final opened = await widget.installer.openPermissionSettings();
    if (!opened && mounted) {
      _setStep(_Step.permission,
          hint: 'No se pudo abrir el ajuste. Búscalo en Ajustes → Aplicaciones → '
              'Acceso especial → Instalar apps desconocidas (o Ajustes → Seguridad).');
    }
  }

  Future<void> _afterPermission() async {
    if (await widget.installer.canInstall()) {
      await _install();
    } else {
      _setStep(_Step.permission,
          hint: 'Todavía no está activado. Activa «Permitir desde esta fuente» para '
              '${AppConfig.appName} y vuelve a la app.');
    }
  }

  Future<void> _later() async {
    _cancel?.cancel();
    await widget.onLater?.call();
    if (mounted) Navigator.of(context).maybePop();
  }

  void _close() {
    _cancel?.cancel();
    Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final narrow = MediaQuery.sizeOf(context).width < 520;
    return PopScope(
      canPop: !_mandatory,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) _cancel?.cancel();
      },
      child: Scaffold(
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: EdgeInsets.symmetric(
                  horizontal: narrow ? 20 : 32, vertical: 24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 620),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Icon(Icons.system_update_rounded,
                        size: 56, color: AppColors.accent),
                    const SizedBox(height: 12),
                    Text(
                      _mandatory
                          ? 'Actualización obligatoria'
                          : 'Actualización disponible',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          fontSize: 24, fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${AppConfig.appName} ${_info.release.versionName}'
                      '${_info.file.size > 0 ? ' · ${formatBytes(_info.file.size)}' : ''}'
                      '\nTienes la versión ${Device.appVersion}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.textSecondary),
                    ),
                    if (_mandatory) ...[
                      const SizedBox(height: 10),
                      const Text(
                        'Para seguir usando la app hay que instalar esta versión.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppColors.warning),
                      ),
                    ],
                    if (_info.release.notes.isNotEmpty) ...[
                      const SizedBox(height: 18),
                      Container(
                        constraints: const BoxConstraints(maxHeight: 180),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: SingleChildScrollView(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Novedades',
                                  style: TextStyle(fontWeight: FontWeight.w700)),
                              const SizedBox(height: 6),
                              Text(_info.release.notes),
                            ],
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 22),
                    _status(),
                    const SizedBox(height: 22),
                    _buttonBar(_buttons(narrow), narrow),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Teléfono angosto: botones a lo ancho, el principal arriba. Pantalla ancha: en fila.
  Widget _buttonBar(List<Widget> buttons, bool narrow) {
    if (buttons.isEmpty) return const SizedBox.shrink();
    if (!narrow) {
      return Wrap(
        alignment: WrapAlignment.center,
        spacing: 12,
        runSpacing: 12,
        children: buttons,
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final b in buttons.reversed) ...[
          b,
          if (b != buttons.first) const SizedBox(height: 10),
        ],
      ],
    );
  }

  Widget _message(IconData icon, Color color, String text) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 15))),
        ],
      ),
    );
  }

  Widget _status() {
    switch (_step) {
      case _Step.ready:
        return const SizedBox.shrink();
      case _Step.downloading:
      case _Step.verifying:
        final value = _total > 0 ? (_received / _total).clamp(0.0, 1.0) : null;
        final text = _step == _Step.verifying
            ? 'Verificando el archivo…'
            : _total > 0
                ? 'Descargando… ${formatBytes(_received)} de ${formatBytes(_total)} '
                    '(${((value ?? 0) * 100).floor()} %)'
                : 'Descargando… ${formatBytes(_received)}';
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: _step == _Step.verifying ? null : value,
                minHeight: 10,
                backgroundColor: AppColors.surfaceHigh,
              ),
            ),
            const SizedBox(height: 10),
            Text(text,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 4),
            const Text(
              'Si se corta la conexión, la descarga continúa donde quedó.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12.5, color: AppColors.textMuted),
            ),
          ],
        );
      case _Step.permission:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _message(
              Icons.verified_user_outlined,
              AppColors.info,
              'Android te va a pedir permiso para que ${AppConfig.appName} pueda instalar '
              'sus actualizaciones. Es solo para esta app.\n\n'
              '1. $_tap «Abrir ajustes».\n'
              '2. Activa «Permitir desde esta fuente».\n'
              '3. Vuelve atrás: la instalación sigue sola.',
            ),
            if (_hint != null) ...[
              const SizedBox(height: 10),
              Text(_hint!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.warning)),
            ],
          ],
        );
      case _Step.installing:
        return _message(
          Icons.install_mobile_rounded,
          AppColors.info,
          'Se abrió el instalador de Android. $_tap «Actualizar» (o «Instalar»). '
          'La app se cerrará y se abrirá la versión nueva.',
        );
      case _Step.notInstalled:
        return _message(
          Icons.info_outline,
          AppColors.warning,
          'La actualización no se instaló. Puedes intentarlo de nuevo.',
        );
      case _Step.error:
        return _message(Icons.error_outline, AppColors.danger,
            _error ?? 'Ocurrió un error.');
    }
  }

  /// Botones del paso actual; el principal va de último (a la derecha en pantallas anchas).
  List<Widget> _buttons(bool narrow) {
    TvButton primary(String label, IconData icon, VoidCallback onPressed) =>
        TvButton(
          label: label,
          icon: icon,
          primary: true,
          expand: narrow,
          focusNode: _primaryFocus,
          onPressed: onPressed,
        );
    TvButton secondary(String label, VoidCallback onPressed) =>
        TvButton(label: label, expand: narrow, onPressed: onPressed);

    switch (_step) {
      case _Step.ready:
        return [
          if (!_mandatory && widget.onLater != null)
            secondary('Más tarde', _later),
          primary('Actualizar', Icons.download_rounded, _download),
        ];
      case _Step.downloading:
        return [
          if (!_mandatory)
            TvButton(
              label: 'Cancelar',
              icon: Icons.close,
              expand: narrow,
              focusNode: _primaryFocus,
              onPressed: () => _cancel?.cancel(),
            ),
        ];
      case _Step.verifying:
        return const [];
      case _Step.permission:
        return [
          if (!_mandatory) secondary('Cancelar', _close),
          secondary('Ya lo activé', _afterPermission),
          primary('Abrir ajustes', Icons.settings_rounded, _openSettings),
        ];
      case _Step.installing:
      case _Step.notInstalled:
        return [
          if (!_mandatory) secondary('Cerrar', _close),
          primary('Instalar', Icons.install_mobile_rounded, _install),
        ];
      case _Step.error:
        return [
          if (!_mandatory) secondary('Cerrar', _close),
          primary('Reintentar', Icons.refresh, _download),
        ];
    }
  }
}

/// "Buscar actualizaciones" (Acerca de).
class CheckForUpdatesButton extends StatefulWidget {
  const CheckForUpdatesButton({super.key});

  @override
  State<CheckForUpdatesButton> createState() => _CheckForUpdatesButtonState();
}

class _CheckForUpdatesButtonState extends State<CheckForUpdatesButton> {
  bool _busy = false;

  void _snack(String text) {
    ScaffoldMessenger.maybeOf(context)
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _check() async {
    final controller = context.read<AppUpdateController>();
    if (controller.activeServerUrl() == null) {
      _snack('Primero agrega o elige un perfil con el servidor de tu proveedor.');
      return;
    }
    setState(() => _busy = true);
    final decision = await controller.check(manual: true);
    if (!mounted) return;
    setState(() => _busy = false);
    final info = decision?.info;
    if (decision == null) {
      _snack('Ya se están buscando actualizaciones. Espera un momento.');
    } else if (decision.action == UpdateAction.prompt && info != null) {
      await controller.prompt(context, info);
    } else if (decision.action == UpdateAction.block) {
      // La pantalla obligatoria aparece sola.
    } else if (decision.check.status == AppUpdateStatus.upToDate) {
      _snack('Ya tienes la versión más reciente (${Device.appVersion}).');
    } else {
      _snack('No se pudo comprobar. Las actualizaciones llegan desde el portal de tu '
          'proveedor; revisa la conexión.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return TvButton(
      label: _busy ? 'Buscando…' : 'Buscar actualizaciones',
      icon: Icons.system_update_rounded,
      onPressed: _busy ? null : _check,
    );
  }
}
