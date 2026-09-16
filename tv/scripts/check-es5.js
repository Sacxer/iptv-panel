'use strict';
/*
 * npm run check — comprueba que todo el JavaScript de la app sea ECMAScript 5 (televisores antiguos:
 * Tizen 2015-2016 usa un motor WebKit y webOS 3 usa Chromium 38).
 *
 * 1) Sintaxis: acorn con ecmaVersion 5 (sin let/const, flechas, clases, plantillas…).
 * 2) Funciones de ES2015+ que el analizador no detecta (includes, startsWith, Array.from, fetch…),
 *    solo en el código propio (src/js), no en las librerías de src/lib.
 *
 * Uso: node scripts/check-es5.js [carpeta …]   (por defecto tv/src)
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { SRC_DIR, TV_DIR } = require('./lib/appconfig');

const FORBIDDEN = [
  [/\.includes\(/, 'String/Array.prototype.includes (ES2016)'],
  [/\.startsWith\(|\.endsWith\(/, 'String.prototype.startsWith/endsWith (ES2015)'],
  [/\.padStart\(|\.padEnd\(/, 'String.prototype.padStart/padEnd (ES2017)'],
  [/\.repeat\(/, 'String.prototype.repeat (ES2015)'],
  [/Array\.from\(|Array\.of\(/, 'Array.from/of (ES2015)'],
  [/Object\.(values|entries|fromEntries)\(/, 'Object.values/entries (ES2017)'],
  [/(^|[^\w.$]|[^U]\.)find(Index)?\(/, 'Array.prototype.find/findIndex (ES2015): use U.find / U.findIndex'],
  [/\bfetch\(/, 'fetch (use IPTV.http)'],
  [/new (Map|Set|WeakMap|WeakSet|Proxy)\(/, 'Map/Set/WeakMap/Proxy (ES2015)'],
  [/\bSymbol\(/, 'Symbol (ES2015)'],
  [/Number\.(isNaN|isFinite|isInteger)\(/, 'Number.isNaN/isFinite/isInteger (ES2015)'],
  [/Math\.(trunc|sign|log10|hypot)\(/, 'Math.trunc/sign/log10/hypot (ES2015)'],
  [/\.closest\(/, null], /* con polyfill en polyfills.js */
];

function listJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJs(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out.sort();
}

function stripComments(code) {
  /* Quita comentarios y cadenas para no dar falsos positivos (aproximado, suficiente para el código propio) */
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

function checkFile(file) {
  const problems = [];
  const code = fs.readFileSync(file, 'utf8');
  try {
    acorn.parse(code, { ecmaVersion: 5, sourceType: 'script', allowReserved: true, locations: true });
  } catch (e) {
    problems.push(`sintaxis no ES5: ${e.message}`);
  }
  const isLib = /[\\/]lib[\\/]/.test(path.relative(TV_DIR, file)) && !/[\\/]scripts[\\/]/.test(file);
  if (!isLib) {
    const lines = stripComments(code).split('\n');
    lines.forEach((line, i) => {
      for (const [re, what] of FORBIDDEN) {
        if (what && re.test(line)) problems.push(`línea ${i + 1}: ${what}`);
      }
    });
  }
  return problems;
}

function main() {
  const dirs = process.argv.slice(2).length ? process.argv.slice(2).map((d) => path.resolve(d)) : [SRC_DIR];
  let files = [];
  for (const d of dirs) files = files.concat(listJs(d));
  let failed = 0;
  for (const f of files) {
    const problems = checkFile(f);
    const rel = path.relative(TV_DIR, f);
    if (problems.length) {
      failed++;
      console.log(`✗ ${rel}`);
      problems.forEach((p) => console.log(`    ${p}`));
    } else {
      console.log(`✓ ${rel}`);
    }
  }
  console.log(`\n${files.length} archivos revisados: ${files.length - failed} correctos, ${failed} con problemas.`);
  if (failed) process.exit(1);
}

if (require.main === module) main();

module.exports = { checkFile, listJs };
