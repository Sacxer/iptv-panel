// Cesbo Astra simulado para probar la importación sin un Astra real.
// Uso: node scripts/mock-astra.js [puerto]   (usuario: admin / contraseña: astra)
import http from 'node:http';

const port = Number(process.argv[2] || 8000);
const groups = ['Deportes', 'Noticias', 'Infantil', 'Películas', 'Música'];
const streams = Array.from({ length: 24 }, (_, i) => {
  const n = String(i + 1).padStart(3, '0');
  const group = groups[i % groups.length];
  return {
    id: `a${n}`,
    name: `${group} ${Math.floor(i / groups.length) + 1} HD`,
    type: 'spts',
    enable: i !== 7,
    input: [i % 3 === 0 ? `dvb://sat1#pnr=${1000 + i}` : `udp://239.10.0.${i + 1}:1234`],
    output: [`http://0:8100/canal-${n}`],
    groups: { Genero: group },
  };
});

const auth = `Basic ${Buffer.from('admin:astra').toString('base64')}`;

http.createServer((req, res) => {
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== auth) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic' });
    return res.end();
  }
  if (req.method === 'POST' && req.url === '/control/') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const cmd = JSON.parse(raw || '{}').cmd;
      if (cmd !== 'load') return json(400, { error: 'comando no soportado' });
      return json(200, { make_stream: streams, categories: [{ name: 'Genero', groups: groups.map((name) => ({ name })) }] });
    });
    return undefined;
  }
  const m = /^\/api\/stream-status\/(\w+)/.exec(req.url);
  if (m) {
    const idx = streams.findIndex((s) => s.id === m[1]);
    if (idx === -1) return json(404, {});
    const onair = streams[idx].enable && idx % 6 !== 5;
    return json(200, {
      timestamp: Math.floor(Date.now() / 1000), name: streams[idx].name, input_id: 1, active: true, onair,
      sessions: idx % 4, bitrate: onair ? 3500 + idx * 100 : 0, cc_error: onair ? idx % 3 : 0, video_count: 1, audio_count: 1,
    });
  }
  if (req.url.startsWith('/play/')) {
    res.writeHead(200, { 'Content-Type': 'video/mp2t' });
    const packet = Buffer.alloc(188 * 50, 0xff);
    for (let i = 0; i < packet.length; i += 188) packet[i] = 0x47;
    const timer = setInterval(() => res.write(packet), 100);
    req.on('close', () => clearInterval(timer));
    return undefined;
  }
  return json(404, {});
}).listen(port, () => console.log(`Astra simulado en http://localhost:${port}  (admin / astra)`));
