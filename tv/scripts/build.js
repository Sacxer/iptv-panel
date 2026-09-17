'use strict';
/*
 * npm run build [tizen|webos] [-- opciones]
 *
 *   npm run build                 → dist/tizen-store y dist/webos-store (compilación de tienda)
 *   npm run build -- --full       → dist/tizen-full y dist/webos-full (servidor libre y M3U, para modo desarrollador)
 *   npm run build -- --all        → las cuatro
 *   npm run build tizen           → solo Samsung (igual con webos)
 *   npm run build -- --usb        → dist/tizen-usb/userwidget/ + README.txt (Samsung por USB; completa salvo --store)
 *
 * Opciones: --operator archivo.json · --dev (config de desarrollo: ?lan=…) · --no-package (no llamar a las
 * herramientas de Samsung/LG) · --no-csp (config.xml sin Content-Security-Policy) · --profile PERFIL
 * (perfil de certificado de Tizen Studio; también operator.json → tizen.certificateProfile o TIZEN_PROFILE).
 *
 * Si están instaladas las herramientas de línea de comandos, además crea el paquete:
 *   Samsung: tizen package -t wgt -s PERFIL → dist/*.wgt   (Tizen Studio + extensión TV + certificado Samsung)
 *   LG:      ares-package → dist/*.ipk                     (webOS TV CLI: npm install la deja en node_modules)
 * Este script no instala nada: si faltan, explica cómo instalarlas.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const cfg = require('./lib/appconfig');
const { checkFile, listJs } = require('./check-es5');

const DIST = path.join(cfg.TV_DIR, 'dist');
const ICONS = path.join(cfg.TV_DIR, 'assets', 'icons');

function parseArgs(argv) {
  const o = { platforms: [], variants: [], dev: false, pack: true, csp: null, usb: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'tizen' || a === 'webos') o.platforms.push(a);
    else if (a === '--full') o.variants.push('full');
    else if (a === '--store') o.variants.push('store');
    else if (a === '--all') o.variants.push('store', 'full');
    else if (a === '--usb') o.usb = true;
    else if (a === '--dev') o.dev = true;
    else if (a === '--no-package') o.pack = false;
    else if (a === '--no-csp') o.csp = false;
    else if (a === '--operator') o.operator = argv[++i];
    else if (a === '--profile') o.profile = argv[++i];
    else throw new Error(`Opción desconocida: ${a}`);
  }
  if (o.usb) {
    /* USB: solo Samsung y, salvo --store, la compilación completa */
    if (o.platforms.includes('webos')) throw new Error('--usb es solo para Samsung (Tizen)');
    o.platforms = ['tizen'];
    if (!o.variants.length) o.variants = ['full'];
    if (o.variants.length > 1) throw new Error('--usb admite una sola variante (--full o --store)');
  }
  if (!o.platforms.length) o.platforms = ['tizen', 'webos'];
  if (!o.variants.length) o.variants = ['store'];
  o.variants = [...new Set(o.variants)];
  return o;
}

/*
 * dist/tizen-usb/: carpeta "userwidget" para copiar en la raíz de una memoria USB y README.txt.
 * Samsung solo instala por USB paquetes .tmg + .license de su "USB Demo Packaging Tool" (Seller Office);
 * un .wgt firmado con Tizen Studio sirve como entrada para esa herramienta y para el modo desarrollador.
 */
function usbFolder(summary) {
  const root = path.join(DIST, 'tizen-usb');
  const uw = path.join(root, 'userwidget');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(uw, { recursive: true });
  const name = summary.ids.tizenName;
  const wgt = summary.package && summary.package.ok ? summary.package.file : null;
  if (wgt) fs.copyFileSync(wgt, path.join(uw, `${name}.wgt`));
  else {
    fs.writeFileSync(path.join(uw, 'COLOQUE-AQUI-EL-PAQUETE.txt'),
      'Aquí van los archivos del paquete para USB (ver ../README.txt).\r\n'
      + `Cuando Tizen Studio esté instalado, "npm run build -- --usb" deja aquí ${name}.wgt.\r\n`);
  }
  const lines = [
    `${summary.config.appName} ${cfg.packageInfo().version} — memoria USB para televisores Samsung (Tizen)`,
    `Compilación: ${summary.variant === 'full' ? 'completa (servidor libre y listas M3U)' : 'de tienda (solo usuario y contraseña)'}`,
    `Identificador: ${summary.ids.tizenId}`,
    '',
    'IMPORTANTE — LEA ANTES DE USAR',
    '------------------------------',
    'Samsung indica que por seguridad un archivo .wgt NO se puede instalar desde una memoria USB.',
    'Por USB el televisor solo instala un paquete .tmg con su archivo .license, que se generan con la',
    'herramienta "USB Demo Packaging Tool" de Samsung TV Seller Office (solo cuentas partner). Esos',
    'paquetes de prueba vencen a los 30 días, y hay reportes de que Samsung ya no los genera.',
    'Fuente: https://developer.samsung.com/smarttv/develop/faq/application-installation.html',
    '',
    'Qué hacer con esta carpeta:',
    ` - ${name}.wgt (si está en userwidget) es la app firmada con su certificado de Tizen Studio. Sirve para:`,
    '     a) instalarla por red en televisores en modo desarrollador (ver tv/README.md), y',
    '     b) subirla a Seller Office para generar el paquete de USB (.tmg + .license).',
    ' - Si tiene el .tmg y el .license, cópielos (sin el .wgt) dentro de la carpeta userwidget.',
    '',
    'Pasos para preparar la memoria USB (con el .tmg y el .license):',
    ' 1. Use una memoria USB 2.0 formateada en FAT32.',
    ' 2. Copie la carpeta "userwidget" completa en la RAÍZ de la memoria: debe quedar X:\\userwidget\\',
    '    con los dos archivos adentro (sin espacios en el nombre del .tmg).',
    ' 3. Si el televisor ya tiene una versión anterior de la app, desinstálela primero.',
    ' 4. Con el televisor encendido, conecte la memoria. La instalación empieza sola y la app',
    '    aparece en Apps / Mis aplicaciones.',
    ' 5. Según el modelo, la app funciona solo mientras la memoria está conectada (así lo indica',
    '    SS IPTV) o queda instalada; en la serie J (2015) puede borrarse al reiniciar.',
    '',
    'Modelos: el método USB "userwidget" se usa en televisores Samsung Tizen de 2015 a 2019',
    '(series J, K, M, N y R). En 2020 y posteriores no está confirmado y hay reportes de bloqueo.',
    'Los televisores Orsay (2012-2014 y algunos 2015, anteriores a Tizen) usan otro SDK y otro',
    'formato de app: esta app no es compatible con ellos.',
    '',
    'Alternativas oficiales para instalar en televisores propios:',
    ' - Modo desarrollador + Tizen Studio por red (certificado con el DUID de cada televisor).',
    ' - Seller Office: prueba beta (televisores 2021 en adelante, con código de activación) o',
    '   prueba alfa (cuentas partner, televisores 2020 en adelante, hasta 50 equipos por DUID).',
    ' - Publicación en la tienda Samsung (ver docs/TV-TIENDAS.md).',
  ];
  fs.writeFileSync(path.join(root, 'README.txt'), `${lines.join('\r\n')}\r\n`);
  return { root, wgt: !!wgt, name };
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fillTemplate(text, values) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in values)) throw new Error(`Plantilla: falta el valor ${k}`);
    return values[k];
  });
}

/* Prefijos -webkit- para flexbox (motores antiguos de TV) */
function prefixCss(css) {
  return css
    .replace(/(^|[;{\s])display:\s*flex\s*;/g, '$1display: -webkit-flex; display: flex;')
    .replace(/(^|[;{\s])(flex|flex-direction|flex-wrap|flex-basis|flex-grow|flex-shrink|align-items|align-self|align-content|justify-content|order):\s*([^;{}]+);/g,
      (m, pre, prop, val) => `${pre}-webkit-${prop}: ${val}; ${prop}: ${val};`)
    .replace(/(^|[;{\s])transition:\s*transform([^;]*);/g, '$1-webkit-transition: -webkit-transform$2; transition: transform$2;')
    .replace(/linear-gradient\(180deg,/g, 'linear-gradient(to bottom,');
}

const CSP = [
  "default-src 'self' file: data: blob:",
  "script-src 'self' file:",
  "style-src 'self' file: 'unsafe-inline'",
  'img-src * data: blob: file:',
  'media-src * data: blob: file:',
  'connect-src *',
  "child-src 'self' blob:",
  "worker-src 'self' blob:",
  "font-src 'self' file: data:",
  "object-src 'self' file:",
].join('; ');

function which(cmd) {
  // Primero la copia del proyecto (npm install instala la CLI de webOS en node_modules/.bin)
  const local = path.join(cfg.TV_DIR, 'node_modules', '.bin', process.platform === 'win32' ? `${cmd}.cmd` : cmd);
  if (fs.existsSync(local)) return local;
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.split(/\r?\n/).filter(Boolean)[0];
  return null;
}

/* Tizen Studio: en el PATH o en las carpetas habituales */
function findTizenCli() {
  const found = which('tizen');
  if (found) return found;
  const bin = process.platform === 'win32' ? 'tizen.bat' : 'tizen';
  const homes = [
    process.env.TIZEN_STUDIO,
    path.join(os.homedir(), 'tizen-studio'),
    process.platform === 'win32' ? 'C:\\tizen-studio' : '/opt/tizen-studio',
  ].filter(Boolean);
  for (const h of homes) {
    const p = path.join(h, 'tools', 'ide', 'bin', bin);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/* En Windows las herramientas son .bat/.cmd: se ejecutan con la consola y los argumentos entre comillas */
function run(cmd, args, cwd) {
  const win = process.platform === 'win32';
  const q = (s) => (win && /[\s&()^]/.test(s) ? `"${s}"` : s);
  const r = win
    ? spawnSync(q(cmd), args.map(q), { cwd, encoding: 'utf8', shell: true })
    : spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function buildOne(platform, variant, operator, opts) {
  const name = `${platform}-${variant}`;
  const out = path.join(DIST, name);
  const { config, warnings } = cfg.variantConfig(operator.data, { variant, platform, dev: opts.dev });
  const ids = cfg.appIds(operator.data, variant);
  const pkg = cfg.packageInfo();
  const op = operator.data;
  cfg.versionParts(pkg.version);

  fs.rmSync(out, { recursive: true, force: true });
  copyDir(cfg.SRC_DIR, out);

  /* Configuración, estilos e index.html */
  fs.writeFileSync(path.join(out, 'js', 'config.js'), cfg.configJs(config));
  const cssFile = path.join(out, 'css', 'app.css');
  fs.writeFileSync(cssFile, prefixCss(fs.readFileSync(cssFile, 'utf8')));
  let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
    .replace('<title>IPTV Player</title>', `<title>${escXml(config.appName)}</title>`);
  if (platform !== 'tizen') {
    html = html.replace(/\s*<!-- Tizen:[^>]*-->\s*<script src="\$WEBAPIS\/webapis\/webapis\.js"><\/script>/, '');
  }
  fs.writeFileSync(path.join(out, 'index.html'), html);

  /* Iconos */
  if (!fs.existsSync(path.join(ICONS, 'webos', 'splash.png'))) {
    console.log('  Generando iconos (npm run icons)…');
    const r = spawnSync(process.execPath, [path.join(__dirname, 'make-icons.js')], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('No se pudieron generar los iconos');
  }
  const description = `${config.appName}: televisión en vivo, películas y series del servicio de ${op.vendor || config.appName} para sus suscriptores.`;
  if (platform === 'tizen') {
    fs.copyFileSync(path.join(ICONS, 'tizen', 'icon.png'), path.join(out, 'icon.png'));
    const tz = op.tizen || {};
    const useCsp = opts.csp === false ? false : tz.csp !== false;
    const domain = ids.webos.split('.').reverse().join('.');
    const xml = fillTemplate(fs.readFileSync(path.join(cfg.TV_DIR, 'tizen', 'config.xml'), 'utf8'), {
      WIDGET_ID: `http://${escXml(domain)}/${ids.tizenName}`,
      VERSION: pkg.version,
      TIZEN_ID: ids.tizenId,
      TIZEN_PACKAGE: ids.tizenPackage,
      REQUIRED_VERSION: escXml(tz.requiredVersion || '2.3'),
      APP_NAME: escXml(config.appName),
      DESCRIPTION: escXml(description),
      AUTHOR: op.vendor ? `<author${config.support.email ? ` email="${escXml(config.support.email)}"` : ''}>${escXml(op.vendor)}</author>` : '',
      CSP: useCsp ? `<tizen:content-security-policy>${CSP}</tizen:content-security-policy>` : '',
    });
    /* Quita el comentario de la plantilla y las líneas vacías */
    const clean = xml.replace(/<!--[\s\S]*?-->\s*/, '').replace(/^\s*\n/gm, '');
    fs.writeFileSync(path.join(out, 'config.xml'), clean);
  } else {
    fs.copyFileSync(path.join(ICONS, 'webos', 'icon.png'), path.join(out, 'icon.png'));
    fs.copyFileSync(path.join(ICONS, 'webos', 'largeIcon.png'), path.join(out, 'largeIcon.png'));
    fs.copyFileSync(path.join(ICONS, 'webos', 'splash.png'), path.join(out, 'splash.png'));
    const wo = op.webos || {};
    const json = fillTemplate(fs.readFileSync(path.join(cfg.TV_DIR, 'webos', 'appinfo.json'), 'utf8'), {
      WEBOS_ID: ids.webos,
      VERSION: pkg.version,
      VENDOR: JSON.stringify(String(op.vendor || config.appName)).slice(1, -1),
      APP_NAME: JSON.stringify(config.appName).slice(1, -1),
      ICON_COLOR: /^#[0-9a-f]{6}$/i.test(wo.iconColor || '') ? wo.iconColor : '#2846aa',
    });
    JSON.parse(json);
    fs.writeFileSync(path.join(out, 'appinfo.json'), json);
  }

  /* ES5 en la salida (incluye config.js generado) */
  const bad = listJs(out).filter((f) => checkFile(f).length);
  if (bad.length) throw new Error(`JavaScript no compatible con ES5 en: ${bad.map((f) => path.relative(out, f)).join(', ')}`);

  const summary = {
    name, out, platform, variant, config, ids, warnings,
    login: config.allowCustomServer ? 'servidor + usuario + contraseña' : 'solo usuario y contraseña',
    m3u: config.allowM3U ? 'sí' : 'no',
    package: null,
  };

  if (opts.pack) summary.package = pack(platform, out, ids, pkg.version, variant, op, opts);
  return summary;
}

function pack(platform, out, ids, version, variant, op, opts) {
  if (platform === 'tizen') {
    const cli = findTizenCli();
    if (!cli) return { ok: false, missing: 'tizen' };
    const profile = opts.profile || process.env.TIZEN_PROFILE || (op.tizen && op.tizen.certificateProfile) || '';
    if (!profile) return { ok: false, missing: 'profile', cli };
    const r = run(cli, ['package', '-t', 'wgt', '-s', profile, '--', out], out);
    const wgt = fs.readdirSync(out).find((f) => f.endsWith('.wgt'));
    if (!r.ok || !wgt) return { ok: false, error: r.out, cli };
    const target = path.join(DIST, `${ids.tizenName}-${version}-${variant}.wgt`);
    fs.renameSync(path.join(out, wgt), target);
    return { ok: true, file: target };
  }
  const ares = which('ares-package');
  if (!ares) return { ok: false, missing: 'ares' };
  const tmp = path.join(DIST, `.ipk-${variant}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const r = run(ares, [out, '-o', tmp], cfg.TV_DIR);
  const ipk = fs.existsSync(tmp) ? fs.readdirSync(tmp).find((f) => f.endsWith('.ipk')) : null;
  if (!r.ok || !ipk) return { ok: false, error: r.out, cli: ares };
  const target = path.join(DIST, `${ids.webos}_${version}_${variant}.ipk`);
  fs.renameSync(path.join(tmp, ipk), target);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { ok: true, file: target };
}

const HELP = {
  tizen: `  Para crear el .wgt instale Tizen Studio (https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)
  con la extensión "TV Extensions" y "Samsung Certificate Extension", cree un perfil de certificado Samsung
  (Tools → Certificate Manager) y vuelva a ejecutar:  npm run build tizen -- --profile NOMBRE_DEL_PERFIL
  (o ponga el perfil en operator.json → tizen.certificateProfile). Ver tv/README.md.`,
  profile: `  Tizen Studio está instalado pero falta el perfil de certificado. Créelo en Tools → Certificate Manager
  y ejecute:  npm run build tizen -- --profile NOMBRE_DEL_PERFIL`,
  ares: `  Para crear el .ipk instale la CLI de webOS TV: en la carpeta tv ejecute  npm install
  (queda en node_modules; ver https://webostv.developer.lge.com/develop/tools/cli-installation) y vuelva a ejecutar npm run build webos.
  También puede empaquetar a mano:  ares-package dist/webos-store -o dist   (o dist/webos-full)`,
};

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const operator = cfg.loadOperator(opts.operator);
  console.log(`Configuración: ${path.relative(cfg.TV_DIR, operator.file)}${operator.example ? '  (¡ejemplo! copie operator.example.json como operator.json)' : ''}`);
  console.log(`Versión: ${cfg.packageInfo().version}\n`);
  fs.mkdirSync(DIST, { recursive: true });
  const results = [];
  for (const variant of opts.variants) {
    for (const platform of opts.platforms) {
      const r = buildOne(platform, variant, operator, opts);
      results.push(r);
      console.log(`✓ ${path.relative(cfg.TV_DIR, r.out)}`);
      console.log(`    ${platform === 'tizen' ? `id ${r.ids.tizenId}` : `id ${r.ids.webos}`} · inicio de sesión: ${r.login} · listas M3U: ${r.m3u}`);
      console.log(`    serverUrls: ${r.config.serverUrls.join(', ') || '(ninguna)'}`);
      r.warnings.forEach((w) => console.log(`    Aviso: ${w}`));
      if (r.package) {
        if (r.package.ok) console.log(`    Paquete: ${path.relative(cfg.TV_DIR, r.package.file)}`);
        else if (r.package.missing) console.log(`    Paquete: no creado.\n${HELP[r.package.missing]}`);
        else console.log(`    Paquete: la herramienta falló:\n${r.package.error}`);
      }
      console.log('');
    }
  }
  if (opts.usb) {
    const usb = usbFolder(results[0]);
    console.log(`✓ ${path.relative(cfg.TV_DIR, usb.root)}  (carpeta userwidget + README.txt)`);
    if (usb.wgt) {
      console.log(`    userwidget/${usb.name}.wgt listo. Recuerde: por USB Samsung solo instala .tmg + .license (ver README.txt).`);
    } else {
      console.log('    Falta el .wgt firmado: instale Tizen Studio con la extensión TV y el certificado Samsung y ejecute');
      console.log('    npm run build -- --usb --profile NOMBRE_DEL_PERFIL   (queda en dist/tizen-usb/userwidget/).');
      console.log('    Para USB, suba ese .wgt a Samsung TV Seller Office → USB Demo Packaging Tool (cuenta partner) y');
      console.log('    copie el .tmg y el .license resultantes en userwidget/. Detalles en dist/tizen-usb/README.txt.');
    }
  }
}

try {
  main();
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
