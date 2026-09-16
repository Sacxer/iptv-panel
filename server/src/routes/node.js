// API que usan los nodos de streaming (autenticados con el token de su servidor).
import { portalIdentity } from '../services/portalAddresses.js';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config, ROOT_DIR } from '../config.js';
import { db } from '../db/index.js';
import { clientIp } from '../lib/access.js';
import { HttpError, int } from '../lib/util.js';
import { handleHeartbeat, nodeStreamConfig } from '../services/nodes.js';

const router = Router();
const AGENT_FILE = path.resolve(ROOT_DIR, '..', 'node', 'iptv-node.js');

async function authServer(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : String(req.query.token || '');
  if (!token) throw new HttpError(401, 'Falta el token del servidor');
  const server = await db('servers').where({ token }).first();
  if (!server) throw new HttpError(401, 'Token de servidor inválido');
  if (!server.enabled) throw new HttpError(403, 'Servidor deshabilitado en el portal');
  return server;
}

router.post('/heartbeat', async (req, res) => {
  const server = await authServer(req);
  const result = await handleHeartbeat(server, req.body || {}, clientIp(req));
  // El nodo guarda las direcciones del portal para encontrarlo si cambia de IP.
  res.json({ ...result, portal: await portalIdentity(req) });
});

router.get('/streams/:id', async (req, res) => {
  const server = await authServer(req);
  const cfg = await nodeStreamConfig(server, int(req.params.id, 0));
  if (!cfg) throw new HttpError(404, 'Canal no asignado a este servidor');
  res.json(cfg);
});

/** Descarga del programa del nodo (se usa desde el script de instalación). */
router.get('/agent.js', async (req, res) => {
  await authServer(req);
  if (!fs.existsSync(AGENT_FILE)) throw new HttpError(404, 'No se encontró node/iptv-node.js en el portal');
  res.type('application/javascript').sendFile(AGENT_FILE);
});

/** Script de instalación para Ubuntu/Debian con el token ya incluido. */
router.get('/install.sh', async (req, res) => {
  const server = await authServer(req);
  const portal = `${req.protocol}://${req.get('host')}`;
  const port = (() => {
    try {
      return new URL(server.public_url).port || '8090';
    } catch {
      return '8090';
    }
  })();
  res.type('text/x-shellscript').send(`#!/usr/bin/env bash
# Instalación del nodo de streaming "${server.name}" (generado por el portal IPTV ${config.version})
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Ejecuta como root (sudo)"; exit 1; fi

echo "==> Dependencias (Node.js y FFmpeg)"
apt-get update
apt-get install -y curl ca-certificates ffmpeg
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Programa del nodo"
id -u iptvnode >/dev/null 2>&1 || useradd --system --home /opt/iptv-node --shell /usr/sbin/nologin iptvnode
mkdir -p /opt/iptv-node
curl -fsSL "${portal}/api/node/agent.js?token=${server.token}" -o /opt/iptv-node/iptv-node.js
# Acceso a GPU (NVIDIA / Intel) si existe
usermod -aG video,render iptvnode 2>/dev/null || true
chown -R iptvnode:iptvnode /opt/iptv-node

cat > /etc/iptv-node.env <<ENV
MAIN_URL=${portal}
NODE_TOKEN=${server.token}
PORT=${port}
IDLE_SECONDS=30
ENV
chmod 640 /etc/iptv-node.env
chgrp iptvnode /etc/iptv-node.env

cat > /etc/systemd/system/iptv-node.service <<UNIT
[Unit]
Description=Nodo de streaming IPTV
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=0

[Service]
User=iptvnode
ExecStart=/usr/bin/node /opt/iptv-node/iptv-node.js
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now iptv-node
command -v ufw >/dev/null && ufw allow ${port}/tcp || true

echo
echo "Nodo instalado. En unos segundos aparecerá en línea en el portal → Servidores."
echo "Logs: journalctl -u iptv-node -f"
`);
});

export default router;
