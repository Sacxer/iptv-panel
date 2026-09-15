import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:iptv_player/services/server_discovery.dart';
import 'package:iptv_player/theme.dart';
import 'package:iptv_player/widgets/server_discovery_sheet.dart';

/// Búsqueda falsa que responde al instante.
class FakeDiscovery extends ServerDiscovery {
  final DiscoveryResult result;
  const FakeDiscovery(this.result);

  @override
  Future<DiscoveryResult> discover({
    DiscoveryUpdate? onUpdate,
    DiscoveryCancelToken? cancelToken,
  }) async {
    if (result.servers.isNotEmpty) onUpdate?.call(result.servers);
    return result;
  }
}

const _portal = DiscoveredServer(
  name: 'Mi IPTV',
  url: 'http://192.168.1.46:8080',
  version: '1.0.0',
  publicUrl: 'http://iptv.midominio.co:8080',
  ports: [8080],
);

class Picked {
  bool done = false;
  String? value;
}

/// Abre la búsqueda desde un botón y guarda lo que devuelve.
Future<Picked> open(WidgetTester tester, ServerDiscovery discovery,
    {Size size = const Size(400, 800)}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final picked = Picked();
  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.dark(),
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: ElevatedButton(
            onPressed: () async {
              picked.value =
                  await showServerDiscovery(context, discovery: discovery);
              picked.done = true;
            },
            child: const Text('abrir'),
          ),
        ),
      ),
    ),
  ));
  await tester.tap(find.text('abrir'));
  await tester.pumpAndSettle();
  return picked;
}

void main() {
  testWidgets('un servidor: se muestra preseleccionado y se confirma',
      (tester) async {
    final picked = await open(
        tester, const FakeDiscovery(DiscoveryResult(servers: [_portal])));

    expect(find.byType(BottomSheet), findsOneWidget);
    expect(find.text('Servidor encontrado'), findsOneWidget);
    expect(find.text('Mi IPTV'), findsOneWidget);
    expect(find.text('http://192.168.1.46:8080'), findsOneWidget);
    expect(find.text('Versión 1.0.0'), findsOneWidget);
    expect(find.text('Fuera de casa: http://iptv.midominio.co:8080'),
        findsOneWidget);
    expect(find.byIcon(Icons.check_circle), findsOneWidget);

    await tester.tap(find.text('Usar este servidor'));
    await tester.pumpAndSettle();
    expect(picked.done, isTrue);
    expect(picked.value, 'http://192.168.1.46:8080');
  });

  testWidgets('"Usar esta" devuelve la URL de fuera de casa', (tester) async {
    final picked = await open(
        tester, const FakeDiscovery(DiscoveryResult(servers: [_portal])));
    await tester.tap(find.text('Usar esta'));
    await tester.pumpAndSettle();
    expect(picked.value, 'http://iptv.midominio.co:8080');
  });

  testWidgets('varios servidores: tocar uno lo elige', (tester) async {
    final picked = await open(
      tester,
      const FakeDiscovery(DiscoveryResult(servers: [
        _portal,
        DiscoveredServer(name: 'Sala', url: 'http://192.168.1.60:25461'),
      ])),
    );
    expect(find.text('Se encontraron 2 servidores'), findsOneWidget);
    expect(find.text('Usar este servidor'), findsNothing);
    await tester.tap(find.text('Sala'));
    await tester.pumpAndSettle();
    expect(picked.value, 'http://192.168.1.60:25461');
  });

  testWidgets('control remoto (TV): OK usa el servidor enfocado',
      (tester) async {
    final picked = await open(
      tester,
      const FakeDiscovery(DiscoveryResult(servers: [_portal])),
      size: const Size(1280, 720),
    );
    expect(find.byType(Dialog), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.select);
    await tester.pumpAndSettle();
    expect(picked.value, 'http://192.168.1.46:8080');
  });

  testWidgets('sin resultados: mensaje amable y cerrar', (tester) async {
    final picked = await open(
      tester,
      const FakeDiscovery(DiscoveryResult(networks: [
        LocalNetwork(interfaceName: 'wlan0', address: '192.168.1.23'),
      ])),
    );
    expect(
        find.text('No se encontró el servidor. Comprueba que el equipo esté '
            'conectado a la misma red Wi-Fi que el servidor, o escribe la '
            'dirección que te dio tu proveedor.'),
        findsOneWidget);
    expect(find.text('IP de este equipo: 192.168.1.23'), findsOneWidget);
    expect(find.text('Buscar de nuevo'), findsOneWidget);
    await tester.tap(find.text('Cerrar'));
    await tester.pumpAndSettle();
    expect(picked.done, isTrue);
    expect(picked.value, isNull);
  });

  testWidgets('solo datos móviles: lo dice de entrada', (tester) async {
    await open(tester,
        const FakeDiscovery(DiscoveryResult(noLocalNetwork: true)));
    expect(find.text('Sin conexión Wi-Fi'), findsOneWidget);
    expect(find.textContaining('no está conectado a una red Wi-Fi'),
        findsOneWidget);
  });
}
