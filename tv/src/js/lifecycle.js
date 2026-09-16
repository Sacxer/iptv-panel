/*
 * Ciclo de vida en el televisor. ES5.
 *
 * - Multitarea: al ocultarse la app (botón Home, otra app, fuente de TV) se detiene el canal en vivo
 *   y se pausa la película (AVPlay: suspend/restore); al volver se reanuda el canal y se actualiza el portal.
 * - Red: aviso permanente "Sin conexión" y reintento automático al volver la conexión
 *   (eventos online/offline, Samsung webapis.network y webOS connectionmanager).
 * - webOS: webOSRelaunch (la app se abre de nuevo mientras estaba en segundo plano).
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, P = IPTV.player, doc = root.document;

  var Lc = IPTV.lifecycle = new U.Emitter();
  Lc.hidden = false;
  Lc.online = true;
  Lc.lastActivity = Date.now();
  var resumeLive = false;

  Lc.userActivity = function () { Lc.lastActivity = Date.now(); };

  function isHidden() {
    if (typeof doc.hidden === 'boolean') { return doc.hidden; }
    if (typeof doc.webkitHidden === 'boolean') { return doc.webkitHidden; }
    return false;
  }

  Lc.onHide = function () {
    if (Lc.hidden) { return; }
    Lc.hidden = true;
    var app = IPTV.app;
    resumeLive = false;
    if (app.playingItem && P.isActive()) {
      resumeLive = !!P.opts.live;
      if (IPTV.screens.player && IPTV.screens.player.active) { IPTV.screens.player.savePosition(); }
      P.suspend();
      IPTV.portal.heartbeat.stop();
    }
    Lc.emit('hide');
  };

  Lc.onShow = function () {
    if (!Lc.hidden) { return; }
    Lc.hidden = false;
    if (P.isSuspended()) {
      P.restore();
      if (!resumeLive && IPTV.screens.player && IPTV.screens.player.active) { IPTV.screens.player.showOsd(P.paused); }
    }
    resumeLive = false;
    if (IPTV.portal.enabled) { IPTV.portal.refresh(); }
    Lc.checkNetwork();
    Lc.emit('show');
  };

  function onVisibility() {
    if (isHidden()) { Lc.onHide(); } else { Lc.onShow(); }
  }

  /* ---------- Red ---------- */
  function netbar() { return doc.getElementById('netbar'); }

  Lc.setOnline = function (on) {
    if (on === Lc.online) { return; }
    Lc.online = on;
    var bar = netbar();
    if (bar) { bar.classList[on ? 'add' : 'remove']('hidden'); }
    if (!on) {
      /* Sin red: detener la reproducción (se reintenta al volver la conexión) */
      Lc.emit('offline');
      return;
    }
    if (IPTV.ui && IPTV.ui.toast) { IPTV.ui.toast('Conexión restablecida'); }
    if (IPTV.portal.enabled) { IPTV.portal.refresh(); }
    Lc.emit('online');
  };

  /* Comprueba el estado actual (al volver a primer plano) */
  Lc.checkNetwork = function () {
    var n = root.webapis && root.webapis.network;
    try {
      if (n && typeof n.isConnectedToGateway === 'function') {
        Lc.setOnline(!!n.isConnectedToGateway());
        return;
      }
    } catch (e) { /* sin permiso */ }
    if (root.navigator && typeof root.navigator.onLine === 'boolean') { Lc.setOnline(root.navigator.onLine); }
  };

  function watchTizen() {
    var n = root.webapis && root.webapis.network;
    if (!n || typeof n.addNetworkStateChangeListener !== 'function') { return; }
    var st = n.NetworkState || {};
    var DISCONNECTED = st.GATEWAY_DISCONNECTED !== undefined ? st.GATEWAY_DISCONNECTED : 5;
    var CONNECTED = st.GATEWAY_CONNECTED !== undefined ? st.GATEWAY_CONNECTED : 4;
    var DETACHED = st.LAN_CABLE_DETACHED !== undefined ? st.LAN_CABLE_DETACHED : 2;
    try {
      n.addNetworkStateChangeListener(function (value) {
        if (value === DISCONNECTED || value === DETACHED) { Lc.setOnline(false); }
        else if (value === CONNECTED) { Lc.setOnline(true); }
      });
    } catch (e) { U.log('webapis.network no disponible', e); }
  }

  function watchWebos() {
    if (!IPTV.device || !IPTV.device.luna || typeof root.PalmServiceBridge === 'undefined') { return; }
    IPTV.device.luna('luna://com.webos.service.connectionmanager/getStatus', { subscribe: true }, function (r) {
      if (r && typeof r.isInternetConnectionAvailable === 'boolean') {
        var wired = r.wired && r.wired.state === 'connected';
        var wifi = r.wifi && r.wifi.state === 'connected';
        Lc.setOnline(!!(r.isInternetConnectionAvailable || wired || wifi));
      }
    });
  }

  Lc.init = function () {
    var ev = typeof doc.hidden === 'boolean' ? 'visibilitychange' : (typeof doc.webkitHidden === 'boolean' ? 'webkitvisibilitychange' : null);
    if (ev) { doc.addEventListener(ev, onVisibility); }
    root.addEventListener('online', function () { Lc.setOnline(true); });
    root.addEventListener('offline', function () { Lc.setOnline(false); });
    doc.addEventListener('webOSRelaunch', function () {
      try { if (root.PalmSystem && root.PalmSystem.activate) { root.PalmSystem.activate(); } } catch (e) { /* nada */ }
      Lc.onShow();
    });
    watchTizen();
    watchWebos();
    Lc.checkNetwork();
  };
})(window);
