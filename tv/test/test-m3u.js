'use strict';
/* Pruebas del lector de listas M3U (src/js/m3u.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');

const IPTV = load(['util', 'm3u']);
const M3U = IPTV.M3U;

const SAMPLE = [
  '﻿#EXTM3U url-tvg="http://guia.example/epg.xml" x-tvg-url="http://otra/epg.xml"',
  '#EXTINF:-1 tvg-id="canal1.co" tvg-name="Canal 1" tvg-logo="http://logos/c1.png" group-title="Nacionales",Canal 1 HD',
  'http://srv:25461/live/u/p/1.ts',
  '#EXTINF:-1 tvg-id="" group-title="Deportes" tvg-chno="7",Deportes, en vivo, 24/7',
  '#EXTVLCOPT:http-user-agent=MiReproductor/1.0',
  '#EXTVLCOPT:http-referrer=http://ref/',
  'http://srv:25461/live/u/p/2.m3u8',
  '#EXTINF:0,Película buena (2020)',
  '#EXTGRP:Estrenos',
  'http://srv:25461/movie/u/p/30.mkv',
  '#EXTINF:-1 group-title="Series",Serie S01 E01',
  'http://srv:25461/series/u/p/40.mp4?token=abc',
  'http://sin-extinf/canal%20libre',
  '',
].join('\r\n');

test('lee canales, películas y series con sus atributos', () => {
  const r = M3U.parse(SAMPLE);
  assert.equal(r.epgUrl, 'http://guia.example/epg.xml');
  assert.equal(r.total, 5);
  assert.equal(r.live.length, 3);
  assert.equal(r.movie.length, 1);
  assert.equal(r.series.length, 1);

  const c1 = r.live[0];
  assert.equal(c1.name, 'Canal 1 HD');
  assert.equal(c1.logo, 'http://logos/c1.png');
  assert.equal(c1.epg, 'canal1.co');
  assert.equal(c1.cat, 'Nacionales');
  assert.equal(c1.num, 1);
  assert.equal(c1.url, 'http://srv:25461/live/u/p/1.ts');
  assert.match(c1.id, /^m[0-9a-z]+$/);

  const dep = r.live[1];
  assert.equal(dep.name, 'Deportes, en vivo, 24/7', 'el título conserva las comas');
  assert.equal(dep.num, 7, 'usa tvg-chno');
  assert.equal(dep.ua, 'MiReproductor/1.0');
  assert.equal(dep.referrer, 'http://ref/');

  const libre = r.live[2];
  assert.equal(libre.name, 'canal libre', 'sin #EXTINF el nombre sale de la URL');
  assert.equal(libre.cat, M3U.NO_GROUP);
  assert.equal(libre.ua, undefined, 'las opciones VLC no pasan a la entrada siguiente');

  const peli = r.movie[0];
  assert.equal(peli.name, 'Película buena (2020)');
  assert.equal(peli.cat, 'Estrenos', '#EXTGRP como categoría');
  assert.equal(peli.ext, 'mkv');

  assert.equal(r.series[0].ext, 'mp4');
  assert.deepEqual(r.groups.live.map((g) => [g.name, g.count]), [['Nacionales', 1], ['Deportes', 1], [M3U.NO_GROUP, 1]]);
});

test('clasifica por ruta y extensión', () => {
  assert.equal(M3U.classify('http://x/movie/u/p/1.ts'), 'movie');
  assert.equal(M3U.classify('http://x/series/u/p/1.ts'), 'series');
  assert.equal(M3U.classify('http://x/peli.MP4?x=1'), 'movie');
  assert.equal(M3U.classify('http://x/live/u/p/1.m3u8'), 'live');
  assert.equal(M3U.classify('rtmp://x/canal'), 'live');
});

test('analiza #EXTINF con comillas simples, atributos sin comillas y duración', () => {
  const r = M3U.parseExtinf("10.5 tvg-id=abc tvg-name='Nombre, con coma' group-title=\"G\",Título");
  assert.equal(r.duration, 10.5);
  assert.equal(r.attrs['tvg-id'], 'abc');
  assert.equal(r.attrs['tvg-name'], 'Nombre, con coma');
  assert.equal(r.attrs['group-title'], 'G');
  assert.equal(r.title, 'Título');
  const bad = M3U.parseExtinf('abc,Solo título');
  assert.equal(bad.duration, -1);
  assert.equal(bad.title, 'Solo título');
});

test('entradas repetidas reciben ids distintos', () => {
  const text = '#EXTM3U\n#EXTINF:-1,A\nhttp://x/1\n#EXTINF:-1,A\nhttp://x/1\n#EXTINF:-1,A\nhttp://x/1\n';
  const ids = M3U.parse(text).live.map((x) => x.id);
  assert.equal(new Set(ids).size, 3);
});

test('usa tvg-name si el título está vacío y respeta finales de línea CR', () => {
  const r = M3U.parse('#EXTM3U\r#EXTINF:-1 tvg-name="Nombre TVG",\rhttp://x/2\r');
  assert.equal(r.live.length, 1);
  assert.equal(r.live[0].name, 'Nombre TVG');
});

test('reconoce listas y rechaza otros archivos', () => {
  assert.equal(M3U.looksLikeM3U('﻿#EXTM3U\n'), true);
  assert.equal(M3U.looksLikeM3U('#EXTINF:-1,x\nhttp://a'), true);
  assert.equal(M3U.looksLikeM3U('<html>error</html>'), false);
  assert.equal(M3U.parse('').total, 0);
  assert.equal(M3U.parse(null).total, 0);
});

test('lectura por bloques da el mismo resultado e informa el avance', async () => {
  const lines = ['#EXTM3U'];
  for (let i = 0; i < 5000; i++) lines.push(`#EXTINF:-1 group-title="G${i % 7}",Canal ${i}`, `http://x/live/u/p/${i}.ts`);
  const text = lines.join('\n');
  const progress = [];
  const result = await new Promise((resolve) => {
    M3U.parseAsync(text, { linesPerChunk: 700 }, (f, n) => progress.push([f, n]), resolve);
  });
  const sync = M3U.parse(text);
  assert.equal(result.total, 5000);
  assert.deepEqual(result.live.map((x) => x.id), sync.live.map((x) => x.id));
  assert.equal(result.groups.live.length, 7);
  assert.ok(progress.length > 5, 'avanza en varios bloques');
  assert.deepEqual(progress[progress.length - 1], [1, 5000]);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i][0] >= progress[i - 1][0]);
});

test('la lectura por bloques se puede cancelar', async () => {
  const text = `#EXTM3U\n${'#EXTINF:-1,X\nhttp://x/1\n'.repeat(3000)}`;
  let done = false;
  const h = M3U.parseAsync(text, { linesPerChunk: 100 }, null, () => { done = true; });
  h.cancel();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(done, false);
});
