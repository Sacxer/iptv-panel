#!/usr/bin/env bash
# Contenido de demostración para la revisión de las tiendas de TV (LG / Samsung), en un servidor de PRUEBAS que ya
# tiene el portal instalado (curl …/install.sh | sudo bash). No lo use en el servidor con sus clientes reales:
# el programa se niega si el portal ya tiene clientes.
#
#   sudo bash /opt/iptv-src/deploy/demo-revision.sh [--rehacer] [--forzar]
#
# Qué hace:
#  1. Instala FFmpeg y descarga 4 películas abiertas de la Fundación Blender (Creative Commons Atribución):
#     Big Buck Bunny, Elephants Dream, Sintel y Tears of Steel (unos 1,6 GB; se necesitan 5 GB libres).
#  2. Las deja en HLS (/var/lib/iptv-demo/vod) y crea 3 canales «en vivo» que las repiten sin parar
#     (servicios iptv-demo-canal@bbb, @tos y @ed). Nginx las publica en http://IP/demo/…
#  3. Carga en el portal los canales (por el nodo de este servidor si está instalado), las películas, una serie,
#     un paquete, un mensaje, un aviso y dos cuentas de prueba (lgqa1 y lgqa2), y las muestra al final.
# Volver a ejecutarlo no descarga ni duplica nada; con --rehacer crea el contenido y las cuentas otra vez.
# --forzar: cargarlo aunque el portal ya tenga clientes (p. ej. uno creado a mano para probar).
set -euo pipefail

APP_DIR=/opt/iptv
APP_USER=iptv
DEMO=/var/lib/iptv-demo
NGINX_SITE=/etc/nginx/sites-available/iptv
LOADER_ARGS=()
for a in "$@"; do
  case "$a" in
    --rehacer|--forzar) LOADER_ARGS+=("$a") ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $a"; exit 1 ;;
  esac
done

step() { echo; echo "==> $*"; }
if [[ $EUID -ne 0 ]]; then echo "Ejecuta como root: sudo bash $0"; exit 1; fi
if [[ ! -f "$APP_DIR/server/src/index.js" ]]; then echo "No está instalado el portal en $APP_DIR."; exit 1; fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOADER="$APP_DIR/server/scripts/demo-revision.js"
if [[ ! -f "$LOADER" ]]; then
  # Portal instalado antes de este programa: se toma de la copia descargada
  cp "$SCRIPT_DIR/../server/scripts/demo-revision.js" "$LOADER"
  chown "$APP_USER:$APP_USER" "$LOADER"
fi
if [[ ! -f "$NGINX_SITE" ]]; then
  echo "Este programa necesita el Nginx que deja el instalador (panel en el puerto 80)."; exit 1
fi

# name|url|archivo dentro del zip (vacío si no es zip)
MOVIES=(
  "ed|https://download.blender.org/ED/elephantsdream-720-h264-st-aac.mov|"
  "tos|https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov|"
  "bbb|https://download.blender.org/peach/bigbuckbunny_movies/big_buck_bunny_720p_h264.mov.zip|big_buck_bunny_720p_h264.mov"
  "sintel|https://download.blender.org/durian/movies/Sintel.2010.720p.mkv.zip|Sintel.2010.720p.mkv"
)
CHANNELS=(bbb tos ed)

step "FFmpeg"
export DEBIAN_FRONTEND=noninteractive
if ! command -v ffmpeg >/dev/null || ! command -v unzip >/dev/null; then
  apt-get update -q
  apt-get install -y -q ffmpeg unzip
fi

mkdir -p "$DEMO/src" "$DEMO/mp4" "$DEMO/vod"
need_download=0
for m in "${MOVIES[@]}"; do
  IFS='|' read -r slug _ _ <<<"$m"
  [[ -f "$DEMO/vod/$slug/index.m3u8" && -f "$DEMO/mp4/$slug.mp4" ]] || need_download=1
done
if (( need_download )); then
  FREE_GB="$(df --output=avail -BG "$DEMO" | tail -1 | tr -dc '0-9')"
  if (( FREE_GB < 5 )); then
    echo "Hay ${FREE_GB} GB libres y se necesitan 5 GB. Amplíe el disco del servidor y vuelva a ejecutarlo."; exit 1
  fi
fi

codec() { ffprobe -v error -select_streams "$1:0" -show_entries stream=codec_name -of csv=p=0 "$2" | head -1; }

for m in "${MOVIES[@]}"; do
  IFS='|' read -r slug url inner <<<"$m"
  if [[ -f "$DEMO/vod/$slug/index.m3u8" && -f "$DEMO/mp4/$slug.mp4" ]]; then
    echo "$slug: listo"
    continue
  fi
  step "Película $slug"
  file="$DEMO/src/$(basename "$url")"
  curl -fL --retry 3 -C - -o "$file" "$url"
  if [[ -n "$inner" ]]; then
    unzip -o -j -q "$file" "*$inner" -d "$DEMO/src"
    rm -f "$file"
    file="$DEMO/src/$inner"
  fi
  vopts=(-c:v copy)
  [[ "$(codec v "$file")" == "h264" ]] || vopts=(-c:v libx264 -preset veryfast -crf 23 -vf scale=-2:720 -pix_fmt yuv420p)
  aopts=(-c:a copy)
  [[ "$(codec a "$file")" == "aac" ]] || aopts=(-c:a aac -b:a 128k -ac 2)
  echo "Preparando $slug (video: ${vopts[1]}, audio: ${aopts[1]})…"
  ffmpeg -nostdin -loglevel error -y -i "$file" -map 0:v:0 -map 0:a:0 "${vopts[@]}" "${aopts[@]}" -movflags +faststart "$DEMO/mp4/$slug.mp4"
  rm -rf "$DEMO/vod/$slug"
  mkdir -p "$DEMO/vod/$slug"
  ffmpeg -nostdin -loglevel error -y -i "$DEMO/mp4/$slug.mp4" -c copy -f hls -hls_time 6 -hls_playlist_type vod \
    -hls_segment_filename "$DEMO/vod/$slug/seg%04d.ts" "$DEMO/vod/$slug/index.m3u8"
  rm -f "$file"
done
chmod -R a+rX "$DEMO"

step "Canales en vivo de demostración"
cat > /etc/systemd/system/iptv-demo-canal@.service <<'UNIT'
[Unit]
Description=Canal de demostración %i (repite una película abierta de Blender)
After=network-online.target
StartLimitIntervalSec=0

[Service]
User=www-data
RuntimeDirectory=iptv-demo/%i
ExecStart=/usr/bin/ffmpeg -nostdin -loglevel error -re -stream_loop -1 -i /var/lib/iptv-demo/mp4/%i.mp4 -map 0:v:0 -map 0:a:0 -c copy -f hls -hls_time 4 -hls_list_size 6 -hls_flags delete_segments+omit_endlist+temp_file -hls_segment_filename /run/iptv-demo/%i/seg%%05d.ts /run/iptv-demo/%i/index.m3u8
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
for ch in "${CHANNELS[@]}"; do systemctl enable --now "iptv-demo-canal@$ch" >/dev/null 2>&1 || systemctl restart "iptv-demo-canal@$ch"; done

step "Nginx"
cat > /etc/nginx/snippets/iptv-demo.conf <<'NGINX'
# Videos de demostración para la revisión de las tiendas (deploy/demo-revision.sh)
location /demo/vod/ {
    alias /var/lib/iptv-demo/vod/;
    add_header Access-Control-Allow-Origin * always;
}
location /demo/live/ {
    alias /run/iptv-demo/;
    add_header Access-Control-Allow-Origin * always;
    add_header Cache-Control no-cache always;
}
NGINX
if ! grep -q 'snippets/iptv-demo.conf' "$NGINX_SITE"; then
  sed -i '0,/location \/ {/s//include snippets\/iptv-demo.conf;\n\n    location \/ {/' "$NGINX_SITE"
fi
nginx -t
systemctl reload nginx

for _ in $(seq 1 20); do
  [[ -f /run/iptv-demo/bbb/index.m3u8 ]] && break
  sleep 1
done
if curl -fsS http://127.0.0.1/demo/live/bbb/index.m3u8 >/dev/null && curl -fsS http://127.0.0.1/demo/vod/ed/index.m3u8 >/dev/null; then
  echo "Videos publicados en http://IP/demo/"
else
  echo "Aviso: Nginx todavía no entrega los videos. Revise: journalctl -u iptv-demo-canal@bbb -n 20"
fi

step "Contenido y cuentas de prueba en el portal"
(cd "$APP_DIR/server" && sudo -u "$APP_USER" node scripts/demo-revision.js ${LOADER_ARGS[@]+"${LOADER_ARGS[@]}"})
echo
echo "Listo. Pruebe con la app (Xtream Codes) usando el servidor y una de las cuentas de arriba."
NODE_PORT="$(sed -n 's/^PORT=//p' /etc/iptv-node.env 2>/dev/null || true)"
if [[ -n "$NODE_PORT" ]]; then
  echo "Los canales pasan por el nodo de este servidor: el puerto ${NODE_PORT}/tcp debe estar abierto en el cortafuegos del proveedor."
else
  echo "Aviso: el nodo de streaming de este servidor no está instalado; actualice el portal (instalador) para que los canales funcionen."
fi
