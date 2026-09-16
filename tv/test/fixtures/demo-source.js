'use strict';
/*
 * Fuentes de vídeo de prueba y un "XtreamUI" simulado, solo para probar la app en el navegador.
 *
 *   node test/fixtures/demo-source.js [--port 8097] [--xtream-port 8098] [--live-target http://…]
 *
 * Medios (puerto --port, con CORS abierto):
 *   /live/<nombre>.ts            MPEG-TS continuo en tiempo real (10 cuadros/s)
 *   /hls/<nombre>/index.m3u8     HLS en vivo (ventana de 3 segmentos de 2 s)
 *   /vod/<nombre>.m3u8           HLS bajo demanda de 90 s (con EXT-X-ENDLIST)
 *   /vod/<nombre>.ts             MPEG-TS bajo demanda de 30 s
 *
 * XtreamUI simulado (puerto --xtream-port): /player_api.php con usuario "zz-prueba-xui" / "clave123",
 * 2 canales y 1 película; /live|movie/… redirige a los medios. No tiene /api/client/* (no es el portal).
 */
const http = require('http');
const { makeTs, TsMuxer } = require('./h264ts');

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const PORT = Number(arg('--port', 8097));
const XPORT = Number(arg('--xtream-port', 8098));
const HOST = arg('--host', '127.0.0.1');
const FPS = 10;
const SEG = 2;
const started = Date.now();

const HUES = [[30, 40, 90], [90, 30, 40], [30, 80, 40], [80, 60, 20]];
function channelStyle(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { label: name.replace(/[-_]/g, ' ').toUpperCase().slice(0, 20), hue: HUES[h % HUES.length] };
}

const cache = new Map();
function cached(key, make) {
  if (cache.has(key)) return cache.get(key);
  const v = make();
  cache.set(key, v);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return v;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
}

function sendRange(req, res, buf, type) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', type);
  if (!m) {
    res.setHeader('Content-Length', buf.length);
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : buf);
    return;
  }
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
  res.setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
  res.setHeader('Content-Length', end - start + 1);
  res.writeHead(206);
  res.end(req.method === 'HEAD' ? undefined : buf.subarray(start, end + 1));
}

function liveTs(req, res, name) {
  const style = channelStyle(name);
  const mux = new TsMuxer();
  let frame = Math.floor((Date.now() - started) / 1000 * FPS);
  const base = frame;
  res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store' });
  /* Un segundo por adelantado para que el reproductor arranque rápido */
  res.write(makeTs(frame, FPS, { ...style, muxer: mux, fps: FPS }));
  frame += FPS;
  const t0 = Date.now();
  const timer = setInterval(() => {
    const due = base + FPS + Math.floor((Date.now() - t0) / 1000 * FPS);
    if (due > frame) {
      const ok = res.write(makeTs(frame, due - frame, { ...style, muxer: mux, fps: FPS }));
      frame = due;
      if (!ok) { /* cliente lento: se espera */ }
    }
  }, 100);
  req.on('close', () => clearInterval(timer));
}

function hlsLive(res, name) {
  const now = Math.floor((Date.now() - started) / 1000 / SEG);
  const first = Math.max(0, now - 3);
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${SEG}`, `#EXT-X-MEDIA-SEQUENCE:${first}`];
  for (let n = first; n < now; n++) lines.push(`#EXTINF:${SEG}.0,`, `seg${n}.ts`);
  if (now === 0) lines.push(`#EXTINF:${SEG}.0,`, 'seg0.ts');
  res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
  res.end(`${lines.join('\n')}\n`);
}

function segment(name, n) {
  return cached(`${name}#${n}`, () => makeTs(n * SEG * FPS, SEG * FPS, { ...channelStyle(name), fps: FPS }));
}

function hlsVod(res, name) {
  const total = 45;
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${SEG}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
  for (let n = 0; n < total; n++) lines.push(`#EXTINF:${SEG}.0,`, `/hls/${name}/seg${n}.ts`);
  lines.push('#EXT-X-ENDLIST');
  res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
  res.end(`${lines.join('\n')}\n`);
}

const media = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://x');
  let m;
  if ((m = /^\/live\/([\w-]+)\.ts$/.exec(url.pathname))) return liveTs(req, res, m[1]);
  if ((m = /^\/hls\/([\w-]+)\/index\.m3u8$/.exec(url.pathname))) return hlsLive(res, m[1]);
  if ((m = /^\/hls\/([\w-]+)\/seg(\d+)\.ts$/.exec(url.pathname))) {
    return sendRange(req, res, segment(m[1], Number(m[2])), 'video/mp2t');
  }
  if ((m = /^\/vod\/([\w-]+)\.m3u8$/.exec(url.pathname))) return hlsVod(res, m[1]);
  if ((m = /^\/vod\/([\w-]+)\.ts$/.exec(url.pathname))) {
    const buf = cached(`vod:${m[1]}`, () => makeTs(0, 30 * FPS, { ...channelStyle(m[1]), fps: FPS }));
    return sendRange(req, res, buf, 'video/mp2t');
  }
  if (url.pathname === '/health') { res.end('ok'); return; }
  res.writeHead(404);
  res.end('No encontrado');
});

/* ---------- XtreamUI simulado ---------- */
const XUSER = 'zz-prueba-xui';
const XPASS = 'clave123';
const MEDIA = `http://${HOST}:${PORT}`;
const XSTREAMS = [
  { num: 1, name: 'zz-prueba XUI Uno', stream_type: 'live', stream_id: 501, stream_icon: '', epg_channel_id: '', category_id: '10', src: `${MEDIA}/hls/xui-uno/index.m3u8` },
  { num: 2, name: 'zz-prueba XUI Dos', stream_type: 'live', stream_id: 502, stream_icon: '', epg_channel_id: '', category_id: '10', src: `${MEDIA}/hls/xui-dos/index.m3u8` },
];

const xtream = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://x');
  const q = url.searchParams;
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/player_api.php') {
    if (q.get('username') !== XUSER || q.get('password') !== XPASS) return json(200, { user_info: { auth: 0 } });
    const action = q.get('action') || '';
    if (!action) {
      return json(200, {
        user_info: { username: XUSER, password: XPASS, message: '', auth: 1, status: 'Active', exp_date: null, is_trial: '0', active_cons: '0', max_connections: '1', allowed_output_formats: ['m3u8', 'ts'] },
        server_info: { url: HOST, port: String(XPORT), server_protocol: 'http', timezone: 'America/Bogota', timestamp_now: Math.floor(Date.now() / 1000) },
      });
    }
    if (action === 'get_live_categories') return json(200, [{ category_id: '10', category_name: 'zz-prueba XUI', parent_id: 0 }]);
    if (action === 'get_live_streams') return json(200, XSTREAMS.map(({ src, ...s }) => s));
    if (action === 'get_vod_categories') return json(200, [{ category_id: '20', category_name: 'zz-prueba Cine XUI', parent_id: 0 }]);
    if (action === 'get_vod_streams') return json(200, [{ num: 1, name: 'zz-prueba Película XUI', stream_type: 'movie', stream_id: 601, stream_icon: '', rating: '7', added: '1700000000', category_id: '20', container_extension: 'm3u8' }]);
    if (action === 'get_vod_info') return json(200, { info: { plot: 'Película de prueba del XtreamUI simulado.', duration: '00:01:30' }, movie_data: { stream_id: 601, container_extension: 'm3u8' } });
    if (action === 'get_series_categories' || action === 'get_series') return json(200, []);
    if (action === 'get_short_epg') return json(200, { epg_listings: [] });
    return json(200, []);
  }
  let m;
  if ((m = /^\/live\/([^/]+)\/([^/]+)\/(\d+)\.(ts|m3u8)$/.exec(url.pathname))) {
    const s = XSTREAMS.find((x) => String(x.stream_id) === m[3]);
    if (!s || m[1] !== XUSER || m[2] !== XPASS) { res.writeHead(403); res.end(); return; }
    const target = m[4] === 'ts' ? s.src.replace('/hls/', '/live/').replace('/index.m3u8', '.ts') : s.src;
    res.writeHead(302, { Location: target });
    res.end();
    return;
  }
  if ((m = /^\/movie\/([^/]+)\/([^/]+)\/601\.\w+$/.exec(url.pathname))) {
    res.writeHead(302, { Location: `${MEDIA}/vod/xui-peli.m3u8` });
    res.end();
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end('<html><body>404</body></html>');
});

media.listen(PORT, HOST, () => console.log(`Medios de prueba: ${MEDIA}  (live/<n>.ts · hls/<n>/index.m3u8 · vod/<n>.m3u8 · vod/<n>.ts)`));
if (XPORT) xtream.listen(XPORT, HOST, () => console.log(`XtreamUI simulado: http://${HOST}:${XPORT}  usuario ${XUSER} / ${XPASS}`));
