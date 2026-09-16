#!/usr/bin/env node
// Nodo de streaming del portal IPTV.
//
// Se instala en cada servidor que reenvía o transcodifica canales. Una sola conexión a la fuente por canal
// se reparte entre todos los clientes conectados a este nodo (MPEG-TS y HLS). El portal le indica qué canales
// mantener siempre encendidos y qué sesiones cortar; el nodo le informa estado, carga y clientes.
//
// Variables (en /etc/iptv-node.env o en el entorno):
//   MAIN_URL      URL del portal, p. ej. https://tv.midominio.com
//   NODE_TOKEN    token del servidor (se ve en el portal → Servidores)
//   PORT          puerto HTTP del nodo (por defecto 8090)
//   FFMPEG_PATH   ruta a ffmpeg (por defecto "ffmpeg")
//   HLS_DIR       carpeta temporal para HLS (por defecto <tmp>/iptv-node-hls)
//   IDLE_SECONDS  segundos sin clientes antes de apagar un canal bajo demanda (por defecto 30)
//   STATE_FILE    dónde guardar las direcciones conocidas del portal (por defecto junto a este archivo)
//
// Si el portal cambia de IP, el nodo prueba las demás direcciones que el portal le informó y lo busca en la
// red local (UDP 25460), reconociéndolo por su identificador. Lo hace al arrancar y cada vez que pierde contacto.
import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.1.0';

for (const file of ['/etc/iptv-node.env', path.join(path.dirname(fileURLToPath(import.meta.url)), '.env')]) {
  try {
    if (fs.existsSync(file)) process.loadEnvFile(file);
  } catch {
    // archivo no legible: se ignora
  }
}

const config = {
  mainUrl: (process.env.MAIN_URL || '').replace(/\/+$/, ''),
  token: process.env.NODE_TOKEN || '',
  port: Number(process.env.PORT || 8090),
  host: process.env.HOST || '0.0.0.0',
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  hlsDir: process.env.HLS_DIR || path.join(os.tmpdir(), 'iptv-node-hls'),
  idleSeconds: Number(process.env.IDLE_SECONDS || 30),
  heartbeatSeconds: Number(process.env.HEARTBEAT_SECONDS || 10),
  stateFile: process.env.STATE_FILE || '',
  discoveryPort: Number(process.env.DISCOVERY_PORT || 25460),
};

const now = () => Math.floor(Date.now() / 1000);

/** Permite usar un script .js como "ffmpeg" (pruebas): se ejecuta con el mismo Node. */
function ffmpegCommand(ffmpegPath, args) {
  return /\.m?js$/i.test(ffmpegPath) ? [process.execPath, [ffmpegPath, ...args]] : [ffmpegPath, args];
}
const log = (...args) => console.log(new Date().toISOString(), ...args);

/* ------------------------------ Conexión con el portal ------------------------------ */

const isNetworkError = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.name === 'TypeError' || Boolean(err?.cause?.code);

/**
 * Dirección del portal con respaldo: la actual, la de MAIN_URL, las que informó el portal y 127.0.0.1;
 * si ninguna responde, lo busca en la red local. Solo acepta un portal con el mismo identificador.
 */
export class PortalLink {
  constructor({ mainUrl, stateFile = '', discoveryPort = 25460, discoveryTargets = null } = {}) {
    this.primary = String(mainUrl || '').replace(/\/+$/, '');
    this.current = this.primary;
    this.known = [];
    this.id = null;
    this.stateFile = stateFile;
    this.discoveryPort = discoveryPort;
    this.discoveryTargets = discoveryTargets;
    this.lastSearch = 0;
    this.searching = null;
    this.load();
  }

  load() {
    if (!this.stateFile) return;
    try {
      const st = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (st.current) this.current = st.current;
      this.known = Array.isArray(st.known) ? st.known : [];
      this.id = st.id || null;
    } catch { /* primera vez */ }
  }

  save() {
    if (!this.stateFile) return;
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify({ current: this.current, known: this.known, id: this.id }, null, 2));
    } catch (err) {
      log('No se pudo guardar el estado del nodo:', err.message);
    }
  }

  /** Datos que el portal devuelve en cada latido: { id, urls }. */
  update(portal) {
    if (!portal?.id) return;
    const urls = (portal.urls || []).map((u) => String(u).replace(/\/+$/, '')).filter((u) => /^https?:\/\//.test(u)).slice(0, 30);
    const changed = portal.id !== this.id || JSON.stringify(urls) !== JSON.stringify(this.known);
    this.id = portal.id;
    this.known = urls;
    if (changed) this.save();
  }

  candidates() {
    const out = [];
    const add = (u) => { if (u && !out.includes(u)) out.push(u); };
    add(this.current);
    add(this.primary);
    for (const u of this.known) add(u);
    const port = (/:(\d+)$/.exec(this.primary) || [])[1];
    if (port) add(`http://127.0.0.1:${port}`); // portal en la misma máquina
    return out;
  }

  async ping(base) {
    try {
      const res = await fetch(`${base}/api/client/ping`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.portal && data.type !== 'iptv-portal') return null;
      if (this.id && data.id !== this.id) return null; // otro portal: no es el nuestro
      return data;
    } catch {
      return null;
    }
  }

  /** Busca el portal por difusión UDP en la red local. */
  discover(waitMs = 2500) {
    return new Promise((resolve) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const found = [];
      const finish = () => {
        try { socket.close(); } catch { /* cerrado */ }
        resolve(found);
      };
      socket.on('error', finish);
      socket.on('message', (msg) => {
        try {
          const info = JSON.parse(msg.toString('utf8'));
          if (info.type === 'iptv-portal' && info.url && (!this.id || info.id === this.id)) found.push(info);
        } catch { /* respuesta ajena */ }
      });
      socket.bind(0, () => {
        try { socket.setBroadcast(true); } catch { /* sin difusión */ }
        const targets = this.discoveryTargets || ['255.255.255.255', ...broadcastAddresses()];
        const payload = Buffer.from('IPTV-DISCOVER v1');
        for (const t of targets) socket.send(payload, this.discoveryPort, t, () => {});
        setTimeout(finish, waitMs);
      });
    });
  }

  /** Encuentra una dirección que responda (máximo una búsqueda cada 20 s). Devuelve true si cambió. */
  async relocate() {
    if (this.searching) return this.searching;
    if (Date.now() - this.lastSearch < 20_000) return false;
    this.lastSearch = Date.now();
    this.searching = (async () => {
      for (const base of this.candidates()) {
        if (base === this.current) continue;
        if (await this.ping(base)) return this.use(base, 'dirección conocida');
      }
      if (this.id) {
        for (const info of await this.discover()) {
          const urls = [info.url, ...(info.public_url ? [info.public_url] : [])];
          for (const base of urls) {
            if (await this.ping(base)) return this.use(base, 'red local');
          }
        }
      }
      return false;
    })();
    try {
      return await this.searching;
    } finally {
      this.searching = null;
    }
  }

  use(base, how) {
    log(`Portal encontrado en ${base} (${how}); antes ${this.current}`);
    this.current = base;
    this.save();
    return true;
  }

  /** fetch al portal; si falla la red, busca otra dirección y reintenta una vez. */
  async request(pathname, init = {}) {
    try {
      return await fetch(`${this.current}${pathname}`, { ...init, signal: init.timeout ? AbortSignal.timeout(init.timeout) : undefined });
    } catch (err) {
      if (!isNetworkError(err) || !(await this.relocate())) throw err;
      return fetch(`${this.current}${pathname}`, { ...init, signal: init.timeout ? AbortSignal.timeout(init.timeout) : undefined });
    }
  }
}

function broadcastAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.internal || (a.family !== 'IPv4' && a.family !== 4) || !a.netmask) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.push(ip.map((b, i) => (b | (~mask[i] & 255))).join('.'));
    }
  }
  return [...new Set(out)];
}

/* --------------------------------- Tokens firmados --------------------------------- */

export function verifyToken(token, secret) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (expected.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.e && payload.e < now() ? null : payload;
  } catch {
    return null;
  }
}

/* ------------------------------ Argumentos de FFmpeg ------------------------------ */

const splitArgs = (s) => (String(s || '').match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ''));

export function buildFfmpegArgs(stream, source, { hlsDir = null } = {}) {
  const p = stream.mode === 'transcode' ? stream.profile : null;
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (/^https?:/i.test(source)) {
    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-rw_timeout', '15000000');
  }
  args.push('-fflags', '+genpts+discardcorrupt', '-analyzeduration', '3000000', '-probesize', '5000000');
  if (p?.hw === 'nvenc') args.push('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda');
  if (p?.hw === 'qsv') args.push('-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv');
  if (p?.hw === 'vaapi') args.push('-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi', '-vaapi_device', '/dev/dri/renderD128');
  args.push('-i', source, '-map', '0:v:0?', '-map', '0:a?');

  if (!p) {
    args.push('-c', 'copy');
  } else {
    const height = /^\d+$/.test(String(p.resolution)) ? Number(p.resolution) : null;
    const filters = [];
    const hw = p.hw || 'cpu';
    if (p.deinterlace) filters.push({ cpu: 'yadif', nvenc: 'yadif_cuda', qsv: 'vpp_qsv=deinterlace=2', vaapi: 'deinterlace_vaapi' }[hw]);
    if (height) {
      filters.push({
        cpu: `scale=-2:${height}`, nvenc: `scale_cuda=-2:${height}`, qsv: `scale_qsv=w=-1:h=${height}`, vaapi: `scale_vaapi=w=-2:h=${height}`,
      }[hw]);
    }
    if (filters.length) args.push('-vf', filters.join(','));
    const hevc = p.video_codec === 'hevc';
    const encoder = {
      cpu: hevc ? 'libx265' : 'libx264',
      nvenc: hevc ? 'hevc_nvenc' : 'h264_nvenc',
      qsv: hevc ? 'hevc_qsv' : 'h264_qsv',
      vaapi: hevc ? 'hevc_vaapi' : 'h264_vaapi',
    }[hw];
    args.push('-c:v', encoder);
    const preset = p.preset || { cpu: 'veryfast', nvenc: 'p4', qsv: 'veryfast', vaapi: '' }[hw];
    if (preset) args.push('-preset', preset);
    const bitrate = Number(p.video_bitrate_kbps) || 3000;
    const maxrate = Number(p.max_bitrate_kbps) || Math.round(bitrate * 1.2);
    args.push('-b:v', `${bitrate}k`, '-maxrate', `${maxrate}k`, '-bufsize', `${maxrate * 2}k`, '-g', String(Number(p.gop) || 50));
    if (hw === 'cpu') args.push('-pix_fmt', 'yuv420p');
    if (p.fps) args.push('-r', String(p.fps));
    if (p.audio_codec === 'copy') {
      args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', 'aac', '-b:a', `${Number(p.audio_bitrate_kbps) || 128}k`);
      if (p.audio_channels) args.push('-ac', String(p.audio_channels));
    }
    args.push(...splitArgs(p.extra_args));
  }

  if (hlsDir) {
    const seg = path.join(hlsDir, 'seg_%05d.ts');
    const index = path.join(hlsDir, 'index.m3u8');
    args.push('-f', 'tee', `[f=mpegts]pipe:1|[f=hls:hls_time=4:hls_list_size=6:hls_flags=delete_segments+omit_endlist:hls_segment_filename=${seg}]${index}`);
  } else {
    args.push('-f', 'mpegts', '-mpegts_flags', '+resend_headers', 'pipe:1');
  }
  return args;
}

/* ------------------------------------ Canales ------------------------------------ */

const TS_PACKET = 188;
const BUFFER_BYTES = 2 * 1024 * 1024; // arranque rápido para clientes nuevos
const MAX_BACKLOG = 8 * 1024 * 1024; // cliente demasiado lento → se corta

class Channel {
  constructor(id, manager) {
    this.id = id;
    this.manager = manager;
    this.stream = null;
    this.proc = null;
    this.state = 'idle'; // idle | starting | running | error
    this.clients = new Set();
    this.buffer = [];
    this.bufferSize = 0;
    this.remainder = Buffer.alloc(0);
    this.sourceIndex = 0;
    this.restarts = 0;
    this.lastError = null;
    this.startedAt = null;
    this.lastDataAt = 0;
    this.byteWindow = [];
    this.alwaysOn = false;
    this.hls = false;
    this.hlsTouchedAt = 0;
    this.idleTimer = null;
    this.restartTimer = null;
    this.stopping = false;
  }

  get hlsDir() {
    return path.join(this.manager.options.hlsDir, String(this.id));
  }

  async ensureConfig() {
    if (this.stream && Date.now() - this.stream.fetchedAt < 60_000) return this.stream;
    const cfg = await this.manager.fetchStreamConfig(this.id);
    if (!cfg) throw Object.assign(new Error('Canal no disponible en este servidor'), { status: 404 });
    this.stream = { ...cfg, fetchedAt: Date.now() };
    return this.stream;
  }

  async start({ hls = false } = {}) {
    if (hls && !this.hls) {
      this.hls = true;
      if (this.proc) this.restart('Activando HLS', 0);
    }
    if (this.proc || this.restartTimer) return;
    await this.ensureConfig();
    this.spawn();
  }

  spawn() {
    const sources = this.stream.sources || [];
    if (!sources.length) {
      this.state = 'error';
      this.lastError = 'Sin URL de origen';
      return;
    }
    const source = sources[this.sourceIndex % sources.length];
    if (this.hls) fs.mkdirSync(this.hlsDir, { recursive: true });
    const args = buildFfmpegArgs(this.stream, source, { hlsDir: this.hls ? this.hlsDir : null });
    this.state = 'starting';
    this.startedAt = now();
    this.lastDataAt = Date.now();
    this.stopping = false;
    const [cmd, cmdArgs] = ffmpegCommand(this.manager.options.ffmpeg, args);
    const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    proc.stdout.on('data', (chunk) => this.onData(chunk));
    proc.on('error', (err) => {
      this.lastError = err.code === 'ENOENT' ? `No se encontró FFmpeg (${this.manager.options.ffmpeg})` : err.message;
    });
    proc.on('close', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (this.stopping) {
        this.state = 'idle';
        return;
      }
      const lines = stderr.trim().split('\n').filter(Boolean);
      this.lastError = this.lastError || lines[lines.length - 1] || `FFmpeg terminó (código ${code})`;
      this.state = 'error';
      // Si falló pronto, probar la siguiente fuente de respaldo.
      if (now() - this.startedAt < 30) this.sourceIndex++;
      if (this.clients.size || this.alwaysOn || this.hlsActive()) {
        this.restart(this.lastError, Math.min(30, 2 ** Math.min(this.restarts, 5)) * 1000);
      }
    });
  }

  onData(chunk) {
    this.lastDataAt = Date.now();
    if (this.state !== 'running') {
      this.state = 'running';
      this.lastError = null;
      this.restarts = 0;
    }
    let data = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk;
    const usable = data.length - (data.length % TS_PACKET);
    this.remainder = data.subarray(usable);
    data = data.subarray(0, usable);
    if (!data.length) return;
    this.byteWindow.push({ at: Date.now(), n: data.length });
    this.buffer.push(data);
    this.bufferSize += data.length;
    while (this.bufferSize > BUFFER_BYTES && this.buffer.length > 1) this.bufferSize -= this.buffer.shift().length;
    for (const client of this.clients) {
      if (client.res.writableLength > MAX_BACKLOG) {
        client.res.destroy();
        continue;
      }
      client.res.write(data);
      client.bytes += data.length;
    }
  }

  bitrateKbps() {
    const cutoff = Date.now() - 10_000;
    this.byteWindow = this.byteWindow.filter((b) => b.at >= cutoff);
    return Math.round((this.byteWindow.reduce((s, b) => s + b.n, 0) * 8) / 10 / 1000);
  }

  hlsActive() {
    return this.hls && Date.now() - this.hlsTouchedAt < 30_000;
  }

  restart(reason, delayMs) {
    this.lastError = reason;
    this.restarts++;
    if (this.proc) {
      this.stopping = true;
      this.proc.kill('SIGKILL');
      this.proc = null;
    }
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.stream = null; // releer configuración por si cambió la fuente
      this.ensureConfig().then(() => this.spawn()).catch((err) => {
        this.state = 'error';
        this.lastError = err.message;
      });
    }, delayMs);
  }

  addClient(client) {
    clearTimeout(this.idleTimer);
    this.clients.add(client);
    for (const b of this.buffer) client.res.write(b);
  }

  removeClient(client) {
    this.clients.delete(client);
    this.scheduleIdle();
  }

  scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (this.clients.size || this.alwaysOn) return;
    this.idleTimer = setTimeout(() => {
      if (!this.clients.size && !this.alwaysOn && !this.hlsActive()) this.stop();
      else this.scheduleIdle();
    }, this.manager.options.idleSeconds * 1000);
  }

  stop() {
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.proc) {
      this.stopping = true;
      this.proc.kill('SIGTERM');
      const proc = this.proc;
      setTimeout(() => proc.exitCode === null && proc.kill('SIGKILL'), 5000).unref();
    }
    this.proc = null;
    this.state = 'idle';
    this.buffer = [];
    this.bufferSize = 0;
    this.hls = false;
    fs.rm(this.hlsDir, { recursive: true, force: true }, () => {});
    this.manager.channels.delete(this.id);
  }

  watchdog() {
    if (this.proc && this.state === 'running' && Date.now() - this.lastDataAt > 20_000) {
      this.sourceIndex++;
      this.restart('Sin datos de la fuente durante 20 s', 1000);
    }
  }

  snapshot() {
    return {
      id: this.id,
      name: this.stream?.name || null,
      mode: this.stream?.mode || null,
      state: this.state,
      uptime: this.startedAt && this.state === 'running' ? now() - this.startedAt : 0,
      bitrate_kbps: this.bitrateKbps(),
      clients: this.clients.size,
      hls: this.hls,
      always_on: this.alwaysOn,
      restarts: this.restarts,
      source_index: this.stream?.sources?.length ? this.sourceIndex % this.stream.sources.length : 0,
      last_error: this.lastError,
    };
  }
}

export class NodeManager {
  constructor(options = {}) {
    this.options = { ...config, ...options };
    this.channels = new Map();
    this.sessions = new Map(); // conn → sesión
    this.killed = new Set(); // accesos expulsados desde el portal
    this.onSessionClosed = () => {}; // se reemplaza en startNode para avisar al portal enseguida
    this.link = new PortalLink({
      mainUrl: this.options.mainUrl,
      stateFile: this.options.stateFile,
      discoveryPort: this.options.discoveryPort,
      discoveryTargets: this.options.discoveryTargets,
    });
  }

  async fetchStreamConfig(id) {
    const res = await this.link.request(`/api/node/streams/${id}`, {
      headers: { Authorization: `Bearer ${this.options.token}` },
      timeout: 10_000,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error(`Portal respondió HTTP ${res.status}`), { status: 502 });
    return res.json();
  }

  channel(id) {
    if (!this.channels.has(id)) this.channels.set(id, new Channel(id, this));
    return this.channels.get(id);
  }

  kill(connIds) {
    for (const conn of connIds) {
      this.killed.add(Number(conn));
      if (this.killed.size > 100000) this.killed.clear();
      const session = this.sessions.get(Number(conn));
      if (session) {
        session.killed = true;
        session.res?.destroy();
        this.sessions.delete(Number(conn));
      }
    }
  }

  async applyAlwaysOn(ids) {
    const wanted = new Set(ids.map(Number));
    for (const id of wanted) {
      const ch = this.channel(id);
      ch.alwaysOn = true;
      ch.start().catch((err) => {
        ch.state = 'error';
        ch.lastError = err.message;
      });
    }
    for (const ch of this.channels.values()) {
      if (ch.alwaysOn && !wanted.has(ch.id)) {
        ch.alwaysOn = false;
        ch.scheduleIdle();
      }
    }
  }

  /* ---------------------------------- HTTP ---------------------------------- */

  async handle(req, res) {
    const url = new URL(req.url, 'http://node');
    const send = (status, text) => {
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(text);
    };
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, version: VERSION, channels: this.channels.size, sessions: this.sessions.size }));
    }

    let m = /^\/live\/(\d+)\.(ts|m3u8)$/.exec(url.pathname);
    const hlsFile = /^\/hls\/(\d+)\/(seg_\d+\.ts)$/.exec(url.pathname);
    const streamId = Number((m || hlsFile || [])[1]);
    if (!streamId) return send(404, 'No encontrado');

    const payload = verifyToken(url.searchParams.get('token'), this.options.token);
    if (!payload || Number(payload.s) !== streamId) return send(403, 'Acceso no autorizado');
    const conn = Number(payload.c) || 0;
    const existing = this.sessions.get(conn);
    if (existing?.killed || (conn && this.killed.has(conn))) return send(403, 'Sesión finalizada');

    const ch = this.channel(streamId);
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');

    if (hlsFile) {
      ch.hlsTouchedAt = Date.now();
      this.touchHlsSession(conn, streamId, ip);
      const file = path.join(ch.hlsDir, hlsFile[2]);
      if (!fs.existsSync(file)) return send(404, 'Segmento no disponible');
      res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(file).pipe(res);
    }

    const ext = m[2];
    try {
      await ch.start({ hls: ext === 'm3u8' });
    } catch (err) {
      return send(err.status || 502, err.message);
    }

    if (ext === 'm3u8') {
      ch.hlsTouchedAt = Date.now();
      this.touchHlsSession(conn, streamId, ip);
      const index = path.join(ch.hlsDir, 'index.m3u8');
      for (let i = 0; i < 60 && !fs.existsSync(index); i++) await new Promise((r) => setTimeout(r, 250));
      if (!fs.existsSync(index)) return send(503, 'El canal se está iniciando, inténtalo de nuevo');
      const token = url.searchParams.get('token');
      const body = fs.readFileSync(index, 'utf8').split('\n')
        .map((line) => (line && !line.startsWith('#') ? `/hls/${streamId}/${path.basename(line.trim())}?token=${token}` : line))
        .join('\n');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' });
      return res.end(body);
    }

    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache', Connection: 'close' });
    if (req.method === 'HEAD') return res.end();
    const client = { res, bytes: 0 };
    const session = { conn, stream_id: streamId, user_id: payload.u || null, ip, started_at: now(), type: 'ts', res, client };
    if (conn) {
      this.sessions.get(conn)?.res?.destroy(); // el mismo acceso reconectando sustituye la sesión anterior
      this.sessions.set(conn, session);
    }
    ch.addClient(client);
    res.on('close', () => {
      ch.removeClient(client);
      if (this.sessions.get(conn) === session) {
        this.sessions.delete(conn);
        this.onSessionClosed();
      }
    });
    return undefined;
  }

  touchHlsSession(conn, streamId, ip) {
    if (!conn) return;
    const s = this.sessions.get(conn);
    if (s && s.type === 'hls') s.touched = Date.now();
    else this.sessions.set(conn, { conn, stream_id: streamId, ip, started_at: now(), type: 'hls', touched: Date.now() });
  }

  sweep() {
    for (const [conn, s] of this.sessions) {
      if (s.type === 'hls' && Date.now() - s.touched > 30_000) this.sessions.delete(conn);
    }
    for (const ch of this.channels.values()) {
      ch.watchdog();
      if (!ch.clients.size && !ch.alwaysOn && ch.hls && !ch.hlsActive() && ch.proc) ch.scheduleIdle();
    }
  }

  heartbeatBody(metrics, hardware, network = null) {
    return {
      version: VERSION,
      hostname: os.hostname(),
      hardware,
      metrics,
      ...(network ? { network } : {}),
      streams: [...this.channels.values()].map((c) => c.snapshot()),
      sessions: [...this.sessions.values()].map((s) => ({
        conn: s.conn, stream_id: s.stream_id, ip: s.ip, started_at: s.started_at, type: s.type, bytes: s.client?.bytes || 0,
      })),
    };
  }
}

/* ------------------------------ Métricas y hardware ------------------------------ */

let lastCpu = null;
let lastNet = null;

function cpuUsage() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  const prev = lastCpu;
  lastCpu = { idle, total };
  if (!prev || total === prev.total) return 0;
  return Math.round((1 - (idle - prev.idle) / (total - prev.total)) * 1000) / 10;
}

function netRates() {
  try {
    let rx = 0;
    let tx = 0;
    for (const line of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
      const [iface, data] = line.split(':');
      if (!data || iface.trim() === 'lo') continue;
      const cols = data.trim().split(/\s+/).map(Number);
      rx += cols[0];
      tx += cols[8];
    }
    const cur = { rx, tx, at: Date.now() };
    const prev = lastNet;
    lastNet = cur;
    if (!prev) return { rx_bps: null, tx_bps: null };
    const secs = (cur.at - prev.at) / 1000;
    return { rx_bps: Math.round(((rx - prev.rx) * 8) / secs), tx_bps: Math.round(((tx - prev.tx) * 8) / secs) };
  } catch {
    return { rx_bps: null, tx_bps: null };
  }
}

export function collectMetrics() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    cpu: cpuUsage(),
    cores: os.cpus().length,
    load_avg: os.loadavg().map((n) => Math.round(n * 100) / 100),
    mem_total: total,
    mem_percent: Math.round(((total - free) / total) * 1000) / 10,
    ...netRates(),
    uptime: Math.floor(os.uptime()),
  };
}

/* ------------------------------------ Red del nodo ------------------------------------ */

function ipScope(ip) {
  if (ip.includes(':')) {
    const l = ip.toLowerCase();
    if (l === '::1') return 'loopback';
    if (/^fe[89ab]/.test(l)) return 'link-local';
    if (/^f[cd]/.test(l)) return 'private';
    return 'public';
  }
  const [a, b] = ip.split('.').map(Number);
  if (a === 127) return 'loopback';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  if (a === 169 && b === 254) return 'link-local';
  return 'public';
}

function ifaceType(name) {
  if (/^lo$|loopback/i.test(name)) return 'loopback';
  if (/zerotier|^zt|tailscale|^wg\d|^tun\d|^tap\d|vpn|ppp/i.test(name)) return 'vpn';
  if (/docker|^veth|^br-|virbr|vethernet|virtualbox|vboxnet|^cni|flannel|^lxc/i.test(name)) return 'virtual';
  if (/wi-?fi|wlan|^wl/i.test(name)) return 'wifi';
  return 'ethernet';
}

/** Puertos de red del nodo (interfaces, IPs y cuál tiene la puerta de enlace) para que el portal elija la IP. */
export function collectNetwork(listenPort) {
  const gateways = new Map();
  try {
    for (const line of fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
      const [iface, dest, gw, , , , metric] = line.trim().split(/\s+/);
      if (dest !== '00000000' || !gw) continue;
      const ip = [gw.slice(6, 8), gw.slice(4, 6), gw.slice(2, 4), gw.slice(0, 2)].map((h) => parseInt(h, 16)).join('.');
      if (!gateways.has(iface) || Number(metric) < gateways.get(iface).metric) gateways.set(iface, { gateway: ip, metric: Number(metric) });
    }
  } catch {
    // no es Linux
  }
  const defaultIface = [...gateways.entries()].sort((a, b) => a[1].metric - b[1].metric)[0]?.[0] || null;
  const ports = Object.entries(os.networkInterfaces()).map(([name, addrs]) => {
    const read = (f) => {
      try {
        return fs.readFileSync(`/sys/class/net/${name}/${f}`, 'utf8').trim();
      } catch {
        return null;
      }
    };
    const speed = Number(read('speed'));
    let type = ifaceType(name);
    if (type === 'ethernet' && fs.existsSync(`/sys/class/net/${name}`) && !fs.existsSync(`/sys/class/net/${name}/device`)) type = 'virtual';
    if (fs.existsSync(`/sys/class/net/${name}/wireless`)) type = 'wifi';
    return {
      name,
      type,
      status: read('operstate') === 'down' ? 'down' : 'up',
      speed_mbps: speed > 0 && speed < 1_000_000 ? speed : null,
      mac: (addrs || []).find((a) => a.mac && a.mac !== '00:00:00:00:00:00')?.mac || null,
      default_route: name === defaultIface,
      gateway: gateways.get(name)?.gateway || null,
      addresses: (addrs || []).map((a) => ({
        address: a.address, family: a.family === 6 || a.family === 'IPv6' ? 'IPv6' : 'IPv4', cidr: a.cidr ? Number(a.cidr.split('/')[1]) : null, scope: ipScope(a.address),
      })),
    };
  });
  return { listen_port: listenPort, hostname: os.hostname(), ports };
}

export function detectHardware(ffmpegPath = config.ffmpeg) {
  const run = (args, cb) => {
    const [cmd, cmdArgs] = ffmpegCommand(ffmpegPath, args);
    execFile(cmd, cmdArgs, { timeout: 10_000 }, cb);
  };
  return new Promise((resolve) => {
    run(['-hide_banner', '-encoders'], (err, stdout) => {
      const encoders = err ? [] : ['libx264', 'libx265', 'h264_nvenc', 'hevc_nvenc', 'h264_qsv', 'hevc_qsv', 'h264_vaapi', 'hevc_vaapi']
        .filter((e) => new RegExp(`\\s${e}\\s`).test(stdout));
      run(['-version'], (err2, out2) => {
        resolve({
          ffmpeg: err2 ? null : (out2.split('\n')[0] || '').replace('ffmpeg version ', '').split(' ')[0],
          encoders,
          nvidia: fs.existsSync('/dev/nvidia0'),
          intel_gpu: fs.existsSync('/dev/dri/renderD128'),
          cpu_model: os.cpus()[0]?.model?.trim() || '',
          cores: os.cpus().length,
          platform: `${os.type()} ${os.release()}`,
        });
      });
    });
  });
}

/* ------------------------------------ Arranque ------------------------------------ */

export async function startNode(options = {}) {
  const manager = new NodeManager(options);
  const opts = manager.options;
  const server = http.createServer((req, res) => {
    manager.handle(req, res).catch((err) => {
      log('Error atendiendo petición:', err.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.requestTimeout = 0;
  await new Promise((resolve) => server.listen(opts.port, opts.host, resolve));

  const hardware = await detectHardware(opts.ffmpeg);
  collectMetrics();
  let failures = 0;
  let lastNetworkAt = 0;
  const heartbeat = async () => {
    try {
      // Las interfaces cambian poco: se envían al arrancar y luego cada minuto.
      const listenPort = server.address()?.port;
      const network = Date.now() - lastNetworkAt > 60_000 ? collectNetwork(listenPort) : null;
      const res = await manager.link.request('/api/node/heartbeat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(manager.heartbeatBody(collectMetrics(), hardware, network)),
        timeout: 15_000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      manager.link.update(data.portal);
      if (network) lastNetworkAt = Date.now();
      if (failures) log('Conexión con el portal restablecida');
      failures = 0;
      manager.kill(data.kill || []);
      await manager.applyAlwaysOn(data.always_on || []);
    } catch (err) {
      if (failures++ % 6 === 0) log('No se pudo contactar al portal:', err.message);
    }
  };
  const hb = setInterval(heartbeat, opts.heartbeatSeconds * 1000);
  let early = null;
  manager.onSessionClosed = () => {
    // Heartbeat anticipado (agrupado) para que el portal quite la conexión casi al instante.
    if (!early) early = setTimeout(() => { early = null; heartbeat(); }, 1000);
  };
  const sweep = setInterval(() => manager.sweep(), 5000);
  heartbeat();

  return {
    manager,
    server,
    port: server.address().port,
    async stop() {
      clearInterval(hb);
      clearInterval(sweep);
      clearTimeout(early);
      for (const ch of [...manager.channels.values()]) ch.stop();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!config.mainUrl || !config.token) {
    console.error('Faltan MAIN_URL y NODE_TOKEN (configúralos en /etc/iptv-node.env)');
    process.exit(1);
  }
  const stateFile = config.stateFile || path.join(path.dirname(fileURLToPath(import.meta.url)), 'portal.json');
  const node = await startNode({ stateFile });
  log(`Nodo IPTV ${VERSION} escuchando en ${config.host}:${node.port} · portal ${node.manager.link.current}`);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      await node.stop();
      process.exit(0);
    });
  }
}
