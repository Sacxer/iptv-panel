/* Utilidades generales. ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util = {};

  IPTV.VERSION = '1.0.0';

  /* ---------- Plataforma ---------- */
  U.detectPlatform = function () {
    var ua = (root.navigator && root.navigator.userAgent) || '';
    if (typeof root.tizen !== 'undefined' || (typeof root.webapis !== 'undefined' && root.webapis.avplay) || /Tizen/i.test(ua)) {
      return 'tizen';
    }
    if (root.PalmSystem || root.webOS || /Web0S|webOS|NetCast/i.test(ua)) {
      return 'webos';
    }
    return 'browser';
  };

  /* ---------- Objetos / arrays ---------- */
  U.extend = function (target) {
    var i, k, src;
    target = target || {};
    for (i = 1; i < arguments.length; i++) {
      src = arguments[i];
      if (!src) { continue; }
      for (k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) { target[k] = src[k]; } }
    }
    return target;
  };

  U.each = function (arr, fn) {
    var i;
    if (!arr) { return; }
    for (i = 0; i < arr.length; i++) { if (fn(arr[i], i) === false) { break; } }
  };

  U.find = function (arr, fn) {
    var i;
    if (!arr) { return null; }
    for (i = 0; i < arr.length; i++) { if (fn(arr[i], i)) { return arr[i]; } }
    return null;
  };

  U.findIndex = function (arr, fn) {
    var i;
    if (!arr) { return -1; }
    for (i = 0; i < arr.length; i++) { if (fn(arr[i], i)) { return i; } }
    return -1;
  };

  U.isArray = function (a) { return Object.prototype.toString.call(a) === '[object Array]'; };

  U.clamp = function (v, min, max) { return v < min ? min : (v > max ? max : v); };

  /* ---------- Texto ---------- */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  U.escapeHtml = function (s) {
    if (s === null || s === undefined) { return ''; }
    return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  };

  var ACCENTS = { 'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'ã': 'a', 'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e',
    'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i', 'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'õ': 'o',
    'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u', 'ñ': 'n', 'ç': 'c' };
  /* Normaliza para búsqueda: minúsculas y sin tildes. */
  U.normalize = function (s) {
    if (!s) { return ''; }
    return String(s).toLowerCase().replace(/[áàäâãéèëêíìïîóòöôõúùüûñç]/g, function (c) { return ACCENTS[c]; });
  };

  U.pad2 = function (n) { return n < 10 ? '0' + n : String(n); };

  /* Segundos → "h:mm:ss" o "mm:ss" */
  U.formatDuration = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h > 0 ? h + ':' + U.pad2(m) : m) + ':' + U.pad2(s);
  };

  U.DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  U.MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  U.formatClock = function (d) {
    d = d || new Date();
    return U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
  };

  U.formatDateLong = function (d) {
    d = d || new Date();
    return U.DAYS[d.getDay()] + ', ' + d.getDate() + ' de ' + U.MONTHS[d.getMonth()];
  };

  /* Unix (segundos, número o string) → "14 de septiembre de 2026" */
  U.formatUnixDate = function (ts) {
    var n = parseInt(ts, 10);
    if (!n) { return 'Sin vencimiento'; }
    var d = new Date(n * 1000);
    return d.getDate() + ' de ' + U.MONTHS[d.getMonth()] + ' de ' + d.getFullYear();
  };

  U.formatUnixDateTime = function (ts) {
    var n = parseInt(ts, 10);
    if (!n) { return ''; }
    var d = new Date(n * 1000);
    return d.getDate() + '/' + U.pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
  };

  /* Hash rápido (djb2) → base36. Sirve para ids estables de entradas M3U. */
  U.hash = function (s) {
    var h = 5381, i;
    s = String(s);
    for (i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36);
  };

  /* Base64 → texto UTF-8 (EPG de Xtream) */
  U.b64decode = function (s) {
    if (!s) { return ''; }
    try {
      var bin = root.atob ? root.atob(s) : (typeof Buffer !== 'undefined' ? new Buffer(s, 'base64').toString('binary') : s);
      try { return decodeURIComponent(escape(bin)); } catch (e1) { return bin; }
    } catch (e) { return s; }
  };

  /* ---------- URLs ---------- */
  /* Normaliza la URL del servidor Xtream: agrega http://, quita barra final y player_api.php */
  U.normalizeServer = function (url) {
    url = String(url || '').trim();
    if (!url) { return ''; }
    if (!/^https?:\/\//i.test(url)) { url = 'http://' + url; }
    url = url.replace(/\/(player_api|get|panel_api|xmltv)\.php.*$/i, '');
    url = url.replace(/\/+$/, '');
    return url;
  };

  U.qs = function (params) {
    var parts = [], k;
    for (k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== undefined && params[k] !== null) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
    }
    return parts.join('&');
  };

  /* Extensión del path (sin query) en minúsculas */
  U.urlExt = function (url) {
    var p = String(url || '').split('?')[0].split('#')[0];
    var m = /\.([a-z0-9]{2,5})$/i.exec(p);
    return m ? m[1].toLowerCase() : '';
  };

  /* ---------- Tiempo ---------- */
  U.debounce = function (fn, ms) {
    var t = null;
    var d = function () {
      var ctx = this, args = arguments;
      if (t) { clearTimeout(t); }
      t = setTimeout(function () { t = null; fn.apply(ctx, args); }, ms);
    };
    d.cancel = function () { if (t) { clearTimeout(t); t = null; } };
    return d;
  };

  U.nowSec = function () { return Math.floor(Date.now() / 1000); };

  /* ---------- Eventos simples ---------- */
  U.Emitter = function () { this._h = {}; };
  U.Emitter.prototype.on = function (ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; };
  U.Emitter.prototype.off = function (ev, fn) {
    var l = this._h[ev], i;
    if (!l) { return this; }
    if (!fn) { this._h[ev] = []; return this; }
    for (i = l.length - 1; i >= 0; i--) { if (l[i] === fn) { l.splice(i, 1); } }
    return this;
  };
  U.Emitter.prototype.emit = function (ev) {
    var l = this._h[ev], i, args = Array.prototype.slice.call(arguments, 1);
    if (!l) { return; }
    l = l.slice();
    for (i = 0; i < l.length; i++) {
      try { l[i].apply(null, args); } catch (e) { if (root.console) { root.console.error('Emitter ' + ev, e); } }
    }
  };

  /* ---------- DOM (solo navegador) ---------- */
  /* h('div', {className:'x', text:'hola'}, [hijos]) */
  U.h = function (tag, attrs, children) {
    var el = root.document.createElement(tag), k, i;
    if (attrs) {
      for (k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) { continue; }
        var v = attrs[k];
        if (v === undefined || v === null) { continue; }
        if (k === 'className') { el.className = v; }
        else if (k === 'text') { el.textContent = v; }
        else if (k === 'html') { el.innerHTML = v; }
        else if (k === 'style' && typeof v === 'object') { U.extend(el.style, v); }
        else if (k.charAt(0) === '_' ) { el[k] = v; }
        else { el.setAttribute(k, v); }
      }
    }
    if (children) {
      if (!U.isArray(children)) { children = [children]; }
      for (i = 0; i < children.length; i++) {
        if (children[i] === null || children[i] === undefined) { continue; }
        el.appendChild(typeof children[i] === 'string' ? root.document.createTextNode(children[i]) : children[i]);
      }
    }
    return el;
  };

  U.$ = function (id) { return root.document.getElementById(id); };

  U.empty = function (el) { while (el && el.firstChild) { el.removeChild(el.firstChild); } };

  U.show = function (el, visible) {
    if (!el) { return; }
    if (visible === false) { el.classList.add('hidden'); } else { el.classList.remove('hidden'); }
  };
  U.hide = function (el) { U.show(el, false); };

  /* Iniciales para portadas sin imagen */
  U.initials = function (name) {
    var w = String(name || '?').replace(/[^\wÁÉÍÓÚÑáéíóúñ ]/g, ' ').trim().split(/\s+/);
    return ((w[0] || '?').charAt(0) + (w[1] ? w[1].charAt(0) : '')).toUpperCase();
  };

  /* Imagen con respaldo: si falla, oculta y deja visible el placeholder del contenedor */
  U.setImg = function (img, src) {
    if (!img) { return; }
    if (!src) { img.removeAttribute('src'); img.style.visibility = 'hidden'; return; }
    if (img.getAttribute('data-src') === src) { return; }
    img.setAttribute('data-src', src);
    img.style.visibility = 'hidden';
    img.onload = function () { img.style.visibility = 'visible'; };
    img.onerror = function () { img.style.visibility = 'hidden'; };
    img.src = src;
  };

  /* Iconos SVG simples (sin fuentes externas) */
  var ICONS = {
    live: 'M3 6h18v12H3z M8 21h8 M12 18v3',
    movie: 'M4 4h16v16H4z M4 9h16 M4 15h16 M9 4v16 M15 4v16',
    series: 'M3 7h14v12H3z M7 3h14v12',
    fav: 'M12 3l2.8 5.9 6.2.8-4.5 4.3 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.7l6.2-.8z',
    recent: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 7v5l3 3',
    search: 'M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M15 15l6 6',
    messages: 'M3 5h18v14H3z M3 5l9 7 9-7',
    account: 'M12 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M4 21c0-4 4-6 8-6s8 2 8 6',
    play: 'M7 4l13 8-13 8z',
    pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
    back: 'M15 4l-8 8 8 8',
    plus: 'M12 4v16 M4 12h16'
  };
  U.icon = function (name, cls) {
    var d = ICONS[name] || '';
    var filled = (name === 'play' || name === 'pause');
    return '<svg class="icon ' + (cls || '') + '" viewBox="0 0 24 24" width="24" height="24"><path d="' + d + '" fill="' + (filled ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  };

  U.log = function () {
    if (root.console && root.console.log) {
      try { root.console.log.apply(root.console, ['[IPTV]'].concat(Array.prototype.slice.call(arguments))); } catch (e) { /* nada */ }
    }
  };
})(typeof window !== 'undefined' ? window : global);
