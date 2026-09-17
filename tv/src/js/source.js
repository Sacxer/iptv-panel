/*
 * Fuente de contenido unificada: XtreamSource (player_api.php) y M3USource (lista M3U).
 * Interfaz común:
 *   connect(onProgress, cb(err, auth))
 *   load(kind, cb(err))              kind: 'live' | 'movie' | 'series'
 *   isLoaded(kind)
 *   getCategories(kind) → [{id, name, count}] (incluye "Todos")
 *   getItems(kind, catId) → [items]
 *   getVodInfo(item, cb) / getSeriesInfo(item, cb) / getEpg(item, cb)
 *   urlFor(item) / altUrl(url)
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util, H = IPTV.http, X = IPTV.Xtream;
  var ALL = '*';

  function buildIndex(self, kind, cats, items) {
    var byCat = {}, catMap = {}, out = [], others = null;
    U.each(cats, function (c) { catMap[c.id] = c; c.count = 0; });
    U.each(items, function (it) {
      var c = catMap[it.cat];
      if (!c) {
        if (!others) { others = { id: '__otros', name: 'Otros', count: 0 }; catMap.__otros = others; }
        it.cat = '__otros';
        c = others;
      }
      it.catName = c.name;
      c.count++;
      (byCat[it.cat] = byCat[it.cat] || []).push(it);
    });
    out.push({ id: ALL, name: 'Todos', count: items.length });
    U.each(cats, function (c) { if (c.count > 0) { out.push(c); } });
    if (others) { out.push(others); }
    self._items[kind] = items;
    self._cats[kind] = out;
    self._byCat[kind] = byCat;
  }

  function baseInit(self, profile) {
    self.profile = profile;
    self._items = {};
    self._cats = {};
    self._byCat = {};
    self._loading = {};
    self._epgCache = {};
  }

  function baseMethods(proto) {
    proto.isLoaded = function (kind) { return !!this._items[kind]; };
    proto.getCategories = function (kind) { return this._cats[kind] || []; };
    proto.getAll = function (kind) { return this._items[kind] || []; };
    proto.getItems = function (kind, catId) {
      if (!this._items[kind]) { return []; }
      if (!catId || catId === ALL) { return this._items[kind]; }
      return this._byCat[kind][catId] || [];
    };
    proto.findItem = function (kind, id) {
      return U.find(this._items[kind] || [], function (x) { return x.id === id; });
    };
    /* Búsqueda por nombre (sin tildes). Devuelve hasta `limit` resultados por tipo. */
    proto.search = function (kind, query, limit) {
      var q = U.normalize(query).trim(), out = [], list = this._items[kind] || [], i, it;
      if (q.length < 1) { return out; }
      for (i = 0; i < list.length && out.length < (limit || 200); i++) {
        it = list[i];
        if (it._s === undefined) { it._s = U.normalize(it.name); }
        if (it._s.indexOf(q) >= 0) { out.push(it); }
      }
      return out;
    };
  }

  /* =================== Xtream =================== */
  function XtreamSource(profile) {
    baseInit(this, profile);
    this.type = 'xtream';
    this.server = U.normalizeServer(profile.server);
    this.user = profile.username;
    this.pass = profile.password;
    this.auth = null;
    this.hasSeriesInfo = true;
    this._fmt = {};
  }
  baseMethods(XtreamSource.prototype);

  /* Dirección nueva (el portal se reubicó): la usan las peticiones siguientes y las URLs de reproducción */
  XtreamSource.prototype.setServer = function (url) {
    var n = U.normalizeServer(url);
    if (n) { this.server = n; this.profile.server = n; }
  };

  /*
   * player_api.php con las cabeceras del equipo. Si falla por red / puerto del panel y el servidor es el
   * portal propio, se busca en sus otras direcciones y se repite una vez (session.js).
   */
  XtreamSource.prototype.api = function (params, cb, timeout, retried) {
    var self = this, used = this.server;
    return H.getJSON(X.apiUrl(used, this.user, this.pass, params), function (err, data) {
      if (err && err.canRelocate && !retried && IPTV.session && !self.closed) {
        IPTV.session.connectionLost(err, used, function (moved) {
          if (self.closed) { return; }
          if (moved) { self.api(params, cb, timeout, true); } else { cb(err, null); }
        });
        return;
      }
      cb(err, data);
    }, timeout, { identity: true });
  };

  XtreamSource.prototype.dispose = function () { this.closed = true; };

  /* Resultado de la autenticación → {ok, auth} o {error: {code, message}} */
  XtreamSource.evaluateAuth = function (err, data) {
    if (err) {
      if (err.status === 401 || err.status === 403) {
        /* XtreamUI y el portal responden 401/403 o auth:0 según la versión */
        return { error: { code: 'auth', message: 'Usuario o contraseña incorrectos.' } };
      }
      var msg = err.message;
      if (err.kind === 'http') { msg = 'El servidor respondió con un error (' + err.status + '). Verifique la dirección del servidor.'; }
      return { error: { code: err.kind === 'http' || err.kind === 'format' ? 'invalid' : 'network', message: msg, canRelocate: !!err.canRelocate, error: err } };
    }
    var auth = X.parseAuth(data);
    if (auth.reason === 'auth' || auth.reason === 'invalid') {
      return { error: { code: auth.reason, message: auth.message } };
    }
    return { ok: true, auth: auth };
  };

  /* Error más útil entre varios intentos: credenciales > respuesta no válida > red */
  XtreamSource.bestError = function (errors) {
    var rank = { auth: 0, invalid: 1, network: 2 }, best = null;
    U.each(errors, function (e) {
      if (e && (!best || (rank[e.code] !== undefined ? rank[e.code] : 3) < (rank[best.code] !== undefined ? rank[best.code] : 3))) { best = e; }
    });
    return best || { code: 'network', message: 'No se pudo conectar con el servidor.' };
  };

  /*
   * Inicia sesión. Con varias direcciones (perfil del operador: serverUrls) se prueban todas a la vez y se
   * usa la primera de la lista que responde; si una anterior sigue sin responder, se espera un poco antes
   * de usar una posterior. Así, si la IP local del operador choca con la red de la casa, se usa la siguiente.
   */
  XtreamSource.prototype.connect = function (onProgress, cb, candidates) {
    var self = this;
    var list = (candidates && candidates.length) ? candidates.slice() : [this.server];
    if (onProgress) { onProgress('Conectando con el servidor…'); }
    if (list.length === 1) {
      if (list[0] !== this.server) { this.setServer(list[0]); }
      var tryAuth = function (followHint) {
        self.api({}, function (err, data) {
          /* Puerto del panel: el mismo equipo indica el puerto de clientes */
          if (err && err.kind === 'panelPort' && err.clientPort && followHint && IPTV.relocate) {
            var moved = IPTV.relocate.withPort(self.server, err.clientPort);
            if (moved) {
              if (onProgress) { onProgress('Conectando con el puerto de clientes…'); }
              self.setServer(moved);
              tryAuth(false);
              return;
            }
          }
          var r = XtreamSource.evaluateAuth(err, data);
          if (r.error) { cb(r.error); return; }
          self.auth = r.auth;
          cb(null, r.auth);
        }, 25000);
      };
      tryAuth(true);
      return;
    }
    var results = [], finished = false, graceTimer = null;
    function win(k) {
      finished = true;
      if (graceTimer) { clearTimeout(graceTimer); }
      self.setServer(list[k]);
      self.auth = results[k].auth;
      cb(null, results[k].auth);
    }
    function check(fromGrace) {
      if (finished || self.closed) { return; }
      var k, pendingBefore = false, errors = [];
      for (k = 0; k < list.length; k++) {
        var r = results[k];
        if (r === undefined) { pendingBefore = true; continue; }
        if (r.ok) {
          if (!pendingBefore || fromGrace) { win(k); return; }
          if (!graceTimer) { graceTimer = setTimeout(function () { check(true); }, XtreamSource.PREFER_WAIT); }
          return;
        }
        errors.push(r.error);
      }
      if (pendingBefore) { return; }
      finished = true;
      cb(XtreamSource.bestError(errors));
    }
    function attempt(idx, url, followHint) {
      H.getJSON(X.apiUrl(url, self.user, self.pass, {}), function (err, data) {
        if (err && err.kind === 'panelPort' && err.clientPort && followHint && IPTV.relocate) {
          var moved = IPTV.relocate.withPort(url, err.clientPort);
          if (moved) { list[idx] = moved; attempt(idx, moved, false); return; }
        }
        results[idx] = XtreamSource.evaluateAuth(err, data);
        check(false);
      }, 12000, { identity: true });
    }
    U.each(list.slice(), function (url, idx) { attempt(idx, url, true); });
  };

  /* Espera por una dirección preferida que aún no responde cuando otra posterior ya respondió (ms) */
  XtreamSource.PREFER_WAIT = 2500;

  XtreamSource.prototype.load = function (kind, cb) {
    var self = this;
    if (this._items[kind]) { cb(null); return; }
    if (this._loading[kind]) { this._loading[kind].push(cb); return; }
    this._loading[kind] = [cb];
    var actions = {
      live: ['get_live_categories', 'get_live_streams', X.normLive],
      movie: ['get_vod_categories', 'get_vod_streams', X.normVod],
      series: ['get_series_categories', 'get_series', X.normSeries]
    }[kind];
    var cats = null, items = null, failed = null, pending = 2;

    function done() {
      pending--;
      if (pending > 0) { return; }
      var cbs = self._loading[kind];
      self._loading[kind] = null;
      if (failed) {
        U.each(cbs, function (f) { f(failed); });
        return;
      }
      buildIndex(self, kind, cats, items);
      U.each(cbs, function (f) { f(null); });
    }

    this.api({ action: actions[0] }, function (err, data) {
      if (err) { failed = err; } else { cats = X.normCategories(data); }
      done();
    }, 30000);
    this.api({ action: actions[1] }, function (err, data) {
      if (err) { failed = err; } else { items = actions[2](data); }
      done();
    }, 90000);
  };

  XtreamSource.prototype.reload = function () {
    this._items = {}; this._cats = {}; this._byCat = {}; this._epgCache = {};
  };

  XtreamSource.prototype.getVodInfo = function (item, cb) {
    this.api({ action: 'get_vod_info', vod_id: item.id }, function (err, data) {
      cb(err, err ? null : X.normVodInfo(data, item));
    });
  };

  XtreamSource.prototype.getSeriesInfo = function (series, cb) {
    this.api({ action: 'get_series_info', series_id: series.id }, function (err, data) {
      cb(err, err ? null : X.normSeriesInfo(data, series));
    }, 30000);
  };

  XtreamSource.prototype.getEpg = function (item, cb) {
    var self = this, key = item.id, c = this._epgCache[key];
    if (item.type !== 'live') { cb(null, []); return; }
    if (c && Date.now() - c.ts < 300000) { cb(null, c.list); return; }
    this.api({ action: 'get_short_epg', stream_id: item.id, limit: 4 }, function (err, data) {
      if (err) { cb(err, []); return; }
      var list = X.normEpg(data);
      self._epgCache[key] = { ts: Date.now(), list: list };
      cb(null, list);
    }, 10000);
  };

  XtreamSource.prototype.liveExt = function (item) {
    var pref = IPTV.storage.getSettings().liveFormat;
    var formats = (this.auth && this.auth.user.formats) || [];
    if (pref === 'ts' || pref === 'm3u8') { return pref; }
    if (item && this._fmt[item.id]) { return this._fmt[item.id]; }
    if (formats.length && formats.indexOf('ts') < 0 && formats.indexOf('m3u8') >= 0) { return 'm3u8'; }
    if (IPTV.platform === 'browser' && !root.mpegts && root.Hls) { return 'm3u8'; }
    return 'ts';
  };

  XtreamSource.prototype.urlFor = function (item) {
    var url;
    switch (item.type) {
      case 'live': url = X.liveUrl(this.server, this.user, this.pass, item.id, this.liveExt(item)); break;
      case 'movie': url = X.movieUrl(this.server, this.user, this.pass, item.id, item.ext); break;
      case 'episode': url = X.episodeUrl(this.server, this.user, this.pass, item.id, item.ext); break;
      default: return item.url || '';
    }
    /* Solo con el portal propio: otros servidores reciben la URL estándar */
    var portal = IPTV.portal;
    return (portal && portal.enabled && IPTV.device) ? X.withDevice(url, IPTV.device.id) : url;
  };

  XtreamSource.prototype.altUrl = function (url) { return X.altLiveUrl(url); };

  /* Formato (.ts / .m3u8) con el que un canal sí se vio: la próxima vez se abre directo, sin el intento fallido */
  XtreamSource.prototype.rememberFormat = function (item, ext) {
    if (item && item.type === 'live' && (ext === 'ts' || ext === 'm3u8')) { this._fmt[item.id] = ext; }
  };

  /* =================== M3U =================== */
  function M3USource(profile) {
    baseInit(this, profile);
    this.type = 'm3u';
    this.url = String(profile.m3uUrl || '').trim();
    this.hasSeriesInfo = false;
    this.auth = null;
    this.epgUrl = '';
  }
  baseMethods(M3USource.prototype);

  M3USource.prototype.connect = function (onProgress, cb) {
    var self = this;
    if (!/^https?:\/\//i.test(this.url)) { this.url = 'http://' + this.url; }
    if (onProgress) { onProgress('Descargando lista M3U…'); }
    H.getText(this.url, function (err, text) {
      if (err) {
        cb({ code: 'network', message: err.status ? ('No se pudo descargar la lista (error ' + err.status + ')') : err.message });
        return;
      }
      if (!IPTV.M3U.looksLikeM3U(text)) {
        cb({ code: 'invalid', message: 'El archivo descargado no es una lista M3U válida' });
        return;
      }
      if (onProgress) { onProgress('Procesando lista…', 0); }
      IPTV.M3U.parseAsync(text, { linesPerChunk: 1500 }, function (frac, count) {
        if (onProgress) { onProgress('Procesando lista… ' + count + ' entradas', frac); }
      }, function (result) {
        text = null;
        self.epgUrl = result.epgUrl;
        if (!result.total) { cb({ code: 'invalid', message: 'La lista M3U está vacía' }); return; }
        buildIndex(self, 'live', result.groups.live, result.live);
        buildIndex(self, 'movie', result.groups.movie, result.movie);
        buildIndex(self, 'series', result.groups.series, result.series);
        cb(null, null);
      });
    }, function (loaded) {
      if (onProgress) { onProgress('Descargando lista M3U… ' + Math.round(loaded / 1048576 * 10) / 10 + ' MB'); }
    }, 180000);
  };

  M3USource.prototype.dispose = function () { this.closed = true; };
  M3USource.prototype.load = function (kind, cb) { cb(this._items[kind] ? null : { message: 'Lista no cargada' }); };
  M3USource.prototype.reload = function () { this._items = {}; this._cats = {}; this._byCat = {}; };
  M3USource.prototype.getVodInfo = function (item, cb) { cb(null, { plot: '', genre: '', year: '', rating: '', duration: '', image: item.logo, ext: item.ext }); };
  M3USource.prototype.getSeriesInfo = function (item, cb) { cb({ message: 'No disponible en listas M3U' }); };
  M3USource.prototype.getEpg = function (item, cb) { cb(null, []); };
  M3USource.prototype.urlFor = function (item) { return item.url; };
  M3USource.prototype.altUrl = function (url) { return X.altLiveUrl(url); };

  IPTV.createSource = function (profile) {
    return profile.type === 'm3u' ? new M3USource(profile) : new XtreamSource(profile);
  };
  IPTV.ALL_CATEGORY = ALL;
  IPTV.XtreamSource = XtreamSource;
  IPTV.M3USource = M3USource;
})(typeof window !== 'undefined' ? window : global);
