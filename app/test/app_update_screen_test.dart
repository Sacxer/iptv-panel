import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:iptv_player/services/apk_downloader.dart';
import 'package:iptv_player/services/apk_installer.dart';
import 'package:iptv_player/services/app_update.dart';
import 'package:iptv_player/theme.dart';
import 'package:iptv_player/widgets/app_update_widgets.dart';

class FakeInstaller extends ApkInstaller {
  bool allowed;
  int settingsOpened = 0;
  final List<String> installed = [];

  FakeInstaller({this.allowed = true});

  @override
  Future<String> updatesDir() async => 'C:/cache/updates';

  @override
  Future<bool> canInstall() async => allowed;

  @override
  Future<bool> openPermissionSettings() async {
    settingsOpened++;
    return true;
  }

  @override
  Future<void> install(String apkPath) async => installed.add(apkPath);
}

class FakeDownloader extends ApkDownloader {
  /// Veces que falla como si se cortara la red.
  int networkFailures;
  int calls = 0;

  FakeDownloader({this.networkFailures = 0});

  @override
  Future<void> removeOtherDownloads(String dir, String keepName) async {}

  @override
  Future<File> download({
    required Uri uri,
    required String targetPath,
    required String sha256,
    int expectedSize = 0,
    DownloadProgress? onProgress,
    DownloadCancelToken? cancelToken,
    Future<void> Function()? beforeRetry,
  }) async {
    calls++;
    onProgress?.call(expectedSize ~/ 2, expectedSize);
    if (networkFailures > 0) {
      networkFailures--;
      throw const ApkDownloadException('No se pudo descargar: la conexión se cortó varias veces.',
          retryable: true);
    }
    onProgress?.call(expectedSize, expectedSize);
    return File(targetPath);
  }
}

final _info = AppUpdateInfo(
  mandatory: false,
  release: const AppUpdateRelease(
    id: 1,
    versionName: '1.0.2',
    versionCode: 2003,
    notes: 'Arreglos en la guía y mejoras para celulares.',
  ),
  file: const AppUpdateFile(
    id: 7,
    abi: 'arm64-v8a',
    size: 32 * 1024 * 1024,
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    url: '/api/client/app-update/download/7',
  ),
  downloadUri: Uri.parse('http://192.168.1.46:8080/api/client/app-update/download/7'),
);

const portrait = Size(360, 740);
const landscape = Size(740, 360);

Future<void> pumpScreen(
  WidgetTester tester,
  Widget screen, {
  Size size = portrait,
}) async {
  tester.view.physicalSize = size * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: AppTheme.dark(), home: screen));
  await tester.pumpAndSettle();
}

Future<void> leaveAndReturn(WidgetTester tester) async {
  for (final s in [
    AppLifecycleState.inactive,
    AppLifecycleState.hidden,
    AppLifecycleState.paused,
    AppLifecycleState.hidden,
    AppLifecycleState.inactive,
    AppLifecycleState.resumed,
  ]) {
    tester.binding.handleAppLifecycleStateChanged(s);
  }
  await tester.pumpAndSettle();
}

void main() {
  for (final size in [portrait, landscape]) {
    final label = size == portrait ? 'vertical' : 'horizontal';

    testWidgets('obligatoria en celular ($label): solo "Actualizar", sin desbordes',
        (tester) async {
      await pumpScreen(
        tester,
        AppUpdateScreen(
          info: _info,
          mandatory: true,
          installer: FakeInstaller(),
          downloader: FakeDownloader(),
        ),
        size: size,
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Actualización obligatoria'), findsOneWidget);
      expect(find.text('Actualizar'), findsOneWidget);
      expect(find.text('Más tarde'), findsNothing);
      expect(find.textContaining('Arreglos en la guía'), findsOneWidget);
    });

    testWidgets('permiso para instalar ($label): explica, abre ajustes y sigue al volver',
        (tester) async {
      final installer = FakeInstaller(allowed: false);
      await pumpScreen(
        tester,
        AppUpdateScreen(
          info: _info,
          mandatory: false,
          installer: installer,
          downloader: FakeDownloader(),
          onLater: () async {},
        ),
        size: size,
      );
      expect(tester.takeException(), isNull);
      expect(find.textContaining('Android te va a pedir permiso'), findsOneWidget);
      expect(find.textContaining('Toca «Abrir ajustes»'), findsOneWidget);
      expect(installer.installed, isEmpty);

      await tester.ensureVisible(find.text('Abrir ajustes'));
      await tester.tap(find.text('Abrir ajustes'));
      await tester.pumpAndSettle();
      expect(installer.settingsOpened, 1);

      // El usuario activa el permiso y vuelve a la app: se instala sin tocar nada más.
      installer.allowed = true;
      await leaveAndReturn(tester);
      expect(installer.installed, ['C:/cache/updates${Platform.pathSeparator}iptv-player-2003.apk']);
      expect(find.textContaining('Se abrió el instalador de Android'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('opcional con toque: descarga, verifica e instala', (tester) async {
    final installer = FakeInstaller();
    final downloader = FakeDownloader();
    await pumpScreen(
      tester,
      AppUpdateScreen(
        info: _info,
        mandatory: false,
        installer: installer,
        downloader: downloader,
        onLater: () async {},
      ),
    );
    expect(downloader.calls, 1);
    expect(installer.installed, hasLength(1));
    expect(find.textContaining('Toca «Actualizar»'), findsOneWidget);

    // Si vuelve a la app sin instalar (canceló el instalador), puede reintentar.
    await leaveAndReturn(tester);
    expect(find.text('La actualización no se instaló. Puedes intentarlo de nuevo.'),
        findsOneWidget);
    await tester.tap(find.text('Instalar'));
    await tester.pumpAndSettle();
    expect(installer.installed, hasLength(2));
  });

  testWidgets('se corta la red en segundo plano: continúa sola al volver', (tester) async {
    final installer = FakeInstaller();
    final downloader = FakeDownloader(networkFailures: 1);
    await pumpScreen(
      tester,
      AppUpdateScreen(
        info: _info,
        mandatory: true,
        autoStart: true,
        installer: installer,
        downloader: downloader,
      ),
    );
    expect(find.textContaining('la conexión se cortó'), findsOneWidget);
    expect(find.text('Reintentar'), findsOneWidget);
    expect(installer.installed, isEmpty);

    await leaveAndReturn(tester);
    expect(downloader.calls, 2);
    expect(installer.installed, hasLength(1));
  });

  testWidgets('"Más tarde" en la pantalla opcional avisa y cierra', (tester) async {
    var later = 0;
    tester.view.physicalSize = portrait * 3;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.dark(),
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => AppUpdateScreen(
                  info: _info,
                  mandatory: false,
                  autoStart: false,
                  installer: FakeInstaller(),
                  downloader: FakeDownloader(),
                  onLater: () async => later++,
                ),
              )),
              child: const Text('abrir'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Más tarde'));
    await tester.pumpAndSettle();
    expect(later, 1);
    expect(find.text('abrir'), findsOneWidget);
  });

  for (final size in [portrait, landscape]) {
    testWidgets('ventana "Hay una actualización" en celular (${size.width}x${size.height})',
        (tester) async {
      tester.view.physicalSize = size * 3;
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      UpdatePromptChoice? choice;
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.dark(),
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () async =>
                    choice = await showAppUpdateDialog(context, _info),
                child: const Text('abrir'),
              ),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('abrir'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Hay una actualización'), findsOneWidget);
      expect(find.textContaining('Versión 1.0.2'), findsOneWidget);
      await tester.tap(find.text('Actualizar'));
      await tester.pumpAndSettle();
      expect(choice, UpdatePromptChoice.update);
    });
  }
}
