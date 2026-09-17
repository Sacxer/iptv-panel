'use strict';
/*
 * Microsoft Edge o Google Chrome sin ventana, manejado con el protocolo de DevTools (sin dependencias).
 * Lo usan store-shots.js (capturas) y ux-doc.js (PDF para LG).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No se encontró Edge ni Chrome. Indique la ruta con --browser');
  return found;
}

async function waitFile(file, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('\n')) return text;
    }
    await sleep(100);
  }
  throw new Error('El navegador no abrió el puerto de depuración');
}

/* Cliente mínimo del protocolo de DevTools */
function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let seq = 0;
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      const p = m.id && pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
      else p.resolve(m.result);
    };
    ws.onerror = () => reject(new Error('No se pudo conectar con el navegador'));
    ws.onopen = () => resolve({
      send(method, params = {}) {
        const id = ++seq;
        ws.send(JSON.stringify({ id, method, params }));
        return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej, method }));
      },
      close() { ws.close(); },
    });
  });
}

/* Abre el navegador, ejecuta fn(client) y lo cierra siempre (borra el perfil temporal) */
async function withBrowser(fn, { browser, width = 1920, height = 1080 } = {}) {
  const exe = findBrowser(browser);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-browser-'));
  const child = spawn(exe, [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', `--window-size=${width},${height}`,
    '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--force-color-profile=srgb', 'about:blank',
  ], { stdio: 'ignore' });
  let client;
  try {
    const port = (await waitFile(path.join(profile, 'DevToolsActivePort'), 15000)).split('\n')[0].trim();
    let page;
    for (let i = 0; i < 50 && !page; i++) {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
      page = list.find((t) => t.type === 'page');
      if (!page) await sleep(100);
    }
    if (!page) throw new Error('El navegador no abrió ninguna página');
    client = await cdp(page.webSocketDebuggerUrl);
    return await fn(client);
  } finally {
    if (client) client.close();
    child.kill();
    await sleep(500);
    // Windows puede tener el perfil temporal bloqueado un momento más: no vale la pena fallar por eso
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
    } catch { /* lo borra el sistema con los temporales */ }
  }
}

/* Evalúa una expresión en la página y devuelve su valor (espera promesas) */
async function evaluate(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`En la página: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}

module.exports = { sleep, findBrowser, withBrowser, evaluate };
