# App de TV — Samsung (Tizen) y LG (webOS)

App del servicio de IPTV del operador para televisores Samsung Smart TV (Tizen) y LG Smart TV (webOS).
Es una app web empaquetada (HTML, CSS y JavaScript ES5, sin dependencias en el televisor) con las mismas
funciones que la app de celular cuando el servidor es el portal propio: mensajes, avisos, cortes,
identidad del portal, búsqueda en la red local y reconexión si el servidor cambia de dirección.

Contrato con el portal: [`docs/API.md`](../docs/API.md). Guía para publicar en las tiendas:
[`docs/TV-TIENDAS.md`](../docs/TV-TIENDAS.md).

## Contenido

1. [Dos compilaciones](#dos-compilaciones)
2. [Probar en el navegador](#probar-en-el-navegador)
3. [Configuración del operador (`operator.json`)](#configuración-del-operador-operatorjson)
4. [Compilar y empaquetar](#compilar-y-empaquetar)
5. [Iconos, imágenes y capturas](#iconos-imágenes-y-capturas)
6. [Instalar en un televisor Samsung (modo desarrollador)](#instalar-en-un-televisor-samsung-modo-desarrollador)
7. [Samsung por memoria USB](#samsung-por-memoria-usb)
8. [Instalar en un televisor LG (modo desarrollador)](#instalar-en-un-televisor-lg-modo-desarrollador)
9. [Versiones](#versiones)
10. [Qué hace la app](#qué-hace-la-app)
11. [Pruebas](#pruebas)
12. [Estructura](#estructura)
13. [Pendientes y notas para el portal](#pendientes-y-notas-para-el-portal)

## Dos compilaciones

| | Tienda (`npm run build`) | Completa (`npm run build -- --full`) |
|---|---|---|
| Para | Samsung Apps TV y LG Content Store | Televisores propios en modo desarrollador y pruebas |
| Inicio de sesión | Solo **usuario y contraseña** | Xtream Codes (**servidor**, usuario, contraseña) o **lista M3U** |
| Servidor | `serverUrls` de `operator.json`, en orden; la última dirección que funcionó; búsqueda en la red local solo del portal del operador | El que escribe el usuario (viene sugerido el del operador) y «Buscar en mi red» (lista los portales encontrados) |
| Carpeta | `dist/tizen-store`, `dist/webos-store` | `dist/tizen-full`, `dist/webos-full` |

Las tiendas suelen rechazar reproductores IPTV genéricos (que aceptan cualquier lista o servidor); por eso la
compilación de tienda es la app del servicio del operador. Las dos opciones están en `operator.json`
(`allowCustomServer`, `allowM3U`): cambiarlas a `true` abre la compilación de tienda sin tocar código.
Ver «Riesgo de rechazo» en [`docs/TV-TIENDAS.md`](../docs/TV-TIENDAS.md).

## Probar en el navegador

Requisitos: Node.js 18 o superior. No hace falta instalar nada más.

```bash
cd tv
npm install          # solo acorn (verificación ES5)
npm run serve        # http://127.0.0.1:8095
```

- `http://127.0.0.1:8095/full/` → compilación completa · `http://127.0.0.1:8095/store/` → compilación de tienda.
  Cada una guarda sus perfiles aparte.
- Use Chrome con la ventana en 16:9: la interfaz está diseñada a 1920x1080 y se escala (en un televisor de
  1280x720 se ve igual, más pequeña).
- Opciones: `--port 8095`, `--host 0.0.0.0` (abrirla desde otro equipo), `--operator otro.json`,
  `--server-urls http://127.0.0.1:8087,http://…` (reemplaza `serverUrls` para probar con un portal local),
  `--portal-id …`, `--platform tizen|webos` (envía `X-App-Distribution` de esa plataforma).

Teclado (pulse **H** dentro de la app para ver la ayuda):

| Tecla | Control remoto |
|---|---|
| Flechas | Flechas |
| Enter | OK |
| Retroceso o Esc | Atrás |
| R, G, Y, B | Botones rojo, verde, amarillo y azul |
| RePág / AvPág | Canal + / − |
| Espacio o P | Reproducir / pausa |
| S | Detener |
| `,` y `.` | Retroceder / avanzar |
| N / M | Siguiente / anterior (canal o episodio) |
| I | Información |
| 0-9 | Número de canal |
| Q | Salir |
| Ratón | Puntero del Magic Remote de LG (mover enfoca, clic = OK) |

Solo en desarrollo:

- El navegador no puede conocer su IP: para probar «Buscar en mi red» agregue `?lan=192.168.1.0/24`
  (o `?lan=127.0.0.0/30` con un portal en el mismo equipo) y `?lanports=8086,8087` si el portal de pruebas
  no usa los puertos 25461/8080/80.
- En la consola: `IPTV.devView(x, y, ancho)` amplía una zona del diseño de 1920x1080 para revisarla;
  `IPTV.devView()` vuelve a la vista normal.

Vídeo de prueba sin descargar nada: `npm run demo-source` levanta en `127.0.0.1:8097` canales en vivo
(MPEG-TS continuo y HLS) y películas (HLS y TS) generados localmente (H.264 sin compresión), y en `:8098` un
«XtreamUI» simulado sin funciones de portal (usuario `zz-prueba-xui` / `clave123`). `npm run test-media`
escribe archivos de prueba en `test/media/`.

## Configuración del operador (`operator.json`)

Copie `operator.example.json` como `operator.json` (no se sube a GitHub) y complételo:

| Campo | Uso |
|---|---|
| `appName` | Nombre en el televisor, en las imágenes y en `X-App-Name` («IPTV Player») |
| `vendor` | Empresa (autor en `config.xml`, `vendor` en `appinfo.json`) |
| `appId.tizenPackage` | Paquete de Samsung: **exactamente 10 letras o números** (lo asigna usted; debe ser único) |
| `appId.tizenName` | Nombre de la app en Tizen (letras y números) → id `Paquete.Nombre` |
| `appId.webos` | Id de LG en minúsculas (p. ej. `com.suempresa.tv`; no puede empezar por `com.lge`, `com.webos`, `com.palm`) |
| `serverUrls` | Direcciones del portal para los clientes, **en orden**. La app usa la primera que responde (si la IP local del operador coincide con la red de la casa del cliente, pasa a la siguiente) |
| `portalId` | Opcional: el `id` de `http://SERVIDOR:25461/api/client/ping`. Si se indica, la búsqueda en la red solo acepta ese portal |
| `allowCustomServer`, `allowM3U` | Compilación de tienda: `false` y `false` (solo usuario y contraseña) |
| `full` | Valores para `--full` (por defecto ambos `true`); `full.appId` permite otro id para instalar las dos |
| `support` | `name`, `phone`, `whatsapp`, `email`, `web`: se muestran en el inicio de sesión, en Cuenta y en la pantalla de bloqueo |
| `privacyUrl` | Para las fichas de las tiendas (el portal la sirve en `/privacidad`) |
| `tizen.requiredVersion` | `2.3` = televisores Samsung desde 2015 |
| `tizen.certificateProfile` | Perfil de certificado de Tizen Studio para firmar el `.wgt` |
| `tizen.csp` | `true` agrega Content-Security-Policy a `config.xml` (ver «Riesgos») |
| `webos.iconColor` | Color de fondo del icono en el lanzador de LG |

Ejemplo del operador (red del ISP): `"serverUrls": ["http://192.168.30.100:25461"]`. Para la revisión de las
tiendas agregue una segunda dirección pública, p. ej. `"http://IP-PUBLICA-O-DOMINIO:25461"` (los revisores no
están en la red del ISP; ver `docs/TV-TIENDAS.md`). Las direcciones de ejemplo con «IP-PUBLICA» o
«DOMINIO» se omiten al compilar.

Con un XtreamUI (sin portal) la app funciona igual con usuario y contraseña: las funciones del portal
(mensajes, avisos, reconexión) quedan apagadas hasta que el servidor sea el portal propio en el mismo puerto.

## Compilar y empaquetar

```bash
npm run build                  # tienda: dist/tizen-store y dist/webos-store
npm run build -- --full        # completa: dist/tizen-full y dist/webos-full
npm run build -- --all         # las cuatro
npm run build tizen            # solo Samsung (npm run build webos: solo LG)
npm run build -- --usb         # Samsung por USB: dist/tizen-usb/ (completa; --store para la de tienda)
npm run check                  # verifica que todo el JavaScript sea ES5
```

Cada carpeta de `dist/` es la app lista para empaquetar: `index.html`, `js/config.js` generado, CSS con
prefijos para motores antiguos, iconos y `config.xml` (Samsung) o `appinfo.json` (LG). La compilación
verifica ES5 en la salida.

Si la herramienta de la plataforma está instalada, también crea el paquete (este proyecto **no instala**
software de Samsung ni de LG):

- **Samsung** (`tizen` de Tizen Studio, en el PATH o en `C:\tizen-studio`):
  `npm run build tizen -- --profile PERFIL` → `dist/IPTVPlayer-1.0.0-store.wgt`.
  Equivale a `tizen package -t wgt -s PERFIL -- dist/tizen-store`.
- **LG** (`ares-package` de la CLI de webOS TV): `npm run build webos` → `dist/com.iptvplayer.tv_1.0.0_store.ipk`.
  Equivale a `ares-package dist/webos-store -o dist`.

Sin las herramientas, el script explica cómo instalarlas.

`config.xml` (Samsung) declara: `tizen:application` con `required_version` 2.3, perfil `tv-samsung`,
`feature` de pantalla 1920x1080, `access origin="*"` (el servidor del operador puede cambiar de IP y los
canales vienen de varias fuentes), y solo los privilegios que se usan: `internet`, `tv.inputdevice` (teclas),
`network.public` (IP, máscara y estado de la red) y `productinfo` (modelo). AVPlay no necesita privilegio
desde 2015. `appinfo.json` (LG) declara `type: web`, `resolution` 1920x1080, iconos, `splashBackground`,
`disableBackHistoryAPI: true` (la app maneja la tecla Atrás) y `handlesRelaunch: true`.

## Iconos, imágenes y capturas

`npm run icons` genera todo desde el icono y el banner de la app de Android
(`app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` y `drawable-xhdpi/banner.png`), con un
lector/escritor de PNG propio en Node (sin dependencias). Los tamaños menores que la fuente se reducen del
PNG; los mayores se dibujan con el mismo diseño (colores, esquinas y posición medidos del PNG) para que
queden nítidos, con el nombre `appName` en letras de puntos.

| Archivo | Tamaño | Dónde se usa | Requisito (fuente) |
|---|---|---|---|
| `assets/icons/tizen/icon.png` | 117x117 | `config.xml` `<icon>` | Samsung no fija el tamaño; es el de las plantillas de Tizen Studio ([configuring-tv-applications](https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html)) |
| `assets/icons/webos/icon.png` | 80x80 | `appinfo.json` `icon` | «80x80 pixels in PNG» ([appinfo.json](https://webostv.developer.lge.com/develop/references/appinfo-json)) |
| `assets/icons/webos/largeIcon.png` | 130x130 | `appinfo.json` `largeIcon` | «130x130 pixels in PNG» (misma fuente) |
| `assets/icons/webos/splash.png` | 1920x1080 | `splashBackground` / `bgImage` | 1920x1080 PNG (misma fuente) |
| `assets/store/samsung/icon-512x423.png` | 512x423 | Seller Office | PNG 24 bits, menos de 300 KB, 72 DPI ([entering-application-information](https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html), [app-icons-and-screenshots](https://developer.samsung.com/smarttv/design/app-icons-and-screenshots.html)) |
| `assets/store/samsung/logo-1920x1080.png` | 1920x1080 | Seller Office (logotipo) | PNG 32 bits con transparencia, menos de 300 KB, dentro del área segura (mismas fuentes) |
| `assets/store/samsung/background-1920x1080.png` | 1920x1080 | Seller Office (fondo) | PNG/JPG 24 bits, menos de 300 KB (mismas fuentes) |
| `assets/store/lg/icon-400x400.png` | 400x400 | Seller Lounge | 400x400; LG la reduce ([app-resources](https://webostv.developer.lge.com/develop/getting-started/app-resources)) |
| `assets/store/lg/background-1920x1080.png` | 1920x1080 | Seller Lounge (fondo) | 1920x1080, hasta 10 MB (guía de Seller Lounge v11.5) |

**Capturas de pantalla** (se toman de la app real con el contenido del operador):

- **Samsung**: exactamente **4 capturas JPG de 1920x1080**, hasta 500 KB cada una
  ([entering-application-information](https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html)).
  La lista de verificación también admite 1280x720; use 1920x1080.
- **LG**: 1 principal y al menos 2 secundarias (máximo 5), **1920x1080 o 1280x720**, JPG o PNG, hasta 20 MB
  (guía de Seller Lounge v11.5).

Cómo tomarlas: `npm run shots` abre la app en Edge o Chrome sin ventana a 1920x1080, inicia sesión y guarda en
`assets/store/screenshots/` las capturas de tienda (PNG para LG y JPG de hasta 500 KB para Samsung: TV en vivo,
reproductor, películas, detalle de película y serie) y las pantallas extra del documento de LG (`ux-*.png`).
Use una cuenta que solo vea contenido propio o de prueba:

```
node scripts/serve.js --port 8094 --server-urls http://PORTAL:PUERTO_CLIENTES
npm run shots -- --url http://127.0.0.1:8094/store/ --user USUARIO --pass CLAVE --scene --movie "Título" --series "Título"
```

`--scene` tapa el vídeo de prueba con una imagen ilustrativa. `npm run shots -- --art` dibuja con letra normal el
fondo de LG (`assets/store/lg/background-1920x1080.png`; `npm run icons` ya no lo sobrescribe salvo con `--force`).
Con el televisor en modo desarrollador también se pueden tomar del LG real: `ares-device --capture-screen`.

**LG**: los iconos (`webos/icon.png`, `webos/largeIcon.png` y `lg/icon-400x400.png`) son cuadrados, sin esquinas
redondeadas, sin transparencia y con fondo liso del color del mosaico (`operator.json` → `webos.iconColor`): LG
rechaza los redondeados, transparentes o con degradado.

**Documentos para la revisión de LG**:

- `npm run ux-doc -- --test-user U --test-pass P --tested-on "LG 43UR7800 (webOS 23)"` → `dist/lg-ux-scenario.pdf`,
  el documento de uso (UX scenario) en inglés con la estructura de la plantilla de LG 4.3. Lo que falte sale en rojo.
- `npm run lg-checklist` (Windows con Excel) llena la lista de verificación oficial de LG
  (`dist/lg/self_evaluation_checklist_5.0.xlsx`, del ZIP «App Self Checklist» de LG) con las respuestas de
  `assets/store/lg/checklist.json` → `dist/lg/self_evaluation_checklist_PTOVS.xlsx`. Las pruebas que dependen del
  televisor quedan vacías hasta ejecutar `npm run lg-checklist -- -Probado` tras probar en un LG real.

## Instalar en un televisor Samsung (modo desarrollador)

Fuentes: [tv-device](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html),
[creating-certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html),
[command-line-interface](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html).

1. **Tizen Studio** en el PC (instalador de Samsung) y, desde el Package Manager, **TV Extensions** y
   **Samsung Certificate Extension**. Este proyecto no los instala.
2. **Identificador del televisor (DUID)**: en el televisor, Menú → Soporte → Contactar con Samsung →
   «Unique Device ID».
3. **Certificado Samsung**: Tizen Studio → Tools → Certificate Manager → perfil nuevo con certificado de autor
   y certificado de distribuidor Samsung (privilegio *public*), agregando los DUID de los televisores. Guarde
   una copia del certificado de autor: las actualizaciones deben firmarse con el mismo.
4. **Modo desarrollador en el televisor**: Smart Hub → Apps → en «Configuración de apps» escriba **12345** →
   Developer mode **On** → escriba la **IP del PC** → reinicie el televisor. Aparece «Develop Mode» en Apps.
5. **Conectar**: Tizen Studio → Device Manager → Remote Device Manager → «+» con la IP del televisor, o en una
   consola (`C:\tizen-studio\tools`):
   ```bash
   sdb connect 192.168.1.50        # IP del televisor
   sdb devices                     # anote el nombre del equipo
   ```
6. **Compilar, firmar e instalar**:
   ```bash
   npm run build tizen -- --full --profile MI_PERFIL      # dist/IPTVPlayer-1.0.0-full.wgt
   tizen install -t NOMBRE_DEL_EQUIPO --name IPTVPlayer-1.0.0-full.wgt -- dist
   tizen run -t NOMBRE_DEL_EQUIPO -p IptvPlayr1.IPTVPlayer
   ```

Notas:
- Samsung indica que las apps instaladas desde Tizen Studio se desinstalan al apagar el televisor
  ([application-testing](https://developer.samsung.com/smarttv/develop/faq/application-testing.html)):
  para uso permanente la vía es la tienda (o las pruebas alfa/beta de Seller Office, ver `docs/TV-TIENDAS.md`).
- Un certificado con DUID solo permite instalar en esos televisores.
- Si aparece el error 205, cree un perfil nuevo con el nivel de privilegio correcto.

## Samsung por memoria USB

`npm run build -- --usb` deja `dist/tizen-usb/userwidget/` y un `README.txt` con los pasos (compilación
completa; `--store` para la de tienda). Con Tizen Studio y `--profile`, deja el `.wgt` firmado dentro de
`userwidget/`; sin Tizen Studio prepara la carpeta y explica cómo firmar.

Lo que dice Samsung y lo que se sabe (investigado el 2026-09-16):

- **Un `.wgt` no se instala desde USB.** Por seguridad, Samsung solo instala por USB un paquete **`.tmg` con su
  archivo `.license`**, generado con la **«USB Demo Packaging Tool»** de TV Seller Office
  ([FAQ de instalación](https://developer.samsung.com/smarttv/develop/faq/application-installation.html)).
  Un `.wgt` firmado con el certificado de Tizen Studio no sirve por USB (solo por red en modo desarrollador).
- La herramienta aparece en Seller Office **solo para cuentas partner** (según hilos del foro de Samsung) y
  los paquetes de USB **vencen a los 30 días** ([SmartLabs](https://help.smartlabs.tv/docs/demo/apps/samsung),
  [Emby](https://emby.media/community/topic/106249-expiration-of-validity-period/)). La documentación de
  TizenBrew dice que Samsung **ya no genera** estos paquetes
  ([TizenBrew](https://github.com/reisxd/TizenBrew/blob/main/docs/README.md)); Samsung no lo ha anunciado.
- Estructura: carpeta `userwidget` en la raíz de una memoria **USB 2.0 en FAT32** con el `.tmg` y el `.license`
  (sin espacios en el nombre); la instalación empieza al conectarla y la app aparece en Apps
  ([SmartLabs](https://help.smartlabs.tv/docs/demo/apps/samsung), [Smart IPTV](https://siptv.app/howto/sammy/)).
- Modelos: SS IPTV lo usa en Samsung **Tizen 2015–2019** (series J, K, M, N, R) y dice que la app solo funciona
  con la memoria conectada ([ss-iptv.com](https://ss-iptv.com/en/users/documents/installing)); otros indican
  que queda instalada salvo en la serie J. En 2020 y posteriores no está confirmado y hay reportes de bloqueo
  por el firmware.
- **Orsay** (Samsung 2012–2014 y algunos 2015, antes de Tizen) usa el antiguo *Samsung Smart TV SDK*, otro
  formato de app (`config.xml`/`widget.info` propios, empaquetado zip) y otra carpeta de USB: **esta app no es
  compatible y no se implementa** ([legacy](https://developer.samsung.com/smarttv/legacy/overview.html)).

Alternativas oficiales para televisores propios: modo desarrollador por red; en Seller Office, **prueba beta**
(televisores 2021+, con código de activación, hasta 90–180 días) o **prueba alfa** (partner, 2020+, hasta 50
televisores por DUID, 30 días)
([distributing-application](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html),
[beta-test](https://developer.samsung.com/tv-seller-office/faq/beta-test.html)).

## Instalar en un televisor LG (modo desarrollador)

Fuentes: [developer-mode-app](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app),
[cli-installation](https://webostv.developer.lge.com/develop/tools/cli-installation),
[webos-tv-cli-dev-guide](https://webostv.developer.lge.com/develop/tools/webos-tv-cli-dev-guide).

1. **CLI de webOS TV** en el PC (este proyecto no la instala): `npm install -g @webos-tools/cli`
   (LG recomienda Node 14.15.1–16.20.2) y compruebe con `ares -V`.
2. **En el televisor**: instale la app **Developer Mode** desde LG Content Store, inicie sesión con su cuenta
   de LG Developer, active **Dev Mode Status** (el televisor se reinicia) y luego **Key Server**.
3. **Registrar el televisor** en el PC:
   ```bash
   ares-setup-device            # add → nombre "tv", IP del televisor, puerto 9922, usuario prisoner
   ares-novacom --device tv --getkey   # escriba la frase de 6 caracteres que muestra el televisor
   ares-device --system-info --device tv
   ```
4. **Compilar, empaquetar e instalar**:
   ```bash
   npm run build webos -- --full           # dist/com.iptvplayer.tv_1.0.0_full.ipk (si ares-package está)
   ares-install --device tv dist/com.iptvplayer.tv_1.0.0_full.ipk
   ares-launch --device tv com.iptvplayer.tv
   ares-inspect --device tv --app com.iptvplayer.tv --open   # depurar
   ```
5. **Sesión de 50 horas**: el modo desarrollador dura un tiempo limitado (normalmente 50 horas; la app muestra
   «Remain Session»). Antes de que termine pulse **Extend** en la app Developer Mode o ejecute
   `ares-extend-dev --device tv`. Si se vence, el televisor borra las apps de desarrollo y hay que instalarlas
   de nuevo.

## Versiones

- La versión sale de `tv/package.json` (`version`, formato `x.y.z`): va a `config.xml`, a `appinfo.json`, a la
  pantalla Cuenta y a la cabecera `X-App-Version`.
- `X-App-Build` = mayor×10000 + menor×100 + parche (1.2.3 → 10203).
- Límites: Samsung `0-255.0-255.0-65535`; LG tres enteros sin ceros a la izquierda. Cada envío a una tienda
  necesita una versión mayor que la anterior.
- Para publicar: suba la versión en `package.json`, `npm test`, `npm run build`, empaquete y firme.

## Qué hace la app

- **Cabeceras del equipo** en todas las peticiones al portal y a la API Xtream: `X-Device-Id` (aleatorio y
  guardado), `X-Device-Type: smart_tv`, `X-Device-Brand`/`X-Device-Model` (Samsung: `webapis.productinfo`;
  LG: `com.webos.service.tv.systemproperty`), `X-App-Name`, `X-App-Version`, `X-App-Build` y
  `X-App-Distribution: tizen|webos`. Todo en ASCII. Si un servidor ajeno rechaza las cabeceras, se repite sin ellas.
- **Identidad del portal**: guarda `server.id` y `server.urls` de `/api/client/info` en el perfil.
- **Reconexión** (docs/API.md «Identidad del portal y reconexión»), solo con el portal propio (con `id`):
  ante un error de red o el 404 del puerto del panel prueba 1) la dirección actual, 2) el mismo equipo con el
  puerto de clientes que indica el portal, 3) las direcciones guardadas (con `/api/client/ping` y el mismo `id`)
  y 4) un barrido HTTP de la red local aceptando solo el mismo `id`. Nunca cambia a un portal con otro `id`.
  Como máximo una búsqueda cada 20 s (el botón «Buscar servidor» no espera). Aviso: «Servidor encontrado en
  la nueva dirección».
- **Barrido de la red local** (los televisores no pueden usar UDP): subred real del televisor (Samsung
  `tizen.systeminfo` / `webapis.network`; LG `connectionmanager`; si no se sabe, /24), puertos 25461, 8080 y
  80, por tramos /24 empezando por la propia y la del router, como máximo una /16, 40 pruebas a la vez, tiempo
  máximo entre 8 y 45 s, con avance y botón Cancelar.
- **Puertos separados**: el 404 «Los clientes usan el puerto N» del puerto del panel lleva al puerto N.
- **Portal**: mensajes (con tipo y ventanas emergentes), avisos (carrusel según `notice_settings`, cinta y
  emergentes una sola vez), cortes, pantalla de bloqueo (suspendido, vencido, deshabilitado, corte con bloqueo)
  y latido de reproducción (`/api/client/playing` cuando el vídeo empieza, `/stopped` al terminar; 429 →
  «Límite de conexiones alcanzado»).
- **Televisor**: teclas registradas en Samsung (colores, multimedia, canales, números); Atrás navega hacia atrás
  y en la primera pantalla pide confirmación para salir (`tizen.application.getCurrentApplication().exit()` /
  `window.close()`; en LG webOS 23 o posterior vuelve a la pantalla de inicio con `webOS.platformBack()` como
  pide la lista de LG); multitarea (al ocultarse se detiene el canal y se pausa la película con
  `suspend/restore` de AVPlay; al volver sigue igual); aviso «Sin conexión a la red» y reintento automático al
  volver la red; foco visible en todo; puntero del Magic Remote; indicadores de carga.
- **Reproducción**: Samsung con AVPlay (TS y HLS); LG con `<video>` (HLS nativo; MPEG-TS con mpegts.js si hay
  MSE); navegador con hls.js / mpegts.js. Si un formato falla prueba el otro (.ts ↔ .m3u8) y reintenta.

## Pruebas

```bash
npm test          # lector M3U y lógica: URLs Xtream, foco, almacenamiento, cabeceras, subredes y barrido,
                  # orden de reconexión, id del portal, compilación tienda/completa, inicio con varias
                  # direcciones (XtreamUI y portal), latido, teclas, PNG
npm run check     # ES5 en todo src/
```

Las pruebas usan `node:test` y no necesitan red ni navegador.

## Estructura

```
tv/
  src/                 app (index.html, css/app.css, js/, js/ui/, lib/ hls.js y mpegts.js)
  tizen/config.xml     plantilla de Samsung
  webos/appinfo.json   plantilla de LG
  assets/              iconos e imágenes generados (npm run icons)
  scripts/             serve.js, build.js, make-icons.js, check-es5.js y lib/
  test/                pruebas y fixtures (vídeo de prueba, XtreamUI simulado)
  operator.example.json
```

Librerías incluidas: [hls.js](https://github.com/video-dev/hls.js) 1.7.3 y
[mpegts.js](https://github.com/xqq/mpegts.js) 1.8.2, ambas con licencia Apache-2.0 (ver
`src/lib/THIRD-PARTY-NOTICES.txt`).

## Pendientes y notas para el portal

- Las peticiones de vídeo (`<video>`, AVPlay) no pueden llevar `X-Device-Id`: con el portal propio la URL lleva
  `?did=<id del equipo>` y el portal la une al mismo equipo. Con otros servidores (XtreamUI) la URL no cambia.
- El latido (`/api/client/playing`) cubre canales, películas y episodios (en el portal los episodios también
  están en `streams`).
- Probar en televisores reales: AVPlay, `config.xml` con CSP (si AVPlay no carga, compile con `--no-csp`),
  registro de teclas y el comportamiento de Atrás en LG webOS 23+.
