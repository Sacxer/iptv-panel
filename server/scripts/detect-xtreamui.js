// Busca un XtreamUI (o XUI.one) instalado en este servidor y muestra, en JSON, cómo conectarse a su MySQL.
// Lo usa el instalador (como root) para dejar lista la migración. Uso: node scripts/detect-xtreamui.js [--json]
// Sale con código 2 si no hay XtreamUI.
import fs from 'node:fs';

// XtreamUI guarda su configuración en base64 cifrada con XOR y esta clave fija.
const XTREAMUI_KEY = '5709650b0d7806074842c6de575025b1';

export function decodeXtreamUiConfig(text) {
  const raw = Buffer.from(String(text).trim(), 'base64');
  const out = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ XTREAMUI_KEY.charCodeAt(i % XTREAMUI_KEY.length);
  const j = JSON.parse(out.toString('utf8'));
  return {
    kind: 'xtreamui',
    host: j.host || '127.0.0.1',
    port: Number(j.db_port) || 7999,
    user: j.db_user || '',
    password: j.db_pass || '',
    database: j.db_name || 'xtream_iptvpro',
  };
}

export function parseXuiIni(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_]+)\s*=\s*"?([^"]*?)"?\s*$/.exec(line);
    if (m) values[m[1].toLowerCase()] = m[2];
  }
  return {
    kind: 'xui',
    host: values.hostname || values.host || '127.0.0.1',
    port: Number(values.port) || 3306,
    user: values.username || '',
    password: values.password || '',
    database: values.database || 'xui',
  };
}

const CANDIDATES = [
  ['/home/xtreamcodes/iptv_xtream_codes/config', decodeXtreamUiConfig],
  ['/home/xui/config/config.ini', parseXuiIni],
];

export function detect(candidates = CANDIDATES) {
  for (const [file, parse] of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const conn = parse(fs.readFileSync(file, 'utf8'));
      if (conn.user && conn.database) return { ...conn, file };
    } catch { /* formato desconocido */ }
    return { kind: file.includes('/xui/') ? 'xui' : 'xtreamui', file, unreadable: true };
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('detect-xtreamui.js')) {
  const found = detect();
  if (!found) process.exit(2);
  process.stdout.write(`${JSON.stringify(found)}\n`);
}
