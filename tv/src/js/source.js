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
  }
  baseMethods(XtreamSource.prototype);

  XtreamSource.prototype.api = function (params, cb, timeout) {
    return H.getJSON(X.apiUrl(this.server, this.user, this.pass, params), cb, timeout);
  };

  XtreamSource.prototype.connect = function (onProgress, cb) {
    var self = this;
    if (onProgress) { onProgress('Conectando con el servidor…'); }
    this.api({}, function (err, data) {
      if (err) {
        cb({ code: 'network', message: err.status ? ('El servidor respondió con error ' + err.status) : err.message });
        return;
      }
      var auth = X.parseAuth(data);
      if (auth.reason === 'auth' || auth.reason === 'invalid') {
        cb({ code: auth.reason, message: auth.message });
        return;
      }
      self.auth = auth;
      cb(null, auth);
    }, 25000);
  };

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

  XtreamSource.prototype.liveExt = function () {
    var pref = IPTV.storage.getSettings().liveFormat;
    var formats = (this.auth && this.auth.user.formats) || [];
    if (pref === 'ts' || pref === 'm3u8') { return pref; }
    if (formats.length && formats.indexOf('ts') < 0 && formats.indexOf('m3u8') >= 0) { return 'm3u8'; }
    if (IPTV.platform === 'browser' && !root.mpegts && root.Hls) { return 'm3u8'; }
    return 'ts';
  };

  XtreamSource.prototype.urlFor = function (item) {
    switch (item.type) {
      case 'live': return X.liveUrl(this.server, this.user, this.pass, item.id, this.liveExt());
      case 'movie': return X.movieUrl(this.server, this.user, this.pass, item.id, item.ext);
      case 'episode': return X.episodeUrl(this.server, this.user, this.pass, item.id, item.ext);
      default: return item.url || '';
    }
  };

  XtreamSource.prototype.altUrl = function (url) { return X.altLiveUrl(url); };

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
