/*
 * Arranque de la aplicación, gestor de pantallas, enrutado de teclas y flujo de sesión.
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, S = IPTV.storage, F = IPTV.focus, K = IPTV.keys, UI = IPTV.ui, P = IPTV.player;
  var doc = root.document;
  var screens = IPTV.screens = IPTV.screens || {};

  var App = IPTV.app = {
    stack: [],
    profile: null,
    source: null,
    auth: null,
    xtreamBlock: null
  };

  /* ======================= Escala 1920x1080 ======================= */
  function applyScale() {
    var w = root.innerWidth || 1920, hgt = root.innerHeight || 1080;
    var s = Math.min(w / 1920, hgt / 1080);
    IPTV.scale = s;
    var app = doc.getElementById('app');
    var t = 'scale(' + s + ')';
    app.style.webkitTransform = t;
    app.style.transform = t;
    app.style.left = Math.floor((w - 1920 * s) / 2) + 'px';
    app.style.top = Math.floor((hgt - 1080 * s) / 2) + 'px';
  }

  /* ======================= Pantallas ======================= */
  function ensureCreated(s) {
    if (s.el) { return; }
    s.el = s.create();
    s.el.classList.add('screen');
    s.el.classList.add('hidden');
    doc.getElementById('screens').appendChild(s.el);
  }

  App.get = function (name) { return screens[name]; };
  App.top = function () { return App.stack.length ? App.stack[App.stack.length - 1] : null; };
  App.topName = function () { var t = App.top(); return t ? t.name : ''; };
  App.isOnStack = function (name) { return U.findIndex(App.stack, function (s) { return s.name === name; }) >= 0; };

  App.push = function (name, params) {
    var s = screens[name], top = App.top();
    if (!s) { U.log('Pantalla desconocida', name); return; }
    s.name = name;
    ensureCreated(s);
    if (top) {
      if (top.pause) { top.pause(); }
      if (!s.overlay) { top.el.classList.add('hidden'); }
    }
    s.el.classList.remove('hidden');
    F.pushLayer(s.el);
    App.stack.push(s);
    if (s.show) { s.show(params || {}); }
    var cur = F.get();
    if (!cur || !s.el.contains(cur)) { F.first(s.el); }
  };

  App.pop = function () {
    if (App.stack.length <= 1) { return; }
    var s = App.stack.pop(), prev = App.top();
    if (s.hide) { s.hide(); }
    s.el.classList.add('hidden');
    prev.el.classList.remove('hidden');
    F.popLayer(s.el);
    if (prev.resume) { prev.resume(); }
    var cur = F.get();
    if (!cur || !prev.el.contains(cur)) { F.first(prev.el); }
  };

  /* Quita una pantalla concreta del stack (p. ej. bloqueo resuelto) */
  App.remove = function (name) {
    var i = U.findIndex(App.stack, function (s) { return s.name === name; });
    if (i < 0) { return; }
    if (i === App.stack.length - 1) { App.pop(); return; }
    var s = App.stack[i];
    App.stack.splice(i, 1);
    if (s.hide) { s.hide(); }
    s.el.classList.add('hidden');
    F.popLayer(s.el);
  };

  /* Vacía el stack y muestra una pantalla */
  App.reset = function (name, params) {
    UI.Dialog.closeAll();
    while (App.stack.length) {
      var s = App.stack.pop();
      if (s.hide) { s.hide(); }
      s.el.classList.add('hidden');
      F.popLayer(s.el);
    }
    F.clear();
    App.push(name, params);
  };

  App.back = function () {
    if (App.stack.length > 1) { App.pop(); return; }
    App.askExit();
  };

  App.askExit = function () {
    UI.Dialog.confirm('Salir', '¿Desea salir de la aplicación?', 'Salir', function () {
      P.stop();
      K.exitApp();
    }, 'Cancelar');
  };

  /* ======================= Teclado / control remoto ======================= */
  function onKeyDown(e) {
    var editing = UI.isEditing();
    var t = K.translate(e, editing);

    if (editing) {
      var input = doc.activeElement;
      if (t.action === 'ok') {
        e.preventDefault();
        input.blur();
        if (input.__onSubmit) { input.__onSubmit(input.value); } else { F.move('down'); }
      } else if (t.action === 'back') {
        e.preventDefault();
        input.blur();
      } else if (t.action === 'up' || t.action === 'down') {
        e.preventDefault();
        input.blur();
        F.move(t.action);
      }
      return;
    }

    if (!t.action) { return; }
    e.preventDefault();
    if (e.stopPropagation) { e.stopPropagation(); }

    if (t.action === 'exit') { P.stop(); K.exitApp(); return; }

    var dlg = UI.Dialog.top();
    if (dlg) {
      if (dlg.opts.onKey && dlg.opts.onKey(t.action, t, dlg)) { return; }
      if (K.isArrow(t.action)) { F.move(t.action); }
      else if (t.action === 'ok') { F.ok(); }
      else if (t.action === 'back') { dlg.back(); }
      return;
    }

    var s = App.top();
    if (!s) { return; }
    if (s.onKey && s.onKey(t.action, t)) { return; }
    if (K.isArrow(t.action)) { F.move(t.action); }
    else if (t.action === 'ok') { F.ok(); }
    else if (t.action === 'back') {
      if (!(s.onBack && s.onBack())) { App.back(); }
    }
  }

  /* Ratón (útil al probar en el navegador) */
  function onClick(e) {
    var el = e.target;
    while (el && el !== doc.body && !(el.classList && el.classList.contains('focusable'))) { el = el.parentNode; }
    if (!el || el === doc.body) { return; }
    var layer = F.root();
    if (layer && !layer.contains(el)) { return; }
    F.set(el);
    if (el.__isInput) { return; }
    F.ok();
  }

  /* ======================= Sesión ======================= */
  App.connect = function (profile) {
    P.stop();
    IPTV.portal.stop();
    App.profile = profile;
    App.auth = null;
    App.xtreamBlock = null;
    App.source = IPTV.createSource(profile);
    var source = App.source;
    App.reset('loading', { text: 'Conectando…' });

    source.connect(function (text, frac) {
      screens.loading.setText(text, frac);
    }, function (err, auth) {
      if (source !== App.source) { return; }
      if (err) {
        App.reset('login', { error: err.message, editProfile: err.code === 'auth' ? profile : null });
        return;
      }
      S.set('activeProfile', profile.id);
      App.auth = auth;
      if (auth && !auth.ok) {
        App.xtreamBlock = xtreamBlockInfo(auth);
      }
      var pending = 2;
      function next() {
        pending--;
        if (pending > 0 || source !== App.source) { return; }
        App.reset('shell');
        App.checkBlock();
      }
      screens.loading.setText('Comprobando servicios…');
      IPTV.portal.start(profile, function () { next(); });
      if (App.xtreamBlock || source.type !== 'xtream') { next(); }
      else {
        screens.loading.setText('Cargando canales…');
        source.load('live', function () { next(); });
      }
    });
  };

  function xtreamBlockInfo(auth) {
    var st = String(auth.status || '').toLowerCase();
    var titles = { expired: 'Suscripción vencida', banned: 'Servicio suspendido', disabled: 'Cuenta deshabilitada' };
    var reason = auth.message || '';
    if (!reason && st === 'expired' && auth.user && auth.user.exp_date) {
      reason = 'Su suscripción venció el ' + U.formatUnixDate(auth.user.exp_date) + '.';
    }
    return { kind: st, title: titles[st] || ('Cuenta no activa (' + auth.status + ')'), reason: reason };
  }

  App.logout = function () {
    P.stop();
    IPTV.portal.stop();
    App.source = null;
    App.profile = null;
    S.remove('activeProfile');
    App.reset('login');
  };

  App.currentBlock = function () {
    return IPTV.portal.blockInfo() || App.xtreamBlock;
  };

  /* Muestra u oculta la pantalla de bloqueo según el estado actual */
  App.checkBlock = function () {
    if (!App.profile) { return; }
    var info = App.currentBlock();
    if (info) {
      P.stop();
      doc.documentElement.classList.remove('video-on');
      if (App.isOnStack('block')) { screens.block.update(info); }
      else {
        UI.Dialog.closeAll();
        App.push('block', { info: info });
      }
    } else if (App.isOnStack('block')) {
      App.remove('block');
    }
  };

  /* Recarga el perfil actual (reautentica y vuelve a descargar listas) */
  App.reload = function () {
    if (App.profile) { App.connect(App.profile); }
  };

  /* ======================= Reproducción ======================= */
  App.isFavorite = function (item) { return App.profile ? S.isFavorite(App.profile.id, item) : false; };

  App.toggleFavorite = function (item) {
    if (!App.profile || !item) { return false; }
    var on = S.toggleFavorite(App.profile.id, item);
    UI.toast(on ? 'Añadido a Favoritos' : 'Quitado de Favoritos');
    return on;
  };

  App.playbackOptions = function (item) {
    var url = App.source.urlFor(item);
    return { url: url, altUrl: item.type === 'live' ? App.source.altUrl(url) : null, live: item.type === 'live' };
  };

  /*
   * Abre el reproductor a pantalla completa.
   * ctx: {list, index, startTime, fromPreview (bool)}
   */
  App.play = function (item, ctx) {
    ctx = ctx || {};
    if (App.currentBlock()) { App.checkBlock(); return; }
    if (!item) { return; }
    var list = ctx.list || [item];
    var index = ctx.index !== undefined ? ctx.index : U.findIndex(list, function (x) { return x === item; });
    if (index < 0) { list = [item]; index = 0; }

    function go(startTime) {
      App.push('player', { list: list, index: index, startTime: startTime || 0, fromPreview: !!ctx.fromPreview });
    }

    if ((item.type === 'movie' || item.type === 'episode') && ctx.startTime === undefined && App.profile) {
      var pos = S.getPosition(App.profile.id, item);
      if (pos && pos.t > 30) {
        UI.Dialog.open({
          title: item.name,
          text: 'Continuar donde lo dejó (' + U.formatDuration(pos.t) + ')?',
          buttons: [
            { label: 'Continuar', action: function () { setTimeout(function () { go(pos.t); }, 0); } },
            { label: 'Desde el inicio', action: function () { setTimeout(function () { go(0); }, 0); } }
          ]
        });
        return;
      }
    }
    go(ctx.startTime || 0);
  };

  /* Abre el detalle adecuado según el tipo (desde Favoritos, Recientes o Buscar) */
  App.open = function (item, ctx) {
    if (!item) { return; }
    if (item.type === 'movie') { App.push('vodDetail', { item: item }); }
    else if (item.type === 'series' && App.source && App.source.hasSeriesInfo) { App.push('seriesDetail', { item: item }); }
    else { App.play(item, ctx); }
  };

  /* ======================= Inicio ======================= */
  App.start = function () {
    IPTV.platform = U.detectPlatform();
    doc.documentElement.classList.add('platform-' + IPTV.platform);
    applyScale();
    root.addEventListener('resize', applyScale);
    K.registerTizenKeys();
    P.init();

    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('click', onClick);

    /* webOS: al volver a primer plano, refrescar portal */
    doc.addEventListener('visibilitychange', function () {
      if (!doc.hidden && IPTV.portal.enabled) { IPTV.portal.refresh(); }
    });

    IPTV.portal.on('update', function () {
      if (screens.shell && screens.shell.onPortalUpdate) { screens.shell.onPortalUpdate(); }
      if (IPTV.notices) { IPTV.notices.update(); }
      App.checkBlock();
    });

    P.on('state', function (st) {
      if (st === 'stopped') { doc.documentElement.classList.remove('video-on'); }
    });

    var activeId = S.get('activeProfile');
    var profile = activeId ? S.getProfile(activeId) : null;
    if (profile) { App.connect(profile); }
    else { App.reset('login'); }
    U.log('Plataforma:', IPTV.platform, '· motores:', P.describeEngines());
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', App.start);
  } else {
    App.start();
  }
})(window);
