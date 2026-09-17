'use strict';
/*
 * npm run shots -- --url http://127.0.0.1:8094/store/ --user USUARIO --pass CLAVE [opciones]
 *
 * Capturas de pantalla para Samsung Seller Office y LG Seller Lounge, tomadas de la app real a 1920x1080
 * con Microsoft Edge o Google Chrome sin ventana (no instala nada). La app debe estar servida con
 * `node scripts/serve.js --server-urls http://PORTAL` y la cuenta debe ver contenido propio o de prueba.
 *
 * Opciones: --out carpeta (por defecto assets/store/screenshots) · --browser ruta del navegador ·
 *           --movie "Título" · --series "Título" (qué abrir en los detalles; por defecto el primero) ·
 *           --scene (sobre el vídeo de prueba pone una imagen ilustrativa; --scene-file imagen para usar otra)
 *
 * Guarda PNG (LG: 1920x1080, hasta 20 MB) y JPG (Samsung: 1920x1080, hasta 500 KB):
 *   1-tv-en-vivo · 2-reproductor · 3-peliculas · 4-detalle-pelicula · 5-serie · 0-inicio-sesion
 * y, solo en PNG, pantallas para el documento de uso de LG (UX scenario):
 *   ux-buscar · ux-mensajes · ux-cuenta · ux-salir
 *
 * npm run shots -- --art   → además (o solo, sin --url) dibuja con letra normal la imagen de fondo de LG
 *   (assets/store/lg/background-1920x1080.png y la pantalla de inicio assets/icons/webos/splash.png) con el
 *   nombre de operator.json → appName.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sleep, withBrowser, evaluate: evalIn } = require('./lib/browser');

const TV_DIR = path.resolve(__dirname, '..');
const W = 1920;
const H = 1080;
const SAMSUNG_MAX = 500 * 1024;

function parseArgs(argv) {
  const o = { out: path.join(TV_DIR, 'assets', 'store', 'screenshots') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--url') o.url = next();
    else if (a === '--user') o.user = next();
    else if (a === '--pass') o.pass = next();
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '--browser') o.browser = next();
    else if (a === '--movie') o.movie = next();
    else if (a === '--series') o.series = next();
    else if (a === '--scene') o.scene = o.scene || 'builtin';
    else if (a === '--scene-file') o.scene = path.resolve(next());
    else if (a === '--art') o.art = true;
    else if (a === '--query') o.query = next();
    else throw new Error(`Opción desconocida: ${a}`);
  }
  if (o.art && !o.url) return o;
  if (!o.url || !o.user || !o.pass) throw new Error('Faltan --url, --user o --pass (ver el comentario al inicio del archivo)');
  return o;
}

/* Imagen ilustrativa (atardecer en la costa) para tapar el patrón de barras del vídeo de prueba */
function builtinScene() {
  const skyline = [[80, 120], [150, 190], [230, 150], [300, 240], [380, 170], [450, 210], [1380, 180], [1450, 260], [1540, 200], [1620, 150], [1700, 230], [1790, 170]]
    .map(([x, h]) => `<rect x="${x}" y="${690 - h}" width="64" height="${h}" rx="4"/>`).join('');
  const windows = [];
  for (let i = 0; i < 60; i++) windows.push(`<rect x="${90 + ((i * 131) % 1700)}" y="${520 + ((i * 53) % 150)}" width="8" height="12" fill="#ffd98a" opacity=".7"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1b4f"/><stop offset=".45" stop-color="#c2477a"/><stop offset=".75" stop-color="#ff9a52"/><stop offset="1" stop-color="#ffd27a"/></linearGradient>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b3f78"/><stop offset="1" stop-color="#15284a"/></linearGradient>
<radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff4c9"/><stop offset=".6" stop-color="#ffd27a"/><stop offset="1" stop-color="#ffb35a" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1920" height="700" fill="url(#sky)"/>
<circle cx="960" cy="640" r="260" fill="url(#sun)"/>
<g fill="#2a1638">${skyline}<path d="M820 690 V600 Q880 520 940 600 V690 Z"/><rect x="872" y="470" width="16" height="80"/></g>
${windows.join('')}
<rect y="690" width="1920" height="390" fill="url(#sea)"/>
<g fill="#ffd98a" opacity=".55"><rect x="860" y="720" width="200" height="6" rx="3"/><rect x="800" y="760" width="320" height="6" rx="3"/><rect x="880" y="810" width="160" height="5" rx="3"/><rect x="760" y="870" width="400" height="5" rx="3"/></g>
<g fill="#10142a"><path d="M300 900 h260 l-40 40 h-190 z"/><rect x="420" y="780" width="8" height="120"/><path d="M428 790 L520 890 H428 Z" fill="#f3e9da" opacity=".9"/></g>
<g opacity=".75"><rect x="1660" y="930" width="200" height="64" rx="14" fill="#000" opacity=".35"/>
<text x="1760" y="974" font-family="Segoe UI,Arial,sans-serif" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">PTOVS</text></g>
</svg>`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await withBrowser(async (client) => {
    if (opts.art) await renderArt(client);
    if (opts.url) await run(client, opts);
  }, { browser: opts.browser, width: W, height: H });
}

/* Fondo de LG Seller Lounge: degradado, icono y nombre de la app con letra del sistema */
async function renderArt(c) {
  const cfg = require('./lib/appconfig');
  const name = cfg.loadOperator().data.appName || 'IPTV Player';
  const iconFile = path.join(TV_DIR, 'assets', 'store', 'lg', 'icon-400x400.png');
  if (!fs.existsSync(iconFile)) throw new Error('Falta el icono: ejecute primero npm run icons');
  const icon = `data:image/png;base64,${fs.readFileSync(iconFile).toString('base64')}`;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
    body{background:linear-gradient(90deg,#141a2b 0%,#1d2a55 55%,#2846aa 100%);display:flex;flex-direction:column;
      align-items:center;justify-content:center;font-family:'Segoe UI','Roboto','Helvetica Neue',Arial,sans-serif;color:#fff}
    img{width:300px;height:300px;border-radius:66px;box-shadow:0 24px 60px rgba(0,0,0,.45)}
    h1{margin:56px 0 0;font-size:132px;font-weight:700;letter-spacing:6px}
    p{margin:18px 0 0;font-size:40px;color:#c9d6f5;letter-spacing:1px}
  </style></head><body><img src="${icon}"><h1>${esc(name)}</h1><p>TV en vivo · Películas · Series</p></body></html>`;
  const file = path.join(os.tmpdir(), `tv-art-${process.pid}.html`);
  fs.writeFileSync(file, html);
  try {
    await c.send('Page.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: require('url').pathToFileURL(file).href });
    await sleep(1500);
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    // La misma imagen sirve de fondo en Seller Lounge y de pantalla de inicio (splash) dentro del paquete de LG
    for (const out of [
      path.join(TV_DIR, 'assets', 'store', 'lg', 'background-1920x1080.png'),
      path.join(TV_DIR, 'assets', 'icons', 'webos', 'splash.png'),
    ]) {
      fs.writeFileSync(out, Buffer.from(png.data, 'base64'));
      console.log(`Fondo de LG: ${path.relative(process.cwd(), out)} (${Math.round(fs.statSync(out).size / 1024)} KB, «${name}»)`);
    }
  } finally {
    fs.rmSync(file, { force: true });
  }
}

async function run(c, opts) {
  const evaluate = (expression) => evalIn(c, expression);
  const waitFor = async (expression, what, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await evaluate(`!!(${expression})`)) return;
      await sleep(200);
    }
    throw new Error(`Tiempo agotado esperando: ${what}`);
  };
  const KEYS = { Enter: 13, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
  const key = async (name, times = 1) => {
    for (let i = 0; i < times; i++) {
      const base = { key: name, code: name, windowsVirtualKeyCode: KEYS[name], nativeVirtualKeyCode: KEYS[name] };
      await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(250);
    }
  };
  /* Clic (como el puntero del Magic Remote) sobre el elemento visible con ese texto */
  const clickText = async (text, scope = 'body') => {
    const box = await evaluate(`(function () {
      var want = ${JSON.stringify(text)};
      var all = document.querySelectorAll(${JSON.stringify(scope)} + ' *');
      for (var i = all.length - 1; i >= 0; i--) {
        var el = all[i];
        if ((el.textContent || '').trim() !== want) continue;
        var r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') {
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return null;
    })()`);
    if (!box) throw new Error(`No se encontró «${text}» en pantalla`);
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await sleep(150);
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(400);
  };
  /* Espera a que las imágenes visibles terminen de cargar */
  const imagesReady = () => waitFor(`Array.prototype.every.call(document.images, function (i) {
      return !i.getAttribute('src') || i.complete; })`, 'imágenes', 10000);
  const videoPlaying = () => waitFor(`(function () { var v = document.querySelector('video');
      return v && v.readyState >= 2 && v.currentTime > 1.5; })()`, 'vídeo', 20000);

  fs.mkdirSync(opts.out, { recursive: true });
  let sceneUrl = null;
  if (opts.scene === 'builtin') sceneUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(builtinScene())}`;
  else if (opts.scene) {
    const ext = path.extname(opts.scene).toLowerCase();
    const type = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : 'image/jpeg';
    sceneUrl = `data:${type};base64,${fs.readFileSync(opts.scene).toString('base64')}`;
  }
  /* La imagen va dentro de la capa del vídeo (debajo de la interfaz) y con el mismo rectángulo que el vídeo */
  const placeScene = () => evaluate(`(function () {
    var url = ${JSON.stringify(sceneUrl)};
    var layer = document.getElementById('video-layer');
    var old = document.getElementById('shot-scene');
    if (old) { old.parentNode.removeChild(old); }
    var v = layer && layer.querySelector('video');
    if (!url || !v) { return false; }
    var r = v.getBoundingClientRect();
    if (!r.width || !r.height) { return false; }
    var img = document.createElement('img');
    img.id = 'shot-scene';
    img.src = url;
    img.style.cssText = 'position:fixed;object-fit:cover;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
    layer.appendChild(img);
    return new Promise(function (res) { if (img.complete) { res(true); } else { img.onload = function () { res(true); }; } });
  })()`);
  const saved = [];
  const shot = async (name, { jpg: withJpg = true } = {}) => {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: W - 1, y: H - 1 });
    await sleep(300);
    if (sceneUrl) await placeScene();
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    fs.writeFileSync(path.join(opts.out, `${name}.png`), Buffer.from(png.data, 'base64'));
    if (!withJpg) {
      saved.push(`${name}  (PNG ${Math.round(Buffer.from(png.data, 'base64').length / 1024)} KB)`);
      return;
    }
    let quality = 90;
    let jpg;
    do {
      const r = await c.send('Page.captureScreenshot', { format: 'jpeg', quality, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
      jpg = Buffer.from(r.data, 'base64');
      quality -= 5;
    } while (jpg.length > SAMSUNG_MAX && quality >= 50);
    fs.writeFileSync(path.join(opts.out, `${name}.jpg`), jpg);
    saved.push(`${name}  (PNG ${Math.round(Buffer.from(png.data, 'base64').length / 1024)} KB · JPG ${Math.round(jpg.length / 1024)} KB)`);
  };

  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url: opts.url });
  await waitFor(`window.IPTV && IPTV.app && document.querySelector('input[type=password]')`, 'la pantalla de inicio de sesión');
  // Oculta la ayuda de desarrollo de serve.js
  await evaluate(`(function () { var s = document.createElement('style');
    s.textContent = '.devkeys{display:none!important}'; document.head.appendChild(s); return true; })()`);
  await sleep(800);
  await shot('0-inicio-sesion');

  await evaluate(`(function () {
    function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
    function fill(el, v) { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    var user = Array.prototype.filter.call(document.querySelectorAll('input[type=text]'), function (i) { return visible(i) && /usuario/i.test(i.placeholder); })[0];
    var pass = Array.prototype.filter.call(document.querySelectorAll('input[type=password]'), visible)[0];
    fill(user, ${JSON.stringify(opts.user)}); fill(pass, ${JSON.stringify(opts.pass)}); pass.blur(); return true;
  })()`);
  await clickText('Ingresar');
  await waitFor(`(function () { var s = document.querySelector('.side-item[data-section=live]');
    return s && s.getBoundingClientRect().width > 0; })()`, 'la pantalla principal', 30000);
  await sleep(1500);

  // 1. TV en vivo con vista previa
  await key('Enter');
  await videoPlaying();
  await imagesReady();
  await sleep(1000);
  await shot('1-tv-en-vivo');

  // 2. Reproductor a pantalla completa con la barra de información
  await key('Enter');
  await sleep(1200);
  await key('ArrowDown');
  await key('ArrowUp');
  await sleep(700);
  await shot('2-reproductor');
  await key('Escape');
  await sleep(1000);

  // 3. Películas
  await clickText('Películas', '.sidebar');
  await sleep(1500);
  await imagesReady();
  await sleep(500);
  await shot('3-peliculas');

  // 4. Detalle de una película
  if (opts.movie) await clickText(opts.movie);
  else await key('Enter');
  await sleep(1500);
  await imagesReady();
  await shot('4-detalle-pelicula');
  await key('Escape');
  await sleep(800);

  // 5. Serie con temporadas y episodios
  await clickText('Series', '.sidebar');
  await sleep(1500);
  if (opts.series) await clickText(opts.series);
  else await key('Enter');
  await sleep(1800);
  await imagesReady();
  await shot('5-serie');
  await key('Escape');
  await sleep(800);

  // Pantallas adicionales para el documento de uso de LG
  await clickText('Buscar', '.sidebar');
  await sleep(800);
  await evaluate(`(function () {
    var i = document.querySelector('.search-bar input');
    i.value = ${JSON.stringify(opts.query || 'la')};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    return true;
  })()`);
  await sleep(2000);
  await imagesReady();
  await shot('ux-buscar', { jpg: false });
  if (await evaluate(`!!Array.prototype.some.call(document.querySelectorAll('.sidebar .side-item'), function (e) {
      return /Mensajes/.test(e.textContent) && e.getBoundingClientRect().width > 0; })`)) {
    await clickText('Mensajes', '.sidebar');
    await sleep(1500);
    await shot('ux-mensajes', { jpg: false });
  }
  await clickText('Cuenta', '.sidebar');
  await sleep(1500);
  await shot('ux-cuenta', { jpg: false });
  await clickText('TV en vivo', '.sidebar');
  await sleep(1200);
  for (let i = 0; i < 4 && !(await evaluate(`!!document.querySelector('.exit-dialog')`)); i++) await key('Escape');
  await waitFor(`document.querySelector('.exit-dialog')`, 'la ventana de salida', 5000);
  await sleep(500);
  await shot('ux-salir', { jpg: false });

  console.log(`Capturas en ${path.relative(process.cwd(), opts.out) || '.'}:`);
  saved.forEach((s) => console.log(`  ${s}`));
  console.log('LG: suba los PNG 1 (principal) y 2 a 5. Samsung: suba 4 JPG (1 a 4). Revise que se vean bien antes de enviarlas.');
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
