/*
 * Parser M3U / M3U8 (listas extendidas IPTV). ES5, sin dependencias de DOM.
 * Soporta: BOM, CRLF/CR/LF, #EXTM3U url-tvg, #EXTINF con atributos (tvg-id, tvg-name, tvg-logo,
 * group-title...), títulos con comas, #EXTGRP, #EXTVLCOPT (user-agent / referrer), URLs sin #EXTINF.
 * Procesa en bloques con setTimeout para no congelar la TV con listas de 20k+ entradas.
 * Utilizable en Node (module.exports) para pruebas.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};

  var M3U = {};
  var NO_GROUP = 'Sin categoría';
  M3U.NO_GROUP = NO_GROUP;

  M3U.VOD_EXT = { mp4: 1, mkv: 1, avi: 1, mov: 1, m4v: 1, wmv: 1, flv: 1, webm: 1, mpg: 1, mpeg: 1, divx: 1, xvid: 1, '3gp': 1 };

  function hash(s) {
    var h = 5381, i;
    for (i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36);
  }

  function urlExt(url) {
    var p = url.split('?')[0].split('#')[0];
    var m = /\.([a-z0-9]{2,5})$/i.exec(p);
    return m ? m[1].toLowerCase() : '';
  }

  /* Clasifica por URL: /movie/ → película, /series/ → serie, extensión de vídeo → película, resto → en vivo */
  M3U.classify = function (url) {
    var path = String(url || '').split('?')[0].toLowerCase();
    if (path.indexOf('/movie/') >= 0) { return 'movie'; }
    if (path.indexOf('/series/') >= 0) { return 'series'; }
    if (M3U.VOD_EXT[urlExt(path)]) { return 'movie'; }
    return 'live';
  };

  /* Analiza el contenido tras "#EXTINF:" → {duration, attrs, title} */
  M3U.parseExtinf = function (s) {
    var i = 0, n = s.length, c, key, val, q, start;
    var attrs = {}, title = '', duration = -1;

    /* duración */
    start = i;
    while (i < n) { c = s.charAt(i); if (c === ' ' || c === ',' || c === '\t') { break; } i++; }
    duration = parseFloat(s.substring(start, i));
    if (isNaN(duration)) { duration = -1; }

    while (i < n) {
      c = s.charAt(i);
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === ',') { title = s.substring(i + 1); break; }
      /* clave */
      start = i;
      while (i < n) { c = s.charAt(i); if (c === '=' || c === ' ' || c === ',' || c === '\t') { break; } i++; }
      key = s.substring(start, i).toLowerCase();
      if (i < n && s.charAt(i) === '=') {
        i++;
        q = s.charAt(i);
        if (q === '"' || q === "'") {
          i++;
          start = i;
          while (i < n && s.charAt(i) !== q) { i++; }
          val = s.substring(start, i);
          i++; /* comilla de cierre */
        } else {
          start = i;
          while (i < n) { c = s.charAt(i); if (c === ' ' || c === ',' || c === '\t') { break; } i++; }
          val = s.substring(start, i);
        }
        if (key) { attrs[key] = val; }
      }
      /* token suelto sin '=' se ignora */
    }
    return { duration: duration, attrs: attrs, title: title.trim() };
  };

  /* Estado incremental del parser */
  function Parser() {
    this.result = {
      epgUrl: '',
      total: 0,
      live: [], movie: [], series: [],
      groups: { live: [], movie: [], series: [] }
    };
    this._groupIndex = { live: {}, movie: {}, series: {} };
    this._ids = {};
    this._pending = null;   /* datos del último #EXTINF */
    this._extgrp = '';
    this._opts = null;
    this._liveNum = 0;
  }

  Parser.prototype.line = function (raw) {
    var line = raw.trim();
    if (!line) { return; }
    if (line.charAt(0) === '#') {
      var upper = line.substr(0, 10).toUpperCase();
      if (upper.indexOf('#EXTINF:') === 0) {
        this._pending = M3U.parseExtinf(line.substring(8));
      } else if (upper.indexOf('#EXTGRP:') === 0) {
        this._extgrp = line.substring(8).trim();
      } else if (upper.indexOf('#EXTM3U') === 0) {
        var h = M3U.parseExtinf(line.substring(7));
        this.result.epgUrl = h.attrs['url-tvg'] || h.attrs['x-tvg-url'] || h.attrs['tvg-url'] || this.result.epgUrl;
      } else if (upper.indexOf('#EXTVLCOPT') === 0) {
        var m = /^#EXTVLCOPT:\s*http-(user-agent|referrer)=(.*)$/i.exec(line);
        if (m) { this._opts = this._opts || {}; this._opts[m[1].toLowerCase() === 'user-agent' ? 'ua' : 'referrer'] = m[2].trim(); }
      }
      return;
    }
    this._entry(line);
  };

  Parser.prototype._entry = function (url) {
    var p = this._pending || { duration: -1, attrs: {}, title: '' };
    var a = p.attrs;
    var type = M3U.classify(url);
    var name = p.title || a['tvg-name'] || '';
    if (!name) {
      name = decodeSafe(url.split('?')[0].split('/').pop()) || url;
    }
    var group = (a['group-title'] || this._extgrp || '').trim() || NO_GROUP;

    var id = 'm' + hash(url + '|' + name);
    if (this._ids[id]) { this._ids[id]++; id = id + '_' + this._ids[id]; } else { this._ids[id] = 1; }

    var item = {
      type: type,
      id: id,
      name: name,
      logo: a['tvg-logo'] || a.logo || '',
      cat: group,
      catName: group,
      epg: a['tvg-id'] || '',
      url: url
    };
    if (type === 'live') { this._liveNum++; item.num = parseInt(a['tvg-chno'], 10) || this._liveNum; }
    else { item.ext = urlExt(url); }
    if (this._opts) { if (this._opts.ua) { item.ua = this._opts.ua; } if (this._opts.referrer) { item.referrer = this._opts.referrer; } }

    this.result[type].push(item);
    this.result.total++;

    var gi = this._groupIndex[type];
    if (gi[group] === undefined) {
      gi[group] = this.result.groups[type].length;
      this.result.groups[type].push({ id: group, name: group, count: 0 });
    }
    this.result.groups[type][gi[group]].count++;

    this._pending = null;
    this._extgrp = '';
    this._opts = null;
  };

  function decodeSafe(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function stripBom(text) {
    return text.charCodeAt(0) === 0xFEFF ? text.substring(1) : text;
  }

  /* Siguiente línea desde pos; devuelve [línea, nuevaPos] con nuevaPos=-1 al final */
  function nextLine(text, pos) {
    var n = text.length, i = pos, c;
    while (i < n) {
      c = text.charCodeAt(i);
      if (c === 10 || c === 13) { break; }
      i++;
    }
    var line = text.substring(pos, i);
    if (i >= n) { return [line, -1]; }
    if (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10) { i++; }
    return [line, i + 1];
  }

  /* Parseo síncrono (Node / listas pequeñas) */
  M3U.parse = function (text) {
    var p = new Parser(), pos = 0, r;
    text = stripBom(String(text || ''));
    while (pos >= 0 && pos < text.length) {
      r = nextLine(text, pos);
      p.line(r[0]);
      pos = r[1];
    }
    return p.result;
  };

  /*
   * Parseo asíncrono por bloques.
   * opts: {linesPerChunk (1500), delay (0)}
   * onProgress(fraccion 0..1, entradas) ; onDone(result)
   * Devuelve {cancel: fn}
   */
  M3U.parseAsync = function (text, opts, onProgress, onDone) {
    opts = opts || {};
    var per = opts.linesPerChunk || 1500;
    var delay = opts.delay || 0;
    var p = new Parser(), pos = 0, cancelled = false;
    text = stripBom(String(text || ''));
    var len = text.length || 1;
    var timer = opts.setTimeout || setTimeout;

    function step() {
      if (cancelled) { return; }
      var k = 0, r;
      while (k < per && pos >= 0 && pos < text.length) {
        r = nextLine(text, pos);
        p.line(r[0]);
        pos = r[1];
        k++;
      }
      if (pos < 0 || pos >= text.length) {
        if (onProgress) { onProgress(1, p.result.total); }
        onDone(p.result);
        return;
      }
      if (onProgress) { onProgress(pos / len, p.result.total); }
      timer(step, delay);
    }
    timer(step, 0);
    return { cancel: function () { cancelled = true; } };
  };

  M3U.looksLikeM3U = function (text) {
    var t = stripBom(String(text || '')).substr(0, 2048).toUpperCase();
    return t.indexOf('#EXTM3U') >= 0 || t.indexOf('#EXTINF') >= 0;
  };

  IPTV.M3U = M3U;
  if (typeof module !== 'undefined' && module.exports) { module.exports = M3U; }
})(typeof window !== 'undefined' ? window : global);
