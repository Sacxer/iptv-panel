# Plataforma IPTV

Portal de administración + apps para reproducir listas M3U/Xtream en Android, Android TV, Windows,
Samsung (Tizen) y LG (webOS). Puede **reemplazar a XtreamUI sin que los clientes pierdan el acceso** o
funcionar desde cero en una instalación nueva.

| Carpeta | Qué es | Tecnología |
|---|---|---|
| [`server/`](server/) | API del portal, API compatible Xtream, migrador XtreamUI | Node.js 20+, Express, SQLite / PostgreSQL / MySQL |
| [`admin/`](admin/) | Portal web de administración | React + Vite (lo sirve el servidor en `/admin`) |
| [`app/`](app/) | App para Android, Android TV/Fire TV y Windows | Flutter + media_kit |
| [`tv/`](tv/) | App para Samsung Tizen y LG webOS | JavaScript ES5, AVPlay / HTML5 |
| [`docs/API.md`](docs/API.md) | Contrato de API compartido por todas las piezas | |
| [`deploy/`](deploy/) | Instalación en Ubuntu, Nginx | |

Aviso: este software reproduce y gestiona listas; eres responsable de tener los derechos para distribuir
el contenido que configures.

## Funciones del portal

Terminología: **Clientes** son las líneas que usan el servicio (usuario/contraseña Xtream y lista M3U);
**Usuarios** son las cuentas que entran al panel (administradores y revendedores).

- **Panel** por secciones: clientes, dispositivos, canales en línea/caídos, películas funcionando/con fallas,
  consumo del servidor (CPU, RAM, disco, red, tiempo encendido) y actividad reciente.
- **Clientes:** crear manual o aleatoriamente, vencimiento, conexiones máximas, prueba, paquetes,
  datos de contacto, extender (+1/3/6/12 meses), suspender con motivo (corte por falta de pago), reactivar,
  acciones masivas, ver conexiones y dispositivos, datos de acceso M3U/Xtream listos para copiar.
- **Dispositivos:** detección automática del equipo con el que se conecta cada cliente (TV Box, Smart TV,
  celular, tablet, PC, decodificador), marca, modelo, app e IP; inventario de TV Box de la empresa (en bodega,
  asignado, en revisión, retirado) y asignación a clientes. Alertas automáticas: equipo sin conexión en 30 días,
  TV Box nuevo detectado y equipo de la empresa usado con la cuenta de otro cliente.
- **Canales, películas, series y episodios**, categorías y **paquetes** (bouquets). Importación de listas M3U
  por URL, texto o archivo. Revisión periódica de las fuentes para saber qué está en línea y qué está caído.
- **Mensajes** a todos, a un usuario o a un paquete, con control de leídos.
- **Avisos** (banner, popup o cinta) con nivel info/advertencia/crítico y ventana de fechas.
- **Cortes** programados globales o por paquete, que pueden bloquear la reproducción.
- **Conexiones activas** con expulsión, **revendedores** que solo ven sus clientes, **registro de actividad**.
- **Migración desde XtreamUI** leyendo directamente su MySQL.
- **API compatible Xtream Codes** (`player_api.php`, `get.php`, `xmltv.php`, `/live/…`) para que IPTV Smarters,
  TiviMate, XCIPTV, etc. sigan funcionando con la misma URL, usuario y contraseña.

Modos de entrega de los streams (Ajustes):

- `redirect`: el servidor valida y redirige (302) a la fuente. Consume muy poco ancho de banda. El límite de
  conexiones es aproximado (cuenta aperturas de canal durante `connection_timeout_seconds`).
- `proxy`: el servidor retransmite el video. Oculta la fuente y controla las conexiones con exactitud, pero
  todo el tráfico pasa por el VPS. Las fuentes HLS (`.m3u8`) se redirigen siempre.
- `xtream_upstream`: redirige al XtreamUI antiguo con las mismas credenciales. Útil mientras conviven ambos.

## Puesta en marcha rápida (desarrollo, en este PC)

```bash
cd server && npm install && npm run dev
```

```bash
cd admin && npm install && npm run dev
```

El panel queda en http://localhost:5173/admin (en desarrollo) o http://localhost:8080/admin (tras
`npm run build` en `admin/`). En el primer arranque se crea el usuario `admin` y su contraseña aparece en la
consola (o define `ADMIN_PASSWORD` en `server/.env`). Pruebas del servidor: `cd server && npm test`.

## Instalación en el VPS (Ubuntu)

Opción A, sin Docker (SQLite, suficiente para miles de usuarios). En una línea, desde GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/Sacxer/iptv-panel/main/install.sh | sudo bash
```

Como XtreamUI: instala todo **sin datos** (sin clientes, canales ni ajustes de otro servidor) y al final muestra la
dirección del panel, el usuario y la contraseña (también quedan en `/root/iptv-credenciales.txt`, solo para root).
Opciones: `| sudo bash -s -- --admin-user soporte --admin-pass 'MiClave123' --clients-port 25461`.

Instala Node.js, compila el panel, crea el servicio `iptv-portal`, configura Nginx (panel en el puerto 80) y abre los
puertos 80, 443, 25461 (clientes) y 25460/udp (búsqueda del servidor desde la app).

- **Actualizar** un servidor ya instalado: ejecutar la misma línea. Hace un backup, actualiza el programa y conserva
  datos, usuarios y ajustes (la base de datos se actualiza sola al arrancar).
- **Olvidé la contraseña del panel**: `sudo bash /opt/iptv/install-ubuntu.sh --reset-admin`.
- Desde una copia local del proyecto: `sudo bash deploy/install-ubuntu.sh` (mismas opciones).
- Pasar clientes y canales de un servidor a otro: backup `.iptvbak` en *Copias de seguridad* y restaurarlo en el nuevo.
Para HTTPS: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d tu-dominio`.

Opción B, con Docker y PostgreSQL:

```bash
cp server/.env.example .env
```

Edita `.env` (define `ADMIN_PASSWORD` y añade `DB_PASSWORD=...`) y luego:

```bash
docker compose up -d --build
```

Para usar MySQL/MariaDB en lugar de SQLite o PostgreSQL, pon `DB_CLIENT=mysql2` y los datos `DB_*` en `.env`.

## Canales de Astra y servidores de streaming

Cada canal tiene un **modo de entrega**:

| Modo | Qué pasa | Cuándo usarlo |
|---|---|---|
| Directo (direct source) | El cliente va directo a la fuente | Fuentes que aguantan muchas conexiones; no gasta ancho de banda del servidor |
| Reenvío por servidor | Un nodo toma la señal **una sola vez** y la reparte a todos sus clientes | Astra y fuentes con límite de conexiones |
| Transcodificar | Igual que reenvío, pero el nodo cambia resolución/bitrate con un perfil (CPU, NVIDIA, Intel) | Bajar consumo de datos, HEVC → H.264, móviles |

**Instalar un servidor de streaming (nodo):** en el portal → Streaming → Servidores → Agregar servidor, y pegar como root en
ese servidor el comando que muestra el portal. Instala Node.js, FFmpeg y el servicio `iptv-node` (logs:
`journalctl -u iptv-node -f`). El nodo arranca cada canal cuando llega el primer cliente y lo apaga 30 s después del último,
salvo que el canal esté marcado como *siempre encendido*. Si la fuente cae, reintenta y pasa a las URLs de respaldo.

**Astra:** Streaming → Astra → Agregar fuente con la URL de la interfaz web de Astra (p. ej. `http://ip:8000`), usuario y
contraseña. El portal lee todos los canales por la API de Astra, permite importarlos en lote eligiendo categoría, modo de entrega,
servidores y paquete, y luego sincroniza solo: canales nuevos, borrados y cambios de URL, además del estado de la señal (al aire,
bitrate, errores CC). Si Astra y el nodo están en el mismo servidor, usa `http://127.0.0.1:8000` como URL de reproducción para
que el tráfico no salga a internet.

**Conexiones activas:** en modo directo el video no pasa por el servidor, así que la conexión solo se estima (se ve un rato tras
abrir el canal). Con reenvío, transcodificación, el modo proxy o la app propia, la conexión es exacta y se mantiene hasta que el
cliente cierra.

## Migrar desde XtreamUI sin que los clientes pierdan el acceso

1. **Permitir el acceso a MySQL de XtreamUI** desde el nuevo servidor. Lo más seguro es un túnel SSH
   desde el VPS nuevo (así MySQL no queda expuesto a internet):
   ```bash
   ssh -N -L 3307:127.0.0.1:3306 root@IP-XTREAMUI
   ```
   y en el portal usar host `127.0.0.1`, puerto `3307`. La alternativa es crear un usuario MySQL de solo
   lectura con permiso desde la IP del VPS nuevo y abrir el puerto 3306 solo a esa IP.
   La base suele llamarse `xtream_iptvpro`. Usa el usuario y la contraseña de MySQL que se definieron al
   instalar XtreamUI, o crea un usuario nuevo de solo lectura (`GRANT SELECT`) desde la consola de MySQL.
2. En el portal, entra en **Migración XtreamUI**, pulsa **Probar conexión** (muestra cuántos usuarios,
   canales, etc. encontró) y luego **Iniciar migración**. Se conservan:
   usuario, contraseña, vencimiento, conexiones máximas, prueba, notas, paquetes y **los mismos IDs** de
   canales, películas, series y episodios. Los bloqueados pasan a *suspendidos* y los desactivados a
   *deshabilitados*. Si activas revendedores, se crean con contraseñas nuevas que se muestran al final.
   Puedes repetir la migración: sin «sobrescribir» solo añade lo nuevo.
3. **Transición sin cortes:** en Ajustes elige `xtream_upstream` con la URL del XtreamUI
   (por ejemplo `http://IP-XTREAMUI:25461`). Los clientes ya se autentican contra el portal, pero el video
   sigue saliendo del XtreamUI.
4. **Cambio de DNS:** apunta el dominio que usan los clientes al nuevo VPS. Como el portal escucha también en
   el puerto **25461** (`EXTRA_PORTS`), las apps siguen conectando con la misma URL. Si los clientes usan la
   IP directamente en lugar de un dominio, habrá que migrar esa IP al VPS nuevo o avisarles del cambio.
5. Cuando verifiques que todo funciona, cambia a `redirect` o `proxy`. Revisa los canales «creados» en
   XtreamUI (transcodificados o grabados): no tienen URL de origen y hay que editarlos o dejarlos en
   `xtream_upstream`.

Limitaciones conocidas: los equipos MAG/Enigma2 (portal Stalker) no se soportan; esas líneas se importan,
pero el equipo debe configurarse con M3U o Xtream. La guía EPG se sirve como proxy de una URL XMLTV
externa (`epg_url`); `get_short_epg` devuelve vacío.

## Instalación inicial sin XtreamUI

1. Crea **categorías** e importa tus listas M3U en **Canales** (o agrega canales a mano).
2. Crea **paquetes** con los canales de cada plan.
3. Crea **usuarios** y asígnales paquetes y vencimiento. Si un usuario no tiene paquetes y
   «Permitir todo sin paquete» está activo, ve todo el catálogo.
4. Entrega a cada cliente la URL del servidor, su usuario y su contraseña (o la URL M3U desde
   *Usuarios → Datos de acceso*).

## Apps

- Android, Android TV y Windows: ver [`app/README.md`](app/README.md).
- Samsung y LG: ver [`tv/README.md`](tv/README.md).

Las apps aceptan cualquier servidor Xtream o lista M3U. Si detectan este portal (`/api/client/ping`),
muestran además los mensajes, avisos, cortes y el estado de la cuenta.
