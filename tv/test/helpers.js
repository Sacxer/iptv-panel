'use strict';
/*
 * Utilidades de prueba: cargan los módulos ES5 de src/js en Node (se registran en global.IPTV)
 * con almacenamiento, XMLHttpRequest y DOM simulados.
 */
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src', 'js');

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  keys() { return [...this.map.keys()]; }
}

/*
 * Carga módulos desde cero. files: nombres relativos a src/js sin ".js".
 * opts.config: IPTV.config antes de cargar (como el config.js generado).
 */
function load(files, opts = {}) {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(SRC)) delete require.cache[k];
  }
  global.IPTV = { config: Object.assign({
    appName: 'IPTV Player', version: '1.2.3', build: 0, distribution: 'browser', dev: false,
    allowCustomServer: true, allowM3U: true, serverUrls: [], portalId: '', support: {}, lanPorts: [25461, 8080, 80], lanFallback: [],
  }, opts.config || {}) };
  global.localStorage = opts.localStorage || new MemoryStorage();
  for (const f of files) require(path.join(SRC, `${f}.js`));
  return global.IPTV;
}

/* XMLHttpRequest simulado: handler(req) → {status, body, delay} | null (sin respuesta: tiempo agotado) */
function fakeXhr(handler) {
  const requests = [];
  class FakeXHR {
    constructor() { this.readyState = 0; this.status = 0; this.responseText = ''; this.headers = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(body) {
      this.body = body;
      requests.push(this);
      const r = handler(this);
      if (!r) return;
      setTimeout(() => {
        if (this.aborted) return;
        this.status = r.status;
        this.responseText = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
        this.readyState = 4;
        if (this.onreadystatechange) this.onreadystatechange();
      }, r.delay || 0);
    }
    abort() { this.aborted = true; }
  }
  global.XMLHttpRequest = FakeXHR;
  return requests;
}

/* ---------- DOM mínimo para focus.js ---------- */
class FakeClassList {
  constructor() { this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  contains(c) { return this.set.has(c); }
}

class FakeEl {
  constructor(id, rect, classes = []) {
    this.id = id;
    this.rect = rect;
    this.classList = new FakeClassList();
    classes.forEach((c) => this.classList.add(c));
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.nodeType = 1;
  }
  get offsetWidth() { return this.rect ? this.rect.right - this.rect.left : 0; }
  get offsetHeight() { return this.rect ? this.rect.bottom - this.rect.top : 0; }
  append(...kids) { kids.forEach((k) => { k.parentNode = this; this.children.push(k); }); return this; }
  contains(el) { for (let n = el; n; n = n.parentNode) if (n === this) return true; return false; }
  hasAttribute(k) { return k in this.attrs; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getBoundingClientRect() { return this.rect; }
  querySelectorAll(sel) {
    const cls = sel.replace(/^\./, '');
    const out = [];
    const walk = (n) => n.children.forEach((c) => { if (c.classList.contains(cls)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
}

function fakeDocument() {
  const body = new FakeEl('body', { left: 0, top: 0, right: 1920, bottom: 1080 });
  const doc = {
    body,
    getElementById: (id) => {
      let found = null;
      const walk = (n) => n.children.forEach((c) => { if (c.id === id) found = found || c; walk(c); });
      walk(body);
      return found;
    },
  };
  return doc;
}

function rect(left, top, w, h) { return { left, top, right: left + w, bottom: top + h, width: w, height: h }; }

/* Temporizadores controlados: avanzar el reloj a mano */
function fakeClock(start = 1000000) {
  let now = start;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + (ms || 0) }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        timers.delete(next[0]);
        now = Math.max(now, next[1].at);
        next[1].fn();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

module.exports = { load, fakeXhr, MemoryStorage, FakeEl, fakeDocument, rect, fakeClock, tick, SRC };
