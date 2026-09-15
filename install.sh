#!/usr/bin/env bash
# Portal IPTV — instalación en una línea (Ubuntu 20.04 / 22.04 / 24.04):
#
#   curl -fsSL https://raw.githubusercontent.com/Sacxer/iptv-panel/main/install.sh | sudo bash
#
# Con opciones (usuario y contraseña del panel, puerto para clientes):
#   curl -fsSL https://raw.githubusercontent.com/Sacxer/iptv-panel/main/install.sh | sudo bash -s -- --admin-user soporte --admin-pass 'MiClave123'
#
# Volver a ejecutarlo en un servidor ya instalado ACTUALIZA el programa y conserva los datos.
# Repositorio privado: IPTV_REPO=https://<token>@github.com/Sacxer/iptv-panel.git
set -euo pipefail

REPO_URL="${IPTV_REPO:-https://github.com/Sacxer/iptv-panel.git}"
BRANCH="${IPTV_BRANCH:-main}"
SRC=/opt/iptv-src

if [[ $EUID -ne 0 ]]; then echo "Ejecuta como root (sudo)"; exit 1; fi

echo "==> Descargando el Portal IPTV (${BRANCH})"
export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null || { apt-get update -q && apt-get install -y -q git ca-certificates; }
if [[ -d "$SRC/.git" ]]; then
  git -C "$SRC" remote set-url origin "$REPO_URL"
  git -C "$SRC" fetch --depth 1 origin "$BRANCH"
  git -C "$SRC" reset --hard "origin/$BRANCH"
  git -C "$SRC" clean -fdx -e server/data
else
  rm -rf "$SRC"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC"
fi
git -C "$SRC" remote set-url origin "${REPO_URL/\/\/*@/\/\/}" # no dejar el token guardado

exec bash "$SRC/deploy/install-ubuntu.sh" "$@"
