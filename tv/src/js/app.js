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
    xtreamBlock: null,
    playingItem: null,
    pointer: false
  };

  /* ======================= Escala 1920x1080 ======================= */
  function applyScale() {
    var w = root.innerWidth || 1920, hgt = root.innerHeight || 1080;
    var s = Math.min(w / 1920, hgt / 1080);
    var left = Math.floor((w - 1920 * s) / 2), top0 = Math.floor((hgt - 1080 * s) / 2);
    /* Solo desarrollo: IPTV.devView(x, y, ancho) amplía una zona del diseño para revisarla */
    var dv = IPTV.config.dev && App.devRegion;
    if (dv) {
      s = w / dv.w;
      left = Math.round(-dv.x * s);
      top0 = Math.round(-dv.y * s);
    }
    IPTV.scale = s;
    var app = doc.getElementById('app');
    var t = 'scale(' + s + ')';
    app.style.webkitTransform = t;
    app.style.transform = t;
    app.style.left = left + 'px';
    app.style.top = top0 + 'px';
    var top = App.top();
    if (top && top.relayout) { top.relayout(); }
  }

  IPTV.devView = function (x, y, w) {
    App.devRegion = (w && IPTV.config.dev) ? { x: x || 0, y: y || 0, w: w } : null;
    applyScale();
  };

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
    /* Con un diálogo abierto encima (p. ej. un aviso), el foco que pidió la pantalla se aplica al cerrarlo */
    if (App.top() === s && F.root() === s.el && (!cur || !s.el.contains(cur))) { F.first(s.el); }
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
    if (F.root() === prev.el && (!cur || !prev.el.contains(cur))) { F.first(prev.el); }
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
    App.backFromHome();
  };

  /*
   * Atrás en la primera pantalla.
   * - Samsung y webOS anteriores a 2023: ventana de confirmación de salida.
   * - LG webOS 23 o posterior: la lista de comprobación de LG pide volver a la pantalla de inicio del TV
   *   (webOS.platformBack), sin ventana.
   */
  App.backFromHome = function () {
    if (IPTV.platform === 'webos' && (IPTV.device.webosMajor || 0) >= 8 && K.platformBack()) {
      App.stopPlayback();
      return;
    }
    App.askExit();
  };

  /* Confirmación de salida en la primera pantalla (requisito de Samsung y LG) */
  App.askExit = function () {
    if (UI.Dialog.top() && UI.Dialog.top().opts.className === 'exit-dialog') { return; }
    UI.Dialog.open({
      title: 'Salir',
      text: '¿Desea salir de ' + (IPTV.config.appName || 'la aplicación') + '?',
      className: 'exit-dialog',
      focus: 1,
      buttons: [
        { label: 'Salir', action: function () { setTimeout(App.exit, 0); } },
        { label: 'Cancelar' }
      ]
    });
  };

  App.exit = function () {
    App.stopPlayback();
    IPTV.portal.heartbeat.stop();
    K.exitApp();
  };

  /* ======================= Teclado / control remoto ======================= */
  function onKeyDown(e) {
    var editing = UI.isEditing();
    var t = K.translate(e, editing);

    if (t.pointer) {
      App.setPointer(t.pointer === 'show');
      e.preventDefault();
      return;
    }
    if (t.action && App.pointer && t.action !== 'ok') { App.setPointer(false); }

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
    if (IPTV.lifecycle) { IPTV.lifecycle.userActivity(); }

    if (t.action === 'exit') { App.exit(); return; }

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

  /* ---------- Puntero (Magic Remote de LG, ratón en el navegador) ---------- */
  App.setPointer = function (on) {
    if (App.pointer === on) { return; }
    App.pointer = on;
    doc.documentElement.classList[on ? 'add' : 'remove']('pointer');
  };

  function focusableFrom(el) {
    while (el && el !== doc.body && !(el.classList && el.classList.contains('focusable'))) { el = el.parentNode; }
    if (!el || el === doc.body || !el.classList) { return null; }
    var layer = F.root();
    if (layer && !layer.contains(el)) { return null; }
    if (el.classList.contains('disabled') || el.classList.contains('hidden')) { return null; }
    return el;
  }

  function onClick(e) {
    var el = focusableFrom(e.target);
    if (!el) { return; }
    F.set(el, { noScroll: true });
    if (el.__isInput) { return; }
    F.ok();
  }

  var lastMove = 0;
  function onMouseMove(e) {
    /* Solo movimientos reales (no los que produce el desplazamiento de la lista) */
    if (e.movementX === 0 && e.movementY === 0) { return; }
    App.setPointer(true);
    var now = Date.now();
    if (now - lastMove < 40) { return; }
    lastMove = now;
    var el = focusableFrom(e.target);
    if (el && el !== F.get() && !UI.isEditing()) { F.set(el, { noScroll: true }); }
  }

  /* ======================= Sesión ======================= */
  App.connect = function (profile, retried) {
    App.stopPlayback();
    IPTV.portal.stop();
    if (App.source && App.source.dispose) { App.source.dispose(); }
    App.profile = profile;
    App.auth = null;
    App.xtreamBlock = null;
    App.source = null;
    App.reset('loading', { text: 'Conectando…' });

    var candidates = IPTV.session.connectCandidates(profile);
    if (profile.type === 'xtream' && !candidates.length) {
      App.profile = null;
      App.reset('login', {
        error: 'Esta aplicación no tiene configurada la dirección del servidor de ' + (IPTV.config.appName || 'su proveedor') + '. Use "Buscar servidor en mi red" o comuníquese con su proveedor.',
        canSearch: true,
        editProfile: profile
      });
      return;
    }

    App.source = IPTV.createSource(profile);
    var source = App.source;

    IPTV.session.onSearchProgress = function (pr) {
      if (App.source === source && App.topName() === 'loading') {
        screens.loading.setText('Buscando el servidor…\n' + pr.label, pr.fraction);
      }
    };

    source.connect(function (text, frac) {
      screens.loading.setText(text, frac);
    }, function (err, auth) {
      if (source !== App.source) { return; }
      if (err) {
        /* Portal propio con id conocido: buscarlo en la red local antes de mostrar el error */
        if (err.code === 'network' && !retried && IPTV.session.canRelocate()) {
          screens.loading.setText('Buscando el servidor en otras direcciones…');
          screens.loading.cancelHandler = function () { IPTV.session.relocator.cancel(); };
          IPTV.session.relocate({ force: true }, function (r) {
            screens.loading.cancelHandler = null;
            if (App.profile !== profile || source !== App.source) { return; }
            if (r.outcome === 'found') { App.connect(profile, true); return; }
            fail(err);
          });
          return;
        }
        fail(err);
        return;
      }
      S.set('activeProfile', profile.id);
      if (profile.auto) { IPTV.session.rememberGlobal(profile.server, profile.portalId, null, profile.clientPorts); }
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
    }, candidates);

    function fail(err) {
      if (source.dispose) { source.dispose(); }
      App.source = null;
      App.profile = null;
      var msg = err.message;
      if (err.code === 'network' && candidates.length > 1) {
        msg = 'No se pudo conectar con el servidor de ' + (IPTV.config.appName || 'su proveedor') + '. Verifique la conexión a Internet del televisor.';
      }
      App.reset('login', {
        error: msg,
        canSearch: profile.type === 'xtream' && err.code === 'network',
        editProfile: profile
      });
    }
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
    App.stopPlayback();
    IPTV.portal.stop();
    if (App.source && App.source.dispose) { App.source.dispose(); }
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
      App.stopPlayback();
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
   * Inicia la reproducción de un ítem (vista previa o pantalla completa) y el latido del portal.
   * opts: {startTime}
   */
  App.startPlayback = function (item, opts) {
    opts = opts || {};
    var o = App.playbackOptions(item);
    App.playingItem = item;
    doc.documentElement.classList.add('video-on');
    /* El latido empieza cuando el vídeo ya se ve (como la app de celular): así el portal une la
       conexión del reproductor con la del latido y no la cuenta dos veces */
    var hb = IPTV.portal.heartbeat;
    if (hb.active && String(hb.streamId) !== String(item.id)) { hb.stop(); }
    P.play(o.url, { live: o.live, altUrl: o.altUrl, startTime: opts.startTime || 0 });
  };

  function heartbeatFor(item) {
    if (!item || !IPTV.portal.enabled) { return; }
    if (item.type === 'live' || item.type === 'movie' || item.type === 'episode') { IPTV.portal.heartbeat.start(item.id); }
  }

  App.stopPlayback = function () {
    App.playingItem = null;
    P.stop();
    IPTV.portal.heartbeat.stop();
    doc.documentElement.classList.remove('video-on');
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
          text: '¿Continuar donde lo dejó (' + U.formatDuration(pos.t) + ')?',
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
  function applyBranding() {
    var name = IPTV.config.appName || 'IPTV Player';
    doc.title = name;
    IPTV.VERSION = IPTV.config.version || IPTV.VERSION;
  }

  App.start = function () {
    IPTV.platform = U.detectPlatform();
    doc.documentElement.classList.add('platform-' + IPTV.platform);
    applyBranding();
    applyScale();
    root.addEventListener('resize', applyScale);
    K.registerKeys();
    P.init();

    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('click', onClick);
    doc.addEventListener('mousemove', onMouseMove);
    /* LG Magic Remote: el puntero aparece / desaparece */
    doc.addEventListener('cursorStateChange', function (ev) {
      var vis = ev && ev.detail ? ev.detail.visibility : null;
      if (vis !== null && vis !== undefined) { App.setPointer(!!vis); }
    });

    IPTV.portal.on('update', function () {
      if (screens.shell && screens.shell.onPortalUpdate) { screens.shell.onPortalUpdate(); }
      if (IPTV.notices) { IPTV.notices.update(); }
      App.checkBlock();
    });

    IPTV.portal.on('limit', function (msg) {
      if (!App.playingItem) { return; }
      App.stopPlayback();
      var ps = screens.player;
      if (App.topName() === 'player' && ps.showLimit) { ps.showLimit(msg); }
      else { UI.Dialog.alert('Límite de conexiones', msg + ' Cierre la reproducción en otro equipo e inténtelo de nuevo.'); }
    });

    P.on('state', function (st) {
      if (st === 'playing') {
        heartbeatFor(App.playingItem);
        if (App.playingItem && App.source && App.source.rememberFormat) { App.source.rememberFormat(App.playingItem, U.urlExt(P.currentUrl)); }
      }
      if (st === 'stopped') {
        doc.documentElement.classList.remove('video-on');
        App.playingItem = null;
        IPTV.portal.heartbeat.stop();
      }
    });
    P.on('error', function () { IPTV.portal.heartbeat.stop(); });

    if (IPTV.lifecycle) { IPTV.lifecycle.init(); }

    IPTV.device.init(function () {
      var activeId = S.get('activeProfile');
      var profile = activeId ? S.getProfile(activeId) : null;
      if (profile) { App.connect(profile); }
      else { App.reset('login'); }
      U.log(IPTV.config.appName, IPTV.config.version, '· plataforma:', IPTV.platform, '· motores:', P.describeEngines(), '· equipo:', IPTV.device.brand, IPTV.device.model);
    });
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', App.start);
  } else {
    App.start();
  }
})(window);
