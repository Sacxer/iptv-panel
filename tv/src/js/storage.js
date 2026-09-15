/* Persistencia en localStorage: perfiles, favoritos, recientes, posiciones, ajustes. ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util;
  var PREFIX = 'iptv.';
  var memory = {};

  function ls() {
    try {
      var s = root.localStorage;
      if (!s) { return null; }
      return s;
    } catch (e) { return null; }
  }

  var S = IPTV.storage = {};

  S.get = function (key, def) {
    var raw = null, s = ls();
    try { raw = s ? s.getItem(PREFIX + key) : memory[key]; } catch (e) { raw = memory[key]; }
    if (raw === null || raw === undefined) { return def; }
    try { return JSON.parse(raw); } catch (e2) { return def; }
  };

  S.set = function (key, value) {
    var raw = JSON.stringify(value), s = ls();
    memory[key] = raw;
    try { if (s) { s.setItem(PREFIX + key, raw); } return true; } catch (e) {
      U.log('localStorage lleno o no disponible', e);
      return false;
    }
  };

  S.remove = function (key) {
    var s = ls();
    delete memory[key];
    try { if (s) { s.removeItem(PREFIX + key); } } catch (e) { /* nada */ }
  };

  /* ---------- Perfiles ---------- */
  S.getProfiles = function () { return S.get('profiles', []); };

  S.saveProfile = function (p) {
    var list = S.getProfiles();
    if (!p.id) { p.id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1000); p.created = Date.now(); }
    var i = U.findIndex(list, function (x) { return x.id === p.id; });
    if (i >= 0) { list[i] = p; } else { list.push(p); }
    S.set('profiles', list);
    return p;
  };

  S.deleteProfile = function (id) {
    var list = S.getProfiles().filter(function (x) { return x.id !== id; });
    S.set('profiles', list);
    S.remove('fav.' + id); S.remove('recent.' + id); S.remove('pos.' + id); S.remove('seen.' + id);
    if (S.get('activeProfile') === id) { S.remove('activeProfile'); }
  };

  S.getProfile = function (id) {
    return U.find(S.getProfiles(), function (x) { return x.id === id; });
  };

  /* ---------- Ajustes ---------- */
  var DEFAULT_SETTINGS = { liveFormat: 'auto', preview: true };
  S.getSettings = function () { return U.extend({}, DEFAULT_SETTINGS, S.get('settings', {})); };
  S.setSetting = function (k, v) { var s = S.getSettings(); s[k] = v; S.set('settings', s); return s; };

  /* ---------- Snapshot mínimo de un ítem (para favoritos / recientes) ---------- */
  S.snapshot = function (item) {
    var o = {}, keys = ['type', 'id', 'name', 'logo', 'cat', 'catName', 'num', 'ext', 'url', 'epg', 'seriesId', 'seriesName', 'season', 'episode', 'plot', 'rating', 'year', 'ua'];
    U.each(keys, function (k) { if (item[k] !== undefined && item[k] !== null && item[k] !== '') { o[k] = item[k]; } });
    return o;
  };

  S.itemKey = function (item) { return item.type + ':' + item.id; };

  /* ---------- Favoritos ---------- */
  S.getFavorites = function (pid) { return S.get('fav.' + pid, []); };

  S.isFavorite = function (pid, item) {
    var k = S.itemKey(item);
    return !!U.find(S.getFavorites(pid), function (x) { return S.itemKey(x) === k; });
  };

  /* Alterna favorito. Devuelve true si quedó marcado. */
  S.toggleFavorite = function (pid, item) {
    var list = S.getFavorites(pid), k = S.itemKey(item);
    var i = U.findIndex(list, function (x) { return S.itemKey(x) === k; });
    if (i >= 0) { list.splice(i, 1); S.set('fav.' + pid, list); return false; }
    list.unshift(S.snapshot(item));
    S.set('fav.' + pid, list);
    return true;
  };

  /* ---------- Recientes ---------- */
  var MAX_RECENT = 60;
  S.getRecents = function (pid) { return S.get('recent.' + pid, []); };

  S.addRecent = function (pid, item) {
    var list = S.getRecents(pid), k = S.itemKey(item);
    list = list.filter(function (x) { return S.itemKey(x) !== k; });
    var snap = S.snapshot(item);
    snap.ts = Date.now();
    list.unshift(snap);
    if (list.length > MAX_RECENT) { list.length = MAX_RECENT; }
    S.set('recent.' + pid, list);
  };

  S.clearRecents = function (pid) { S.set('recent.' + pid, []); };

  /* ---------- Posición de reproducción (VOD) ---------- */
  var MAX_POS = 200;
  S.getPosition = function (pid, item) {
    var map = S.get('pos.' + pid, {});
    return map[S.itemKey(item)] || null;
  };

  S.setPosition = function (pid, item, t, d) {
    var map = S.get('pos.' + pid, {}), k = S.itemKey(item), keys;
    if (!t || t < 30 || (d && d - t < 60)) { delete map[k]; }
    else { map[k] = { t: Math.floor(t), d: Math.floor(d || 0), ts: Date.now() }; }
    keys = Object.keys(map);
    if (keys.length > MAX_POS) {
      keys.sort(function (a, b) { return map[a].ts - map[b].ts; });
      U.each(keys.slice(0, keys.length - MAX_POS), function (kk) { delete map[kk]; });
    }
    S.set('pos.' + pid, map);
  };

  /* ---------- Popups de avisos ya mostrados ---------- */
  S.wasSeen = function (pid, noticeId) {
    var l = S.get('seen.' + pid, []);
    return l.indexOf(String(noticeId)) >= 0;
  };
  S.markSeen = function (pid, noticeId) {
    var l = S.get('seen.' + pid, []);
    if (l.indexOf(String(noticeId)) < 0) { l.push(String(noticeId)); if (l.length > 300) { l.shift(); } S.set('seen.' + pid, l); }
  };
})(typeof window !== 'undefined' ? window : global);
