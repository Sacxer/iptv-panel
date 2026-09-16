/*
 * Reencontrar el portal si su dirección cambió (IP nueva tras un corte, otra red, puerto de clientes
 * separado del panel). Contrato: docs/API.md → "Identidad del portal y reconexión".
 * Equivale a app/lib/services/portal_relocator.dart.
 *
 * Orden: 1) la dirección actual; 2) el mismo equipo con el puerto de clientes que indica el portal;
 * 3) las direcciones guardadas (server.urls), todas a la vez, eligiendo la primera de la lista que
 * responde con el mismo id; 4) barrido HTTP de la red local, aceptando solo el mismo id.
 * Nunca se cambia a un portal con otro id. Una búsqueda a la vez y, salvo force, una cada 20 s.
 * Sin DOM: se prueba en Node con ping y búsqueda inyectados.
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util;

  var R = IPTV.relocate = {};
  R.MIN_INTERVAL = 20000;

  /* http://host:puerto (sin / final, ?… ni player_api.php). '' si no es válida. */
  R.normalizeBase = function (input) {
    var s = String(input || '').trim();
    if (!s) { return ''; }
    if (s.indexOf('://') < 0) { s = 'http://' + s; }
    s = s.replace(/\/(player_api|get|panel_api|xmltv)\.php.*$/i, '');
    var q = s.indexOf('?');
    if (q >= 0) { s = s.substring(0, q); }
    q = s.indexOf('#');
    if (q >= 0) { s = s.substring(0, q); }
    s = s.replace(/\/+$/, '');
    var m = /^(https?):\/\/(\[[0-9a-f:.]+\]|[^\/:\s\[\]]+)(:(\d{1,5}))?(\/[^\s]*)?$/i.exec(s);
    if (!m) { return ''; }
    if (m[4] && (parseInt(m[4], 10) < 1 || parseInt(m[4], 10) > 65535)) { return ''; }
    return m[1].toLowerCase() + '://' + m[2].toLowerCase() + (m[3] || '') + (m[5] || '');
  };

  R.parseBase = function (input) {
    var s = R.normalizeBase(input);
    if (!s) { return null; }
    var m = /^(https?):\/\/(\[[^\]]+\]|[^\/:]+)(?::(\d+))?(\/.*)?$/.exec(s);
    return { scheme: m[1], host: m[2], port: m[3] ? parseInt(m[3], 10) : (m[1] === 'https' ? 443 : 80), path: m[4] || '' };
  };

  /* La misma dirección con otro puerto */
  R.withPort = function (base, port) {
    var u = R.parseBase(base);
    if (!u || !(port > 0 && port < 65536)) { return null; }
    return u.scheme + '://' + u.host + ':' + port + u.path;
  };

  R.sameUrl = function (a, b) {
    var x = R.parseBase(a), y = R.parseBase(b);
    if (!x || !y) { return false; }
    return x.scheme === y.scheme && x.host === y.host && x.port === y.port && x.path === y.path;
  };

  /* Identidad conocida: con qué reconocer el portal */
  R.isKnown = function (identity) {
    return !!(identity && ((identity.id && identity.id !== '') || (identity.urls && identity.urls.length)));
  };

  /* ¿La respuesta del ping es este portal? (sin id conocido se acepta cualquier portal) */
  R.accepts = function (ping, identity) {
    if (!ping || ping.status !== 'portal') { return false; }
    if (identity && identity.id) { return ping.id === identity.id; }
    return true;
  };

  /*
   * new R.Relocator({ping(base, cb), lanSearch(portalId, onProgress, cb) → {cancel}, minInterval, now})
   */
  function Relocator(opts) {
    opts = opts || {};
    this.ping = opts.ping || function (base, cb) { IPTV.lan.ping(base, cb); };
    this.lanSearch = opts.lanSearch === undefined ? R.defaultLanSearch : opts.lanSearch;
    this.minInterval = opts.minInterval === undefined ? R.MIN_INTERVAL : opts.minInterval;
    this.now = opts.now || function () { return Date.now(); };
    this._waiters = null;
    this._lastFinished = null;
    this._last = null;
    this._search = null;
    this._cancelled = false;
  }

  Relocator.prototype.isRunning = function () { return !!this._waiters; };

  /* Cancela la búsqueda en curso (botón Cancelar) */
  Relocator.prototype.cancel = function () {
    if (!this._waiters) { return; }
    this._cancelled = true;
    if (this._search && this._search.cancel) { this._search.cancel(); }
  };

  /*
   * relocate({currentUrl, identity: {id, urls, clientPorts}, suggestedPort, force, onProgress}, cb(result))
   * result: {outcome: found|currentWorks|notFound|skipped|unknownPortal|cancelled, url, previousUrl, portalId, clientPorts, via}
   */
  Relocator.prototype.relocate = function (o, cb) {
    var self = this;
    if (this._waiters) { this._waiters.push(cb); return; }
    var current = R.normalizeBase(o.currentUrl);
    var t = this.now();
    if (!o.force && this._lastFinished !== null && t - this._lastFinished < this.minInterval) {
      var prev = this._last;
      /* Quien falló con la dirección vieja justo después de encontrarse la nueva la recibe también */
      if (prev && prev.outcome === 'found' && prev.previousUrl === current) { cb(prev); return; }
      cb({ outcome: 'skipped', previousUrl: current });
      return;
    }
    this._waiters = [cb];
    this._cancelled = false;
    this._run(current, o.identity || {}, o.suggestedPort || null, o.onProgress, function (result) {
      var waiters = self._waiters || [];
      self._waiters = null;
      self._search = null;
      self._last = result;
      self._lastFinished = self.now();
      U.each(waiters, function (w) { try { w(result); } catch (e) { U.log('relocate cb', e); } });
    });
  };

  Relocator.prototype._run = function (current, identity, suggestedPort, onProgress, done) {
    var self = this;
    if (!R.isKnown(identity) || !current) {
      done({ outcome: 'unknownPortal', previousUrl: current });
      return;
    }
    function found(url, r, via) {
      return { outcome: 'found', url: url, previousUrl: current, portalId: r.id || identity.id || '', clientPorts: r.clientPorts || [], via: via };
    }

    /* 0) La dirección actual */
    this.ping(current, function (now0) {
      if (self._cancelled) { done({ outcome: 'cancelled', previousUrl: current }); return; }
      if (R.accepts(now0, identity)) {
        done({ outcome: 'currentWorks', url: current, previousUrl: current, portalId: now0.id || '', clientPorts: now0.clientPorts || [] });
        return;
      }
      var candidates = R.candidates(current, identity, suggestedPort, now0);
      self._pingAll(candidates, identity, function (hit) {
        if (self._cancelled) { done({ outcome: 'cancelled', previousUrl: current }); return; }
        if (hit) { done(found(hit.url, hit.ping, hit.via)); return; }
        /* 3) Red local, solo con id (es lo único que distingue a este portal de otro) */
        if (!self.lanSearch || !identity.id) { done({ outcome: 'notFound', previousUrl: current }); return; }
        self._search = self.lanSearch(identity.id, onProgress, function (servers) {
          if (self._cancelled) { done({ outcome: 'cancelled', previousUrl: current }); return; }
          var list = [];
          U.each(servers || [], function (s) {
            var u = R.normalizeBase(s.url);
            if (s.id === identity.id && u && u !== current) { list.push({ url: u, via: 'localNetwork' }); }
          });
          /* Confirmar que responde y es el mismo */
          self._pingAll(list, identity, function (h2) {
            if (self._cancelled) { done({ outcome: 'cancelled', previousUrl: current }); return; }
            done(h2 ? found(h2.url, h2.ping, 'localNetwork') : { outcome: 'notFound', previousUrl: current });
          });
        });
      });
    });
  };

  /*
   * Direcciones a probar después de la actual: 1) mismo equipo con el puerto de clientes (si es el puerto
   * del panel), 2) las guardadas en su orden. → [{url, via}]
   */
  R.candidates = function (current, identity, suggestedPort, now0) {
    var out = [], seen = {};
    seen[current] = true;
    function add(u, via) {
      if (!u || seen[u]) { return; }
      seen[u] = true;
      out.push({ url: u, via: via });
    }
    var panel = (now0 && now0.status === 'panelPort') || !!suggestedPort;
    if (panel) {
      var ports = [];
      if (suggestedPort) { ports.push(suggestedPort); }
      if (now0 && now0.suggestedPort) { ports.push(now0.suggestedPort); }
      U.each(identity.clientPorts || [], function (p) { ports.push(p); });
      U.each(ports, function (p) { add(R.withPort(current, p), 'clientPort'); });
    }
    U.each(identity.urls || [], function (raw) { add(R.normalizeBase(raw), 'savedUrl'); });
    return out;
  };

  /* Consulta todas a la vez; devuelve la primera de la lista (en su orden) que es este portal */
  Relocator.prototype._pingAll = function (list, identity, cb) {
    var self = this, results = [], pending = list.length, finished = false, i;
    if (!pending) { cb(null); return; }
    function check() {
      if (finished) { return; }
      var k;
      for (k = 0; k < list.length; k++) {
        if (results[k] === undefined) { return; } /* esperar a las anteriores en la lista */
        if (R.accepts(results[k], identity)) {
          finished = true;
          cb({ url: list[k].url, via: list[k].via, ping: results[k] });
          return;
        }
      }
      finished = true;
      cb(null);
    }
    for (i = 0; i < list.length; i++) {
      (function (idx) {
        self.ping(list[idx].url, function (r) {
          results[idx] = r || { status: 'unreachable' };
          pending--;
          check();
        });
      })(i);
    }
  };

  /* Búsqueda real en la red local: termina en cuanto aparece el portal buscado */
  R.defaultLanSearch = function (portalId, onProgress, cb) {
    return IPTV.lan.discover({ expectedId: portalId, onProgress: onProgress }, function (res) { cb(res.servers); });
  };

  R.Relocator = Relocator;
  if (typeof module !== 'undefined' && module.exports) { module.exports = R; }
})(typeof window !== 'undefined' ? window : global);
