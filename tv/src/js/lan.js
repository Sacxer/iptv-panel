/*
 * Búsqueda del portal en la red local por HTTP (los navegadores de TV no pueden usar UDP). ES5.
 * Contrato: docs/API.md → "Descubrimiento del servidor en la red local" (barrido).
 *
 * - Subredes reales del equipo (device.js); si la red es mayor que /24 se recorre por tramos /24,
 *   primero la propia, luego la del router y después las demás por cercanía, como máximo una /16.
 * - Puertos 25461, 8080 y 80. GET /api/client/ping con tiempo límite; es un portal si responde
 *   "type":"iptv-portal" (o "portal":true). Un 404 "Los clientes usan el puerto N" lleva al puerto N.
 * - Concurrencia limitada y duración máxima. Se puede cancelar.
 * Sin DOM: se prueba en Node (test/test-core.js).
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util;
  var L = IPTV.lan = {};

  L.PORTAL_TYPE = 'iptv-portal';
  L.DEFAULT_PORTS = [25461, 8080, 80];
  L.MAX_NETWORKS = 4;
  L.MIN_SWEEP_PREFIX = 16;
  L.SHORTEST_LIMIT = 8000;
  L.LONGEST_LIMIT = 45000;

  /* ---------- Direcciones IPv4 ---------- */
  L.ipToInt = function (ip) {
    if (ip === null || ip === undefined) { return null; }
    var parts = String(ip).trim().split('.'), v = 0, i, n;
    if (parts.length !== 4) { return null; }
    for (i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(parts[i])) { return null; }
      n = parseInt(parts[i], 10);
      if (n > 255) { return null; }
      v = v * 256 + n;
    }
    return v;
  };

  L.intToIp = function (v) {
    v = Math.floor(v);
    return [Math.floor(v / 16777216) % 256, Math.floor(v / 65536) % 256, Math.floor(v / 256) % 256, v % 256].join('.');
  };

  /* Máscara como entero sin signo */
  L.maskOf = function (prefix) {
    var p = U.clamp(parseInt(prefix, 10) || 0, 0, 32);
    return p === 0 ? 0 : (Math.pow(2, 32) - Math.pow(2, 32 - p));
  };

  /* Tamaño del bloque (2^(32-p)) */
  function blockSize(prefix) { return Math.pow(2, 32 - U.clamp(prefix, 0, 32)); }

  L.networkOf = function (ip, prefix) {
    var v = L.ipToInt(ip);
    if (v === null) { return null; }
    var size = blockSize(prefix);
    return Math.floor(v / size) * size;
  };

  /* "255.255.240.0" → 20 ; también acepta "20" o "/20". null si no es una máscara válida. */
  L.prefixFromMask = function (mask) {
    if (mask === null || mask === undefined || mask === '') { return null; }
    var s = String(mask).trim().replace(/^\//, '');
    if (/^\d{1,2}$/.test(s)) {
      var n = parseInt(s, 10);
      return n >= 0 && n <= 32 ? n : null;
    }
    var v = L.ipToInt(s);
    if (v === null) { return null; }
    var p = 0;
    while (p < 32 && v >= Math.pow(2, 31 - p) ) { v -= Math.pow(2, 31 - p); p++; }
    return v === 0 ? p : null; /* bits no contiguos → no válida */
  };

  /* 10/8, 172.16/12, 192.168/16 y CGNAT 100.64/10 */
  L.isLanAddress = function (ip) {
    var v = L.ipToInt(ip);
    if (v === null) { return false; }
    var a = Math.floor(v / 16777216), b = Math.floor(v / 65536) % 256;
    if (a === 10) { return true; }
    if (a === 172 && b >= 16 && b <= 31) { return true; }
    if (a === 192 && b === 168) { return true; }
    if (a === 100 && b >= 64 && b <= 127) { return true; }
    return false;
  };

  L.cidr = function (ip, prefix) {
    var net = L.networkOf(ip, prefix);
    return net === null ? String(ip) + '/' + prefix : L.intToIp(net) + '/' + prefix;
  };

  /*
   * Tramos /24 de una red {address, prefix, gateway}: su rango real sin dirección de red ni de difusión,
   * recortado a la /16 del equipo. Orden: la /24 propia, la del router y las demás por cercanía.
   * Cada tramo: {first, last, network, label}
   */
  L.sweepBlocks = function (network) {
    var ip = L.ipToInt(network && network.address);
    if (ip === null) { return []; }
    var prefix = U.clamp(parseInt(network.prefix, 10) || 24, 0, 32);
    var sp = prefix < L.MIN_SWEEP_PREFIX ? L.MIN_SWEEP_PREFIX : prefix;
    var size = blockSize(sp);
    var net = Math.floor(ip / size) * size;
    var broadcast = net + size - 1;
    var first = sp >= 31 ? net : net + 1;
    var last = sp >= 31 ? broadcast : broadcast - 1;
    var label = L.intToIp(net) + '/' + sp;
    var own = Math.floor(ip / 256);
    var gw = L.ipToInt(network.gateway);
    var gwBlock = (gw !== null && gw >= first && gw <= last) ? Math.floor(gw / 256) : null;
    var blocks = [], b;
    for (b = Math.floor(first / 256); b <= Math.floor(last / 256); b++) { blocks.push(b); }
    function rank(x) { return x === own ? 0 : (x === gwBlock ? 1 : 2); }
    blocks.sort(function (x, y) {
      var r = rank(x) - rank(y);
      if (r !== 0) { return r; }
      var d = Math.abs(x - own) - Math.abs(y - own);
      return d !== 0 ? d : x - y;
    });
    var out = [];
    U.each(blocks, function (blk) {
      var lo = blk * 256, hi = blk * 256 + 255;
      out.push({ first: Math.max(lo, first), last: Math.min(hi, last), network: label, label: L.intToIp(lo) + '/24' });
    });
    return out;
  };

  /* Tramos de varias redes (máximo 4), sin repetir una /24 */
  L.sweepBlocksFor = function (networks) {
    var seen = {}, out = [];
    U.each((networks || []).slice(0, L.MAX_NETWORKS), function (n) {
      U.each(L.sweepBlocks(n), function (b) {
        var key = Math.floor(b.first / 256);
        if (seen[key]) { return; }
        seen[key] = true;
        out.push(b);
      });
    });
    return out;
  };

  L.countTargets = function (blocks, ports) {
    var n = 0;
    U.each(blocks, function (b) { n += b.last - b.first + 1; });
    return n * (ports || []).length;
  };

  /*
   * Recorrido: cada puerto recorre todos los tramos en orden (así el puerto de clientes se revisa
   * entero antes de agotar el tiempo). Devuelve {next() → {host, port, block} | null}.
   */
  L.sweepTargets = function (blocks, ports) {
    var pi = 0, bi = 0, v = blocks.length ? blocks[0].first : 0;
    return {
      next: function () {
        while (pi < ports.length) {
          if (bi >= blocks.length) { pi++; bi = 0; v = blocks.length ? blocks[0].first : 0; continue; }
          var b = blocks[bi];
          if (v > b.last) { bi++; v = bi < blocks.length ? blocks[bi].first : 0; continue; }
          var t = { host: L.intToIp(v), port: ports[pi], block: b };
          v++;
          return t;
        }
        return null;
      }
    };
  };

  /* Duración máxima según el trabajo (en el peor caso cada prueba agota su tiempo) */
  L.autoLimit = function (total, concurrency, probeTimeout) {
    var ms = total * (probeTimeout || 1500) / Math.max(1, concurrency || 1) * 1.15 + 1000;
    return Math.round(U.clamp(ms, L.SHORTEST_LIMIT, L.LONGEST_LIMIT));
  };

  /* ---------- Respuesta de /api/client/ping ---------- */
  L.panelPortHint = function (text) { return IPTV.http.panelPortHint(text); };

  function ports(v) {
    var out = [];
    U.each(U.isArray(v) ? v : [], function (p) {
      var n = parseInt(p, 10);
      if (n > 0 && n < 65536 && out.indexOf(n) < 0) { out.push(n); }
    });
    return out;
  }

  /*
   * → {status: 'portal'|'panelPort'|'notPortal'|'unreachable', id, name, version, clientPorts, ports, publicUrl, suggestedPort}
   */
  L.parsePing = function (status, text) {
    if (!status) { return { status: 'unreachable' }; }
    var hint = L.panelPortHint(text);
    if (status === 404 && hint) { return { status: 'panelPort', suggestedPort: hint }; }
    if (status !== 200) { return { status: 'notPortal' }; }
    var j = null;
    try { j = JSON.parse(String(text || '').trim()); } catch (e) { j = null; }
    if (!j || typeof j !== 'object' || U.isArray(j)) { return { status: 'notPortal' }; }
    if (j.type !== L.PORTAL_TYPE && j.portal !== true) { return { status: 'notPortal' }; }
    return {
      status: 'portal',
      id: j.id ? String(j.id) : '',
      name: j.name ? String(j.name) : '',
      version: j.version ? String(j.version) : '',
      publicUrl: j.public_url ? String(j.public_url) : '',
      clientPorts: ports(j.client_ports),
      ports: ports(j.ports)
    };
  };

  /* GET {base}/api/client/ping sin cabeceras propias (petición simple, sin CORS previo). Nunca falla. */
  L.ping = function (base, cb, timeout) {
    var url = IPTV.relocate ? IPTV.relocate.normalizeBase(base) : base;
    if (!url) { cb({ status: 'unreachable' }); return { abort: function () {} }; }
    return IPTV.http.request({ url: url + '/api/client/ping', timeout: timeout || 2500 }, function (err, res) {
      if (err && err.kind !== 'http' && err.kind !== 'panelPort') { cb({ status: 'unreachable' }); return; }
      cb(L.parsePing(res ? res.status : 0, res ? res.text : ''));
    });
  };

  /*
   * Prueba un equipo: devuelve {url, id, name, version, publicUrl, ports, clientPorts} o null.
   * Si es el puerto del panel, prueba el puerto de clientes que indica.
   */
  L.probe = function (host, port, cb, timeout, follow) {
    var base = 'http://' + host + ':' + port;
    return L.ping(base, function (r) {
      if (r.status === 'portal') {
        var all = r.ports.slice();
        if (all.indexOf(port) < 0) { all.push(port); }
        cb({ url: base, host: host, port: port, id: r.id, name: r.name || 'Servidor IPTV', version: r.version, publicUrl: r.publicUrl, ports: all, clientPorts: r.clientPorts });
        return;
      }
      if (r.status === 'panelPort' && follow !== false && r.suggestedPort && r.suggestedPort !== port) {
        L.probe(host, r.suggestedPort, cb, timeout, false);
        return;
      }
      cb(null);
    }, timeout);
  };

  /* Mismo portal: mismo id, o misma URL, o mismo equipo con un puerto en común */
  L.sameServer = function (a, b) {
    if (a.id && b.id && a.id !== b.id) { return false; }
    if (a.id && b.id && a.id === b.id) { return true; }
    if (a.url === b.url) { return true; }
    if (a.host !== b.host) { return false; }
    return (a.ports || []).indexOf(b.port) >= 0 || (b.ports || []).indexOf(a.port) >= 0;
  };

  L.merge = function (list, server) {
    var i = U.findIndex(list, function (x) { return L.sameServer(x, server); });
    if (i < 0) { list.push(server); return true; }
    var cur = list[i];
    /* Preferir el puerto de clientes (primero de la lista del portal) */
    if (server.clientPorts && server.clientPorts[0] === server.port && cur.clientPorts && cur.clientPorts[0] !== cur.port) {
      list[i] = U.extend({}, cur, server);
      return true;
    }
    if (!cur.id && server.id) { cur.id = server.id; }
    return false;
  };

  /* Solo desarrollo: ?lanports=8086,8087 cambia los puertos del barrido (portal de pruebas) */
  L.devPorts = function () {
    try {
      if (!IPTV.config || !IPTV.config.dev || !root.location) { return null; }
      var m = /[?&]lanports=([\d,]+)/.exec(root.location.search || '');
      var list = m ? ports(m[1].split(',')) : [];
      return list.length ? list : null;
    } catch (e) { return null; }
  };

  /*
   * L.discover(opts, cb) → {cancel()}
   * opts: networks (null = las del equipo), ports, expectedId, concurrency (40), probeTimeout (1500),
   *       maxDuration, minDuration (1500), grace (1500), onProgress({network, fraction, percent, probed, total, label}),
   *       onFound(servers), probe (inyectable: function(host, port, cb)), setTimeout/clearTimeout/now (pruebas)
   * cb({servers, networks, cancelled, noNetwork, elapsed})
   */
  L.discover = function (opts, cb) {
    opts = opts || {};
    var setT = opts.setTimeout || root.setTimeout, clearT = opts.clearTimeout || root.clearTimeout;
    var now = opts.now || function () { return Date.now(); };
    var started = now();
    var stopped = false, cancelled = false, finished = false;
    var servers = [], inflight = {}, seq = 0, timers = [];
    var probed = 0, total = 0, current = '', running = 0;
    var portsList = opts.ports || L.devPorts() || ((IPTV.config && IPTV.config.lanPorts) || L.DEFAULT_PORTS);
    var concurrency = opts.concurrency || 40;
    var probeTimeout = opts.probeTimeout || 1500;
    var probe = opts.probe || function (host, port, done) { return L.probe(host, port, done, probeTimeout); };
    var networks = null, limit = 0, targets = null, progressTimer = null, graceSet = false;

    function later(fn, ms) { var t = setT(fn, ms); timers.push(t); return t; }

    function finish() {
      if (finished) { return; }
      finished = true;
      stopped = true;
      U.each(timers, function (t) { clearT(t); });
      if (progressTimer) { clearT(progressTimer); }
      var k;
      for (k in inflight) {
        if (Object.prototype.hasOwnProperty.call(inflight, k)) {
          try { if (inflight[k] && inflight[k].abort) { inflight[k].abort(); } } catch (e) { /* nada */ }
        }
      }
      inflight = {};
      cb({ servers: servers, networks: networks || [], cancelled: cancelled, noNetwork: !networks || !networks.length, elapsed: now() - started });
    }

    function report() {
      if (!opts.onProgress || stopped) { return; }
      var byWork = total ? probed / total : 0;
      var byTime = limit ? (now() - started) / limit : 0;
      var f = Math.min(0.99, Math.max(byWork, byTime));
      var pct = Math.floor(f * 100);
      opts.onProgress({
        network: current, fraction: f, percent: pct, probed: probed, total: total,
        label: current ? 'Buscando en ' + current + '… ' + pct + ' %' : 'Buscando en la red… ' + pct + ' %'
      });
    }

    function tick() {
      report();
      if (!stopped) { progressTimer = setT(tick, 250); }
    }

    function onHit(server) {
      if (stopped) { return; }
      if (opts.portalId && server.id !== opts.portalId) { return; }
      if (opts.accept && !opts.accept(server)) { return; }
      var changed = L.merge(servers, server);
      if (changed && opts.onFound) { opts.onFound(servers.slice()); }
      if (opts.expectedId) {
        if (server.id === opts.expectedId) { finish(); }
        return;
      }
      if (graceSet) { return; }
      graceSet = true;
      var wait = Math.max(opts.grace || 1500, (opts.minDuration || 1500) - (now() - started));
      later(finish, wait);
    }

    function worker() {
      if (stopped) { return; }
      var t = targets.next();
      if (!t) {
        running--;
        if (running <= 0) { finish(); }
        return;
      }
      current = t.block.network;
      var slot = ++seq;
      var called = false, sync = true;
      var handle = probe(t.host, t.port, function (server) {
        if (called) { return; }
        called = true;
        delete inflight[slot];
        probed++;
        if (server) { onHit(server); }
        if (stopped) { return; }
        /* Respuesta inmediata (pruebas): continuar sin apilar llamadas */
        if (sync) { setT(worker, 0); } else { worker(); }
      });
      sync = false;
      if (!called && handle) { inflight[slot] = handle; }
    }

    function start(nets) {
      if (stopped) { return; }
      networks = nets || [];
      if (!networks.length) { finish(); return; }
      var blocks = L.sweepBlocksFor(networks);
      total = L.countTargets(blocks, portsList);
      current = blocks.length ? blocks[0].network : '';
      limit = opts.maxDuration || L.autoLimit(total, concurrency, probeTimeout);
      targets = L.sweepTargets(blocks, portsList);
      later(finish, limit);
      tick();
      var n = Math.min(concurrency, total), i;
      running = n;
      if (!n) { finish(); return; }
      for (i = 0; i < n; i++) { worker(); }
    }

    if (opts.networks) {
      later(function () { start(opts.networks); }, 0);
    } else {
      IPTV.device.networks(function (nets) { start(nets); });
    }

    return {
      cancel: function () {
        if (finished) { return; }
        cancelled = true;
        finish();
      }
    };
  };
})(typeof window !== 'undefined' ? window : global);
