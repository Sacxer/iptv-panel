#!/usr/bin/env bash
# Instalador del Portal IPTV para Ubuntu 20.04 / 22.04 / 24.04 (sin Docker).
#
#  - Instalación nueva: deja todo funcionando SIN datos (sin clientes, canales ni ajustes previos) y al final
#    muestra la dirección del panel, el usuario y la contraseña.
#  - Si ya está instalado: actualiza el programa y conserva datos, usuarios y ajustes (antes hace un backup).
#
# Uso (como root, desde la carpeta del proyecto):
#   sudo bash deploy/install-ubuntu.sh [opciones]
#
# Opciones:
#   --admin-user USUARIO    usuario del panel (por defecto: admin)
#   --admin-pass CLAVE      contraseña del panel (por defecto: aleatoria; mínimo 8 caracteres)
#   --reset-admin           en un servidor ya instalado: solo pone una contraseña nueva al usuario del panel
#                           (sudo bash /opt/iptv/install-ubuntu.sh --reset-admin [--admin-user U] [--admin-pass C])
#   --clients-port PUERTO   puerto para clientes Xtream Codes / M3U (por defecto: 25461)
#   --no-firewall           no configurar el cortafuegos (ufw)
set -euo pipefail

APP_DIR=/opt/iptv
APP_USER=iptv
PORTAL_PORT=8080
CREDENTIALS_FILE=/root/iptv-credenciales.txt

ADMIN_USER="admin"
ADMIN_PASS=""
RESET_ADMIN=0
CLIENTS_PORT=25461
FIREWALL=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-user) ADMIN_USER="${2:-}"; shift 2 ;;
    --admin-pass) ADMIN_PASS="${2:-}"; shift 2 ;;
    --reset-admin) RESET_ADMIN=1; shift ;;
    --clients-port) CLIENTS_PORT="${2:-}"; shift 2 ;;
    --no-firewall) FIREWALL=0; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1 (usa --help)"; exit 1 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then echo "Ejecuta como root: sudo bash $0"; exit 1; fi
if [[ ! "$ADMIN_USER" =~ ^[A-Za-z0-9._-]{3,64}$ ]]; then echo "Usuario no válido (3-64 letras, números, . _ -)"; exit 1; fi
if [[ -n "$ADMIN_PASS" && ${#ADMIN_PASS} -lt 8 ]]; then echo "La contraseña debe tener al menos 8 caracteres"; exit 1; fi
if [[ ! "$CLIENTS_PORT" =~ ^[0-9]+$ ]] || (( CLIENTS_PORT < 1 || CLIENTS_PORT > 65535 )) || (( CLIENTS_PORT == PORTAL_PORT )); then
  echo "Puerto de clientes no válido"; exit 1
fi
if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then echo "Aviso: probado en Ubuntu; este sistema es ${PRETTY_NAME:-desconocido}. Se continúa."; fi
fi

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRESH=1
[[ -f "$APP_DIR/server/.env" ]] && FRESH=0

step() { echo; echo "==> $*"; }
random_pass() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-16}" || true; }

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

# --reset-admin en un servidor instalado: solo cambia la contraseña del panel, no reinstala nada.
if (( RESET_ADMIN )); then
  if (( FRESH )); then echo "El portal no está instalado en $APP_DIR"; exit 1; fi
  [[ -z "$ADMIN_PASS" ]] && ADMIN_PASS="$(random_pass 16)"
  (cd "$APP_DIR/server" && sudo -u "$APP_USER" env ADMIN_USER="$ADMIN_USER" ADMIN_PASS="$ADMIN_PASS" node scripts/create-admin.js --from-env)
  MAIN_IP="$(detect_main_ip || true)"
  install -m 600 /dev/null "$CREDENTIALS_FILE"
  printf 'Portal IPTV — acceso al panel
Panel:      http://%s/admin
Usuario:    %s
Contraseña: %s
Cambiada:   %s
'     "${MAIN_IP:-IP-DEL-SERVIDOR}" "$ADMIN_USER" "$ADMIN_PASS" "$(date '+%Y-%m-%d %H:%M')" > "$CREDENTIALS_FILE"
  echo
  echo "   Panel:       http://${MAIN_IP:-IP-DEL-SERVIDOR}/admin"
  echo "   Usuario:     ${ADMIN_USER}"
  echo "   Contraseña:  ${ADMIN_PASS}"
  echo "(guardado en ${CREDENTIALS_FILE})"
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

step "Paquetes del sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl ca-certificates build-essential python3 nginx ufw tar
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
  printf '{"commit":"%s","branch":"%s","repo":"%s","installed_at":%s}
' "$B_COMMIT" "$B_BRANCH" "$B_REPO" "$(date +%s)" > "$APP_DIR/server/build-info.json"
fi

step "Compilando el panel"
cd "$APP_DIR/admin" && npm ci --no-audit --no-fund && npm run build && rm -rf node_modules
step "Dependencias del servidor"
cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund

MAIN_IP="$(detect_main_ip || true)"
if (( FRESH )); then
  step "Configuración inicial"
  cp "$APP_DIR/server/.env.example" "$APP_DIR/server/.env"
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(random_pass 48)/" "$APP_DIR/server/.env"
  sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=/" "$APP_DIR/server/.env"
  sed -i "s/^EXTRA_PORTS=.*/EXTRA_PORTS=${CLIENTS_PORT}/" "$APP_DIR/server/.env"
  if [[ -n "$MAIN_IP" ]]; then
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=http://${MAIN_IP}:${CLIENTS_PORT}|" "$APP_DIR/server/.env"
  fi
fi
chmod 600 "$APP_DIR/server/.env"
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
Panel:      http://${MAIN_IP:-IP-DEL-SERVIDOR}/admin
Usuario:    ${ADMIN_USER}
Contraseña: ${ADMIN_PASS}
Creado:     $(date '+%Y-%m-%d %H:%M')
CRED
  chmod 600 "$CREDENTIALS_FILE"
fi

step "Servicio del portal"
cat > /etc/systemd/system/iptv-portal.service <<UNIT
[Unit]
Description=Portal IPTV
After=network.target

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

step "Nginx (panel en el puerto 80)"
cp "$SRC_DIR/deploy/nginx-iptv.conf" /etc/nginx/sites-available/iptv
ln -sf /etc/nginx/sites-available/iptv /etc/nginx/sites-enabled/iptv
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

if (( FIREWALL )); then
  step "Cortafuegos"
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow "${CLIENTS_PORT}/tcp" >/dev/null
  # Descubrimiento en red local para la app (solo responde a IPs de red local)
  ufw allow 25460/udp >/dev/null
  ufw --force enable >/dev/null
  ufw status | sed -n '1,12p'
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
HOST_SHOW="${MAIN_IP:-IP-DEL-SERVIDOR}"
echo
echo "╔══════════════════════════════════════════════════════════════╗"
if (( FRESH )); then
echo "   PORTAL IPTV INSTALADO"
else
echo "   PORTAL IPTV ACTUALIZADO (datos conservados)"
fi
echo "╠══════════════════════════════════════════════════════════════╣"
echo "   Panel:       http://${HOST_SHOW}/admin"
if [[ -n "$PUBLIC_IP" && "$PUBLIC_IP" != "$MAIN_IP" ]]; then
echo "   Desde fuera: http://${PUBLIC_IP}/admin   (si el router/NAT lo permite)"
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
echo "╚══════════════════════════════════════════════════════════════╝"
if [[ -n "$SHOW_PASS" ]]; then
  echo "Estos datos quedaron guardados solo para root en ${CREDENTIALS_FILE}. Cambia la contraseña al entrar."
fi
echo "Para usar otra IP o un dominio: Ajustes -> Red en el panel. HTTPS: sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d tu-dominio"
echo "Logs: journalctl -u iptv-portal -f"
