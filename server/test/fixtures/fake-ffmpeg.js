// FFmpeg simulado para pruebas: emite paquetes MPEG-TS (188 bytes, byte de sincronía 0x47) por stdout
// y, si se pide salida HLS (tee), escribe index.m3u8 y segmentos en la carpeta indicada.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('-version')) {
  console.log('ffmpeg version 7.0-simulado Copyright (c)');
  process.exit(0);
}
if (args.includes('-encoders')) {
  console.log(' V....D libx264              libx264 H.264\n V....D h264_nvenc           NVIDIA NVENC');
  process.exit(0);
}

const source = args[args.indexOf('-i') + 1] || '';
if (source.includes('falla')) {
  process.stderr.write(`${source}: Server returned 404 Not Found\n`);
  process.exit(1);
}

const packet = Buffer.alloc(188, 0xff);
packet[0] = 0x47;
const chunk = Buffer.concat(Array.from({ length: 50 }, () => packet));

let hlsDir = null;
const tee = args.indexOf('tee');
if (tee !== -1) {
  const spec = args[tee + 1];
  const index = spec.split(']').pop();
  hlsDir = path.dirname(index);
  fs.mkdirSync(hlsDir, { recursive: true });
}
let seg = 0;
const timer = setInterval(() => {
  process.stdout.write(chunk);
  if (hlsDir && seg < 3) {
    fs.writeFileSync(path.join(hlsDir, `seg_0000${seg}.ts`), chunk);
    seg++;
    const list = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:4'];
    for (let i = 0; i < seg; i++) list.push('#EXTINF:4.0,', `seg_0000${i}.ts`);
    fs.writeFileSync(path.join(hlsDir, 'index.m3u8'), `${list.join('\n')}\n`);
  }
}, 50);
process.on('SIGTERM', () => {
  clearInterval(timer);
  process.exit(0);
});
