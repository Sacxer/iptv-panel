'use strict';
/*
 * Dibujo vectorial mínimo con funciones de distancia (bordes suavizados) y una fuente de puntos 5x7.
 * Sirve para generar iconos y fondos grandes nítidos con el mismo diseño del icono de Android.
 */
const { blendPixel } = require('./png');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.sqrt(ox * ox + oy * oy) - r;
}

function sdTriangle(px, py, a, b, c) {
  const e0x = b[0] - a[0], e0y = b[1] - a[1];
  const e1x = c[0] - b[0], e1y = c[1] - b[1];
  const e2x = a[0] - c[0], e2y = a[1] - c[1];
  const v0x = px - a[0], v0y = py - a[1];
  const v1x = px - b[0], v1y = py - b[1];
  const v2x = px - c[0], v2y = py - c[1];
  const t0 = clamp((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y), 0, 1);
  const t1 = clamp((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y), 0, 1);
  const t2 = clamp((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y), 0, 1);
  const p0x = v0x - e0x * t0, p0y = v0y - e0y * t0;
  const p1x = v1x - e1x * t1, p1y = v1y - e1y * t1;
  const p2x = v2x - e2x * t2, p2y = v2y - e2y * t2;
  const s = Math.sign(e0x * e2y - e0y * e2x);
  const d0 = [p0x * p0x + p0y * p0y, s * (v0x * e0y - v0y * e0x)];
  const d1 = [p1x * p1x + p1y * p1y, s * (v1x * e1y - v1y * e1x)];
  const d2 = [p2x * p2x + p2y * p2y, s * (v2x * e2y - v2y * e2x)];
  const dx = Math.min(d0[0], d1[0], d2[0]);
  const dy = Math.min(d0[1], d1[1], d2[1]);
  return -Math.sqrt(dx) * Math.sign(dy);
}

/*
 * Rellena una forma: sdf(x, y) → distancia con signo en píxeles; color: [r,g,b,a] o función (x, y) → [r,g,b,a].
 * bbox: [x0, y0, x1, y1] para no recorrer toda la imagen.
 */
function fill(img, sdf, color, bbox) {
  const x0 = Math.max(0, Math.floor(bbox ? bbox[0] - 2 : 0));
  const y0 = Math.max(0, Math.floor(bbox ? bbox[1] - 2 : 0));
  const x1 = Math.min(img.width, Math.ceil(bbox ? bbox[2] + 2 : img.width));
  const y1 = Math.min(img.height, Math.ceil(bbox ? bbox[3] + 2 : img.height));
  const fn = typeof color === 'function';
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = sdf(x + 0.5, y + 0.5);
      const cov = clamp(0.5 - d, 0, 1);
      if (cov <= 0) continue;
      const c = fn ? color(x + 0.5, y + 0.5) : color;
      const a = (c[3] === undefined ? 1 : c[3]) * cov;
      blendPixel(img.data, (y * img.width + x) * 4, c[0], c[1], c[2], a);
    }
  }
}

function hex(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), 1];
}

function mix(a, b, t) {
  t = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
}

function gradient(img, from, to, dir, bbox) {
  const [x0, y0, x1, y1] = bbox || [0, 0, img.width, img.height];
  fill(img, (x, y) => sdRoundBox(x, y, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0) - 1,
    (x, y) => mix(from, to, dir === 'horizontal' ? (x - x0) / (x1 - x0) : (y - y0) / (y1 - y0)), bbox);
}

/*
 * Logotipo (mismo diseño que app/android/.../ic_launcher_foreground.xml, lienzo de 108 unidades):
 * pantalla con bordes redondeados, base y triángulo de reproducción.
 * box: {x, y, size} = cuadrado donde se dibuja el icono completo; glyph: {scale, ox, oy} en unidades de 108.
 */
const GLYPH_BOUNDS = [27.75, 33.75, 80.25, 76.5];

function drawGlyph(img, x, y, unit, color) {
  const u = (v) => v * unit;
  const X = (v) => x + u(v), Y = (v) => y + u(v);
  const white = color || [255, 255, 255, 1];
  /* Pantalla: rectángulo 30..78 × 36..69, radio 7, trazo 4.5 */
  const cx = X(54), cy = Y(52.5), hw = u(24), hh = u(16.5), r = u(7), sw = u(4.5) / 2;
  fill(img, (px, py) => Math.abs(sdRoundBox(px, py, cx, cy, hw, hh, r)) - sw, white,
    [X(30) - sw, Y(36) - sw, X(78) + sw, Y(69) + sw]);
  /* Base: 41.5..66.5 × 73.5..76.5 */
  fill(img, (px, py) => sdRoundBox(px, py, X(54), Y(75), u(12.5), u(1.5), u(1.5)), white,
    [X(41.5), Y(73.5), X(66.5), Y(76.5)]);
  /* Reproducir */
  const a = [X(49), Y(44.5)], b = [X(49), Y(60.5)], c = [X(62.5), Y(52.5)];
  fill(img, (px, py) => sdTriangle(px, py, a, b, c), white, [X(49), Y(44.5), X(62.5), Y(60.5)]);
}

/* Icono completo (cuadrado redondeado con degradado + logotipo) en un cuadrado de `size` px */
function drawIcon(img, x, y, size, style) {
  const s = style || {};
  const radius = size * (s.radiusRatio || 0.22);
  const top = s.top || hex('#4F8CFF');
  const bottom = s.bottom || hex('#2846AA');
  fill(img, (px, py) => sdRoundBox(px, py, x + size / 2, y + size / 2, size / 2, size / 2, radius),
    (px, py) => mix(top, bottom, (py - y) / size), [x, y, x + size, y + size]);
  const g = s.glyph || { unit: size / 108 * 1.36, cx: 0.5, cy: 0.5 };
  const unit = g.unit;
  /* Centro del logotipo en unidades de 108 */
  const gcx = (GLYPH_BOUNDS[0] + GLYPH_BOUNDS[2]) / 2, gcy = (GLYPH_BOUNDS[1] + GLYPH_BOUNDS[3]) / 2;
  drawGlyph(img, x + size * g.cx - gcx * unit, y + size * g.cy - gcy * unit, unit);
}

/* ---------- Fuente de puntos 5x7 (mayúsculas, dígitos y algunos signos) ---------- */
const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

function textKey(s) {
  return String(s || '').toUpperCase()
    .replace(/[ÁÀÄÂ]/g, 'A').replace(/[ÉÈËÊ]/g, 'E').replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔ]/g, 'O').replace(/[ÚÙÜÛ]/g, 'U').replace(/Ñ/g, 'N')
    .split('').map((ch) => (FONT[ch] ? ch : ' ')).join('');
}

/* Ancho en píxeles de un texto con celdas de `cell` px */
function textWidth(text, cell) {
  const t = textKey(text);
  return t.length ? (t.length * 6 - 1) * cell : 0;
}

function drawText(img, text, x, y, cell, color) {
  const t = textKey(text);
  const dot = cell * 0.9, r = cell * 0.18;
  for (let i = 0; i < t.length; i++) {
    const g = FONT[t[i]];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row][col] !== '#') continue;
        const cx = x + (i * 6 + col) * cell + cell / 2;
        const cy = y + row * cell + cell / 2;
        fill(img, (px, py) => sdRoundBox(px, py, cx, cy, dot / 2, dot / 2, r), color,
          [cx - dot / 2, cy - dot / 2, cx + dot / 2, cy + dot / 2]);
      }
    }
  }
}

module.exports = { fill, gradient, drawGlyph, drawIcon, drawText, textWidth, textKey, hex, mix, sdRoundBox, sdTriangle, GLYPH_BOUNDS, FONT };
