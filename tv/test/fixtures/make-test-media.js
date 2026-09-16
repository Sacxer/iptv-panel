'use strict';
/*
 * npm run test-media — escribe vídeos de prueba en tv/test/media/ (no se suben a GitHub):
 *   prueba-10s.ts   MPEG-TS H.264 de 10 s (256x144, 10 cuadros/s)
 *   prueba-hls/     HLS de 20 s en segmentos de 2 s
 * Sirven para probar la reproducción con un servidor cualquiera. Para vídeo en vivo use demo-source.js.
 */
const fs = require('fs');
const path = require('path');
const { makeTs } = require('./h264ts');

const OUT = path.resolve(__dirname, '..', 'media');
fs.mkdirSync(path.join(OUT, 'prueba-hls'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'prueba-10s.ts'), makeTs(0, 100, { label: 'PRUEBA 10 S' }));
const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2', '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
for (let n = 0; n < 10; n++) {
  fs.writeFileSync(path.join(OUT, 'prueba-hls', `seg${n}.ts`), makeTs(n * 20, 20, { label: 'PRUEBA HLS' }));
  lines.push('#EXTINF:2.0,', `seg${n}.ts`);
}
lines.push('#EXT-X-ENDLIST');
fs.writeFileSync(path.join(OUT, 'prueba-hls', 'index.m3u8'), `${lines.join('\n')}\n`);
console.log(`Vídeos de prueba en ${OUT}`);
