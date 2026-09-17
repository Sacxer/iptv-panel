'use strict';
/*
 * npm run icons — genera los iconos de los televisores y las imágenes de las tiendas.
 *
 * Fuentes: app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png (192x192) y
 *          drawable-xhdpi/banner.png (320x180) de la app de Android.
 * - Tamaños menores o iguales a la fuente: se reducen del PNG.
 * - Tamaños mayores: se dibujan con el mismo diseño (colores, forma y posición medidos del PNG) para que
 *   queden nítidos. El nombre de la app (operator.json → appName) se escribe con una fuente de puntos.
 *
 * Salida:
 *   assets/icons/   → los que empaqueta build.js (Tizen y webOS)
 *   assets/store/   → los que se suben a Samsung Seller Office y LG Seller Lounge
 */
const fs = require('fs');
const path = require('path');
const png = require('./lib/png');
const draw = require('./lib/draw');
const { TV_DIR, loadOperator } = require('./lib/appconfig');

const RES = path.resolve(TV_DIR, '..', 'app', 'android', 'app', 'src', 'main', 'res');
const ICON_SRC = path.join(RES, 'mipmap-xxxhdpi', 'ic_launcher.png');
const BANNER_SRC = path.join(RES, 'drawable-xhdpi', 'banner.png');

/* Tamaños requeridos (ver README.md → "Iconos e imágenes") */
const TARGETS = {
  icons: [
    { file: 'tizen/icon.png', w: 117, h: 117, kind: 'icon', note: 'Tizen config.xml <icon> (tamaño de las plantillas de Tizen Studio)' },
    /* LG: cuadrado, sin esquinas redondeadas y sin transparencia (lista de verificación de LG, «Icon») */
    { file: 'webos/icon.png', w: 80, h: 80, kind: 'square', alpha: false, note: 'webOS appinfo.json icon (80x80, cuadrado y opaco)' },
    { file: 'webos/largeIcon.png', w: 130, h: 130, kind: 'square', alpha: false, note: 'webOS appinfo.json largeIcon (130x130, cuadrado y opaco)' },
    { file: 'webos/splash.png', w: 1920, h: 1080, kind: 'splash', note: 'webOS appinfo.json splashBackground (1920x1080)' },
  ],
  store: [
    { file: 'samsung/icon-512x423.png', w: 512, h: 423, kind: 'tile', alpha: false, note: 'Samsung Seller Office: icono 512x423, PNG 24 bits, < 300 KB' },
    { file: 'samsung/logo-1920x1080.png', w: 1920, h: 1080, kind: 'logo', note: 'Samsung Seller Office: logotipo 1920x1080, PNG 32 bits transparente, < 300 KB' },
    { file: 'samsung/background-1920x1080.png', w: 1920, h: 1080, kind: 'background', alpha: false, note: 'Samsung Seller Office: fondo 1920x1080, PNG 24 bits, < 300 KB' },
    { file: 'lg/icon-400x400.png', w: 400, h: 400, kind: 'square', alpha: false, note: 'LG Seller Lounge: icono 400x400 (cuadrado y opaco)' },
    /* Con letra normal: npm run shots -- --art (aquí solo se crea si no existe) */
    { file: 'lg/background-1920x1080.png', w: 1920, h: 1080, kind: 'splash', alpha: false, keep: true, note: 'LG Seller Lounge: imagen de fondo 1920x1080' },
  ],
};

function readPng(file) {
  if (!fs.existsSync(file)) throw new Error(`No se encontró ${path.relative(TV_DIR, file)}`);
  return png.decode(fs.readFileSync(file));
}

function pixel(img, x, y) {
  const o = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3] / 255];
}

/* Mide el icono de Android: forma, colores del degradado y posición del logotipo blanco */
function measureIcon(img) {
  const { width: w, height: h } = img;
  let ax0 = w, ay0 = h, ax1 = -1, ay1 = -1;
  let gx0 = w, gy0 = h, gx1 = -1, gy1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(img, x, y);
      if (a > 0.5) { ax0 = Math.min(ax0, x); ay0 = Math.min(ay0, y); ax1 = Math.max(ax1, x); ay1 = Math.max(ay1, y); }
      if (a > 0.5 && r > 235 && g > 235 && b > 235) { gx0 = Math.min(gx0, x); gy0 = Math.min(gy0, y); gx1 = Math.max(gx1, x); gy1 = Math.max(gy1, y); }
    }
  }
  const size = Math.max(ax1 - ax0 + 1, ay1 - ay0 + 1);
  /* Radio de las esquinas: primer píxel opaco sobre la diagonal */
  let t = 0;
  while (t < size / 2 && pixel(img, ax0 + t, ay0 + t)[3] < 0.5) t++;
  const radius = Math.max(0, t / (1 - Math.SQRT1_2));
  const cx = Math.round((ax0 + ax1) / 2);
  const top = pixel(img, cx, ay0 + Math.max(2, size * 0.04));
  const bottom = pixel(img, cx, ay1 - Math.max(2, size * 0.04));
  /* Escala del logotipo respecto a su caja en unidades de 108 */
  const [bx0, by0, bx1, by1] = draw.GLYPH_BOUNDS;
  const unit = ((gx1 - gx0 + 1) / (bx1 - bx0) + (gy1 - gy0 + 1) / (by1 - by0)) / 2 / size;
  return {
    radiusRatio: radius / size,
    top: [top[0], top[1], top[2], 1],
    bottom: [bottom[0], bottom[1], bottom[2], 1],
    glyph: { unitRatio: unit, cx: ((gx0 + gx1 + 1) / 2 - ax0) / size, cy: ((gy0 + gy1 + 1) / 2 - ay0) / size },
    bounds: [ax0, ay0, ax1, ay1],
  };
}

function measureBanner(img) {
  const y = Math.round(img.height / 2);
  const left = pixel(img, 2, 4);
  const right = pixel(img, img.width - 3, img.height - 5);
  const mid = pixel(img, Math.round(img.width * 0.62), y - Math.round(img.height * 0.35));
  return { left: [left[0], left[1], left[2], 1], right: [right[0], right[1], right[2], 1], mid: [mid[0], mid[1], mid[2], 1] };
}

function iconStyle(m, size) {
  return {
    radiusRatio: m.radiusRatio,
    top: m.top,
    bottom: m.bottom,
    glyph: { unit: m.glyph.unitRatio * size, cx: m.glyph.cx, cy: m.glyph.cy },
  };
}

/* Icono cuadrado: si cabe, se reduce del PNG original; si no, se dibuja */
function renderIcon(src, m, w, h) {
  const size = Math.min(w, h);
  const out = png.createImage(w, h);
  const [ax0, ay0, ax1, ay1] = m.bounds;
  const srcSize = Math.max(ax1 - ax0 + 1, ay1 - ay0 + 1);
  if (size <= srcSize) {
    const crop = png.createImage(srcSize, srcSize);
    png.composite(crop, src, -ax0, -ay0);
    png.composite(out, png.resize(crop, size, size), Math.round((w - size) / 2), Math.round((h - size) / 2));
  } else {
    draw.drawIcon(out, (w - size) / 2, (h - size) / 2, size, iconStyle(m, size));
  }
  return out;
}

/*
 * Icono cuadrado a sangre (LG): color liso y logotipo centrado, sin esquinas, transparencia ni degradado.
 * LG pide que el fondo del icono sea del mismo color que el mosaico (operator.json → webos.iconColor).
 */
function renderSquare(m, w, h, tile) {
  const out = png.createImage(w, h);
  draw.gradient(out, tile, tile, 'vertical');
  const size = Math.min(w, h);
  const unit = m.glyph.unitRatio * size;
  const [bx0, by0, bx1, by1] = draw.GLYPH_BOUNDS;
  draw.drawGlyph(out, (w - (bx0 + bx1) * unit) / 2, (h - (by0 + by1) * unit) / 2, unit);
  return out;
}

function textBlock(img, name, centerX, top, maxWidth, cell, color) {
  let c = cell;
  while (c > 2 && draw.textWidth(name, c) > maxWidth) c -= 1;
  const tw = draw.textWidth(name, c);
  draw.drawText(img, name, Math.round(centerX - tw / 2), top, c, color);
  return c * 7;
}

function render(target, src, m, banner, name, tile) {
  const { w, h, kind } = target;
  if (kind === 'icon') return renderIcon(src, m, w, h);
  if (kind === 'square') return renderSquare(m, w, h, tile || m.bottom);

  const bg = png.createImage(w, h);
  if (kind === 'background' || kind === 'splash' || kind === 'tile') {
    const from = kind === 'tile' ? m.top : banner.left;
    const to = kind === 'tile' ? m.bottom : banner.right;
    draw.gradient(bg, from, to, kind === 'tile' ? 'vertical' : 'horizontal');
  }
  if (kind === 'background') return bg;

  if (kind === 'tile') {
    /* 512x423: logotipo blanco centrado y nombre debajo */
    const unit = h * 0.0072;
    const [bx0, by0, bx1, by1] = draw.GLYPH_BOUNDS;
    const gw = (bx1 - bx0) * unit, gh = (by1 - by0) * unit;
    const textCell = Math.round(h * 0.022);
    const block = gh + textCell * 10;
    const top = (h - block) / 2;
    draw.drawGlyph(bg, (w - gw) / 2 - bx0 * unit, top - by0 * unit, unit);
    textBlock(bg, name, w / 2, Math.round(top + gh + textCell * 3), w * 0.86, textCell, [255, 255, 255, 1]);
    return bg;
  }

  /* splash / logo: icono grande centrado y nombre debajo */
  const size = Math.round(h * (kind === 'logo' ? 0.36 : 0.3));
  const cell = Math.round(h * 0.017);
  const block = size + cell * 12;
  const top = Math.round((h - block) / 2);
  draw.drawIcon(bg, (w - size) / 2, top, size, iconStyle(m, size));
  textBlock(bg, name, w / 2, top + size + cell * 5, w * 0.8, cell, [255, 255, 255, 1]);
  return bg;
}

function main() {
  const args = process.argv.slice(2);
  const opIndex = args.indexOf('--operator');
  let name = 'IPTV Player';
  let tile = null;
  try {
    const op = loadOperator(opIndex >= 0 ? args[opIndex + 1] : null).data;
    name = op.appName || name;
    if (op.webos && /^#[0-9a-f]{6}$/i.test(op.webos.iconColor || '')) tile = draw.hex(op.webos.iconColor);
  } catch (e) {
    console.warn(`Aviso: ${e.message} Se usa el nombre "${name}".`);
  }
  const src = readPng(ICON_SRC);
  const bannerImg = readPng(BANNER_SRC);
  const m = measureIcon(src);
  const banner = measureBanner(bannerImg);
  console.log(`Icono de Android ${src.width}x${src.height}: esquinas ${(m.radiusRatio * 100).toFixed(1)} %, degradado rgb(${m.top.slice(0, 3)}) → rgb(${m.bottom.slice(0, 3)})`);
  console.log(`Banner ${bannerImg.width}x${bannerImg.height}: degradado rgb(${banner.left.slice(0, 3)}) → rgb(${banner.right.slice(0, 3)})`);
  console.log(`Nombre en las imágenes: "${draw.textKey(name)}"\n`);

  const groups = [['icons', path.join(TV_DIR, 'assets', 'icons')], ['store', path.join(TV_DIR, 'assets', 'store')]];
  for (const [group, dir] of groups) {
    for (const t of TARGETS[group]) {
      const file = path.join(dir, t.file);
      if (t.keep && fs.existsSync(file) && args.indexOf('--force') < 0) {
        console.log(`${path.relative(TV_DIR, file).padEnd(44)} (se conserva; --force para redibujarla)`);
        continue;
      }
      const img = render(t, src, m, banner, name, tile);
      const alpha = t.alpha !== false;
      const buf = png.encode(alpha ? img : png.flatten(img, [11, 15, 23]), { alpha });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      const kb = (buf.length / 1024).toFixed(0);
      const warn = t.note.indexOf('300 KB') >= 0 && buf.length > 300 * 1024 ? '  ¡supera 300 KB!' : '';
      console.log(`${path.relative(TV_DIR, file).padEnd(44)} ${String(t.w + 'x' + t.h).padEnd(10)} ${kb.padStart(5)} KB  ${t.note}${warn}`);
    }
  }
  console.log('\nCapturas de pantalla: ver README.md (Samsung: 4 JPG 1920x1080; LG: 1280x720 o 1920x1080).');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { TARGETS, measureIcon, render };
