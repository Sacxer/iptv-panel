# IPTV Player (app cliente)

Aplicación reproductora IPTV hecha en Flutter para **teléfonos y tabletas Android**, **Android TV / Google TV / Fire TV** y **Windows**.
Interfaz en español, tema oscuro, usable con pantalla táctil, ratón, teclado y control remoto (D-pad).

## Funciones

- **Perfiles** guardados (se elige uno al iniciar, se pueden editar y eliminar):
  - **Xtream Codes**: URL del servidor con puerto, usuario y contraseña (`player_api.php`).
  - **Lista M3U por URL**.
  - **Lista M3U desde archivo** (se guarda una copia dentro de la app).
- **Inicio** con accesos rápidos, canales recientes, "Continuar viendo" y favoritos.
- **TV en vivo**: categorías, canales con logo y guía **Ahora / Después** con barra de progreso (EPG de Xtream, carga perezosa y caché de 5 min).
- **Películas** y **Series** en cuadrícula de pósters, con ficha (`get_vod_info`) y temporadas/episodios (`get_series_info`).
- **Favoritos**, **Recientes** (por perfil), **Buscar** global (sin distinguir tildes).
- **Deslizar hacia abajo para actualizar** listas.
- **Reproductor** (media_kit: MPEG-TS, HLS, MP4, MKV…):
  - Pantalla completa en horizontal (restaura la orientación al salir) y pantalla siempre encendida.
  - Toque: muestra/oculta controles. Doble toque izquierda/derecha: ±10 s (películas y episodios).
  - En vivo: deslizar arriba/abajo o botón **Canales** para cambiar de canal; botón **EPG** con la guía de hoy.
  - Pistas de audio y subtítulos, relación de aspecto (Ajustar / Rellenar / 16:9 / Estirar / 4:3), bloqueo de controles.
  - Reconexión automática con indicador, continuar película/episodio donde se dejó, siguiente episodio automático.
  - Control remoto / teclado: ↑/↓ o CH+/CH− cambian de canal, ←/→ adelantan/retroceden, OK muestra controles, Atrás oculta/sale.
- **Portal propio** (solo si `GET /api/client/ping` responde `portal: true`):
  - Avisos en **carrusel** (banner), **cinta** desplazable y **ventana emergente** (una vez por aviso), coloreados por nivel.
  - **Mensajes** con icono/color por tipo, insignia de no leídos y ventana al abrir la app para los de tipo `popup`.
  - Estado y vencimiento de la cuenta; pantallas de bloqueo por **suspensión / vencimiento** o **corte con bloqueo de reproducción**.
  - **Latido de reproducción** (`/api/client/playing` y `/api/client/stopped`) y aviso de **"Límite de conexiones alcanzado"**.
  - Identificación del equipo con cabeceras `X-Device-Id`, `X-Device-Type`, `X-Device-Brand`, `X-Device-Model`, `X-App-Name`,
    `X-App-Version`, `X-App-Build` y `X-App-Distribution` (también en las peticiones de video, para no duplicar dispositivos).
  - **Actualizaciones desde el portal** (solo versión *portal*, ver abajo).

## Requisitos para compilar

- Flutter 3.44 o superior (probado con 3.44.8 / Dart 3.12.2).
- Android: Android SDK (plataforma 36, build-tools 36) y Java 17+.
- Windows: Visual Studio (o Build Tools) con la carga de trabajo "Desarrollo para el escritorio con C++".

```bash
flutter pub get
flutter analyze
flutter test
```

## Ejecutar en desarrollo

```bash
# Windows
flutter run -d windows

# Teléfono o TV Android conectado por USB o por red (depuración ADB activada)
adb connect 192.168.1.50:5555      # solo si es por red (TV Box / Fire TV)
flutter devices
flutter run -d <id-del-dispositivo>
```

## Dos distribuciones: Portal y Play

> **Por ahora la app no está publicada en Google Play: el APK de la versión _portal_ es el que se instala en
> celulares, tabletas y TV box**, y se actualiza sola desde el portal. La versión Play queda lista para más adelante.

Es **la misma app** (paquete `com.iptvplayer.app`, misma firma) compilada de dos formas (*flavors* de Gradle):

| Versión | Para | Se actualiza | Diferencias |
|---|---|---|---|
| **portal** (`.apk`) | Celulares, tabletas y TV box (hoy, todos los equipos) | Desde el portal | Con actualizador propio (`android/app/src/portal`) |
| **play** (`.aab`) | Futura publicación en Google Play | Google Play | Sin permiso `REQUEST_INSTALL_PACKAGES` ni actualizador |

- En Dart la versión se sabe con `--dart-define=DISTRIBUTION=play|portal` (y el flavor); ver `lib/services/distribution.dart`.
  En la versión Play el código del actualizador queda fuera de la compilación.
- Sin `--flavor` (`flutter run`, pruebas locales) se usa **portal** (`default-flavor` en `pubspec.yaml`).
- `versionCode`: Play usa el número de compilación (`1.0.1+2` → 2); los APK por arquitectura usan 1000×ABI + compilación
  (armeabi-v7a 1002, arm64-v8a 2002, x86_64 4002). Cada equipo sigue en su canal.

## Compilar

```bash
# Portal: APK por arquitectura (celulares y TV box)
flutter build apk --release --split-per-abi --flavor portal --dart-define=DISTRIBUTION=portal

# Portal: APK universal (sirve en todos, pesa más)
flutter build apk --release --flavor portal --dart-define=DISTRIBUTION=portal

# Google Play (.aab), solo cuando se publique en Play
flutter build appbundle --release --flavor play --dart-define=DISTRIBUTION=play

# Windows
flutter build windows --release
```

O todo junto con `scripts\publicar.ps1` (ver "Publicar una versión").

Salidas y a qué equipo enviarlas:

| Archivo | Celulares y tabletas | TV box |
|---|---|---|
| `build/app/outputs/flutter-apk/app-arm64-v8a-portal-release.apk` | **Casi todos** los de los últimos años | La mayoría de los recientes |
| `build/app/outputs/flutter-apk/app-armeabi-v7a-portal-release.apk` | Viejos o muy económicos (32 bits) | Económicos y Fire TV Stick viejos (Android de 32 bits) |
| `build/app/outputs/flutter-apk/app-portal-release.apk` | **Universal**: si no sabes cuál | Universal: si no sabes cuál |
| `build/app/outputs/flutter-apk/app-x86_64-portal-release.apk` | Emuladores y equipos Intel/AMD | — |
| `build/app/outputs/bundle/playRelease/app-play-release.aab` | Google Play Console (más adelante) | |
| `build/windows/x64/runner/Release/` | Carpeta completa de la app de Windows (copie toda la carpeta) | |

Después de instalada, cada equipo recibe desde el portal solo la actualización de su arquitectura.

## Instalar el APK en un teléfono Android

1. Copie el APK al teléfono (cable USB, Google Drive, WhatsApp, correo…) o descárguelo desde un enlace.
2. Ábralo desde el administrador de archivos. Android pedirá permiso para
   **"Instalar apps de origen desconocido"**: actívelo para la app con la que abrió el archivo
   (Ajustes → Aplicaciones → Acceso especial → Instalar apps desconocidas).
3. Pulse **Instalar**.

Con cable y ADB (depuración USB activada en Opciones de desarrollador):

```bash
adb install -r build/app/outputs/flutter-apk/app-arm64-v8a-portal-release.apk
```

**¿Qué APK elegir?** `arm64-v8a` para casi todos los teléfonos de los últimos años. Si al instalar aparece
"La app no es compatible", use `armeabi-v7a` o el **universal** (`app-portal-release.apk`).

## Instalar en Android TV / Google TV / Fire TV (sideload)

- **Android TV / Google TV**: active *Ajustes → Preferencias del dispositivo → Información → Compilación* (pulse 7 veces) y luego
  *Opciones de desarrollador → Depuración USB/ADB*. Instale con `adb connect IP_DEL_TV:5555` y `adb install -r app-release.apk`,
  o copie el APK con una app como *Send files to TV* y ábralo con un administrador de archivos.
- **Fire TV**: *Configuración → Mi Fire TV → Opciones para desarrolladores → Apps de origen desconocido* (o *Depuración ADB*).
  Use la app **Downloader** con la URL del APK o `adb install`.
- La app aparece en el lanzador de TV con su banner (320×180).

## Iniciar sesión

Al abrir la app por primera vez, pulse **Agregar perfil** y elija el tipo:

- **Xtream Codes**
  - *URL del servidor*: incluya `http://` y el **puerto de clientes**, por ejemplo `http://tv.midominio.com:25461`
    (en la red local, la IP de la PC: `http://192.168.1.10:25461`; el teléfono no puede usar `localhost`).
    Si el portal separa panel y clientes, el puerto del panel (8080) no sirve para la app.
  - **Buscar servidor en mi red** lo encuentra solo (ver abajo).
  - *Usuario* y *Contraseña* entregados por su proveedor.
- **Lista M3U (URL)**: pegue el enlace completo, por ejemplo `http://servidor:puerto/get.php?username=U&password=P&type=m3u_plus&output=ts`.
- **Lista M3U (archivo)**: seleccione un archivo `.m3u` / `.m3u8` del equipo.

Mensajes de error comunes: "Usuario o contraseña incorrectos", "Su suscripción ha vencido", "Su cuenta está suspendida",
"No se pudo conectar con el servidor" (revise URL, puerto y red; el botón **Buscar servidor** lo busca en otras direcciones).

### Buscar el servidor en la red

- UDP (`IPTV-DISCOVER v1` al puerto 25460) a `255.255.255.255` y a la difusión **real** de cada red, y a la vez un barrido.
- En Android la máscara y la puerta de enlace se leen del sistema (canal `iptv_player/network`, solo
  `ACCESS_NETWORK_STATE`); en otras plataformas se asume /24.
- Barrido: conexión TCP rápida (300 ms, 96 a la vez) a los puertos 25461, 8080 y 80, y `GET /api/client/ping` solo si
  está abierto. Cada puerto recorre la red por tramos /24: primero el del equipo, luego el del router y después los
  vecinos por cercanía; redes grandes se recortan a la /16 del equipo. Límite: 8 s en una /24, hasta 30 s en redes grandes,
  con progreso ("Buscando en 172.27.0.0/19… 35 %") y Cancelar.
- Si responde el puerto del panel ("Los clientes usan el puerto N"), se usa el mismo equipo con el puerto N.

### Si el servidor cambia de dirección (portal propio, desde 1.0.2)

- Tras cada `/api/client/info` la app guarda en el perfil el **id** del portal, sus direcciones (`server.urls`) y los
  puertos de clientes.
- Si una petición falla por red (o responde el puerto del panel), primero comprueba la dirección actual; si no responde
  como ese portal, prueba el mismo equipo con el puerto de clientes (caso panel), las direcciones guardadas y por último
  la red local, **aceptando solo el mismo id**. Al encontrarlo actualiza el perfil, repite la petición y avisa
  "Servidor encontrado en la nueva dirección". Lo mismo al abrir la app, en el sondeo del portal cada 5 min y cuando el
  reproductor no logra reconectar (sigue con la dirección nueva).
- Una búsqueda a la vez y como máximo una cada 20 s (el botón **Buscar servidor** no espera).
- Listas M3U y servidores Xtream que no son el portal: sin cambios; ahí **Buscar servidor** abre la búsqueda en la red y
  el usuario elige.
- Código: `lib/services/portal_relocator.dart`, `server_discovery.dart`, `server_endpoint.dart` (dirección compartida),
  `lib/providers/session_provider.dart`.

## Personalizar la marca

### Nombre de la app
1. `lib/constants.dart` → `AppConfig.appName` (textos dentro de la app, título de ventana y cabecera `X-App-Name`).
2. Android: `android/app/src/main/AndroidManifest.xml` → `android:label="IPTV Player"`.
3. Windows: `windows/runner/main.cpp` (título inicial) y `windows/runner/Runner.rc` (`ProductName`, `FileDescription`).
4. Banner de TV: `android/app/src/main/res/drawable-xhdpi/banner.png` (320×180).

### Icono
- Android (adaptativo, Android 8+): `android/app/src/main/res/drawable/ic_launcher_foreground.xml` (vector) y
  `drawable/ic_launcher_background.xml` (fondo). Android 7: PNG en `res/mipmap-*/ic_launcher.png` y `ic_launcher_round.png`.
- Alternativa automática: agregue `flutter_launcher_icons` en `dev_dependencies`, configure su imagen de 1024×1024 y ejecute
  `dart run flutter_launcher_icons`.
- Windows: reemplace `windows/runner/resources/app_icon.ico`.

### ID del paquete (package id)
- `android/app/build.gradle.kts` → `applicationId = "com.iptvplayer.app"`. Cambiarlo crea una app distinta (no actualiza la anterior).
- El `namespace` (`com.iptvplayer.iptv_player`) es el paquete del código Kotlin; solo cámbielo si también mueve
  `android/app/src/main/kotlin/.../MainActivity.kt` a la carpeta y `package` correspondientes.

## Firma

- Llave: `android/keystore/iptv-player.jks` (RSA 4096, alias `iptv-player`, 10 000 días).
- Contraseñas: `android/key.properties` (`storeFile=keystore/iptv-player.jks`, `storePassword`, `keyAlias`, `keyPassword`;
  la ruta es relativa a `android/`). En PKCS12 la contraseña del almacén y la de la clave son la misma.
- `android/app/build.gradle.kts` firma `release` con esa llave. Si falta `key.properties` (otro equipo), compila igual con la
  **clave de depuración** y muestra un AVISO: esa compilación no sirve para Play ni para actualizar equipos instalados.
- La llave y `key.properties` están en `.gitignore`. **No se suben a ningún lado**; guarde copia en USB y gestor de contraseñas.
  Si se pierde, no se pueden publicar más actualizaciones con esa firma.
- Google Play debe firmar con **esta misma llave** (así Play y Portal son la misma app). Al crear la app en Play Console elija
  "Exportar y subir una clave desde Java KeyStore", descargue `pepk.jar` y la clave de cifrado `.pem`, y ejecute:

```powershell
.\scripts\clave-para-play.ps1 -Pepk C:\Descargas\pepk.jar -ClaveCifrado C:\Descargas\encryption_public_key.pem
```

  Sube el `clave-play.zip` que genera (cifrado para Google) en esa pantalla. Guía completa: `docs/PLAY-STORE.md`.

Ver la huella del certificado: `keytool -list -v -keystore android/keystore/iptv-player.jks -alias iptv-player`.

## Publicar una versión

1. Suba la versión en `pubspec.yaml`: `version: 1.0.2+3` (nombre + número que **siempre** sube).
2. Compile (y opcionalmente suba los APK al portal):

```powershell
.\scripts\publicar.ps1                                                   # APK por arquitectura + universal
.\scripts\publicar.ps1 -Portal http://192.168.1.46:8080 -Usuario admin   # y los sube al portal (pide la contraseña)
.\scripts\publicar.ps1 -SinCompilar -Portal http://…                     # repite solo la subida
.\scripts\publicar.ps1 -Play                                             # también el .aab de Google Play
```

   Opciones: `-SinUniversal` (no compila el universal), `-GitHub` (**pendiente**: subir a GitHub Releases, aún no hace nada).
   Comprueba con `aapt2` que cada APK tenga la versión de `pubspec.yaml`, muestra lo que el portal leyó de cada APK y
   termina con la lista de qué APK enviar a celulares y a TV box. Los APK quedan **sin publicar** en el portal.
3. **Portal** → *Actualizaciones de la app* → revisar la versión → **Publicar** (se puede limitar por tipo de equipo:
   celulares, tabletas o TV box; hacer despliegue gradual o marcarla obligatoria).
4. Cuando se publique en Google Play: Play Console → Producción (o Pruebas) → Crear versión → subir `app-play-release.aab`.

> Sin "Android SDK Command-line Tools" (Android Studio → SDK Manager → SDK Tools), `flutter build appbundle` dice
> "failed to strip debug symbols" aunque el `.aab` quedó bien; `publicar.ps1 -Play` lo revisa por su cuenta y sigue.

## Actualizaciones desde el portal (versión portal)

- La app consulta `GET /api/client/app-update` (sin credenciales) al abrir (con el último perfil usado), cada 6 horas y desde
  **Cuenta / Ajustes → Acerca de → Buscar actualizaciones**. Si el servidor no es el portal no pasa nada.
  Envía el tipo real de equipo (`mobile`, `tablet`, `tvbox`), así el portal puede ofrecer una versión solo a algunos.
- Opcional: ventana *Actualizar / Más tarde* ("Más tarde" calla esa versión 24 h). No interrumpe el reproductor.
- Obligatoria: la app muestra solo la pantalla de actualización hasta instalarla.
- Descarga en la caché de la app con barra de progreso y cancelar; la pantalla no se apaga mientras descarga. Si se corta la
  red (o la app pasa a segundo plano), espera a volver y **continúa donde quedó** (`Range`). Verifica el **sha256** antes de
  instalar (si no coincide, borra el archivo y avisa).
- Instala con el instalador de Android. Si falta el permiso *Instalar apps desconocidas*, explica en palabras simples que
  Android pedirá permiso para esta app, abre ese ajuste y **sigue sola al volver**.
- Funciona con pantalla táctil (vertical u horizontal; en celulares los botones van a lo ancho) y con control remoto.
- Código: `lib/services/app_update.dart` (consulta y reglas), `apk_downloader.dart`, `apk_installer.dart`,
  `lib/providers/app_update_provider.dart`, `lib/widgets/app_update_widgets.dart` y en Android `src/portal/`.

## Estructura

```
lib/
  constants.dart        Nombre de la app y tiempos
  theme.dart            Tema oscuro y colores
  main.dart             Arranque, proveedores, atajos globales (Esc/F11)
  models/               Perfil, contenido, Xtream (tolerante a números/strings), portal
  services/             xtream_api, m3u_parser (isolate), portal_api, heartbeat, epg_service,
                        content_source (Xtream/M3U), storage, device (cabeceras y ventana),
                        server_discovery (buscar el portal en la red), native_network (máscara real en Android),
                        portal_relocator y server_endpoint (reencontrar el portal), distribution (play/portal),
                        app_update, apk_downloader, apk_installer (actualizador)
  providers/            perfiles, sesión, biblioteca (favoritos/recientes), portal, actualizaciones
  screens/              perfiles, inicio, en vivo, catálogo, detalles, reproductor, buscar, mensajes, cuenta
  widgets/              FocusableCard (foco para control remoto), tarjetas, EPG, avisos del portal, actualización
android/app/src/play/   Versión Google Play (sin actualizador)
android/app/src/portal/ Versión portal: permiso de instalación, canal nativo y proveedor del APK
scripts/                publicar.ps1 (compilar y subir al portal), clave-para-play.ps1 (llave para Play)
android/app/src/main/   NetworkInfoChannel.kt (redes con máscara y puerta de enlace)
test/                   Parser M3U, modelos Xtream, EPG, avisos, descubrimiento, reconexión, actualizaciones y descarga
```

## Notas

- Las listas M3U con cabecera `url-tvg` no cargan guía XMLTV por ahora (la EPG solo está disponible con perfiles Xtream).
- `usesCleartextTraffic="true"` permite servidores `http://`, muy comunes en IPTV.
