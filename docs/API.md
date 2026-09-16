# Contrato de API — Plataforma IPTV

Este documento es la fuente de verdad compartida por `server/`, `admin/`, `app/` y `tv/`.

Convenciones generales:

- JSON en UTF-8. Errores: `{"error": "mensaje legible"}` con código HTTP 4xx/5xx.
- Fechas: **segundos unix (entero)** o `null` (en `exp_date`, `null` = sin vencimiento).
- Booleanos siempre `true`/`false` en la API de administración y la API de cliente
  (la API compatible Xtream usa los formatos string que esperan las apps de terceros).
- Paginación: `?page=1&limit=50` → `{"data": [...], "total": 123, "page": 1, "limit": 50}`.

---

## 1. API compatible Xtream Codes (clientes de terceros y apps propias)

Permite que los clientes migrados desde XtreamUI sigan usando **la misma URL, usuario y contraseña**
en IPTV Smarters, TiviMate, XCIPTV, etc. El servidor escucha en `PORT` y además en `EXTRA_PORTS`
(por ejemplo `25461`, el puerto por defecto de XtreamUI).

### `GET|POST /player_api.php?username=U&password=P[&action=...]`

Sin `action` → autenticación:

```json
{
  "user_info": {
    "username": "juan", "password": "abc123", "message": "",
    "auth": 1, "status": "Active", "exp_date": "1767225600", "is_trial": "0",
    "active_cons": "0", "created_at": "1700000000", "max_connections": "1",
    "allowed_output_formats": ["m3u8", "ts"]
  },
  "server_info": {
    "url": "tv.midominio.com", "port": "25461", "https_port": "443",
    "server_protocol": "http", "rtmp_port": "0", "timezone": "UTC",
    "timestamp_now": 1726300000, "time_now": "2026-09-14 10:00:00", "process": true
  }
}
```

- Credenciales incorrectas → `{"user_info": {"auth": 0}}`.
- `status`: `Active` | `Expired` | `Banned` (suspendido / corte) | `Disabled`.
  `exp_date` es `null` si no vence. `message` lleva el motivo de suspensión o corte.
- Si el estado no es `Active`, las acciones de listado devuelven `[]`.

Acciones:

| action | Parámetros | Respuesta |
|---|---|---|
| `get_live_categories` | – | `[{"category_id":"1","category_name":"Deportes","parent_id":0}]` |
| `get_vod_categories` | – | igual |
| `get_series_categories` | – | igual |
| `get_live_streams` | `category_id` opcional | `[{"num":1,"name":"Canal 1","stream_type":"live","stream_id":10,"stream_icon":"http://…","epg_channel_id":"canal1.co","added":"1700000000","category_id":"1","custom_sid":"","tv_archive":0,"direct_source":"","tv_archive_duration":0}]` |
| `get_vod_streams` | `category_id` opcional | `[{"num":1,"name":"Película","stream_type":"movie","stream_id":20,"stream_icon":"","rating":"7.5","rating_5based":3.75,"added":"1700000000","category_id":"5","container_extension":"mp4","custom_sid":"","direct_source":""}]` |
| `get_vod_info` | `vod_id` | `{"info":{"movie_image":"","plot":"","genre":"","releasedate":"","rating":"","duration":"","duration_secs":0},"movie_data":{"stream_id":20,"name":"","added":"","category_id":"5","container_extension":"mp4","custom_sid":"","direct_source":""}}` |
| `get_series` | `category_id` opcional | `[{"num":1,"name":"Serie","series_id":3,"cover":"","plot":"","cast":"","director":"","genre":"","releaseDate":"","last_modified":"1700000000","rating":"","rating_5based":0,"backdrop_path":[],"youtube_trailer":"","episode_run_time":"","category_id":"7"}]` |
| `get_series_info` | `series_id` | `{"seasons":[],"info":{…igual a get_series…},"episodes":{"1":[{"id":"55","episode_num":1,"title":"Capítulo 1","container_extension":"mp4","info":{"plot":"","duration":""},"custom_sid":"","added":"1700000000","season":1,"direct_source":""}]}}` |
| `get_short_epg` / `get_simple_data_table` | `stream_id`, `limit` | `{"epg_listings":[{"id","epg_id","title":"(base64)","lang","start":"YYYY-MM-DD HH:MM:SS","end","description":"(base64)","channel_id","start_timestamp","stop_timestamp"}]}` (la tabla completa añade `now_playing` y `has_archive`; vacío si el canal no tiene EPG) |

Todos los `id` numéricos de canales/películas/series se **conservan** al migrar desde XtreamUI.

### `GET /get.php?username=U&password=P&type=m3u_plus&output=ts|m3u8`

Lista M3U de todo lo que el usuario puede ver:

```
#EXTM3U url-tvg="http://tv.midominio.com:25461/xmltv.php?username=juan&password=abc123" x-tvg-url="…mismo…"
#EXTINF:-1 tvg-id="canal1.co" tvg-name="Canal 1" tvg-logo="http://…" group-title="Deportes",Canal 1
http://tv.midominio.com:25461/live/juan/abc123/10.ts
```

La cabecera `url-tvg` / `x-tvg-url` solo aparece en `m3u_plus` y cuando hay guía (combinada o `epg_url`): los reproductores
compatibles (TiviMate, OTT Navigator, Kodi, Perfect Player…) cargan la EPG solos; `tvg-id` es el `epg_channel_id` del canal.

### `GET /xmltv.php?username=U&password=P`

Devuelve (proxy) la guía XMLTV configurada en ajustes (`epg_url`), o 404.

### URLs de reproducción

- `/live/{u}/{p}/{stream_id}.{ts|m3u8}`
- `/movie/{u}/{p}/{stream_id}.{ext}`
- `/series/{u}/{p}/{episode_id}.{ext}`
- `/{u}/{p}/{stream_id}` (formato antiguo, en vivo)

Validan: credenciales, habilitado, no suspendido, no vencido, sin corte activo que bloquee,
que el contenido pertenezca a los paquetes del usuario y el límite de conexiones.
Según `stream_mode` en ajustes: `redirect` (302 a la fuente), `proxy` (el servidor retransmite)
o `xtream_upstream` (302 al XtreamUI antiguo con las mismas credenciales, útil durante la transición).
Errores: `401` credenciales, `403` sin acceso / vencido / suspendido / corte, `404` contenido,
`429` límite de conexiones.

---

## 2. API de cliente del portal (`/api/client`) — funciones extra para las apps propias

Las apps propias detectan si el servidor es este portal con `GET /api/client/ping`. Si responde,
activan mensajes, avisos y cortes. Si no (servidor Xtream ajeno o lista M3U), la app funciona igual
sin esas funciones.

### `GET /api/client/ping`
`{"portal": true, "type": "iptv-portal", "name": "Mi IPTV", "version": "1.0.0", "url": "http://192.168.1.46:8080",
"public_url": "http://…"|null, "ports": [8080, 25461]}` — sin autenticación.

### Descubrimiento del servidor en la red local (para el login Xtream Codes)
Para no escribir IP y puerto, la app busca el portal en la red local de dos formas (a la vez):
1. **UDP**: envía el texto `IPTV-DISCOVER v1` por difusión a `255.255.255.255:25460` (y a la difusión de su subred).
   Cada portal responde por UDP, al puerto de origen, con
   `{"type":"iptv-portal","name","version","url":"http://<IP de su interfaz en esa red>:<puerto>","host","port","ports":[…],"public_url"}`.
   Solo responde a IPs de red local (privadas, CGNAT, link-local) y como máximo 5 veces por segundo por IP.
   Puerto configurable con `DISCOVERY_PORT`; se apaga con `DISCOVERY_ENABLED=false`.
2. **Barrido HTTP** (si la red bloquea la difusión): `GET http://<IP>:<puerto>/api/client/ping` a las IPs de la subred del
   equipo (/24) en los puertos 8080, 25461 y 80, con tiempo de espera corto; es un portal si responde `"type":"iptv-portal"`.

La URL elegida se usa como servidor Xtream (`http://IP:puerto`). Fuera de la red local hay que escribirla (o usar `public_url`).

### Actualización de la app propia (APK "portal": celulares, TV box y Android TV que la instalan sin Play Store)
Sin credenciales (funciona antes de iniciar sesión o con la cuenta cortada).

`GET /api/client/app-update?package=com.iptvplayer.app&version_code=2003&version_name=1.0.1&abis=arm64-v8a,armeabi-v7a&device_type=tvbox&device_id=…&channel=stable&sdk=31`
(`abis` en orden de preferencia, como `Build.SUPPORTED_ABIS`; `device_type` y `device_id` también se toman de `X-Device-Type`/`X-Device-Id`)
→ `{"update":false}` o
`{"update":true,"mandatory":false,"release":{"id","version_name","version_code","notes","published_at","channel"},
"file":{"id","abi":"arm64-v8a|armeabi-v7a|x86_64|universal","size","sha256","url":"/api/client/app-update/download/{fileId}"}}`.
- Solo versiones publicadas del mismo paquete; canal `beta` recibe beta y estable.
- Solo se ofrece un APK con `version_code` **mayor** al instalado (Android no deja instalar uno menor; con `--split-per-abi`
  Flutter usa 1000×ABI + build: armeabi-v7a 1xxx, arm64-v8a 2xxx, x86_64 4xxx; el universal usa el build).
- `mandatory` es true si la versión ofrecida o alguna intermedia es obligatoria: la app no debe dejar seguir sin actualizar.
- Despliegue gradual por `device_id` (estable: el mismo equipo siempre recibe la misma respuesta).
- `GET /api/client/app-update/download/{fileId}` → el APK (`application/vnd.android.package-archive`, admite `Range`).
  La app debe comprobar el `sha256` antes de instalar.

Cabeceras que la app envía en todas las peticiones (además de `X-Device-*`): `X-App-Version: 1.0.1`, `X-App-Build: 2003`,
`X-App-Distribution: play|portal`. Se guardan en el dispositivo (`app_version`, `app_build`, `app_distribution`).

### Páginas públicas para las tiendas
- `GET /privacidad` — política de privacidad (HTML) con `company_name`, `app_name`, `support_email`, `support_phone` de Ajustes.
- `GET /eliminar-datos` — cómo pedir la eliminación de la cuenta y los datos.

### `GET /api/client/info?username=U&password=P`

```json
{
  "portal": true,
  "server_name": "Mi IPTV",
  "user": {
    "username": "juan", "exp_date": 1767225600, "max_connections": 1, "is_trial": false,
    "status": "active", "suspension_reason": null
  },
  "outage": {
    "id": 2, "title": "Mantenimiento", "reason": "Cambio de servidor",
    "starts_at": 1726300000, "ends_at": 1726310000, "block_playback": true
  },
  "notices": [
    {"id": 1, "title": "Nuevo canal", "body": "Ya está disponible…", "level": "info",
     "display": "banner", "starts_at": 1726300000, "ends_at": null}
  ],
  "messages": [
    {"id": 4, "title": "Recordatorio de pago", "body": "Tu plan vence…", "created_at": 1726300000, "read": false}
  ],
  "unread_messages": 1
}
```

- `status`: `active` | `expired` | `suspended` | `disabled`.
- `outage` es `null` si no hay corte activo que afecte al usuario.
- `level`: `info` | `warning` | `critical`. `display`: `banner` | `popup` | `ticker`.
- Credenciales incorrectas → `401 {"error": "Credenciales inválidas"}`.

### `POST /api/client/playing`
La app propia lo llama al empezar a reproducir y cada `interval_seconds` mientras reproduce (cabecera `X-Device-Id` recomendada).
Cuerpo `{"username","password","stream_id","connection_id?"}` → `{"ok":true,"connection_id":123,"interval_seconds":30}`
(`429` si supera el límite de conexiones). Así la conexión se ve y cuenta hasta que el cliente cierra, aunque el video vaya directo.

### `POST /api/client/stopped`
Cuerpo `{"username","password","connection_id?"}` → `{"ok":true,"closed":1}`. Llamar al detener la reproducción o cerrar la app.

### `POST /api/client/messages/{id}/read`
Cuerpo `{"username": "U", "password": "P"}` → `{"ok": true}`.

---

## 3. API de administración (`/api/admin`)

Autenticación: `Authorization: Bearer <token>` (JWT). Roles: `admin` (todo) y `reseller`
(solo ve y gestiona sus propios usuarios; no ve admins, ajustes, migración ni registro).

### Autenticación
- `POST /api/admin/auth/login` `{"username","password"}` → `{"token":"…","admin":{"id":1,"username":"admin","role":"admin"}}`
- `GET /api/admin/auth/me` → `{"id":1,"username":"admin","role":"admin"}`
- `POST /api/admin/auth/password` `{"current_password","new_password"}` → `{"ok":true}`

### Panel
`GET /api/admin/dashboard` →
```json
{
  "users": {"total":0,"active":0,"expired":0,"suspended":0,"disabled":0,"trial":0,"expiring_7d":0},
  "content": {"live":0,"movie":0,"series":0,"episodes":0,"categories":0,"packages":0},
  "active_connections": 0,
  "active_outages": 0,
  "expiring_soon": [ /* hasta 10 objetos Usuario */ ],
  "recent_logs": [ /* hasta 10 objetos Log */ ]
}
```

### Usuarios (líneas)
Objeto **Usuario**:
```json
{
  "id": 1, "username": "juan", "password": "abc123",
  "full_name": "Juan Pérez", "email": "", "phone": "",
  "exp_date": 1767225600, "max_connections": 1,
  "enabled": true, "suspended": false, "suspension_reason": null,
  "is_trial": false, "status": "active",
  "notes": "", "owner_id": 1, "owner_username": "admin",
  "source": "local", "xtream_id": null,
  "package_ids": [1, 2], "active_connections": 0,
  "last_seen_at": null, "last_ip": null,
  "created_at": 1700000000, "updated_at": 1700000000
}
```
`status` calculado: `suspended` > `disabled` > `expired` > `active`. `source`: `local` | `xtreamui`.

- `GET /users?search=&status=active|expired|suspended|disabled|expiring|trial&package_id=&source=&owner_id=&sort=created_at|exp_date|username&order=asc|desc&page=&limit=` → paginado
- `POST /users` → Usuario. Cuerpo: `username?`, `password?` (si faltan y `random:true` se generan),
  `exp_date?` o `duration?: {"amount":1,"unit":"days|months"}` , `max_connections`, `is_trial`,
  `package_ids`, `notes`, `full_name`, `email`, `phone`, `enabled`, `owner_id?` (solo admin)
- `GET /users/{id}` · `PUT /users/{id}` (mismos campos, parcial) · `DELETE /users/{id}`
- `POST /users/{id}/suspend` `{"reason":"Falta de pago"}` → Usuario
- `POST /users/{id}/reactivate` → Usuario
- `POST /users/{id}/extend` `{"amount":1,"unit":"days|months"}` → Usuario (extiende desde max(ahora, exp_date))
- `POST /users/bulk` `{"ids":[1,2],"action":"enable|disable|suspend|reactivate|delete|extend|set_packages","reason?","amount?","unit?","package_ids?"}` → `{"affected":2}`
- `GET /users/{id}/connections` → lista de Conexión
- `GET /users/{id}/m3u-url` → `{"m3u_url":"http://…/get.php?…","xtream":{"server":"http://host:port","username":"…","password":"…"}}`

### Paquetes (bouquets)
Objeto: `{"id","name","description","stream_count","series_count","user_count","created_at"}`;
`GET /packages/{id}` añade `"stream_ids":[…], "series_ids":[…]`.
- `GET /packages` (lista completa, sin paginar) · `POST /packages` `{"name","description","stream_ids","series_ids"}`
- `GET|PUT|DELETE /packages/{id}`

### Categorías
Objeto: `{"id","name","type":"live|movie|series","sort_order","item_count"}`
- `GET /categories?type=` (sin paginar) · `POST /categories` · `PUT|DELETE /categories/{id}`

### Canales y películas (streams)
Objeto **Stream**:
```json
{
  "id": 10, "type": "live", "name": "Canal 1", "category_id": 1, "category_name": "Deportes",
  "logo": "", "source_url": "http://origen/…", "backup_urls": [],
  "epg_channel_id": "", "container_extension": "ts", "tv_archive_duration": 0,
  "sort_order": 0, "enabled": true,
  "info": {"plot":"","genre":"","rating":"","releasedate":"","duration":"","cover":""},
  "package_ids": [1], "source": "local", "created_at": 1700000000
}
```
`type`: `live` | `movie`. `source`: `local` | `xtreamui` | `m3u`.
- `GET /streams?type=&category_id=&search=&enabled=&package_id=&page=&limit=` → paginado
- `POST /streams` · `GET|PUT|DELETE /streams/{id}`
- `POST /streams/bulk` `{"ids","action":"enable|disable|delete|set_category|add_to_package|remove_from_package","category_id?","package_id?"}` → `{"affected":n}`
- `POST /streams/reorder` `{"ids":[…en el orden deseado…],"start?":0}` → `{"ok","updated"}` (arrastrar y soltar; guarda `sort_order` 10, 20, 30…)
- `POST /streams/sort` `{"type":"live|movie","category_id?":id|null,"mode":"alpha|alpha_desc|number|added|added_desc|epg"}` → `{"ok","updated"}`
  (`number` = por el primer número del nombre: Canal 1, 2, 10; `category_id` null = sin categoría; omitido = todos los del tipo)
- `POST /categories/reorder` `{"ids":[…]}` → `{"ok","updated"}`
- Las apps reciben canales y películas (`get_live_streams`, `get_vod_streams`, `get.php`) en el orden de las categorías y, dentro de cada una,
  por `sort_order` y nombre; `num` es la posición resultante (1, 2, 3…).
- `POST /streams/import-m3u` `{"url?","content?","type":"auto|live|movie","create_categories":true,"package_id?":1,"skip_duplicates":true}`
  → `{"created":0,"skipped":0,"categories_created":0}` (`auto`: .mp4/.mkv/.avi/.mov → película, resto en vivo)

### Salud de canales y películas

El servidor revisa periódicamente las fuentes (lee solo los primeros bytes; en HLS valida `#EXTM3U`; en
películas usa `Range`). Revisa primero los que llevan más tiempo sin comprobarse, `stream_check_batch` por ronda,
cada `stream_check_interval_minutes`. Si hay respaldo (`backup_urls`) y funciona, el contenido cuenta como en línea.

El objeto **Stream** añade: `health_status` (`online` | `offline` | `unknown`), `health_checked_at`,
`health_ms` (tiempo de respuesta), `health_error` (p. ej. `HTTP 404`, `Tiempo de espera agotado`),
`health_down_since` (desde cuándo está caído). `GET /streams` acepta `health=online|offline|unknown`.

- `GET /streams/health` → `{"live":{"online","offline","unknown","total"},"movie":{…},"running":false,"progress":{"total","done","online","offline"},"started_at","finished_at","last_result":{…}|null,"settings":{…}}`
- `POST /streams/check` (solo admin):
  - `{"ids":[1,2]}` (hasta 50) → revisa y responde al terminar, con `results: [{"id","status","ms","error"}]`
  - `{"type":"live"|"movie", "all": true}` → inicia en segundo plano, `202` con el estado; seguir con `GET /streams/health`
  - `409` si ya hay una revisión en curso

Ajustes nuevos: `stream_check_enabled` (true), `stream_check_interval_minutes` (30), `stream_check_batch` (500),
`stream_check_concurrency` (10), `stream_check_timeout_seconds` (8).

### Consumo del servidor (solo admin)

`GET /system/metrics` →
```json
{
  "sampled_at": 1726300000, "hostname": "vps1", "platform": "Linux 6.8.0", "node_version": "v22.0.0",
  "cpu": {"model": "AMD EPYC", "cores": 4, "usage_percent": 12.5, "load_avg": [0.4, 0.3, 0.2]},
  "memory": {"total": 8000000000, "used": 3000000000, "free": 5000000000, "percent": 37.5, "process_rss": 90000000},
  "disk": {"path": "/", "total": 80000000000, "used": 20000000000, "free": 60000000000, "percent": 25},
  "network": {"available": true, "rx_bps": 1200000, "tx_bps": 48000000},
  "uptime": {"system": 864000, "process": 3600},
  "history": [{"t": 1726299400, "cpu": 10.2, "mem": 37.1, "rx_bps": 1000000, "tx_bps": 40000000}]
}
```
`history` guarda una muestra cada 5 s de los últimos 10 minutos. `load_avg` es `null` en Windows; `network`
solo está disponible en Linux (`rx_bps`/`tx_bps` en bits por segundo). `disk` puede ser `null`.

`GET /dashboard` añade:
- `content_health` (igual que en `/streams/health`)
- `stream_check`: `{"running", "last_result"}`
- `offline_streams`: hasta 8 caídos, `[{"id","type","name","logo","category_name","health_error","health_checked_at","down_since"}]`
- `recent_logs` ahora trae como máximo 6 entradas

### Modo de entrega por canal, servidores de streaming y Astra

**Modo de entrega** (`delivery_mode` en el objeto Stream):
- `default`: usa el modo general de Ajustes (`stream_mode`: redirect | proxy | xtream_upstream).
- `direct`: *direct source*, el cliente va siempre directo a la fuente (302), aunque Ajustes diga proxy.
- `restream`: un **servidor de streaming (nodo)** toma la fuente una sola vez y la reparte a todos sus clientes, sin transcodificar.
- `transcode`: igual, pero el nodo transcodifica con `transcode_profile_id` (sin perfil se comporta como `restream`).

El objeto Stream añade: `delivery_mode`, `transcode_profile_id`, `transcode_profile_name`, `always_on` (el nodo lo mantiene
encendido aunque nadie lo vea; si no, arranca al primer cliente y se apaga tras 30 s sin clientes), `server_ids` (en orden
de prioridad), `servers: [{id,name}]` y `active_connections` (conexiones en este momento).
`POST /streams` y `PUT /streams/{id}` aceptan `delivery_mode`, `transcode_profile_id`, `always_on`, `server_ids`.
`GET /streams` acepta `delivery_mode=`, `server_id=`, `source=` (local | m3u | xtreamui | astra) y `watching=true`.
`POST /streams/bulk` acepta `action: "set_delivery"` con `delivery_mode`, `transcode_profile_id?`, `server_ids?`, `always_on?`.

Elección de servidor al reproducir: solo los asignados al canal (o todos si no tiene), en línea y con cupo; primero el que ya
está emitiendo ese canal (reutiliza la conexión a la fuente), luego prioridad y menor carga/peso. Sin servidor disponible:
si `node_fallback_direct` (Ajustes, true) redirige a la fuente; si no, `503`. Ajuste `node_offline_seconds` (30).

**Conexiones en tiempo real**
- `GET /streams/{id}/connections` → `[{"id","user_id","username","full_name","ip","user_agent","mode","tracking","server_id","server_name","started_at","last_seen_at"}]`
- `GET /connections` añade `tracking`, `server_id`, `server_name`.
- `mode`: `redirect` | `xtream_upstream` (estimadas: el video no pasa por el servidor, se ven durante `connection_timeout_seconds`)
  · `proxy` | `node` | `app` (exactas: se mantienen hasta que el cliente cierra). `tracking`: `exact` | `estimated`.

### Servidores de streaming (solo admin)

Objeto **Servidor**: `{"id","name","public_url","enabled","max_clients","weight","status":"pending|online|offline|disabled",
"last_heartbeat_at","last_ip","version","hardware":{"ffmpeg","encoders":["libx264","h264_nvenc",…],"nvidia","intel_gpu","cpu_model","cores","platform"},
"metrics":{"cpu","cores","load_avg","mem_total","mem_percent","rx_bps","tx_bps","uptime","clients_total"},
"streams_running","streams_error","clients","assigned_streams","notes","install_command","token","created_at"}`
- `GET /servers` · `POST /servers` `{"name","public_url":"http://ip:8090","max_clients","weight","enabled","notes"}` · `GET|PUT|DELETE /servers/{id}`
- `POST /servers/{id}/token` → regenera el token (hay que reinstalar o editar `/etc/iptv-node.env`)
- `public_url` es opcional al crear: si queda vacía, se completa con la IP de la **interfaz principal del nodo** (la de la puerta de
  enlace, nunca loopback) y el puerto en el que escucha, al recibir su primer latido.
- El objeto Servidor añade `network: {"hostname","listen_port","reported_at","ports":[…mismo formato que network_ports de /system/network…]}`
  (lo informa el nodo cada minuto) y `url_suggestions: [{"url","ip","port","interface","interface_type","scope","default_route","in_use"}]`.
- `POST /servers/{id}/use-ip` `{"ip","port?"}` → usa esa IP (debe ser de una interfaz informada por el nodo) como URL pública; responde el Servidor.
- `GET /servers/{id}/streams` → `[{"stream_id","name","delivery_mode","assigned","priority","always_on","state":"idle|starting|running|error","uptime","bitrate_kbps","clients","restarts","last_error"}]`
- Instalación: `install_command` (= `curl -fsSL "{portal}/api/node/install.sh?token=…" | sudo bash`) instala Node.js, FFmpeg y el servicio `iptv-node`.

Perfiles de transcodificación: objeto `{"id","name","hw":"cpu|nvenc|qsv|vaapi","video_codec":"h264|hevc","preset","resolution":"source|2160|1080|720|576|480|360",
"video_bitrate_kbps","max_bitrate_kbps","fps","gop","deinterlace","audio_codec":"copy|aac","audio_bitrate_kbps","audio_channels","extra_args","stream_count","created_at"}`
- `GET /transcode-profiles` · `POST /transcode-profiles` · `PUT|DELETE /transcode-profiles/{id}`

API interna de nodos (token del servidor en `Authorization: Bearer`): `POST /api/node/heartbeat`, `GET /api/node/streams/{id}`,
`GET /api/node/agent.js`, `GET /api/node/install.sh`. El nodo sirve `/live/{id}.ts|m3u8?token=…` (token HMAC firmado por el portal).

### Fuentes Astra (solo admin)

Se conecta a la API de Cesbo Astra con usuario/contraseña (Basic): `POST {api_url}/control/ {"cmd":"load"}` (lista `make_stream`)
y `GET {api_url}/api/stream-status/{id}` (onair, bitrate, cc_error).

Objeto **Fuente**: `{"id","name","api_url","username","password_set","play_url","url_mode":"play|output","play_path":"/play/{id}","enabled",
"sync_interval_minutes","status_poll","status_interval_minutes","auto_import_new","disable_removed","sync_names",
"import_defaults":{"category_mode":"group|fixed","category_id","delivery_mode","transcode_profile_id","server_ids","package_id","always_on"},
"last_sync_at","last_status_at","last_error","counts":{"channels","imported","not_imported","removed","onair","offair"},"created_at"}`
- `url_mode`: `play` = `{play_url o api_url}{play_path}` (HTTP Play de Astra) · `output` = la primera salida `http://` del canal, cambiando `0`/`0.0.0.0` por el host.
- `POST /astra/test` (mismos campos, sin guardar; `id` para usar la contraseña guardada) → `{"ok","total","enabled","groups":[…],"sample":[{"astra_id","name","enabled","group","play_url","outputs"}]}`
- `GET /astra/sources` · `POST /astra/sources` (guarda y sincroniza: `{"source","sync","error"}`) · `GET|PUT|DELETE /astra/sources/{id}`
- `POST /astra/sources/{id}/sync` → `{"total","new","updated","removed","restored","streams_updated","streams_disabled","imported"}`
- `POST /astra/sources/{id}/status` → `{"checked","online","offline"}` (actualiza la salud de los canales importados)
- `GET /astra/sources/{id}/channels?search=&imported=true|false&removed=true|all&group=&onair=true|false&page=&limit=` →
  `{"data":[{"id","astra_id","name","enabled","group","inputs","outputs","play_url","removed","stream_id","stream_name","stream_enabled","stream_delivery_mode","onair","bitrate_kbps","cc_errors","sessions","status_checked_at","synced_at"}],"groups":[…],"total","page","limit"}`
- `POST /astra/sources/{id}/import` `{"channel_ids":[…]}` o `{"all_not_imported":true,"group?":"…"}` + `"options":{…import_defaults…}` + `"save_as_default"?` → `{"created","categories_created"}`
- `POST /astra/sources/{id}/delete-imported` `{"all":true}` | `{"group":"Deportes"}` | `{"channel_ids":[…]}` + `"remove_empty_categories"?` →
  `{"deleted","categories_deleted"}` (borra del portal los canales importados; en Astra no se toca nada y se pueden reimportar)
- `DELETE /astra/sources/{id}?delete_streams=true&remove_empty_categories=true` → también borra sus canales importados; responde `{"ok","deleted","categories_deleted"}`

Automático: sincroniza cada `sync_interval_minutes` (altas, bajas y cambios de URL; con `disable_removed` deshabilita los canales
borrados en Astra; con `auto_import_new` importa los nuevos con `import_defaults`) y consulta la señal cada `status_interval_minutes`.

### EPG (guía de programación, solo admin)

Fuentes XMLTV (`.xml` o `.xml.gz`, se leen en streaming). El portal extrae los canales de cada guía, empareja por nombre los canales
en vivo (ignora calidad HD/FHD/4K, prefijos de país "CO:", tildes y símbolos; "televisión" = "tv"; números distintos no coinciden;
bonifica el país preferido `epg_country` en IDs como `CanalRCN.co`) y genera una guía combinada solo con los canales usados,
que `xmltv.php` entrega a los clientes (gzip si el cliente lo acepta). Si no hay guía combinada, `xmltv.php` usa `epg_url` como antes.

El objeto Stream añade `epg_match_score` (0-100) y `epg_locked` (asignado a mano: el emparejamiento automático no lo cambia; editar
`epg_channel_id` desde el formulario lo bloquea, o se envía `epg_locked`).

- `GET /epg/status` → `{"sources":[Fuente],"guide":{"building","built_at","channels","programmes","size","exists","error"},"streams":{"live","with_epg","without_epg","locked"},"epg_channels"}`
- Fuente: `{"id","name","url","enabled","priority","status":"pending|refreshing|ok|error","last_error","channel_count","programme_count","first_programme_at","last_programme_at","current_programmes","outdated","last_fetch_at","created_at"}` (`priority` menor = preferida; `outdated` = la programación ya terminó: sirve para emparejar pero no muestra la guía de hoy)
- `get_short_epg` / `get_simple_data_table` (API Xtream) devuelven la programación guardada al generar la guía (6 h atrás a 8 días): títulos y descripciones en base64 como Xtream Codes, horas en la zona horaria de Ajustes
- `POST /epg/sources[?wait=true]` `{"name?","url","enabled?","priority?"}` → Fuente (descarga en segundo plano, o espera con `wait`)
- `PUT|DELETE /epg/sources/{id}` · `POST /epg/sources/{id}/refresh[?wait=true]` · `POST /epg/refresh-all[?wait=true]`
- `GET /epg/channels?search=&source_id=&page=&limit=` → `{"data":[{"id","xmltv_id","display_names","icon","country","source_id","source_name","used_by"}],"total","page","limit"}`
- `POST /epg/match` `{"stream_ids?":[…],"filter?":{"category_id","search","source"},"only_missing":true,"min_score?":85,"fill_logos?":true,"country?":"co","dry_run?":false}` →
  `{"dry_run","checked","assigned","suggested","not_found","logos_filled","min_score","results":[{"stream_id","name","current","match":{"xmltv_id","display_name","icon","source","score"}|null,"alternatives":[…],"action":"assign|suggest|none","logo_filled?"}]}`
  (`assign` ≥ min_score; `suggest` 60…min_score, no se aplica)
- `POST /epg/assign` `{"stream_id","xmltv_id"|null,"locked?","fill_logo?"}` → `{"ok","stream_id","epg_channel_id","epg_locked"}`
- `POST /epg/guide/build[?wait=true]` → estado de la guía

Ajustes: `epg_refresh_hours` (12), `epg_auto_match` (false: tras cada actualización empareja los canales sin EPG), `epg_min_score` (85),
`epg_country` (""), `epg_fill_logos` (true). Automático: cada `epg_refresh_hours` actualiza las fuentes, empareja (si está activado) y regenera la guía.

### Series y episodios
Objeto **Serie**: `{"id","name","category_id","category_name","cover","plot","cast","director","genre","release_date","rating","backdrop","youtube_trailer","episode_count","package_ids","source","created_at"}`
Objeto **Episodio**: `{"id","series_id","season","episode_num","name","source_url","container_extension","info":{"plot":"","duration":""},"enabled"}`
- `GET /series?category_id=&search=&page=&limit=` · `POST /series` · `GET|PUT|DELETE /series/{id}`
- `GET /series/{id}/episodes` (lista) · `POST /series/{id}/episodes`
- `PUT /episodes/{id}` · `DELETE /episodes/{id}`

### Mensajes (bandeja de entrada del cliente)
Objeto: `{"id","title","body","target":"all|user|package","user_id","package_id","target_label","expires_at","read_count","created_at"}`
- `GET /messages?page=&limit=` · `POST /messages` · `PUT|DELETE /messages/{id}`

### Avisos (banner / popup / cinta)
Objeto: `{"id","title","body","level":"info|warning|critical","display":"banner|popup|ticker","target":"all|package","package_id","starts_at","ends_at","active","created_at"}`
- `GET /notices` · `POST /notices` · `PUT|DELETE /notices/{id}`

### Cortes (cortes / mantenimientos programados)
Objeto: `{"id","title","reason","scope":"global|package","package_id","starts_at","ends_at","block_playback","active_now","created_at"}`
(`active_now` calculado. `ends_at` null = hasta que se elimine.) La suspensión individual de un usuario
(corte por falta de pago) se hace con `POST /users/{id}/suspend`.
- `GET /outages` · `POST /outages` · `PUT|DELETE /outages/{id}`

### Modos de corte e integración con plataformas de facturación (solo admin)

`cut_mode` (en `/settings` y en `/integrations/billing`):
- `manual`: los cortes se hacen solo desde el portal (la sincronización externa no aplica cambios).
- `external`: los clientes **vinculados** los corta y reactiva la plataforma externa; el portal responde `409`
  si se intenta suspender/reactivar a mano uno vinculado (en acciones masivas se omiten y se devuelve `skipped`).
- `both`: ambos. La plataforma suspende y reactiva, pero **nunca levanta un corte hecho a mano en el portal**.

Reglas de sincronización: estado externo en `status_map.suspended` → suspender (`suspension_source: "external"`);
en `status_map.disabled` → deshabilitar; en `status_map.active` → reactivar solo si `suspension_source` es `external`;
en `status_map.free` (por defecto `["Gratis"]`) → **nunca se corta** (cuenta como activo y tiene prioridad).

**Una cuenta IPTV por persona:** los servicios con la misma cédula se vinculan a la misma cuenta. El estado de la cuenta sale
del servicio con mayor prioridad: gratis > activo > suspendido > cancelado. Los cambios de sincronización incluyen `services`
(cuántos servicios tiene la cuenta). El objeto Cliente añade `external_services: [{"external_id","status","plan"}]`.
`status_map`, `mapped_status`, `status` de bulk-link y los contadores `by_status`/`unlinked_by_status`/`status_applied` incluyen `free`.

El objeto Cliente (`/users`) añade: `document_id` (cédula, editable), `external_id` (ID en la plataforma, editable
por admin), `external_status`, `external_synced_at`, `suspension_source` (`manual` | `external` | null).
`GET /users` acepta `external=linked|unlinked` y `suspension_source=manual|external`; la búsqueda incluye cédula e ID externo.

Endpoints (`/api/admin/integrations/billing`):
- `GET /integrations/billing` → `{"cut_mode","config":{…sin api_key…,"api_key_set":true},"presets":{"wisphub":{…}},"running",
  "counts":{"external_clients","linked","unlinked_external","iptv_unlinked","suspended_by_external"},"last_run","webhook_path"}`
- `PUT /integrations/billing` `{"cut_mode"?, "config"?: {enabled, provider: "wisphub"|"custom", base_url, list_path, api_key,
  auth_header, auth_prefix, page_size, results_path, interval_minutes, auto_link, reactivate, suspension_reason,
  match_by: ["document","email","phone","username"], fields: {id,status,document,username,name,email,phone,plan},
  status_map: {free:[…], active:[…], suspended:[…], disabled:[…]}}}` → igual que GET
- `POST /integrations/billing/test` (acepta los campos de `config` **en la raíz del cuerpo** como borrador sin guardar) →
  `{"ok","total","sample":[{external_id,status,document_id,username,name,email,phone,plan}],"raw_keys":[…],
  "status_values":[{"value":"Suspendido","maps_to":"suspended"}],"missing_fields":[{"field","path"}]}`
- `POST /integrations/billing/sync` `{"dry_run": true|false}` → `{"id","status","trigger","stats":{fetched, linked_now,
  linked_total, suspended, disabled, reactivated, skipped_manual, unknown_status, unchanged, unlinked_external, applied},
  "changes":[{user_id, username, external_id, external_name, external_status, action, new_link?}]}`
  (en simulación no se guardan vínculos nuevos; los propuestos llegan con `new_link: true`)
  (`action`: `suspend` | `disable` | `reactivate` | `skip_manual` | `unknown_status`)
- `GET /integrations/billing/runs?page=` · `GET /integrations/billing/runs/{id}` (con `changes`)
- `GET /integrations/billing/external-clients?search=&linked=true|false&status=&page=` → paginado de
  `{"id","external_id","name","document_id","username","email","phone","plan","status","status_mapped","user_id",
  "iptv_username","iptv_status","iptv_suspension_source","link_method","synced_at"}`
- `GET /integrations/billing/external-clients` acepta además `mapped_status=free|active|suspended|disabled` y `plan=` (contiene)
- `GET /integrations/billing/external-clients/summary` → `{"total","linked","by_status":{active,suspended,disabled,unknown},"unlinked_by_status":{…},"plans":[{"name","count"}]}`
- `POST /integrations/billing/external-clients/bulk-link` — vinculación en lote de los clientes externos **sin vincular**:
  `{"status":"all|active|suspended|disabled|unknown","plan_contains?":"tv","search?","ids?":[…],"match_by?":["document","email","phone","username"],
  "create_missing":false,"apply_status":false,"dry_run":false,
  "create":{"username_from":"cedula|usuario|email|id","password_mode":"cedula|random|fixed","password?","package_ids":[…],"max_connections":1,"duration":{"amount","unit"}|null}}`
  (por defecto usuario y contraseña = cédula sin puntos; si la cédula tiene menos de 3 dígitos el usuario es `wh<id_servicio>`, y con menos de 4 la contraseña es aleatoria)
  → `{"dry_run","selected","linked","created","grouped","accounts","no_match","ambiguous","status_applied":{free,active,suspended,disabled},
  "items":[{"external_id","name","external_status","action":"link|create|no_match|ambiguous","username","method?","status_applied?","status_skipped?"}],
  "credentials":[{"username","password","password_source":"cedula|random|fixed","name","external_id"}]}` (`grouped` = servicios extra de una
  persona unidos a la cuenta creada en la misma ejecución, `method: "same_document"`; credenciales solo de las cuentas creadas y nunca en simulación;
  usuarios repetidos reciben sufijo `-2`; `apply_status` nunca levanta un corte manual)
- `POST /integrations/billing/external-clients/{id}/link` `{"user_id"}` · `DELETE /integrations/billing/external-clients/{id}/link`
- `POST /integrations/billing/webhook-token` → regenera el token del webhook
- `POST /integrations/billing/check-suspended` → **revisa ya solo las cuentas cortadas** (suspendidas o deshabilitadas y
  vinculadas): reactiva a quienes la plataforma ya marca activos o gratis. No corta a nadie nuevo ni crea vínculos.
  Misma respuesta que `sync`, con `trigger: "check_suspended"` y `stats.checked` (cuentas revisadas) y `stats.scope: "suspended"`.
  En modo de cortes manual consulta pero no aplica (`stats.applied: false`).
- `POST /integrations/billing/users/{userId}/refresh` → **actualiza un cliente ya mismo** (p. ej. acaba de pagar): consulta
  sus servicios (y los de su misma cédula) con el detalle `GET {base}/clientes/{id_servicio}/`; si la plataforma no tiene
  detalle, usa la lista completa. Aplica su estado (reactiva o corta) salvo en modo manual →
  `{"applied","method":"detail|list","change":{user_id, username, external_id, external_status, action, services},
  "services":[{"external_id","name","status","status_mapped","plan"}],"missing":["id sin respuesta"],"user":{Usuario}}`.
  400 si el cliente no está vinculado. El detalle de WispHub no trae nombre ni cédula: solo se actualizan los campos que llegan.
- En `GET /integrations/billing`: `counts.cut_linked` (cuentas vinculadas cortadas hoy) y
  `auto_sync: {"enabled","interval_minutes","running","last_run_at","last_status","next_run_at"}`.
  `config.interval_minutes` admite de 1 a 1440 minutos; la sincronización automática corre si la integración está activa,
  hay API Key y el modo de cortes no es manual.
- Historial (`runs`): `trigger` puede ser `manual`, `auto`, `dry_run`, `webhook`, `check_suspended` o `user_refresh`.

Webhook público (sin JWT): `POST /api/integrations/billing/webhook/{token}` con el registro del cliente usando los mismos
nombres de campo configurados (p. ej. `{"id_servicio": 102, "estado": "Activo"}`) o los genéricos
`{"external_id","document","username","status"}` → `{"ok":true,"applied":true,"action":"reactivate","username":"…"}`.

WispHub (plantilla por defecto): `base_url` = "URL de consulta de API" de tu empresa (normalmente
`https://api.wisphub.net/api`), `list_path` `/clientes/`, cabecera `Authorization: Api-Key <clave>`, paginación
`limit`/`offset` (máx. 300), resultados en `results`, ID `id_servicio`, estado `estado`.

### Recordatorios programados

Objeto **Recordatorio**: `{"id","title","body","kind","display","target":"all|user|package","user_id","package_id","target_label",
"recurrence","config","message_ttl_days","replace_previous","starts_at","ends_at","active","last_run_at","next_run_at",
"upcoming":[unix…5],"sent_count","created_at"}`
- `kind` (tipo, también en Mensajes): `payment` (Pago) | `expiration` (Vencimiento) | `maintenance` (Mantenimiento) |
  `promotion` (Promoción) | `support` (Soporte) | `general`
- `display` (también en Mensajes): `inbox` (bandeja) | `popup` (ventana al abrir la app)
- `recurrence` y `config`: `once` · `daily` `{time}` · `weekly` `{time, weekdays:[1=lunes…7=domingo]}` ·
  `monthly` `{time, month_day}` (si el mes es más corto, el último día) · `interval` `{time, every_days}` ·
  `before_expiration` `{time, days_before:[7,3,1]}` (mensaje individual a cada cliente que vence en esos días)
- Horas en la zona horaria de Ajustes. `replace_previous`: al enviar de nuevo, el mensaje anterior del mismo
  recordatorio caduca. `message_ttl_days`: días que el mensaje queda visible.
- Variables en título y cuerpo (también en mensajes y avisos): `{nombre}`, `{usuario}`, `{vence}`, `{dias}`, `{servidor}`.

Endpoints: `GET /reminders` · `POST /reminders` · `GET|PUT|DELETE /reminders/{id}` ·
`POST /reminders/{id}/run` (enviar ahora) → `{"ok","messages_created","reminder"}`.
`GET /messages` acepta `kind=`, `reminder_id=`, `source=reminder|manual`; el objeto Mensaje añade `kind`, `display`, `reminder_id`.

### Avisos en carrusel

El objeto Aviso añade `sort_order` (orden dentro del carrusel) y `duration_seconds` (tiempo en pantalla; null = el general).
Ajustes: `notices_carousel_enabled` (true) y `notices_carousel_seconds` (8). `GET /api/client/info` añade
`"notice_settings": {"carousel": true, "interval_seconds": 8}`; los avisos llegan ordenados por nivel
(crítico primero) y `sort_order`, con `duration_seconds`. Los mensajes llegan con `kind` y `display`, y las
variables ya sustituidas.

### Conexiones activas
Objeto **Conexión**: `{"id","user_id","username","stream_id","stream_name","ip","user_agent","started_at","last_seen_at"}`
- `GET /connections` · `DELETE /connections/{id}` (expulsar)

### Administradores y revendedores (solo admin)
Objeto: `{"id","username","role":"admin|reseller","enabled","user_count","created_at"}`
- `GET /admins` · `POST /admins` `{"username","password","role","enabled"}` · `PUT|DELETE /admins/{id}`

### Ajustes (solo admin)
`GET /settings` →
```json
{
  "server_name": "Mi IPTV",
  "public_url": "http://tv.midominio.com:25461",
  "stream_mode": "redirect",
  "xtream_upstream_url": "",
  "epg_url": "",
  "timezone": "America/Bogota",
  "allow_all_without_package": true,
  "connection_timeout_seconds": 60,
  "xtream_db": {"host":"","port":3306,"user":"","database":"xtream_iptvpro","password_set":false}
}
```
`PUT /settings` parcial (en `xtream_db` se puede enviar `password`).

### Red del servidor (solo admin)

`GET /system/network[?external=true]` →
```json
{
  "network_ports": [{"name":"eth0","description":"","type":"ethernet|wifi|vpn|virtual|loopback","type_label":"Ethernet","status":"up|down|disconnected",
    "speed_mbps":1000,"mac":"aa:bb:…","physical":true,"default_route":true,"gateway":"192.168.10.1",
    "addresses":[{"address":"192.168.10.20","family":"IPv4","cidr":24,"scope":"public|private|cgnat|link-local|loopback"}]}],
  "listening": [{"ip":"0.0.0.0","port":25461,"process":"node","all_interfaces":true,"scope":"all","service":"Portal IPTV","portal":true}],
  "portal_ports": [8080, 25461],
  "suggestions": [{"url":"http://192.168.10.20:25461","ip","port","interface":"eth0","interface_type":"ethernet","scope":"private",
    "default_route":true,"reason":"Ethernet «eth0» · interfaz principal (puerta de enlace) · IP de red privada · puerto Xtream habitual","responds":true}],
  "public_ip": null,
  "current_public_url": "http://192.168.10.20:25461",
  "effective_base_url": "http://192.168.10.20:25461"
}
```
- `network_ports`: los puertos de red (interfaces) con sus IPs; `default_route` = interfaz con la puerta de enlace predeterminada.
- `suggestions`: URLs posibles para clientes, ordenadas (IP pública > interfaz principal > Ethernet > Wi-Fi > VPN > virtual; nunca loopback,
  link-local ni interfaces caídas) × puertos del portal (25461 primero, 80 si hay proxy web). `responds` = el portal contesta en esa IP:puerto.
- `?external=true` añade `public_ip` (IP de salida a internet, consultada a un servicio externo) y sugerencias con ella (requiere NAT/redirección).
- `GET /system/public-ip` → `{"address","source","scope","error"}`.

URL para clientes (`public_url` en Ajustes): en el primer arranque, si está vacía, se toma `PUBLIC_URL` del entorno o la IP IPv4 de la
interfaz principal con el puerto 25461 (si está en `EXTRA_PORTS`) o `PORT` (`AUTO_PUBLIC_URL=false` lo desactiva). Los enlaces del panel
(M3U de clientes, instalación de nodos) nunca usan `localhost`/`127.0.0.1` si hay otra IP disponible.

### Copias de seguridad (solo admin)
Copia **completa** de la base (clientes, canales, paquetes, dispositivos, WispHub, ajustes…) en un archivo `.iptvbak`
portable entre SQLite, PostgreSQL y MySQL, comprimido y opcionalmente **cifrado** (AES-256-GCM, clave con scrypt).
No incluye: sesiones en vivo, el propio historial de backups, el secreto de sesión ni los ajustes de backup del servidor
(conexión de Drive, contraseña, horario), que **se conservan al restaurar**. El registro de actividad es opcional
(`include_logs`) y la programación EPG también (`include_epg`, por defecto no: se vuelve a descargar sola).
Se guardan en `server/data/backups` (`BACKUP_DIR`).

Objeto **Backup**: `{"id","filename","size","sha256","status":"running|ok|error","error","trigger":"manual|scheduled|pre_restore|upload|drive",
"note","encrypted","pinned","app_version","server_name","backup_created_at","tables":{"users":443,…},"total_rows","options":{include_logs,include_epg},
"created_by","created_at","finished_at","local":true,"drive":{"status":"none|pending|uploading|ok|error","file_id","error","uploaded_at","attempts"},"restored_at"}`
(`local`: el archivo está en el servidor; `pinned`: la limpieza automática no lo borra).

- `GET /backups` → `{"items":[Backup],"last_status","last_at","last_error","last_ok_at","next_run_at","schedule_enabled","drive_connected",
  "running":{"kind":"backup|restore","id","started_at"}|null,"settings":{AjustesBackup},"timezone","drive":{"connected","account_email","folder_name",
  "connection":{EstadoConexión}},"storage":{"dir","used_bytes","free_bytes"}}`
- `POST /backups[?wait=true]` `{"note?","upload_drive?":bool}` → 202 con el Backup en curso (201 terminado con `wait`).
  Si Drive está conectado y `auto_upload` activo, se sube al terminar. 409 si ya hay una copia o restauración en curso.
- `GET /backups/{id}` · `PATCH /backups/{id}` `{"note?","pinned?"}` · `DELETE /backups/{id}?from=server|drive|all`
  → `{"deleted":bool,"backup":Backup|null}` (borrar solo del servidor deja la copia de Drive; en Drive va a la papelera)
- **Descargar**: `GET /backups/{id}/download` (con JWT) o `POST /backups/{id}/download-link` → `{"url":"/api/admin/backups/file/{token}",
  "filename","size","expires_at"}`: enlace válido 10 minutos que se abre directamente en el navegador (sin cabecera de sesión).
- **Subir un archivo**: `POST /backups/upload?name=archivo.iptvbak` con el archivo como cuerpo binario
  (`Content-Type: application/octet-stream`, máx. 4 GB) → 201 Backup (`trigger: "upload"`). 400 si no es un `.iptvbak` válido.
- `POST /backups/{id}/check-password` `{"password"}` → `{"ok":true,"encrypted"}` o 400 si no coincide.
- **Restaurar**: `POST /backups/{id}/restore` `{"confirm":"RESTAURAR","password?","safety_backup":true}` → reemplaza **todos** los datos
  por los del backup en una sola transacción (si algo falla, no cambia nada). Antes guarda una copia del estado actual
  (`trigger: "pre_restore"`) para poder deshacer. Sin `password` usa la contraseña guardada en este servidor.
  → `{"ok":true,"backup":Backup,"safety_backup":Backup|null,"tables":{…},"total_rows","warnings":["…"],"relogin_required":bool}`.
  400: falta confirmar, contraseña incorrecta, archivo dañado/alterado/incompleto, o backup de una versión **más nueva** del portal.
  Un backup de una versión anterior se restaura con aviso. Si la copia solo está en Drive, primero hay que bajarla.

**AjustesBackup** (`PUT /backups/settings`, devuelve lo mismo que `GET /backups`):
`{"schedule_enabled":false,"frequency":"daily|weekly|hours","time":"03:00","weekdays":[7],"every_hours":12,"keep_local":10,
"include_logs":true,"include_epg":false,"encrypt":false,"password":"(solo escritura, mín. 8)","clear_password":true,
"google_drive":{"auto_upload":true,"keep":30,"folder_name":"Backups IPTV","client_id","client_secret":"(solo escritura)"}}`.
En la respuesta: `password_set`, `last_scheduled_at` y `google_drive.{client_secret_set, connected, account_email, connected_at, folder_id}`
(nunca la contraseña, el secreto ni el token). Días: 1=lunes … 7=domingo; la hora usa la zona horaria de Ajustes.
Al activar el horario la primera copia es en el próximo horario (no al instante). `keep_local` cuenta las copias no fijadas;
`google_drive.keep` = copias que se conservan en Drive (0 = no borrar).
- `POST /backups/settings/preview` `{"frequency","time","weekdays","every_hours"}` → `{"timezone","runs":[unix × 5]}` próximas copias.

**Google Drive** (conexión con código, sirve aunque el portal no tenga dominio ni IP pública; permiso `drive.file`:
la app solo ve los archivos que ella crea):
1. En Google Cloud Console: crear proyecto → activar **Google Drive API** → pantalla de consentimiento (externa, agregar tu
   correo como usuario de prueba) → Credenciales → **ID de cliente OAuth** de tipo **"TV y dispositivos de entrada limitada"**.
2. `POST /backups/drive/connect` `{"client_id","client_secret"}` → `{"status":"pending","user_code":"ABCD-EFGH",
   "verification_url":"https://www.google.com/device","expires_at","interval"}`. El administrador abre la URL, escribe el código
   y acepta. El portal consulta a Google solo en segundo plano.
3. `GET /backups/drive/connect` → `{"status":"idle|pending|connected|denied|expired|error","user_code?","verification_url?",
   "expires_at?","error","account_email","connected"}` (consultar cada 2-3 s mientras esté `pending`).
- `POST /backups/drive/cancel` · `POST /backups/drive/disconnect` (revoca el acceso en Google)
- `POST /backups/drive/test` → `{"ok","account_email","folder_id","folder_name","storage":{"limit","usage","free"}}` (crea la carpeta si falta)
- `GET /backups/drive/files` → `{"items":[{"id","name","size","created_at","encrypted","server_name","backup_id","local_backup_id","local","pinned"}]}`
- `POST /backups/drive/files/{fileId}/import` → 201 Backup descargado al servidor (listo para restaurar)
- `POST /backups/{id}/drive[?wait=true]` → sube (o vuelve a subir) esa copia; los fallos se reintentan solos cada 15 min (máx. 5 intentos).
- En `GET /dashboard`: `backups: {last_status, last_at, last_error, last_ok_at, next_run_at, schedule_enabled, drive_connected, running}` (null para revendedores).

Formato `.iptvbak`: `IPTVBAK1\n` + JSON de metadatos (versión, tablas y filas, migraciones, cifrado) + `\n` + gzip de líneas JSON
(`{"type":"table","name","columns"}`, `{"type":"rows","table","rows":[[…]]}`, …, `{"type":"end"}`); si está cifrado, ese gzip va
cifrado con AES-256-GCM y termina con la etiqueta de 16 bytes. Los metadatos se leen sin contraseña.

### Actualizaciones de la app (solo admin)
Objeto **AppRelease**: `{"id","package_name","version_name","version_code","channel":"stable|beta","notes","mandatory","published",
"targets":["tvbox","smart_tv","mobile","tablet","pc","stb"] (vacío = todos),"rollout_percent":100,"min_sdk","target_sdk","created_by",
"created_at","updated_at","published_at","downloads","installed_devices","files":[{"id","abi","version_code","filename","size","sha256","downloads","created_at","missing"}]}`
- `GET /app-releases` → `{"items":[AppRelease],"devices_by_version":[{"version","distribution","devices"}],"targets":[…]}`
  (`installed_devices` y `devices_by_version`: equipos vistos en los últimos 30 días)
- `POST /app-releases/upload?name=app-arm64-v8a-release.apk` con el APK como cuerpo binario (`application/octet-stream`, máx. 512 MB)
  → 201 `{"release":AppRelease,"file","replaced","warnings":[…],"apk":{"package","versionCode","versionName","minSdk","targetSdk","abis","abi"}}`.
  El portal lee paquete, versión y arquitectura del propio APK. Los APK con el mismo `versionName` se agrupan en una versión
  (uno por arquitectura; el que trae varias es `universal`). Queda **sin publicar**. 409 si ya hay un APK de esa arquitectura con número mayor.
- `PATCH /app-releases/{id}` `{"notes","channel","mandatory","targets","rollout_percent","published"}` (publicar exige al menos un APK)
- `DELETE /app-releases/{id}` · `DELETE /app-releases/{id}/files/{fileId}` (si no quedan archivos se despublica)
- `GET /app-releases/{id}/files/{fileId}/download`

En Ajustes (`GET/PUT /settings`): `company_name`, `app_name` ("IPTV Player"), `support_email`, `support_phone`.

### Versión y actualizaciones desde GitHub (solo admin)
El instalador guarda de qué commit se instaló (`server/build-info.json`: `{"commit","branch","repo","installed_at"}`); en desarrollo se lee
del repositorio git local. El repositorio es **automático**: el del instalador o `Sacxer/iptv-panel`, rama `main` (no se configura en el panel;
`UPDATES_REPO`/`UPDATES_BRANCH` solo para pruebas; `GITHUB_TOKEN` si algún día fuera privado).

- **Panel**: compara el commit instalado con la rama en GitHub. Actualizar = volver a ejecutar la línea de instalación en el servidor.
- **App**: cada versión es un *Release* de GitHub con etiqueta `app-v<versión>` (p. ej. `app-v1.0.2`) y los APK adjuntos
  (`*armeabi-v7a*.apk`, `*arm64-v8a*.apk`, `*x86_64*.apk` o universal). Los marcados como *pre-release* son beta; los borradores se ignoran.
  Al importar se descargan los APK, se comprueba la huella SHA-256 que publica GitHub y quedan en *Actualizaciones de la app*
  (en borrador salvo que se pida publicar o esté activado `auto_publish_app`). Las notas del Release pasan a las novedades.

- `GET /updates` → `{"current":{"version","commit","branch","repo","installed_at","source":"installer|git|unknown","node"},
  "repo":"Sacxer/iptv-panel","branch":"main","settings":{"check_enabled","check_hours","auto_import_app","auto_publish_app"},"checking","importing",
  "last":{"checked_at","repo","branch","error",
  "panel":{"current_version","current_commit","latest_version","latest_commit","latest_message","latest_date","update_available":true|false|null,
  "commits_behind","changes":[{"sha","message","date"}],"install_command","compare_url"},
  "app":{"latest":{"tag","version_name","name","notes","prerelease","published_at","url","assets":[{"name","size","abi","sha256","download_url"}]}|null,
  "beta":{…}|null,"imported":bool,"release_id","published":bool}}|null}`
  (`update_available: null` = no se sabe de qué commit se instaló)
- `POST /updates/check` → consulta GitHub ahora y devuelve lo mismo que `GET /updates`. 429 si GitHub limitó las consultas de esta IP
  (60 por hora sin token); se conserva el último resultado bueno con `last.error`.
- `POST /updates/app/import` `{"tag?":"app-v1.0.2","publish?":bool}` (por defecto la última estable) →
  `{"tag","version_name","release_id","published","files":[{"name","abi","version_code","replaced","warnings"}|{"name","error"}],"overview":{…}}`
- `PUT /updates/settings` `{"check_enabled","check_hours":1-168,"auto_import_app","auto_publish_app"}`
- Automático: revisa cada `check_hours` (primera revisión 2 min después de arrancar; `UPDATES_CHECK=false` lo apaga); con `auto_import_app`
  importa sola la versión nueva de la app.
- En `GET /dashboard`: `updates: {version, checked_at, panel_update_available, app_latest, app_update_pending}`.

### Puertos del portal (solo admin)
El puerto principal (`PORT`, panel y API; 8080) se fija al instalar. Los **puertos para clientes** (Xtream Codes / M3U; por
defecto `EXTRA_PORTS` del `.env`, p. ej. 25461) se cambian desde el panel y se aplican **al instante, sin reiniciar**.
Si un puerto está ocupado (p. ej. por XtreamUI) queda "en espera" y el portal lo abre solo cuando se libera (reintenta cada 30 s).
El puerto principal también atiende a los clientes.

- `GET /system/ports` → `{"panel_port":8080,"client_ports":[25461],"source":"panel|env","discovery_port":25460,"public_url",
  "listeners":[{"port","role":"panel|clients","status":"listening|waiting|error","error","since"}],"firewall_helper":bool,
  "xtream":{"on_server":"XtreamUI|XUI.one|null","migrated_from","suggested_port","original_port"}}`
  (`original_port`: el puerto HTTP que usaban los clientes en XtreamUI, leído al probar la conexión de migración;
  `suggested_port`: el recomendado para que los clientes no cambien nada)
- `POST /system/ports/check` `{"port"}` → `{"port","available":bool,"in_use_by_portal","error"}` (prueba sin quedarse con el puerto)
- `PUT /system/ports` `{"client_ports":[25461,80],"update_public_url":true}` → lo mismo que GET más
  `"results":[{"port","ok","error?","closed?","already?"}],"public_url_changed":"http://…"|null,"firewall":[{"port","ok","manual?","error?"}]`.
  Máximo 10; no se permiten el puerto del panel ni 22, 25, 53, 3306, 5432. Si la URL para clientes usaba un puerto que se quitó,
  pasa al primero de la lista. Los puertos nuevos se abren en ufw con el ayudante que deja el instalador
  (`/usr/local/sbin/iptv-firewall`, vía sudo); si no está, `manual` trae el comando.
- En el servidor: `sudo bash /opt/iptv/install-ubuntu.sh --set-clients-port 25461` hace lo mismo desde la consola.

### Registro de actividad (solo admin)
Objeto **Log**: `{"id","admin_id","admin_username","action","entity","entity_id","details","created_at"}`
- `GET /logs?page=&limit=`

### Dispositivos

Terminología del portal: **Clientes** = líneas (`/users`, tienen el usuario/contraseña Xtream y la lista M3U);
**Usuarios** = cuentas del panel (`/admins`). Los paths de la API no cambian.

Los equipos se registran solos cuando un cliente usa `player_api.php`, `get.php`, una URL de reproducción
o `/api/client/info`. Se reconocen por `X-Device-Id` (apps propias) o por cliente + User-Agent (apps de terceros).
Las apps propias deben enviar las cabeceras `X-Device-Id`, `X-Device-Type` (`tvbox|smart_tv|mobile|tablet|pc`),
`X-Device-Brand`, `X-Device-Model`, `X-Device-Mac` (si se puede) y `X-App-Name`.

Objeto **Dispositivo**:
```json
{
  "id": 1, "name": "Box bodega 001", "display_name": "Box bodega 001",
  "type": "tvbox", "type_label": "TV Box", "type_locked": true,
  "brand": "", "model": "X96 Mini", "os": "Android 9", "app": "TiviMate",
  "mac": "AA:BB:CC:DD:EE:FF", "serial": "SN-001", "device_id": "APP-001", "user_agent": "…",
  "ownership": "company", "inventory_status": "assigned",
  "user_id": 5, "username": "juan", "client_name": "Juan Pérez",
  "last_user_id": 5, "last_username": "juan",
  "source": "manual", "notes": "", "last_ip": "1.2.3.4", "last_activity": "stream",
  "first_seen_at": 1726300000, "last_seen_at": 1726300000,
  "online": true, "inactive": false, "open_alerts": 0, "created_at": 1726300000
}
```
- `type`: `tvbox` | `smart_tv` | `mobile` | `tablet` | `pc` | `stb` (MAG/Enigma2) | `unknown`
- `ownership`: `company` | `client` | `unknown` — `inventory_status`: `available` (en bodega) | `assigned` | `review` | `retired`
- `last_activity`: `xtream_api` | `m3u` | `stream` | `app` — `source`: `auto` | `manual`
- `online`: visto en los últimos `device_online_minutes`; `inactive`: sin actividad en `device_inactive_days`.

Endpoints (escritura solo admin; los revendedores ven los dispositivos de sus clientes):
- `GET /devices?search=&type=&ownership=&inventory_status=&user_id=&unassigned=true&source=&online=true&inactive=true&with_alerts=true&sort=last_seen_at|created_at|type&order=&page=&limit=` → paginado
- `GET /devices/stats` → `{"total","online","inactive","company_tvbox","in_stock","unassigned","open_alerts","by_type":{"tvbox":0,…},"last_check_at","settings":{…}}`
- `POST /devices` (registro manual; por defecto `type: tvbox`, `ownership: company`) — campos: `name, type, brand, model, os, mac, serial, device_id, ownership, inventory_status, user_id, notes`
- `GET /devices/{id}` · `PUT /devices/{id}` (mismos campos; cambiar `type` lo bloquea frente a la detección) · `DELETE /devices/{id}`
- `POST /devices/{id}/assign` `{"user_id": 5 | null}` (asignar cierra alertas `new_tvbox` y `foreign_user`)
- `POST /devices/check` → ejecuta ya la revisión de inactividad: `{"checked_at","inactive_found","alerts_created"}`
- `GET /devices/ids?{mismos filtros del listado}` → `{"ids":[…],"total","truncated"}` (para "seleccionar todos los que coinciden", máx. 50 000)
- `POST /devices/bulk` (admin) `{"action":"delete|set_ownership|set_inventory|set_type|unassign|resolve_alerts","value?","ids":[…]}`
  o con `"filter":{…mismos filtros del listado…}` en lugar de `ids` → `{"affected","selected"}`
  (`value`: propiedad para set_ownership, estado de inventario para set_inventory, tipo para set_type, nota para resolve_alerts)
- `GET /devices/duplicates` (admin) → `{"groups":[{"key","reason":"same_signature|same_session|mixed","target_id","device_ids","devices":[Dispositivo]}],"duplicate_devices","orphans"}`
- `POST /devices/merge` `{"target_id","source_ids":[…]}` → `{"merged","device"}` (completa datos, mueve alertas y firmas, borra los repetidos)
- `POST /devices/dedupe` `{"dry_run?"}` → `{"dry_run","groups","merged"}` (fusiona todos los grupos conservando el registro más completo)
- `POST /devices/cleanup-orphans` `{"dry_run?"}` → `{"dry_run","orphans","deleted"}` (equipos detectados de clientes que ya no existen; nunca los de la empresa ni los manuales)

**Cómo se evita repetir equipos:** el User-Agent se compara sin números de versión; las peticiones del mismo cliente desde la misma
IP en 15 minutos se unen al mismo equipo si son compatibles (una firma genérica como `okhttp`, `VLC` o `IPTVSmartersPlayer` se une
al equipo real; un celular y un TV Box con modelos distintos no se mezclan) y la firma queda recordada como alias. La app propia con
`X-Device-Id` es la identificación exacta. Al borrar un cliente se borran sus equipos detectados automáticamente; los TV Box de la
empresa y los registrados a mano quedan sin asignar.
- `GET /devices/alerts?status=open|resolved|all&type=&device_id=&page=&limit=` → paginado de
  `{"id","device_id","device_name","device_type","user_id","username","type","message","status","resolution","created_at","resolved_at"}`
- `POST /devices/alerts/{id}/resolve` `{"resolution":"Cliente contactado"}`

Tipos de alerta: `inactive` (sin conexión en N días; se cierra sola si vuelve a conectarse), `new_tvbox`
(TV Box nuevo detectado), `foreign_user` (equipo de la empresa usado con la cuenta de otro cliente).
La revisión corre automáticamente cada `device_check_interval_minutes`. Si `device_inactive_message_client`
está activo, además se envía un mensaje al cliente.

Ajustes nuevos en `/settings`: `device_online_minutes` (10), `device_inactive_days` (30),
`device_check_interval_minutes` (60), `tvbox_default_ownership` (`company`), `device_alert_new_tvbox` (true),
`device_inactive_message_client` (false). `GET /dashboard` añade `"devices": {"online","total","open_alerts"}`
y el objeto Usuario (cliente) añade `device_count`.

### Migración desde XtreamUI (solo admin)
- `POST /xtream/test` `{"host","port","user","password?","database","save":true}`
  → `{"ok":true,"counts":{"users":0,"resellers":0,"bouquets":0,"categories":0,"live":0,"movie":0,"series":0,"episodes":0}}`
  (si no se envía `password` se usa la guardada)
- `POST /xtream/migrate` `{"options":{"categories":true,"packages":true,"streams":true,"series":true,"users":true,"resellers":false,"overwrite":false}}`
  → `{"job_id":"abc"}` (usa la conexión guardada)
- `GET /xtream/jobs` → lista de trabajos (sin `log`)
- `GET /xtream/jobs/{id}` →
```json
{
  "id": "abc", "status": "running|done|error",
  "progress": {"step": "users", "current": 120, "total": 500},
  "stats": {"categories":{"created":0,"updated":0,"skipped":0}, "packages":{…}, "streams":{…}, "series":{…}, "episodes":{…}, "users":{…}, "resellers":{…}},
  "log": ["Conectado a MySQL…"], "error": null,
  "reseller_credentials": [{"username":"rev1","password":"generada"}],
  "started_at": 1726300000, "finished_at": null
}
```
Reglas de migración: se conservan IDs, usuario, contraseña, vencimiento, conexiones máximas, prueba,
notas y paquetes. `admin_enabled=0` → suspendido; `enabled=0` → deshabilitado. Con `overwrite:false`
los registros existentes (mismo `xtream_id` o mismo `username`) se omiten; con `true` se actualizan.
Las contraseñas de revendedores de XtreamUI están cifradas, así que se generan nuevas y se devuelven.
