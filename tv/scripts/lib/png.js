'use strict';
/*
 * PNG mínimo en Node puro (zlib): leer, redimensionar y escribir imágenes RGBA de 8 bits.
 * Admite PNG sin entrelazado de 8 bits (escala de grises, RGB, paleta, gris+alfa, RGBA).
 */
const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* Imagen: {width, height, data: Uint8ClampedArray RGBA} */
function createImage(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3] === undefined ? 255 : fill[3];
    }
  }
  return { width, height, data };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/* ---------- Lectura ---------- */
function decode(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('No es un archivo PNG');
  let pos = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const body = buffer.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8],
        colorType: body[9], interlace: body[12],
      };
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      transparency = body;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!header) throw new Error('PNG sin cabecera');
  if (header.depth !== 8) throw new Error(`Profundidad de ${header.depth} bits no soportada (solo 8)`);
  if (header.interlace) throw new Error('PNG entrelazado no soportado');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  if (!channels) throw new Error(`Tipo de color ${header.colorType} no soportado`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width, height } = header;
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: v += paeth(a, b, c); break;
        default: throw new Error(`Filtro PNG ${filter} no válido`);
      }
      out[x] = v & 0xff;
    }
    prev = out;
  }

  const img = createImage(width, height);
  const d = img.data;
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const o = i * 4;
    switch (header.colorType) {
      case 0: d[o] = d[o + 1] = d[o + 2] = pixels[j]; d[o + 3] = 255; break;
      case 2:
        d[o] = pixels[j]; d[o + 1] = pixels[j + 1]; d[o + 2] = pixels[j + 2]; d[o + 3] = 255;
        break;
      case 3: {
        const k = pixels[j];
        d[o] = palette[k * 3]; d[o + 1] = palette[k * 3 + 1]; d[o + 2] = palette[k * 3 + 2];
        d[o + 3] = transparency && k < transparency.length ? transparency[k] : 255;
        break;
      }
      case 4: d[o] = d[o + 1] = d[o + 2] = pixels[j]; d[o + 3] = pixels[j + 1]; break;
      default:
        d[o] = pixels[j]; d[o + 1] = pixels[j + 1]; d[o + 2] = pixels[j + 2]; d[o + 3] = pixels[j + 3];
    }
  }
  return img;
}

/* ---------- Escritura ---------- */
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

/*
 * encode(img, {alpha: true}) → Buffer PNG. alpha:false escribe RGB de 24 bits (fondo opaco).
 * Elige por fila el filtro con menor suma absoluta (heurística estándar).
 */
function encode(img, opts = {}) {
  const alpha = opts.alpha !== false;
  const channels = alpha ? 4 : 3;
  const { width, height, data } = img;
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  let prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  const candidates = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, t = x * channels;
      line[t] = data[s]; line[t + 1] = data[s + 1]; line[t + 2] = data[s + 2];
      if (alpha) line[t + 3] = data[s + 3];
    }
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const cand = candidates[f];
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? line[x - channels] : 0;
        const b = prev[x];
        const c = x >= channels ? prev[x - channels] : 0;
        let v;
        switch (f) {
          case 0: v = line[x]; break;
          case 1: v = line[x] - a; break;
          case 2: v = line[x] - b; break;
          case 3: v = line[x] - ((a + b) >> 1); break;
          default: v = line[x] - paeth(a, b, c);
        }
        v &= 0xff;
        cand[x] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    const o = y * (stride + 1);
    out[o] = best;
    candidates[best].copy(out, o + 1);
    prev = Buffer.from(line);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(out, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- Redimensionado (alfa premultiplicado para evitar bordes oscuros) ---------- */
function toPremultiplied(img) {
  const n = img.width * img.height;
  const p = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4, a = img.data[o + 3] / 255;
    p[o] = img.data[o] * a; p[o + 1] = img.data[o + 1] * a; p[o + 2] = img.data[o + 2] * a; p[o + 3] = a;
  }
  return p;
}

function fromPremultiplied(p, width, height) {
  const img = createImage(width, height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4, a = p[o + 3];
    if (a > 0.0001) {
      img.data[o] = Math.round(p[o] / a); img.data[o + 1] = Math.round(p[o + 1] / a); img.data[o + 2] = Math.round(p[o + 2] / a);
    }
    img.data[o + 3] = Math.round(a * 255);
  }
  return img;
}

/* Reducción por promedio de área (caja) y ampliación bilineal */
function resize(img, width, height) {
  const src = toPremultiplied(img);
  const sw = img.width, sh = img.height;
  const dst = new Float32Array(width * height * 4);
  const sx = sw / width, sy = sh / height;
  if (sx >= 1 && sy >= 1) {
    for (let y = 0; y < height; y++) {
      const y0 = y * sy, y1 = (y + 1) * sy;
      for (let x = 0; x < width; x++) {
        const x0 = x * sx, x1 = (x + 1) * sx;
        let r = 0, g = 0, b = 0, a = 0, area = 0;
        for (let yy = Math.floor(y0); yy < Math.min(sh, Math.ceil(y1)); yy++) {
          const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          if (wy <= 0) continue;
          for (let xx = Math.floor(x0); xx < Math.min(sw, Math.ceil(x1)); xx++) {
            const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
            if (wx <= 0) continue;
            const w = wx * wy, o = (yy * sw + xx) * 4;
            r += src[o] * w; g += src[o + 1] * w; b += src[o + 2] * w; a += src[o + 3] * w;
            area += w;
          }
        }
        const o = (y * width + x) * 4;
        dst[o] = r / area; dst[o + 1] = g / area; dst[o + 2] = b / area; dst[o + 3] = a / area;
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < width; x++) {
        const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
        const o = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) {
          const top = src[(y0 * sw + x0) * 4 + c] * (1 - tx) + src[(y0 * sw + x1) * 4 + c] * tx;
          const bot = src[(y1 * sw + x0) * 4 + c] * (1 - tx) + src[(y1 * sw + x1) * 4 + c] * tx;
          dst[o + c] = top * (1 - ty) + bot * ty;
        }
      }
    }
  }
  return fromPremultiplied(dst, width, height);
}

/* Dibuja `src` sobre `dst` en (dx, dy) con mezcla alfa normal */
function composite(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4, d = (ty * dst.width + tx) * 4;
      blendPixel(dst.data, d, src.data[s], src.data[s + 1], src.data[s + 2], src.data[s + 3] / 255);
    }
  }
}

function blendPixel(data, o, r, g, b, a) {
  if (a <= 0) return;
  const da = data[o + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  data[o] = (r * a + data[o] * da * (1 - a)) / oa;
  data[o + 1] = (g * a + data[o + 1] * da * (1 - a)) / oa;
  data[o + 2] = (b * a + data[o + 2] * da * (1 - a)) / oa;
  data[o + 3] = oa * 255;
}

/* Quita el canal alfa sobre un color de fondo */
function flatten(img, bg) {
  const out = createImage(img.width, img.height, [bg[0], bg[1], bg[2], 255]);
  composite(out, img, 0, 0);
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  return out;
}

module.exports = { decode, encode, resize, composite, blendPixel, flatten, createImage, crc32 };
