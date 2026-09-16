'use strict';
/*
 * npm run serve — prueba la app de TV en un navegador de escritorio (Chrome).
 *
 *   http://127.0.0.1:8095/full/    compilación completa (servidor libre y listas M3U)
 *   http://127.0.0.1:8095/store/   compilación de tienda (solo usuario y contraseña)
 *
 * Opciones:
 *   --port 8095              puerto
 *   --host 127.0.0.1         interfaz (0.0.0.0 para abrirla desde otro equipo)
 *   --operator archivo.json  otra configuración del operador
 *   --server-urls a,b        reemplaza serverUrls (p. ej. un portal de pruebas local)
 *   --portal-id ID           reemplaza portalId
 *   --platform tizen|webos   simula la cabecera X-App-Distribution de esa plataforma
 *
 * Teclado (ver también la ayuda en pantalla con la tecla H): flechas, Enter = OK, Retroceso/Esc = Atrás,
 * R G Y B = colores, RePág/AvPág = canal, Espacio/P = play/pausa, S = stop, "," "." = retroceder/avanzar.
 * En la URL: ?lan=192.168.1.0/24 fija la red del barrido (el navegador no puede conocer su IP).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { SRC_DIR, loadOperator, variantConfig, configJs } = require('./lib/appconfig');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

function parseArgs(argv) {
  const out = { port: 8095, host: '127.0.0.1', platform: 'browser' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--port') out.port = Number(next());
    else if (a === '--host') out.host = next();
    else if (a === '--operator') out.operator = next();
    else if (a === '--server-urls') out.serverUrls = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--portal-id') out.portalId = next();
    else if (a === '--platform') out.platform = next();
  }
  return out;
}

const DEV_HELPER = `
<style>
  .devkeys { position: fixed; right: 12px; bottom: 12px; z-index: 99; max-width: 360px; padding: 12px 16px;
    border-radius: 10px; background: rgba(8, 12, 20, 0.92); border: 1px solid #2a3446; color: #cfd8e6;
    font: 13px/1.5 Segoe UI, Arial, sans-serif; }
  .devkeys b { color: #fff; } .devkeys table { border-collapse: collapse; } .devkeys td { padding: 1px 8px 1px 0; }
  .devkeys .tag { display: inline-block; padding: 1px 8px; border-radius: 8px; background: #2d5bd1; color: #fff; }
  .devkeys.min table, .devkeys.min .more { display: none; }
</style>
<script>
(function () {
  var box = document.createElement('div');
  box.className = 'devkeys min';
  var cfg = window.IPTV && IPTV.config || {};
  var rows = (IPTV.keys && IPTV.keys.DESKTOP_HELP || []).map(function (r) { return '<tr><td><b>' + r[0] + '</b></td><td>' + r[1] + '</td></tr>'; }).join('');
  box.innerHTML = '<div><span class="tag">' + (cfg.variant === 'store' ? 'Tienda' : 'Completa') + '</span> ' +
    (cfg.appName || '') + ' ' + (cfg.version || '') + ' · <b>H</b>: teclas</div>' +
    '<table>' + rows + '</table><div class="more">Ratón: mover y clic (como el Magic Remote).<br>' +
    'Otra variante: <a style="color:#9fc1ff" href="' + (cfg.variant === 'store' ? '../full/' : '../store/') + '">' +
    (cfg.variant === 'store' ? 'completa' : 'tienda') + '</a> · Red del barrido: <code>?lan=192.168.1.0/24</code></div>';
  document.body.appendChild(box);
  document.addEventListener('keydown', function (e) {
    var a = document.activeElement;
    if (e.keyCode === 72 && !(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'))) { box.classList.toggle('min'); }
  });
})();
</script>
`;

function landing(port) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>App de TV — desarrollo</title>
<style>body{font:16px/1.6 Segoe UI,Arial,sans-serif;background:#0b0f17;color:#eef2f8;padding:40px;max-width:820px}
a{color:#9fc1ff}code{background:#151b26;padding:2px 6px;border-radius:4px}li{margin:6px 0}</style></head><body>
<h1>App de TV — servidor de desarrollo</h1>
<ul>
<li><a href="/full/">Compilación completa</a> — Xtream Codes con servidor libre, «Buscar servidor en mi red» y listas M3U.</li>
<li><a href="/store/">Compilación de tienda</a> — solo usuario y contraseña; servidor de <code>serverUrls</code>.</li>
</ul>
<p>Use Chrome con la ventana en 16:9 (la interfaz está diseñada a 1920x1080 y se escala). Pulse <b>H</b> dentro de la app para ver las teclas.</p>
<p>Cada variante guarda sus perfiles aparte (prefijo <code>iptv.full.</code> / <code>iptv.store.</code> en localStorage). Borre los datos del sitio para empezar de cero.</p>
<p>Puerto: ${port}</p></body></html>`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const operator = loadOperator(opts.operator);
  if (opts.serverUrls) operator.data.serverUrls = opts.serverUrls;
  if (opts.portalId !== undefined) operator.data.portalId = opts.portalId;
  const variants = {};
  for (const v of ['full', 'store']) {
    const { config, warnings } = variantConfig(operator.data, { variant: v, platform: opts.platform, dev: true });
    variants[v] = config;
    warnings.forEach((w) => console.warn(`[${v}] Aviso: ${w}`));
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
      res.end(landing(opts.port));
      return;
    }
    const m = /^\/(full|store)(\/.*)?$/.exec(pathname);
    if (!m) { res.writeHead(404); res.end('No encontrado'); return; }
    if (!m[2]) { res.writeHead(302, { Location: `/${m[1]}/` }); res.end(); return; }
    const variant = m[1];
    pathname = m[2] === '/' ? '/index.html' : m[2];

    const headers = { 'Cache-Control': 'no-store' };
    if (pathname === '/js/config.js') {
      res.writeHead(200, { ...headers, 'Content-Type': TYPES['.js'] });
      res.end(configJs(variants[variant]));
      return;
    }
    const file = path.normalize(path.join(SRC_DIR, pathname));
    if (!file.startsWith(SRC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, headers); res.end('No encontrado'); return; }
      const ext = path.extname(file).toLowerCase();
      if (pathname === '/index.html') {
        const html = data.toString('utf8')
          .replace('<title>IPTV Player</title>', `<title>${variants[variant].appName} (${variant === 'store' ? 'tienda' : 'completa'})</title>`)
          .replace('</body>', `${DEV_HELPER}</body>`);
        res.writeHead(200, { ...headers, 'Content-Type': TYPES['.html'] });
        res.end(html);
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Type': TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  server.listen(opts.port, opts.host, () => {
    const base = `http://${opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host}:${opts.port}`;
    console.log(`App de TV (${path.basename(operator.file)}${operator.example ? ', ejemplo' : ''})`);
    console.log(`  Completa: ${base}/full/`);
    console.log(`  Tienda:   ${base}/store/   serverUrls: ${variants.store.serverUrls.join(', ') || '(ninguna)'}`);
    console.log('Ctrl+C para detener.');
  });
}

main();
