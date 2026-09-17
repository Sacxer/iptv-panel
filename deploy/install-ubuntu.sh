#!/usr/bin/env bash
# Instalador del Portal IPTV para Ubuntu 20.04 / 22.04 / 24.04 (sin Docker).
#
#  - Instalación nueva: deja todo funcionando SIN datos (sin clientes, canales ni ajustes previos) y al final
#    muestra la dirección del panel, el usuario y la contraseña.
#  - Si ya está instalado: actualiza el programa y conserva datos, usuarios y ajustes (antes hace un backup).
#  - Si el servidor ya tiene XtreamUI (o XUI.one): no lo toca. Usa puertos libres, no cierra sus puertos en el
#    cortafuegos y deja lista la migración con los datos de su base de datos.
#
# Uso (como root, desde la carpeta del proyecto):
#   sudo bash deploy/install-ubuntu.sh [opciones]
#
# Opciones:
#   --admin-user USUARIO     usuario del panel (por defecto: admin)
#   --admin-pass CLAVE       contraseña del panel (por defecto: aleatoria; mínimo 8 caracteres)
#   --clients-port PUERTO    puerto para clientes Xtream Codes / M3U (por defecto: 25461 o, si está ocupado, uno libre)
#   --no-firewall            no tocar el cortafuegos (ufw)
#   --sin-nodo               no instalar el nodo de streaming en este servidor (por defecto sí: el mismo servidor
#                            reenvía y transcodifica canales; al actualizar se actualiza también el nodo)
# En un servidor ya instalado (sudo bash /opt/iptv/install-ubuntu.sh …):
#   --reset-admin            solo pone una contraseña nueva al usuario del panel [--admin-user U] [--admin-pass C]
#   --set-clients-port N     solo cambia el puerto de clientes (p. ej. 25461 después de apagar XtreamUI)
set -euo pipefail

APP_DIR=/opt/iptv
APP_USER=iptv
CREDENTIALS_FILE=/root/iptv-credenciales.txt
DISCOVERY_PORT=25460

ADMIN_USER="admin"
ADMIN_PASS=""
RESET_ADMIN=0
SET_CLIENTS_PORT=""
CLIENTS_PORT=""
FIREWALL=1
LOCAL_NODE=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-user) ADMIN_USER="${2:-}"; shift 2 ;;
    --admin-pass) ADMIN_PASS="${2:-}"; shift 2 ;;
    --reset-admin) RESET_ADMIN=1; shift ;;
    --clients-port) CLIENTS_PORT="${2:-}"; shift 2 ;;
    --set-clients-port) SET_CLIENTS_PORT="${2:-}"; shift 2 ;;
    --no-firewall) FIREWALL=0; shift ;;
    --sin-nodo) LOCAL_NODE=0; shift ;;
    -h|--help) sed -n '2,23p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1 (usa --help)"; exit 1 ;;
  esac
done

valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= 1 && $1 <= 65535 )); }

if [[ $EUID -ne 0 ]]; then echo "Ejecuta como root: sudo bash $0"; exit 1; fi
if [[ ! "$ADMIN_USER" =~ ^[A-Za-z0-9._-]{3,64}$ ]]; then echo "Usuario no válido (3-64 letras, números, . _ -)"; exit 1; fi
if [[ -n "$ADMIN_PASS" && ${#ADMIN_PASS} -lt 8 ]]; then echo "La contraseña debe tener al menos 8 caracteres"; exit 1; fi
if [[ -n "$CLIENTS_PORT" ]] && ! valid_port "$CLIENTS_PORT"; then echo "Puerto de clientes no válido"; exit 1; fi
if [[ -n "$SET_CLIENTS_PORT" ]] && ! valid_port "$SET_CLIENTS_PORT"; then echo "Puerto de clientes no válido"; exit 1; fi

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID:-}" == "ubuntu" ]]; then
    if [[ "$(printf '%s\n' "20.04" "${VERSION_ID:-0}" | sort -V | head -1)" != "20.04" ]]; then
      echo "Este servidor tiene Ubuntu ${VERSION_ID}. El portal necesita Ubuntu 20.04 o más nuevo (Node.js 22 no funciona en ${VERSION_ID})."
      echo "Si aquí corre XtreamUI (suele estar en 18.04): instala el portal en otro servidor y migra desde allá"
      echo "(Migración XtreamUI → conexión a la MySQL de este servidor), o actualiza el sistema operativo."
      exit 1
    fi
  else
    echo "Aviso: probado en Ubuntu; este sistema es ${PRETTY_NAME:-desconocido}. Se continúa."
  fi
fi

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRESH=1
[[ -f "$APP_DIR/server/.env" ]] && FRESH=0
ENV_FILE="$APP_DIR/server/.env"

step() { echo; echo "==> $*"; }
random_pass() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-16}" || true; }
env_get() { [[ -f "$ENV_FILE" ]] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 || true; }
env_set() {
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}

# IP para los clientes: la de la interfaz de red principal (la que tiene la puerta de enlace).
# Sirve aunque el servidor no tenga IP pública; nunca se usa 127.0.0.1.
detect_main_ip() {
  local ip
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
  if [[ -z "$ip" ]]; then
    ip="$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|veth|br-|virbr|lo)/ {split($4,a,"/"); print a[1]; exit}')"
  fi
  echo "$ip"
}

# Puertos TCP a la escucha y quién los usa.
port_busy() { ss -Hltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"; }
port_owner() {
  local pid exe
  pid="$(ss -Hltnp 2>/dev/null | awk -v p=":$1" '$4 ~ p"$" {print $6}' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"
  [[ -z "$pid" ]] && { echo "desconocido"; return; }
  exe="$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)"
  echo "${exe:-pid $pid}"
}
# ¿El puerto lo tiene el propio portal? (proceso del usuario del portal)
port_is_ours() {
  local pid
  pid="$(ss -Hltnp 2>/dev/null | awk -v p=":$1" '$4 ~ p"$" {print $6}' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"
  [[ -n "$pid" && "$(ps -o user= -p "$pid" 2>/dev/null | tr -d ' ')" == "$APP_USER" ]]
}
first_free_port() {
  local p
  for p in "$@"; do port_busy "$p" || { echo "$p"; return 0; }; done
  return 1
}
ufw_active() { command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; }

# XtreamUI / XUI.one en este mismo servidor.
XTREAM_KIND=""
if [[ -d /home/xtreamcodes/iptv_xtream_codes ]]; then XTREAM_KIND="XtreamUI";
elif [[ -d /home/xui ]]; then XTREAM_KIND="XUI.one"; fi

# ---------------------------------------------------------------------------------------------------------------
# Tareas sueltas en un servidor ya instalado (no reinstalan nada).
# ---------------------------------------------------------------------------------------------------------------
if (( RESET_ADMIN )); then
  if (( FRESH )); then echo "El portal no está instalado en $APP_DIR"; exit 1; fi
  [[ -z "$ADMIN_PASS" ]] && ADMIN_PASS="$(random_pass 16)"
  (cd "$APP_DIR/server" && sudo -u "$APP_USER" env ADMIN_USER="$ADMIN_USER" ADMIN_PASS="$ADMIN_PASS" node scripts/create-admin.js --from-env)
  MAIN_IP="$(detect_main_ip || true)"
  PANEL_URL="$(sed -n 's/^Panel: *//p' "$CREDENTIALS_FILE" 2>/dev/null | head -1)"
  PANEL_URL="${PANEL_URL:-http://${MAIN_IP:-IP-DEL-SERVIDOR}/admin}"
  install -m 600 /dev/null "$CREDENTIALS_FILE"
  printf 'Portal IPTV — acceso al panel\nPanel:      %s\nUsuario:    %s\nContraseña: %s\nCambiada:   %s\n' \
    "$PANEL_URL" "$ADMIN_USER" "$ADMIN_PASS" "$(date '+%Y-%m-%d %H:%M')" > "$CREDENTIALS_FILE"
  echo
  echo "   Panel:       ${PANEL_URL}"
  echo "   Usuario:     ${ADMIN_USER}"
  echo "   Contraseña:  ${ADMIN_PASS}"
  echo "(guardado en ${CREDENTIALS_FILE})"
  exit 0
fi

if [[ -n "$SET_CLIENTS_PORT" ]]; then
  if (( FRESH )); then echo "El portal no está instalado en $APP_DIR"; exit 1; fi
  OLD_PORT="$(env_get EXTRA_PORTS | cut -d, -f1)"
  if [[ "$SET_CLIENTS_PORT" == "$(env_get PORT)" ]]; then
    echo "El $SET_CLIENTS_PORT es el puerto del panel: usa uno distinto para los clientes."
    exit 1
  fi
  if port_busy "$SET_CLIENTS_PORT" && ! port_is_ours "$SET_CLIENTS_PORT"; then
    echo "El puerto $SET_CLIENTS_PORT lo está usando: $(port_owner "$SET_CLIENTS_PORT")."
    [[ -n "$XTREAM_KIND" ]] && echo "Apaga primero $XTREAM_KIND (y su inicio automático) cuando hayas terminado la migración."
    exit 1
  fi
  env_set EXTRA_PORTS "$SET_CLIENTS_PORT"
  PUB="$(env_get PUBLIC_URL)"
  if [[ "$PUB" =~ ^(https?://[^/:]+):([0-9]+)$ && "${BASH_REMATCH[2]}" == "$OLD_PORT" ]]; then
    env_set PUBLIC_URL "${BASH_REMATCH[1]}:${SET_CLIENTS_PORT}"
  fi
  (cd "$APP_DIR/server" && sudo -u "$APP_USER" node scripts/set-client-ports.js "$SET_CLIENTS_PORT") || true
  if (( FIREWALL )) && ufw_active; then ufw allow "${SET_CLIENTS_PORT}/tcp" >/dev/null; fi
  systemctl restart iptv-portal
  echo "Puerto de clientes: ${OLD_PORT:-?} -> ${SET_CLIENTS_PORT}. Portal reiniciado."
  echo "Revisa la URL para clientes en el panel (Ajustes -> Red) si usas un dominio."
  exit 0
fi

if [[ ! -d "$SRC_DIR/server/src" || "$SRC_DIR" == "$APP_DIR" || "$SRC_DIR" == "$(dirname "$APP_DIR")" ]]; then
  echo "Ejecuta el instalador desde la carpeta del proyecto (o usa la línea de instalación con install.sh)."
  exit 1
fi

if (( FRESH )); then
  echo "Instalación NUEVA del Portal IPTV en $APP_DIR (sin datos)."
else
  echo "El Portal IPTV ya está instalado en $APP_DIR: se ACTUALIZA conservando datos, usuarios y ajustes."
fi
[[ -n "$XTREAM_KIND" ]] && echo "Se detectó ${XTREAM_KIND} en este servidor: se instala al lado, sin detenerlo ni cambiar su configuración."

# ---------------------------------------------------------------------------------------------------------------
# Puertos: en una instalación nueva se eligen libres; al actualizar se conservan los del .env.
# ---------------------------------------------------------------------------------------------------------------
if (( FRESH )); then
  PORTAL_PORT="$(first_free_port 8080 8081 8082 8090 18080)" || { echo "No hay un puerto libre para el portal (8080-8090)."; exit 1; }
  if [[ -n "$CLIENTS_PORT" ]]; then
    if port_busy "$CLIENTS_PORT"; then
      echo "El puerto $CLIENTS_PORT lo está usando: $(port_owner "$CLIENTS_PORT"). Elige otro con --clients-port."
      exit 1
    fi
  else
    CLIENTS_PORT="$(first_free_port 25461 25471 25481 25491 8880 8881)" || { echo "No hay un puerto libre para clientes."; exit 1; }
  fi
  # Panel en el puerto 80 con Nginx solo si el 80 está libre y no hay otro Nginx con sitios propios.
  USE_NGINX=1
  if port_busy 80; then
    USE_NGINX=0
    echo "El puerto 80 lo usa $(port_owner 80): el panel quedará en el puerto ${PORTAL_PORT}."
  elif [[ -d /etc/nginx/sites-enabled ]] && ls /etc/nginx/sites-enabled 2>/dev/null | grep -vqx 'default'; then
    USE_NGINX=0
    echo "Nginx ya tiene otros sitios: no se modifican; el panel quedará en el puerto ${PORTAL_PORT}."
  fi
else
  PORTAL_PORT="$(env_get PORT)"; PORTAL_PORT="${PORTAL_PORT:-8080}"
  CLIENTS_PORT="$(env_get EXTRA_PORTS | cut -d, -f1)"; CLIENTS_PORT="${CLIENTS_PORT:-25461}"
  USE_NGINX=0
  [[ -f /etc/nginx/sites-enabled/iptv ]] && USE_NGINX=1
fi

step "Paquetes del sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
PKGS=(curl ca-certificates build-essential python3 tar)
(( USE_NGINX )) && PKGS+=(nginx)
(( FIREWALL )) && ! command -v ufw >/dev/null && [[ -z "$XTREAM_KIND" ]] && PKGS+=(ufw)
apt-get install -y -q "${PKGS[@]}"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
echo "Node $(node -v)"

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"

if (( ! FRESH )) && [[ -f "$APP_DIR/server/scripts/backup-now.js" ]]; then
  step "Backup antes de actualizar"
  (cd "$APP_DIR/server" && sudo -u "$APP_USER" node scripts/backup-now.js "Antes de actualizar el programa") \
    || echo "Aviso: no se pudo hacer el backup automático; se continúa."
fi

step "Copiando el programa"
# Solo el código: nunca datos (base, backups, APK, EPG) ni contraseñas (.env) de donde se copia.
# Al actualizar, los datos y el .env que ya tenga este servidor se conservan.
tar -C "$SRC_DIR" \
  --exclude='server/data' --exclude='server/.env' --exclude='node_modules' --exclude='admin/dist' \
  -cf - server admin docs | tar -C "$APP_DIR" -xf -
cp "$SRC_DIR/deploy/install-ubuntu.sh" "$APP_DIR/install-ubuntu.sh" 2>/dev/null || true
# De qué versión de GitHub se instaló: el panel lo compara para avisar de actualizaciones.
if command -v git >/dev/null && git -C "$SRC_DIR" rev-parse HEAD >/dev/null 2>&1; then
  B_COMMIT="$(git -C "$SRC_DIR" rev-parse HEAD)"
  B_BRANCH="$(git -C "$SRC_DIR" rev-parse --abbrev-ref HEAD)"
  B_REPO="$(git -C "$SRC_DIR" remote get-url origin 2>/dev/null | sed -E 's#^[a-z]+://([^@/]*@)?github\.com/##; s#^git@github\.com:##; s#\.git$##')"
  printf '{"commit":"%s","branch":"%s","repo":"%s","installed_at":%s}\n' "$B_COMMIT" "$B_BRANCH" "$B_REPO" "$(date +%s)" > "$APP_DIR/server/build-info.json"
fi

step "Compilando el panel"
cd "$APP_DIR/admin" && npm ci --no-audit --no-fund && npm run build && rm -rf node_modules
step "Dependencias del servidor"
cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund

MAIN_IP="$(detect_main_ip || true)"
HOST_SHOW="${MAIN_IP:-IP-DEL-SERVIDOR}"
if (( USE_NGINX )); then PANEL_URL="http://${HOST_SHOW}/admin"; else PANEL_URL="http://${HOST_SHOW}:${PORTAL_PORT}/admin"; fi

if (( FRESH )); then
  step "Configuración inicial"
  cp "$APP_DIR/server/.env.example" "$ENV_FILE"
  env_set JWT_SECRET "$(random_pass 48)"
  env_set ADMIN_PASSWORD ""
  env_set PORT "$PORTAL_PORT"
  env_set EXTRA_PORTS "$CLIENTS_PORT"
  (( USE_NGINX )) || env_set TRUST_PROXY false
  [[ -n "$MAIN_IP" ]] && env_set PUBLIC_URL "http://${MAIN_IP}:${CLIENTS_PORT}"
fi
chmod 600 "$ENV_FILE"
mkdir -p "$APP_DIR/server/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# Usuario del panel: se crea antes de arrancar (así la contraseña nunca queda escrita en .env).
SHOW_PASS=""
if (( FRESH )); then
  step "Usuario del panel"
  [[ -z "$ADMIN_PASS" ]] && ADMIN_PASS="$(random_pass 16)"
  (cd "$APP_DIR/server" && sudo -u "$APP_USER" env ADMIN_USER="$ADMIN_USER" ADMIN_PASS="$ADMIN_PASS" node scripts/create-admin.js --from-env)
  SHOW_PASS="$ADMIN_PASS"
  install -m 600 /dev/null "$CREDENTIALS_FILE"
  cat > "$CREDENTIALS_FILE" <<CRED
Portal IPTV — acceso al panel
Panel:      ${PANEL_URL}
Usuario:    ${ADMIN_USER}
Contraseña: ${ADMIN_PASS}
Creado:     $(date '+%Y-%m-%d %H:%M')
CRED
fi

# Datos de la base de XtreamUI para la migración (se leen como root; se guardan con el usuario del portal).
XTREAM_MSG=""
if [[ -n "$XTREAM_KIND" ]]; then
  step "Conexión a ${XTREAM_KIND} para la migración"
  if XJSON="$(cd "$APP_DIR/server" && node scripts/detect-xtreamui.js 2>/dev/null)" && [[ -n "$XJSON" ]]; then
    if echo "$XJSON" | grep -q '"unreadable"'; then
      XTREAM_MSG="No se pudo leer la configuración de ${XTREAM_KIND}: escribe los datos de su MySQL en el panel (Migración XtreamUI)."
    else
      XTREAM_MSG="$(cd "$APP_DIR/server" && printf '%s' "$XJSON" | sudo -u "$APP_USER" node scripts/set-xtream-db.js)"
    fi
    echo "$XTREAM_MSG"
  fi
  XJSON=""
fi

step "Permisos del panel para el cortafuegos"
# El panel puede abrir en ufw los puertos que se agreguen para clientes (solo eso, validado aquí).
cat > /usr/local/sbin/iptv-firewall <<'HELPER'
#!/bin/sh
# Abre un puerto TCP en ufw para el Portal IPTV. Lo llama el panel con sudo. Uso: iptv-firewall allow <puerto>
set -eu
if [ "$#" -ne 2 ] || [ "$1" != "allow" ]; then echo "uso: iptv-firewall allow <puerto>" >&2; exit 2; fi
case "$2" in ''|*[!0-9]*) echo "puerto no válido" >&2; exit 2 ;; esac
if [ "$2" -lt 1 ] || [ "$2" -gt 65535 ]; then echo "puerto no válido" >&2; exit 2; fi
if ! command -v ufw >/dev/null 2>&1 || ! ufw status | grep -q "Status: active"; then
  echo "El cortafuegos no está activo: no hace falta abrir el puerto."
  exit 0
fi
ufw allow "$2/tcp"
HELPER
chmod 755 /usr/local/sbin/iptv-firewall
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/iptv-firewall
' "$APP_USER" > /tmp/iptv-portal.sudoers
if visudo -cf /tmp/iptv-portal.sudoers >/dev/null; then
  install -m 440 /tmp/iptv-portal.sudoers /etc/sudoers.d/iptv-portal
else
  echo "Aviso: no se pudo configurar sudo para el cortafuegos; abre los puertos nuevos a mano (ufw allow N/tcp)."
fi
rm -f /tmp/iptv-portal.sudoers

step "Servicio del portal"
cat > /etc/systemd/system/iptv-portal.service <<UNIT
[Unit]
Description=Portal IPTV
# Arranca solo al encender el servidor (p. ej. tras un corte de luz), cuando la red ya está lista.
Wants=network-online.target
After=network-online.target
# Nunca deja de reintentar, aunque falle varias veces seguidas.
StartLimitIntervalSec=0

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/server
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
LimitNOFILE=65535
# Permite escuchar en puertos < 1024 si se configuran
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable iptv-portal >/dev/null
systemctl restart iptv-portal

if (( USE_NGINX )); then
  step "Nginx (panel en el puerto 80)"
  sed "s#http://127.0.0.1:8080#http://127.0.0.1:${PORTAL_PORT}#" "$SRC_DIR/deploy/nginx-iptv.conf" > /etc/nginx/sites-available/iptv
  ln -sf /etc/nginx/sites-available/iptv /etc/nginx/sites-enabled/iptv
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
fi

# ---------------------------------------------------------------------------------------------------------------
# Cortafuegos: nunca se cierran puertos de otros programas.
# ---------------------------------------------------------------------------------------------------------------
OUR_RULES=("${CLIENTS_PORT}/tcp" "${DISCOVERY_PORT}/udp")
if (( USE_NGINX )); then OUR_RULES+=("80/tcp" "443/tcp"); else OUR_RULES+=("${PORTAL_PORT}/tcp"); fi
FIREWALL_MSG=""
if (( FIREWALL )) && command -v ufw >/dev/null; then
  step "Cortafuegos"
  if ufw_active; then
    for r in "${OUR_RULES[@]}"; do ufw allow "$r" >/dev/null; done
    FIREWALL_MSG="Cortafuegos: se abrieron ${OUR_RULES[*]} (las reglas que ya tenía se conservan)."
  elif (( FRESH )); then
    # Otros servicios a la escucha para todo el mundo (aparte de SSH, DNS local y los del portal).
    OTHERS="$(ss -Hltn 2>/dev/null | awk '{print $4}' | grep -Ev '^(127\.|\[::1\]|\[::ffff:127\.)' | sed -E 's/.*[:.]([0-9]+)$/\1/' \
      | sort -un | grep -vxE "22|53|80|443|${PORTAL_PORT}|${CLIENTS_PORT}" | paste -sd ' ' - || true)"
    if [[ -z "$XTREAM_KIND" && -z "$OTHERS" ]]; then
      ufw allow OpenSSH >/dev/null
      for r in "${OUR_RULES[@]}"; do ufw allow "$r" >/dev/null; done
      ufw --force enable >/dev/null
      FIREWALL_MSG="Cortafuegos activado: SSH, ${OUR_RULES[*]}."
    else
      FIREWALL_MSG="Cortafuegos NO activado para no bloquear otros servicios (puertos ${OTHERS:-de ${XTREAM_KIND}}). Si lo activas, abre también: ${OUR_RULES[*]}."
    fi
  fi
  [[ -n "$FIREWALL_MSG" ]] && echo "$FIREWALL_MSG"
fi

step "Comprobando que el portal responde"
OK=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORTAL_PORT}/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
done
if (( ! OK )); then
  echo "El portal no respondió en 60 s. Revisa: journalctl -u iptv-portal -n 80"
  exit 1
fi
if [[ -n "$SHOW_PASS" ]]; then
  BODY="$(ADMIN_USER="$ADMIN_USER" ADMIN_PASS="$SHOW_PASS" node -e 'process.stdout.write(JSON.stringify({username:process.env.ADMIN_USER,password:process.env.ADMIN_PASS}))')"
  if curl -fsS -X POST "http://127.0.0.1:${PORTAL_PORT}/api/admin/auth/login" -H 'Content-Type: application/json' -d "$BODY" | grep -q '"token"'; then
    echo "Inicio de sesión del panel comprobado."
  else
    echo "Aviso: no se pudo comprobar el inicio de sesión. Restablece con: sudo bash $APP_DIR/install-ubuntu.sh --reset-admin"
  fi
fi
CLIENTS_OK=1
if ! curl -fsS "http://127.0.0.1:${CLIENTS_PORT}/health" 2>/dev/null | grep -q '"ok"'; then CLIENTS_OK=0; fi

# ---------------------------------------------------------------------------------------------------------------
# Nodo de streaming en este mismo servidor (reenvío y transcodificación con FFmpeg).
# Se registra solo en el portal (Servidores → Nodos de streaming) y se conecta por 127.0.0.1.
# ---------------------------------------------------------------------------------------------------------------
NODE_MSG=""
NODE_PORT=""
NODE_ENV=/etc/iptv-node.env
if (( LOCAL_NODE )); then
  step "Nodo de streaming en este servidor"
  if [[ -f /etc/systemd/system/iptv-node.service ]]; then
    if grep -q '^MAIN_URL=http://127.0.0.1:' "$NODE_ENV" 2>/dev/null; then
      NODE_TOKEN="$(sed -n 's/^NODE_TOKEN=//p' "$NODE_ENV")"
      NODE_PORT="$(sed -n 's/^PORT=//p' "$NODE_ENV")"
      sed -i "s#^MAIN_URL=.*#MAIN_URL=http://127.0.0.1:${PORTAL_PORT}#" "$NODE_ENV"
      if curl -fsS "http://127.0.0.1:${PORTAL_PORT}/api/node/agent.js?token=${NODE_TOKEN}" -o /opt/iptv-node/iptv-node.js.new; then
        mv /opt/iptv-node/iptv-node.js.new /opt/iptv-node/iptv-node.js
        chown iptvnode:iptvnode /opt/iptv-node/iptv-node.js
      fi
      systemctl restart iptv-node
      NODE_MSG="actualizado (puerto ${NODE_PORT})"
    else
      NODE_MSG="este servidor ya tiene un nodo conectado a otro portal; no se tocó"
    fi
  else
    NODE_PORT="$(first_free_port 8090 8091 8092 8093 18090)" || NODE_PORT=""
    if [[ -z "$NODE_PORT" ]]; then
      NODE_MSG="no se instaló: no hay un puerto libre (8090-8093, 18090)"
    else
      NODE_TOKEN="$(cd "$APP_DIR/server" && sudo -u "$APP_USER" node scripts/local-node.js)" || NODE_TOKEN=""
      NODE_SCRIPT="$(mktemp)"
      if [[ -n "$NODE_TOKEN" ]] && curl -fsS "http://127.0.0.1:${PORTAL_PORT}/api/node/install.sh?token=${NODE_TOKEN}&port=${NODE_PORT}" -o "$NODE_SCRIPT"; then
        if bash "$NODE_SCRIPT" >/var/log/iptv-node-install.log 2>&1; then
          NODE_MSG="instalado en el puerto ${NODE_PORT}"
        else
          NODE_MSG="falló la instalación (detalles en /var/log/iptv-node-install.log)"
          NODE_PORT=""
        fi
      else
        NODE_MSG="no se pudo preparar (el portal no entregó el instalador del nodo)"
        NODE_PORT=""
      fi
      rm -f "$NODE_SCRIPT"
    fi
  fi
  echo "Nodo de streaming: ${NODE_MSG}"
fi

echo
echo "==> Puertos de red (interfaces) y sus IPs"
DEFAULT_IF="$(ip -4 route show default 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}')"
printf "%-3s %-16s %-10s %-10s %s\n" "" "INTERFAZ" "ESTADO" "VELOCIDAD" "IPs"
for path in /sys/class/net/*; do
  ifname="$(basename "$path")"
  [[ "$ifname" == "lo" ]] && continue
  state="$(cat "$path/operstate" 2>/dev/null || echo '?')"
  speed="$(cat "$path/speed" 2>/dev/null || true)"
  if [[ "$speed" =~ ^[0-9]+$ && "$speed" -gt 0 ]]; then speed="${speed} Mbps"; else speed="-"; fi
  ips="$(ip -o addr show dev "$ifname" 2>/dev/null | awk '{print $4}' | paste -sd ' ' -)"
  mark=" "; [[ "$ifname" == "$DEFAULT_IF" ]] && mark="*"
  printf "%-3s %-16s %-10s %-10s %s\n" "$mark" "$ifname" "$state" "$speed" "${ips:--}"
done
echo "  * = interfaz principal (puerta de enlace)"

PUBLIC_IP="$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || true)"
echo
echo "╔══════════════════════════════════════════════════════════════╗"
if (( FRESH )); then
echo "   PORTAL IPTV INSTALADO"
else
echo "   PORTAL IPTV ACTUALIZADO (datos conservados)"
fi
echo "╠══════════════════════════════════════════════════════════════╣"
echo "   Panel:       ${PANEL_URL}"
if [[ -n "$PUBLIC_IP" && "$PUBLIC_IP" != "$MAIN_IP" ]]; then
echo "   Desde fuera: ${PANEL_URL/${HOST_SHOW}/${PUBLIC_IP}}   (si el router/NAT lo permite)"
fi
if [[ -n "$SHOW_PASS" ]]; then
echo "   Usuario:     ${ADMIN_USER}"
echo "   Contraseña:  ${SHOW_PASS}"
else
echo "   Usuario y contraseña: los de siempre (no se cambiaron)."
echo "   ¿Olvidaste la clave?  sudo bash $APP_DIR/install-ubuntu.sh --reset-admin"
fi
echo
echo "   Clientes (IPTV Smarters, TiviMate, app propia):"
echo "     Servidor:  http://${HOST_SHOW}:${CLIENTS_PORT}"
if (( ! CLIENTS_OK )); then
echo "     ¡Atención! El puerto ${CLIENTS_PORT} no responde (¿ocupado por otro programa?)."
fi
if [[ -n "$NODE_PORT" ]]; then
echo
echo "   Nodo de streaming (reenvío y transcodificación): este servidor"
echo "     Puerto ${NODE_PORT}/tcp: ábrelo también en el cortafuegos del proveedor"
echo "     o del router, porque los clientes reciben el video por ese puerto."
elif [[ -n "$NODE_MSG" ]]; then
echo
echo "   Nodo de streaming: ${NODE_MSG}"
fi
if [[ -n "$XTREAM_KIND" ]]; then
echo
echo "   ${XTREAM_KIND} sigue funcionando igual (no se tocó)."
echo "   1. Migra: Panel -> Migración XtreamUI (la conexión ya está guardada)."
echo "   2. Prueba algunos clientes con el puerto ${CLIENTS_PORT}."
if [[ "$CLIENTS_PORT" != "25461" ]]; then
echo "   3. Para que los clientes NO cambien nada: apaga ${XTREAM_KIND} y su inicio"
echo "      automático, y luego:  sudo bash $APP_DIR/install-ubuntu.sh --set-clients-port 25461"
fi
fi
echo "╚══════════════════════════════════════════════════════════════╝"
[[ -n "$FIREWALL_MSG" ]] && echo "$FIREWALL_MSG"
if [[ -n "$SHOW_PASS" ]]; then
  echo "Estos datos quedaron guardados solo para root en ${CREDENTIALS_FILE}. Cambia la contraseña al entrar."
fi
echo "Para usar otra IP o un dominio: Ajustes -> Red en el panel. HTTPS: sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d tu-dominio"
echo "Logs: journalctl -u iptv-portal -f"
