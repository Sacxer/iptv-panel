/* Cliente de la API Xtream Codes (player_api.php) y normalización de datos. ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util;

  var X = {};

  X.apiUrl = function (server, user, pass, params) {
    var p = U.extend({ username: user, password: pass }, params || {});
    return server + '/player_api.php?' + U.qs(p);
  };

  /* Construye URLs de reproducción */
  X.liveUrl = function (server, user, pass, id, ext) {
    return server + '/live/' + encodeURIComponent(user) + '/' + encodeURIComponent(pass) + '/' + id + '.' + (ext || 'ts');
  };
  X.movieUrl = function (server, user, pass, id, ext) {
    return server + '/movie/' + encodeURIComponent(user) + '/' + encodeURIComponent(pass) + '/' + id + '.' + (ext || 'mp4');
  };
  X.episodeUrl = function (server, user, pass, id, ext) {
    return server + '/series/' + encodeURIComponent(user) + '/' + encodeURIComponent(pass) + '/' + id + '.' + (ext || 'mp4');
  };

  /* URL alternativa para en vivo: .ts <-> .m3u8 (null si no aplica) */
  X.altLiveUrl = function (url) {
    var m = /^(.*\/live\/[^\/]+\/[^\/]+\/[^\/?#.]+)\.(ts|m3u8)(\?.*)?$/i.exec(url || '');
    if (!m) { return null; }
    return m[1] + '.' + (m[2].toLowerCase() === 'ts' ? 'm3u8' : 'ts') + (m[3] || '');
  };

  function str(v) { return (v === null || v === undefined) ? '' : String(v); }

  function catOf(o) {
    if (o.category_id !== undefined && o.category_id !== null && o.category_id !== '') { return String(o.category_id); }
    if (U.isArray(o.category_ids) && o.category_ids.length) { return String(o.category_ids[0]); }
    return '0';
  }

  /*
   * Interpreta la respuesta de autenticación.
   * Devuelve {ok, reason: 'auth'|'status'|'invalid', status, message, user, server}
   */
  X.parseAuth = function (data) {
    if (!data || typeof data !== 'object' || !data.user_info) {
      return { ok: false, reason: 'invalid', message: 'El servidor no respondió como un servidor Xtream Codes' };
    }
    var ui = data.user_info;
    if (String(ui.auth) !== '1') {
      return { ok: false, reason: 'auth', message: 'Usuario o contraseña incorrectos' };
    }
    var status = str(ui.status) || 'Active';
    var res = {
      ok: status.toLowerCase() === 'active',
      status: status,
      message: str(ui.message),
      user: {
        username: str(ui.username),
        status: status,
        exp_date: ui.exp_date ? parseInt(ui.exp_date, 10) : null,
        is_trial: String(ui.is_trial) === '1',
        active_cons: parseInt(ui.active_cons, 10) || 0,
        max_connections: parseInt(ui.max_connections, 10) || 0,
        created_at: parseInt(ui.created_at, 10) || 0,
        formats: U.isArray(ui.allowed_output_formats) ? ui.allowed_output_formats : []
      },
      server: data.server_info || {}
    };
    if (!res.ok) { res.reason = 'status'; }
    return res;
  };

  X.statusText = function (status) {
    switch (String(status || '').toLowerCase()) {
      case 'active': return 'Activa';
      case 'expired': return 'Vencida';
      case 'banned': case 'suspended': return 'Suspendida';
      case 'disabled': return 'Deshabilitada';
      default: return String(status || 'Desconocido');
    }
  };

  X.normCategories = function (arr) {
    var out = [];
    if (!U.isArray(arr)) { return out; }
    U.each(arr, function (c) {
      out.push({ id: str(c.category_id), name: str(c.category_name) || 'Sin nombre', count: 0 });
    });
    return out;
  };

  X.normLive = function (arr) {
    var out = [];
    if (!U.isArray(arr)) { return out; }
    U.each(arr, function (s, i) {
      out.push({
        type: 'live',
        id: str(s.stream_id),
        num: parseInt(s.num, 10) || (i + 1),
        name: str(s.name) || 'Canal',
        logo: str(s.stream_icon),
        cat: catOf(s),
        epg: str(s.epg_channel_id),
        archive: parseInt(s.tv_archive, 10) || 0
      });
    });
    return out;
  };

  X.normVod = function (arr) {
    var out = [];
    if (!U.isArray(arr)) { return out; }
    U.each(arr, function (s) {
      out.push({
        type: 'movie',
        id: str(s.stream_id),
        name: str(s.name) || 'Película',
        logo: str(s.stream_icon),
        cat: catOf(s),
        ext: str(s.container_extension) || 'mp4',
        rating: str(s.rating),
        added: parseInt(s.added, 10) || 0
      });
    });
    return out;
  };

  X.normSeries = function (arr) {
    var out = [];
    if (!U.isArray(arr)) { return out; }
    U.each(arr, function (s) {
      out.push({
        type: 'series',
        id: str(s.series_id),
        name: str(s.name) || 'Serie',
        logo: str(s.cover),
        cat: catOf(s),
        plot: str(s.plot),
        genre: str(s.genre),
        cast: str(s.cast),
        director: str(s.director),
        rating: str(s.rating),
        year: str(s.releaseDate || s.release_date)
      });
    });
    return out;
  };

  X.normVodInfo = function (data, item) {
    var info = (data && data.info) || {};
    var md = (data && data.movie_data) || {};
    if (U.isArray(info)) { info = {}; }
    return {
      plot: str(info.plot || info.description),
      genre: str(info.genre),
      year: str(info.releasedate || info.release_date || info.year),
      rating: str(info.rating || (item && item.rating)),
      duration: str(info.duration),
      durationSecs: parseInt(info.duration_secs, 10) || 0,
      cast: str(info.cast || info.actors),
      director: str(info.director),
      image: str(info.movie_image || info.cover_big || (item && item.logo)),
      ext: str(md.container_extension) || (item && item.ext) || 'mp4'
    };
  };

  /* get_series_info → {info, seasons:[{num, name, episodes:[...]}]} */
  X.normSeriesInfo = function (data, series) {
    var res = { info: {}, seasons: [] };
    if (!data || typeof data !== 'object') { return res; }
    var info = data.info && !U.isArray(data.info) ? data.info : {};
    res.info = {
      plot: str(info.plot) || (series && series.plot) || '',
      genre: str(info.genre) || (series && series.genre) || '',
      cast: str(info.cast),
      director: str(info.director),
      rating: str(info.rating) || (series && series.rating) || '',
      year: str(info.releaseDate || info.release_date) || (series && series.year) || '',
      cover: str(info.cover) || (series && series.logo) || ''
    };
    var eps = data.episodes || {};
    var seasonNames = {};
    U.each(U.isArray(data.seasons) ? data.seasons : [], function (s) {
      if (s && s.season_number !== undefined) { seasonNames[String(s.season_number)] = str(s.name); }
    });
    var keys = [];
    if (U.isArray(eps)) {
      /* Algunos servidores devuelven un array de arrays */
      var tmp = {};
      U.each(eps, function (list, i) {
        var k = (list && list[0] && list[0].season !== undefined) ? String(list[0].season) : String(i + 1);
        tmp[k] = list;
      });
      eps = tmp;
    }
    keys = Object.keys(eps);
    keys.sort(function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0); });
    U.each(keys, function (k) {
      var list = eps[k];
      if (!U.isArray(list)) { return; }
      var season = { num: parseInt(k, 10) || 0, name: seasonNames[k] || ('Temporada ' + k), episodes: [] };
      U.each(list, function (e, i) {
        var ei = (e.info && !U.isArray(e.info)) ? e.info : {};
        season.episodes.push({
          type: 'episode',
          id: str(e.id),
          name: str(e.title) || ('Episodio ' + (e.episode_num || (i + 1))),
          episode: parseInt(e.episode_num, 10) || (i + 1),
          season: parseInt(e.season, 10) || season.num,
          ext: str(e.container_extension) || 'mp4',
          plot: str(ei.plot),
          duration: str(ei.duration),
          logo: str(ei.movie_image) || (series && series.logo) || '',
          seriesId: series ? series.id : '',
          seriesName: series ? series.name : ''
        });
      });
      season.episodes.sort(function (a, b) { return a.episode - b.episode; });
      res.seasons.push(season);
    });
    return res;
  };

  /* get_short_epg → [{title, desc, start, end}] (segundos unix) */
  X.normEpg = function (data) {
    var out = [];
    var list = data && data.epg_listings;
    if (!U.isArray(list)) { return out; }
    U.each(list, function (e) {
      var start = parseInt(e.start_timestamp, 10) || Math.floor(Date.parse(String(e.start || '').replace(' ', 'T') + 'Z') / 1000) || 0;
      var end = parseInt(e.stop_timestamp, 10) || Math.floor(Date.parse(String(e.end || e.stop || '').replace(' ', 'T') + 'Z') / 1000) || 0;
      out.push({ title: U.b64decode(e.title), desc: U.b64decode(e.description), start: start, end: end });
    });
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  };

  IPTV.Xtream = X;
  if (typeof module !== 'undefined' && module.exports) { module.exports = X; }
})(typeof window !== 'undefined' ? window : global);
