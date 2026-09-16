/*
 * Sesión: dirección del servidor del perfil activo, identidad del portal y reconexión. ES5.
 *
 * - Guarda server.id y server.urls de /api/client/info en el perfil (y una copia global para los perfiles
 *   del servidor del operador, "auto").
 * - Si una petición falla por red / tiempo / puerto del panel, busca el portal (relocate.js), aplica la
 *   dirección nueva a la fuente Xtream, al portal y al reproductor, y avisa "Servidor encontrado en la
 *   nueva dirección". Solo con el portal propio (servidores Xtream ajenos y M3U funcionan como siempre).
 * - Compilación de tienda (allowCustomServer: false): findServer() elige el servidor entre la dirección
 *   guardada, operator.json → serverUrls y las direcciones conocidas; si ninguna responde, lo busca en la
 *   red local aceptando solo el portal del operador (su id o sus serverUrls).
 * - Compilación completa: "Buscar servidor en mi red" lista los portales encontrados.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util, S = IPTV.storage, R = IPTV.relocate;

  var SS = IPTV.session = {};
  SS.RELOCATED_MESSAGE = 'Servidor encontrado en la nueva dirección';
  SS.relocator = new R.Relocator();

  /* Observadores de la búsqueda (pantalla de carga, diálogo de búsqueda) */
  SS.onSearchProgress = null;

  function app() { return IPTV.app || {}; }

  SS.cfg = function () { return IPTV.config || {}; };

  /* Compilación restringida (allowCustomServer: false): el usuario no escribe la dirección del servidor */
  SS.isRestricted = function () { return SS.cfg().allowCustomServer === false; };

  /* Dirección del servidor del operador sugerida: la última encontrada o la primera de serverUrls */
  SS.suggestedServer = function () {
    var cfg = SS.cfg(), g = S.get('portal', {}) || {};
    var list = cfg.serverUrls || [];
    if (g.url && (SS.isOperatorServer(g.url) || !list.length)) { return R.normalizeBase(g.url); }
    return list.length ? R.normalizeBase(list[0]) : '';
  };

  /* ¿Es una dirección del operador (serverUrls o direcciones conocidas de su portal)? */
  SS.isOperatorServer = function (url) {
    var cfg = SS.cfg(), g = S.get('portal', {}) || {}, n = R.normalizeBase(url), hit = false;
    if (!n) { return false; }
    U.each((cfg.serverUrls || []).concat(g.urls || [], g.url ? [g.url] : []), function (u) {
      if (R.sameUrl(u, n)) { hit = true; return false; }
    });
    return hit;
  };

  /*
   * Qué muestra la pantalla de inicio de sesión según la configuración:
   * {restricted, showServer, showM3U, types: ['xtream', 'm3u'], prefillServer, lanSearch}
   */
  SS.loginOptions = function () {
    var cfg = SS.cfg();
    var restricted = SS.isRestricted();
    var showM3U = cfg.allowM3U !== false;
    return {
      restricted: restricted,
      showServer: !restricted,
      showM3U: showM3U,
      types: showM3U ? ['xtream', 'm3u'] : ['xtream'],
      prefillServer: restricted ? '' : SS.suggestedServer(),
      lanSearch: true
    };
  };

  /* ---------- Identidad ---------- */
  SS.identityOf = function (profile) {
    var cfg = SS.cfg(), g = S.get('portal', {}) || {};
    if (!profile) { return { id: '', urls: [], clientPorts: [] }; }
    var id = profile.portalId || '';
    var urls = (profile.portalUrls || []).slice();
    var clientPorts = (profile.clientPorts || []).slice();
    /* Perfiles del modo tienda: también sirven la identidad global y las direcciones del operador */
    if (profile.auto) {
      if (!id) { id = cfg.portalId || g.id || ''; }
      U.each((g.urls || []).concat(cfg.serverUrls || []), function (u) {
        var n = R.normalizeBase(u);
        if (n && urls.indexOf(n) < 0) { urls.push(n); }
      });
      if (!clientPorts.length && g.clientPorts) { clientPorts = g.clientPorts.slice(); }
    }
    return { id: id, urls: urls, clientPorts: clientPorts };
  };

  /* Reubicación solo con el portal propio: hace falta su id (un XtreamUI o un Xtream ajeno no lo tienen) */
  SS.canRelocate = function () {
    var p = app().profile;
    return !!(p && p.type === 'xtream' && SS.identityOf(p).id);
  };

  /*
   * Direcciones con las que iniciar sesión (API Xtream), en orden de preferencia.
   * Perfiles del operador ("auto"): operator.json → serverUrls en su orden y después la última dirección
   * usada (p. ej. una reubicada). Así, si la IP local del operador choca con la red de la casa, se usa la
   * siguiente. Otros perfiles: su servidor.
   */
  SS.connectCandidates = function (profile) {
    var out = [];
    function add(u) {
      var n = R.normalizeBase(u);
      if (n && out.indexOf(n) < 0) { out.push(n); }
    }
    if (!profile || profile.type !== 'xtream') { return out; }
    if (profile.auto) { U.each(SS.cfg().serverUrls || [], add); }
    add(profile.server);
    return out;
  };

  /* Guarda la identidad y direcciones del portal que devolvió /api/client/info */
  SS.rememberPortal = function (server, clientPorts) {
    var p = app().profile;
    if (!p || p.type !== 'xtream' || !server) { return; }
    var urls = [];
    U.each(U.isArray(server.urls) ? server.urls : [], function (u) {
      var n = R.normalizeBase(u);
      if (n && urls.indexOf(n) < 0 && urls.length < 24) { urls.push(n); }
    });
    var id = server.id ? String(server.id) : (p.portalId || '');
    /* Nunca adoptar la identidad de otro portal */
    if (p.portalId && id && p.portalId !== id) {
      U.log('El servidor respondió con otro identificador de portal; se ignora', id);
      return;
    }
    var ports = (clientPorts && clientPorts.length) ? clientPorts : (p.clientPorts || []);
    var changed = id !== (p.portalId || '') || urls.join('|') !== (p.portalUrls || []).join('|') || ports.join('|') !== (p.clientPorts || []).join('|');
    if (changed) {
      p.portalId = id;
      p.portalUrls = urls;
      p.clientPorts = ports.slice();
      S.saveProfile(p);
    }
    if (p.auto) { SS.rememberGlobal(p.server, id, urls, ports); }
  };

  SS.rememberGlobal = function (url, id, urls, clientPorts) {
    var g = S.get('portal', {}) || {};
    if (g.id && id && g.id !== id && SS.cfg().portalId) { return; }
    g.url = R.normalizeBase(url) || g.url || '';
    if (id) { g.id = id; }
    if (urls && urls.length) { g.urls = urls.slice(0, 24); }
    if (clientPorts && clientPorts.length) { g.clientPorts = clientPorts.slice(); }
    S.set('portal', g);
  };

  /* Usa `url` como servidor del perfil activo (fuente Xtream, portal y reproductor) */
  SS.applyServer = function (url, clientPorts) {
    var a = app(), p = a.profile, clean = R.normalizeBase(url);
    if (!p || !clean) { return; }
    p.server = clean;
    if (clientPorts && clientPorts.length) { p.clientPorts = clientPorts.slice(); }
    S.saveProfile(p);
    if (a.source && a.source.type === 'xtream') { a.source.setServer(clean); }
    if (IPTV.portal) { IPTV.portal.setServer(clean); }
    if (p.auto) { SS.rememberGlobal(clean, p.portalId, null, p.clientPorts); }
  };

  /*
   * Busca el portal del perfil activo. cb(result) con result.outcome (ver relocate.js).
   * opts: {reason (error http), force (botón), onProgress}
   */
  SS.relocate = function (opts, cb) {
    opts = opts || {};
    var a = app(), p = a.profile;
    cb = cb || U.noop;
    if (!p || p.type !== 'xtream') { cb({ outcome: 'skipped' }); return; }
    var startedFor = p;
    SS.relocator.relocate({
      currentUrl: p.server,
      identity: SS.identityOf(p),
      suggestedPort: opts.reason && opts.reason.clientPort ? opts.reason.clientPort : null,
      force: !!opts.force,
      onProgress: function (pr) {
        if (opts.onProgress) { opts.onProgress(pr); }
        if (SS.onSearchProgress) { SS.onSearchProgress(pr); }
      }
    }, function (result) {
      if (app().profile !== startedFor) { cb({ outcome: 'skipped' }); return; }
      if (result.outcome === 'found' && result.url) {
        if (!R.sameUrl(result.url, p.server)) {
          SS.applyServer(result.url, result.clientPorts);
          if (IPTV.ui && IPTV.ui.toast) { IPTV.ui.toast(SS.RELOCATED_MESSAGE, 4000); }
        }
      } else if (result.outcome === 'currentWorks' && result.clientPorts && result.clientPorts.length) {
        p.clientPorts = result.clientPorts.slice();
        S.saveProfile(p);
      }
      cb(result);
    });
  };

  /*
   * Para las peticiones: si el error permite reubicar, busca el portal.
   * cb(true) si ahora el servidor está en otra dirección (la petición se repite una vez).
   */
  SS.connectionLost = function (err, usedServer, cb) {
    var p = app().profile;
    if (!err || !err.canRelocate || !SS.canRelocate()) { cb(false); return; }
    /* Otra petición ya aplicó el cambio */
    if (usedServer && p && !R.sameUrl(usedServer, p.server)) { cb(true); return; }
    SS.relocate({ reason: err }, function (r) {
      cb(r.outcome === 'found' && !!r.url);
    });
  };

  /* El reproductor no logra reproducir: si el servidor no responde, buscarlo. cb(true) si cambió. */
  SS.checkServer = function (cb) {
    if (!SS.canRelocate()) { cb(false); return; }
    var p = app().profile, before = p.server;
    SS.relocate({}, function (r) {
      cb(r.outcome === 'found' && !!r.url && !R.sameUrl(before, r.url));
    });
  };

  /* ---------- Modo tienda: elegir el servidor ---------- */
  /* Direcciones a probar al iniciar sesión: guardada, las del operador y las conocidas */
  /*
   * Direcciones a probar al iniciar sesión: la guardada, las del operador (serverUrls, de confianza: se aceptan
   * aunque el portal tenga otro id, p. ej. tras reinstalarlo) y las conocidas. → [{url, trusted}]
   */
  SS.storeCandidates = function () {
    var cfg = SS.cfg(), g = S.get('portal', {}) || {}, out = [];
    function add(u, trusted) {
      var n = R.normalizeBase(u), i;
      if (!n) { return; }
      for (i = 0; i < out.length; i++) {
        if (out[i].url === n) { if (trusted) { out[i].trusted = true; } return; }
      }
      out.push({ url: n, trusted: !!trusted });
    }
    add(g.url, false);
    U.each(cfg.serverUrls || [], function (u) { add(u, true); });
    U.each(g.urls || [], function (u) { add(u, false); });
    return out;
  };

  /*
   * Portal encontrado en la red que corresponde a operator.json → serverUrls: misma dirección, misma
   * public_url, o el mismo equipo (IP) de una de esas direcciones.
   */
  SS.matchesOperatorUrls = function (server) {
    var cfg = SS.cfg(), hit = false;
    if (!server) { return false; }
    U.each(cfg.serverUrls || [], function (u) {
      var a = R.parseBase(u), b = R.parseBase(server.url);
      if (!a || !b) { return; }
      if (R.sameUrl(u, server.url) || (server.publicUrl && R.sameUrl(u, server.publicUrl)) || a.host === b.host) {
        hit = true;
        return false;
      }
    });
    return hit;
  };

  SS.expectedPortalId = function () {
    var cfg = SS.cfg(), g = S.get('portal', {}) || {};
    return cfg.portalId || g.id || '';
  };

  /*
   * Prueba direcciones en paralelo ([{url, trusted}] o [url]) y devuelve la primera de la lista que sea un
   * portal válido: con id conocido, el mismo id (salvo las de confianza). cb({url, ping, trusted} | null)
   */
  SS.pingFirst = function (items, expectedId, cb) {
    var list = [], seen = {};
    U.each(items || [], function (it) {
      var o = typeof it === 'string' ? { url: it, trusted: false } : it;
      if (o && o.url && !seen[o.url]) { seen[o.url] = true; list.push(o); }
    });
    if (!list.length) { cb(null); return; }
    var results = [], done = false;
    function ok(r, item) {
      if (!r || r.status !== 'portal') { return false; }
      return item.trusted || !expectedId || r.id === expectedId;
    }
    function check() {
      if (done) { return; }
      var k;
      for (k = 0; k < list.length; k++) {
        if (results[k] === undefined) { return; }
        if (ok(results[k], list[k])) { done = true; cb({ url: list[k].url, ping: results[k], trusted: !!list[k].trusted }); return; }
      }
      /* Puerto del panel: probar el puerto de clientes del mismo equipo */
      var hinted = [];
      for (k = 0; k < list.length; k++) {
        if (results[k].status === 'panelPort' && results[k].suggestedPort) {
          var w = R.withPort(list[k].url, results[k].suggestedPort);
          if (w && !seen[w]) { seen[w] = true; hinted.push({ url: w, trusted: list[k].trusted }); }
        }
      }
      done = true;
      if (hinted.length) { SS.pingFirst(hinted, expectedId, cb); } else { cb(null); }
    }
    U.each(list, function (item, idx) {
      IPTV.lan.ping(item.url, function (r) {
        results[idx] = r || { status: 'unreachable' };
        check();
      });
    });
  };

  /*
   * Busca el servidor: primero las direcciones conocidas (salvo lanOnly) y luego la red local.
   * opts: {lan (false: no barrer la red), lanOnly (botón "Buscar servidor en mi red"),
   *        onlyKnown (compilación restringida: solo el portal del operador si se conoce su id), onProgress}
   * cb({url, id, name, clientPorts} | null, info) — info: {servers (portales encontrados), cancelled, noNetwork}
   * Con varios portales y sin id conocido devuelve null y la lista en info.servers para que el usuario elija.
   * Devuelve {cancel()}.
   */
  SS.findServer = function (opts, cb) {
    opts = opts || {};
    var expected = SS.expectedPortalId();
    var onlyId = opts.onlyKnown ? expected : '';
    /* Restringida y sin id conocido: solo portales que coinciden con serverUrls del operador */
    var accept = (opts.onlyKnown && !onlyId) ? SS.matchesOperatorUrls : null;
    var search = null, cancelled = false;
    function pick(s) { return { url: s.url, id: s.id, name: s.name, clientPorts: s.clientPorts }; }
    function lan() {
      if (opts.lan === false) { cb(null, {}); return; }
      if (opts.onProgress) { opts.onProgress({ percent: 0, label: 'Buscando el servidor en su red local…' }); }
      search = IPTV.lan.discover({
        expectedId: onlyId || null,
        portalId: onlyId || null,
        accept: accept,
        onProgress: opts.onProgress
      }, function (res) {
        if (cancelled || res.cancelled) { cb(null, { cancelled: true }); return; }
        var list = (res.servers || []).slice();
        /* El portal conocido primero */
        if (expected) {
          list.sort(function (a, b) { return (a.id === expected ? 0 : 1) - (b.id === expected ? 0 : 1); });
        }
        if (!list.length) { cb(null, { servers: [], noNetwork: res.noNetwork, networks: res.networks }); return; }
        if (list.length === 1 || onlyId) { cb(pick(list[0]), { servers: list }); return; }
        cb(null, { servers: list });
      });
    }
    if (opts.lanOnly) {
      lan();
    } else {
      if (opts.onProgress) { opts.onProgress({ percent: 0, label: 'Conectando con el servidor…' }); }
      SS.pingFirst(SS.storeCandidates(), expected, function (hit) {
        if (cancelled) { return; }
        if (hit) {
          cb({ url: hit.url, id: hit.ping.id, name: hit.ping.name, clientPorts: hit.ping.clientPorts, trusted: hit.trusted }, {});
          return;
        }
        lan();
      });
    }
    return {
      cancel: function () {
        cancelled = true;
        if (search) { search.cancel(); } else { cb(null, { cancelled: true }); }
      }
    };
  };
})(typeof window !== 'undefined' ? window : global);
