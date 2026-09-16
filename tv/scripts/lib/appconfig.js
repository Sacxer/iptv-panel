'use strict';
/*
 * Configuración del operador (tv/operator.json) y de cada variante de compilación.
 *
 * Variantes:
 *   store → tiendas de Samsung y LG (por defecto): allowCustomServer/allowM3U de operator.json (false en el ejemplo).
 *           El usuario solo escribe usuario y contraseña; el servidor sale de serverUrls.
 *   full  → televisores propios en modo desarrollador y pruebas (--full): servidor libre y listas M3U.
 */
const fs = require('fs');
const path = require('path');

const TV_DIR = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(TV_DIR, 'src');

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path.relative(TV_DIR, file)} no es un JSON válido: ${e.message}`);
  }
}

function packageInfo() {
  return readJson(path.join(TV_DIR, 'package.json'));
}

/* operator.json (local) o, si no existe, operator.example.json */
function loadOperator(explicit) {
  const candidates = explicit ? [path.resolve(explicit)] : [path.join(TV_DIR, 'operator.json'), path.join(TV_DIR, 'operator.example.json')];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return { file, example: path.basename(file) === 'operator.example.json', data: readJson(file) };
    }
  }
  throw new Error(explicit ? `No existe ${explicit}` : 'Falta tv/operator.json (copie operator.example.json).');
}

/* Direcciones de ejemplo que no deben llegar a una compilación */
function isPlaceholderUrl(u) {
  return /IP-PUBLICA|DOMINIO|EJEMPLO|example\.com|midominio/i.test(String(u || ''));
}

function cleanUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/(player_api|get|panel_api|xmltv)\.php.*$/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+(\/\S*)?$/i.test(s) ? s : '';
}

function versionParts(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!m) throw new Error(`Versión "${version}" no válida: use x.y.z en package.json`);
  const parts = m.slice(1).map(Number);
  if (parts[0] > 255 || parts[1] > 255 || parts[2] > 65535) {
    throw new Error(`Versión "${version}" fuera de rango para Tizen (0-255.0-255.0-65535)`);
  }
  return parts;
}

function buildNumber(version) {
  const [a, b, c] = versionParts(version);
  return a * 10000 + b * 100 + c;
}

/*
 * Identificadores por plataforma y variante.
 * operator.appId: {tizenPackage (10 letras/números), tizenName, webos}; full.appId los puede cambiar.
 */
function appIds(operator, variant) {
  const base = operator.appId || {};
  const over = variant === 'full' && operator.full && operator.full.appId ? operator.full.appId : {};
  const ids = {
    tizenPackage: over.tizenPackage || base.tizenPackage || 'IptvPlayr1',
    tizenName: over.tizenName || base.tizenName || 'IPTVPlayer',
    webos: over.webos || base.webos || 'com.iptvplayer.tv',
  };
  const errors = [];
  if (!/^[A-Za-z0-9]{10}$/.test(ids.tizenPackage)) errors.push(`appId.tizenPackage "${ids.tizenPackage}" debe tener exactamente 10 letras o números`);
  if (!/^[A-Za-z0-9]{1,52}$/.test(ids.tizenName)) errors.push(`appId.tizenName "${ids.tizenName}" solo admite letras y números`);
  if (!/^[a-z0-9][a-z0-9.-]+$/.test(ids.webos) || /^(com\.palm|com\.webos|com\.lge|com\.palmdts)/.test(ids.webos)) {
    errors.push(`appId.webos "${ids.webos}" no es válido (minúsculas, números, "." y "-"; no puede empezar por com.lge, com.webos ni com.palm)`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  ids.tizenId = `${ids.tizenPackage}.${ids.tizenName}`;
  return ids;
}

/*
 * Objeto IPTV.config para una variante.
 * opts: {variant: 'store'|'full', platform: 'tizen'|'webos'|'browser', dev: bool}
 * → {config, warnings}
 */
function variantConfig(operator, opts) {
  const variant = opts.variant === 'full' ? 'full' : 'store';
  const pkg = packageInfo();
  const warnings = [];
  const serverUrls = [];
  for (const raw of operator.serverUrls || []) {
    if (isPlaceholderUrl(raw)) {
      warnings.push(`serverUrls: se omite la dirección de ejemplo "${raw}"`);
      continue;
    }
    const u = cleanUrl(raw);
    if (!u) { warnings.push(`serverUrls: dirección no válida "${raw}"`); continue; }
    if (!serverUrls.includes(u)) serverUrls.push(u);
  }
  const full = operator.full || {};
  const pick = (key, def) => {
    if (variant === 'full') return full[key] !== undefined ? full[key] !== false : true;
    return operator[key] !== undefined ? operator[key] !== false : def;
  };
  const allowCustomServer = pick('allowCustomServer', false);
  const allowM3U = pick('allowM3U', false);
  if (!allowCustomServer && !serverUrls.length) {
    warnings.push('La compilación restringida no tiene serverUrls: los clientes solo podrán buscar el servidor en la red local.');
  }
  const support = Object.assign({ name: '', phone: '', whatsapp: '', email: '', web: '' }, operator.support || {});
  const config = {
    appName: String(operator.appName || 'IPTV Player'),
    version: pkg.version,
    build: buildNumber(pkg.version),
    distribution: opts.platform === 'tizen' || opts.platform === 'webos' ? opts.platform : 'browser',
    variant,
    dev: !!opts.dev,
    allowCustomServer,
    allowM3U,
    serverUrls,
    portalId: String(operator.portalId || ''),
    support: {
      name: String(support.name || ''), phone: String(support.phone || ''), whatsapp: String(support.whatsapp || ''),
      email: String(support.email || ''), web: String(support.web || ''),
    },
    lanPorts: Array.isArray(operator.lanPorts) && operator.lanPorts.length ? operator.lanPorts.map(Number).filter((p) => p > 0 && p < 65536) : [25461, 8080, 80],
    lanFallback: opts.dev && Array.isArray(operator.lanFallback) ? operator.lanFallback : [],
  };
  return { config, warnings };
}

function configJs(config) {
  return `/* Generado por scripts/lib/appconfig.js — no editar. Variante: ${config.variant}, plataforma: ${config.distribution}. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  IPTV.config = ${JSON.stringify(config, null, 2).replace(/\n/g, '\n  ')};
})(typeof window !== 'undefined' ? window : global);
`;
}

module.exports = {
  TV_DIR, SRC_DIR, readJson, packageInfo, loadOperator, variantConfig, configJs, appIds,
  versionParts, buildNumber, cleanUrl, isPlaceholderUrl,
};
