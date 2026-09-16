'use strict';
/*
 * Vídeo de prueba generado localmente, sin FFmpeg ni descargas:
 * H.264 Baseline con macrobloques I_PCM (sin compresión, válido para cualquier decodificador) dentro de
 * MPEG-TS. Sirve para probar la reproducción en vivo (TS por HTTP, HLS) y bajo demanda en el navegador.
 *
 * Imagen 256x144 (16x9 macrobloques) con barras de color, un cuadro que se mueve, el nombre del canal
 * y un contador de tiempo.
 */
const { FONT, textKey } = require('../../scripts/lib/draw');

const WIDTH = 256;
const HEIGHT = 144;
const MB_W = WIDTH / 16;
const MB_H = HEIGHT / 16;
const VIDEO_PID = 0x100;
const PMT_PID = 0x1000;

/* ---------- Escritura de bits ---------- */
class BitWriter {
  constructor() { this.bytes = []; this.cur = 0; this.n = 0; }
  bit(b) {
    this.cur = (this.cur << 1) | (b & 1);
    this.n++;
    if (this.n === 8) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; }
  }
  u(bits, value) { for (let i = bits - 1; i >= 0; i--) this.bit((value >>> i) & 1); }
  ue(v) {
    const x = v + 1;
    const len = Math.floor(Math.log2(x));
    this.u(len, 0);
    this.u(len + 1, x);
  }
  se(v) { this.ue(v <= 0 ? -2 * v : 2 * v - 1); }
  align() { while (this.n) this.bit(0); }
  trailing() { this.bit(1); this.align(); }
  raw(buf) {
    if (this.n) throw new Error('raw sin alinear');
    for (let i = 0; i < buf.length; i++) this.bytes.push(buf[i]);
  }
}

/* Bytes de prevención de emulación (00 00 0x → 00 00 03 0x) */
function escape(rbsp) {
  const out = [];
  let zeros = 0;
  for (const b of rbsp) {
    if (zeros >= 2 && b <= 3) { out.push(3); zeros = 0; }
    out.push(b);
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return out;
}

function nal(header, bw) {
  return Buffer.from([0, 0, 0, 1, header, ...escape(bw.bytes)]);
}

function spsNal(fps) {
  const w = new BitWriter();
  w.u(8, 66); /* Baseline */
  w.u(8, 0xc0); /* constraint_set0/1: Constrained Baseline */
  w.u(8, 30); /* nivel 3.0 */
  w.ue(0); /* seq_parameter_set_id */
  w.ue(0); /* log2_max_frame_num_minus4 */
  w.ue(2); /* pic_order_cnt_type */
  w.ue(1); /* max_num_ref_frames */
  w.u(1, 0); /* gaps_in_frame_num_value_allowed_flag */
  w.ue(MB_W - 1);
  w.ue(MB_H - 1);
  w.u(1, 1); /* frame_mbs_only_flag */
  w.u(1, 1); /* direct_8x8_inference_flag */
  w.u(1, 0); /* frame_cropping_flag */
  w.u(1, 1); /* vui_parameters_present_flag */
  w.u(1, 0); w.u(1, 0); w.u(1, 0); w.u(1, 0); /* aspect, overscan, video_signal, chroma_loc */
  w.u(1, 1); /* timing_info_present_flag */
  w.u(32, 1); /* num_units_in_tick */
  w.u(32, fps * 2); /* time_scale */
  w.u(1, 1); /* fixed_frame_rate_flag */
  w.u(1, 0); w.u(1, 0); w.u(1, 0); w.u(1, 0); /* nal_hrd, vcl_hrd, pic_struct, bitstream_restriction */
  w.trailing();
  return nal(0x67, w);
}

function ppsNal() {
  const w = new BitWriter();
  w.ue(0); w.ue(0);
  w.u(1, 0); /* CAVLC */
  w.u(1, 0);
  w.ue(0); /* num_slice_groups_minus1 */
  w.ue(0); w.ue(0);
  w.u(1, 0); w.u(2, 0);
  w.se(0); w.se(0); w.se(0);
  w.u(1, 1); /* deblocking_filter_control_present_flag */
  w.u(1, 0); w.u(1, 0);
  w.trailing();
  return nal(0x68, w);
}

const AUD = Buffer.from([0, 0, 0, 1, 0x09, 0x10]);

/* Cuadro IDR con todos los macrobloques I_PCM. yuv: {y: Uint8Array(W*H), u, v: Uint8Array(W/2*H/2)} */
function idrNal(yuv, idrId) {
  const w = new BitWriter();
  w.ue(0); /* first_mb_in_slice */
  w.ue(7); /* slice_type I */
  w.ue(0); /* pps id */
  w.u(4, 0); /* frame_num */
  w.ue(idrId & 0xffff);
  w.u(1, 0); w.u(1, 0); /* dec_ref_pic_marking: no_output_of_prior_pics, long_term_reference */
  w.se(0); /* slice_qp_delta */
  w.ue(1); /* disable_deblocking_filter_idc */
  const mb = Buffer.alloc(384);
  const cw = WIDTH / 2;
  for (let my = 0; my < MB_H; my++) {
    for (let mx = 0; mx < MB_W; mx++) {
      w.ue(25); /* I_PCM */
      w.align();
      let k = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) mb[k++] = yuv.y[(my * 16 + y) * WIDTH + mx * 16 + x];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) mb[k++] = yuv.u[(my * 8 + y) * cw + mx * 8 + x];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) mb[k++] = yuv.v[(my * 8 + y) * cw + mx * 8 + x];
      w.raw(mb);
    }
  }
  w.trailing();
  return nal(0x65, w);
}

/* ---------- Imagen de prueba ---------- */
const BARS = [[235, 235, 235], [235, 235, 16], [16, 235, 235], [16, 235, 16], [235, 16, 235], [235, 16, 16], [16, 16, 235]];

function toYuv(r, g, b) {
  return [
    16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255,
    128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255,
    128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255,
  ];
}

function drawTextRgb(rgb, text, x0, y0, cell, color) {
  const t = textKey(text);
  for (let i = 0; i < t.length; i++) {
    const g = FONT[t[i]];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row][col] !== '#') continue;
        for (let dy = 0; dy < cell; dy++) {
          for (let dx = 0; dx < cell; dx++) {
            const x = x0 + (i * 6 + col) * cell + dx, y = y0 + row * cell + dy;
            if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) continue;
            const o = (y * WIDTH + x) * 3;
            rgb[o] = color[0]; rgb[o + 1] = color[1]; rgb[o + 2] = color[2];
          }
        }
      }
    }
  }
}

function renderFrame(index, fps, label, hue) {
  const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
  const barH = 96;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const o = (y * WIDTH + x) * 3;
      let c;
      if (y < barH) c = BARS[Math.floor(x * 7 / WIDTH)];
      else c = hue;
      rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
    }
  }
  /* Cuadro que se mueve (se nota si el vídeo avanza) */
  const bx = (index * 4) % (WIDTH - 24), by = 36;
  for (let y = by; y < by + 24; y++) for (let x = bx; x < bx + 24; x++) {
    const o = (y * WIDTH + x) * 3;
    rgb[o] = 20; rgb[o + 1] = 20; rgb[o + 2] = 20;
  }
  drawTextRgb(rgb, label, 6, barH + 6, 2, [240, 240, 240]);
  const secs = Math.floor(index / fps);
  const clock = `${String(Math.floor(secs / 60)).padStart(2, '0')}.${String(secs % 60).padStart(2, '0')}.${index % fps}`;
  drawTextRgb(rgb, clock, 6, barH + 26, 2, [255, 230, 80]);

  const Y = new Uint8Array(WIDTH * HEIGHT);
  const U = new Uint8Array((WIDTH / 2) * (HEIGHT / 2));
  const V = new Uint8Array((WIDTH / 2) * (HEIGHT / 2));
  const cb = new Float32Array(WIDTH * HEIGHT), cr = new Float32Array(WIDTH * HEIGHT);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const [yy, u, v] = toYuv(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    Y[i] = Math.max(16, Math.min(235, Math.round(yy)));
    cb[i] = u; cr[i] = v;
  }
  for (let y = 0; y < HEIGHT / 2; y++) {
    for (let x = 0; x < WIDTH / 2; x++) {
      const a = (y * 2) * WIDTH + x * 2;
      const idx = y * (WIDTH / 2) + x;
      U[idx] = Math.max(16, Math.min(240, Math.round((cb[a] + cb[a + 1] + cb[a + WIDTH] + cb[a + WIDTH + 1]) / 4)));
      V[idx] = Math.max(16, Math.min(240, Math.round((cr[a] + cr[a + 1] + cr[a + WIDTH] + cr[a + WIDTH + 1]) / 4)));
    }
  }
  return { y: Y, u: U, v: V };
}

/* ---------- MPEG-TS ---------- */
function crc32mpeg(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b << 24;
    for (let i = 0; i < 8; i++) crc = (crc & 0x80000000) ? ((crc << 1) ^ 0x04c11db7) : (crc << 1);
    crc >>>= 0;
  }
  return crc >>> 0;
}

function withCrc(section) {
  const c = crc32mpeg(section);
  return [...section, (c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff];
}

function patSection() {
  return withCrc([0x00, 0xb0, 13, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe0 | (PMT_PID >> 8), PMT_PID & 0xff]);
}

function pmtSection() {
  return withCrc([0x02, 0xb0, 18, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xe0 | (VIDEO_PID >> 8), VIDEO_PID & 0xff, 0xf0, 0x00,
    0x1b, 0xe0 | (VIDEO_PID >> 8), VIDEO_PID & 0xff, 0xf0, 0x00]);
}

class TsMuxer {
  constructor() { this.cc = {}; }

  counter(pid) {
    const v = this.cc[pid] || 0;
    this.cc[pid] = (v + 1) & 0x0f;
    return v;
  }

  psi(pid, section) {
    const p = Buffer.alloc(188, 0xff);
    p[0] = 0x47;
    p[1] = 0x40 | (pid >> 8);
    p[2] = pid & 0xff;
    p[3] = 0x10 | this.counter(pid);
    p[4] = 0;
    Buffer.from(section).copy(p, 5);
    return p;
  }

  pes(pid, payload, ptsValue, pcrValue) {
    const hi = Math.floor(ptsValue / 1073741824) & 7;
    const lo = ptsValue % 1073741824;
    const header = Buffer.from([
      0, 0, 1, 0xe0, 0, 0, 0x84, 0x80, 5,
      0x20 | (hi << 1) | 1, (lo >> 22) & 0xff, ((lo >> 14) & 0xfe) | 1, (lo >> 7) & 0xff, ((lo << 1) & 0xfe) | 1,
    ]);
    const len = header.length - 6 + payload.length;
    if (len <= 0xffff) header.writeUInt16BE(len, 4);
    const data = Buffer.concat([header, payload]);
    const packets = [];
    let pos = 0;
    let first = true;
    while (pos < data.length) {
      const p = Buffer.alloc(188, 0xff);
      p[0] = 0x47;
      p[1] = (first ? 0x40 : 0) | (pid >> 8);
      p[2] = pid & 0xff;
      let af = null;
      if (first && pcrValue !== null) {
        const b = Math.floor(pcrValue);
        af = [0x50, Math.floor(b / 33554432) & 0xff, Math.floor(b / 131072) & 0xff, Math.floor(b / 512) & 0xff,
          Math.floor(b / 2) & 0xff, ((b % 2) << 7) | 0x7e, 0x00];
      }
      let room = 184 - (af ? af.length + 1 : 0);
      const left = data.length - pos;
      if (left < room) {
        /* Relleno en el campo de adaptación */
        const need = room - left;
        if (!af) {
          af = need === 1 ? [] : [0x00];
          while (af.length < need - 1) af.push(0xff);
        } else {
          for (let i = 0; i < need; i++) af.push(0xff);
        }
        room = left;
      }
      let o = 4;
      if (af) {
        p[3] = 0x30 | this.counter(pid);
        p[4] = af.length;
        Buffer.from(af).copy(p, 5);
        o = 5 + af.length;
      } else {
        p[3] = 0x10 | this.counter(pid);
      }
      data.copy(p, o, pos, pos + room);
      pos += room;
      first = false;
      packets.push(p);
    }
    return Buffer.concat(packets);
  }
}

/*
 * Genera `count` cuadros desde `start` como MPEG-TS.
 * opts: {fps (10), label, hue: [r,g,b], muxer (para continuidad entre llamadas), baseSeconds}
 */
function makeTs(start, count, opts = {}) {
  const fps = opts.fps || 10;
  const mux = opts.muxer || new TsMuxer();
  const sps = spsNal(fps), pps = ppsNal();
  const parts = [];
  for (let i = start; i < start + count; i++) {
    const yuv = renderFrame(i, fps, opts.label || 'CANAL DE PRUEBA', opts.hue || [30, 40, 90]);
    const frame = Buffer.concat([AUD, sps, pps, idrNal(yuv, i)]);
    const pts = Math.round(((opts.baseSeconds || 2) + i / fps) * 90000);
    parts.push(mux.psi(0, patSection()), mux.psi(PMT_PID, pmtSection()), mux.pes(VIDEO_PID, frame, pts, pts - 9000));
  }
  return Buffer.concat(parts);
}

module.exports = { makeTs, TsMuxer, WIDTH, HEIGHT, crc32mpeg, escape, BitWriter };
