/*
 * Avisos del portal según "display":
 *   banner → franja superior en la pantalla principal. Con notice_settings.carousel rota cada
 *            interval_seconds (o duration_seconds del aviso); sin carrusel se muestran hasta 3 a la vez.
 *   popup  → diálogo que se muestra una sola vez por id (también los mensajes con display "popup",
 *            que además se marcan como leídos)
 *   ticker → cinta con texto desplazándose en la parte inferior (también sobre el reproductor)
 * Color según "level": info | warning | critical. Los avisos llegan ordenados (crítico primero).
 * Un corte activo que no bloquea la reproducción se muestra como aviso de advertencia.
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, S = IPTV.storage, UI = IPTV.ui;
  var doc = root.document;

  var N = IPTV.notices = {
    bannerEl: null,
    bannerList: [],
    bannerIndex: 0,
    bannerTimer: null,
    bannerKey: '',
    popupQueue: [],
    popupOpen: false,
    waitTimer: null
  };

  N.attach = function (el) { N.bannerEl = el; N.bannerKey = ''; };

  N.detach = function () {
    if (N.bannerTimer) { clearTimeout(N.bannerTimer); N.bannerTimer = null; }
    if (N.bannerEl) { N.bannerEl.classList.add('hidden'); }
    N.bannerEl = null;
    N.bannerKey = '';
    N.popupQueue = [];
    N.setTicker([]);
  };

  function levelOf(n) { return (n.level === 'warning' || n.level === 'critical') ? n.level : 'info'; }

  N.update = function () {
    var portal = IPTV.portal;
    if (!portal.enabled || !portal.state || !IPTV.app.profile) {
      N.setBanners([], {});
      N.setTicker([]);
      return;
    }
    var banners = portal.activeNotices('banner').slice();
    var out = portal.activeOutage();
    if (out && !out.block_playback) {
      var until = out.ends_at ? 'Hasta ' + U.formatUnixDateTime(out.ends_at) : '';
      banners.unshift({
        id: 'outage-' + out.id,
        title: out.title || 'Mantenimiento',
        body: [out.reason || '', until].join(out.reason && until ? ' · ' : ''),
        level: 'warning',
        outage: true
      });
    }
    N.setBanners(banners, portal.noticeSettings());
    N.setTicker(portal.activeNotices('ticker'));

    /* Popups una sola vez por id: avisos y mensajes */
    var pid = IPTV.app.profile.id;
    U.each(portal.activeNotices('popup'), function (n) {
      var key = 'notice:' + n.id;
      if (S.wasSeen(pid, key) || S.wasSeen(pid, n.id)) { return; }
      N.enqueue({ key: key, title: n.title || 'Aviso', body: n.body || '', level: levelOf(n) });
    });
    U.each(portal.popupMessages(), function (m) {
      var key = 'message:' + m.id;
      if (S.wasSeen(pid, key)) { return; }
      N.enqueue({ key: key, title: m.title || 'Mensaje', body: m.body || '', level: m.kind === 'payment' || m.kind === 'expiration' ? 'warning' : 'info', message: m });
    });
    N.nextPopup();
  };

  N.enqueue = function (item) {
    if (U.find(N.popupQueue, function (q) { return q.key === item.key; })) { return; }
    if (N.current && N.current.key === item.key) { return; }
    N.popupQueue.push(item);
  };

  /* ---------- Banners ---------- */
  N.setBanners = function (list, settings) {
    settings = settings || {};
    var el = N.bannerEl;
    var carousel = settings.carousel !== false;
    var key = (carousel ? 'c' : 's') + (settings.interval || 8) + '|' + list.map(function (n) {
      return [n.id, n.level, n.title, n.body, n.duration_seconds || ''].join('~');
    }).join('||');
    if (el && key === N.bannerKey && !el.classList.contains('hidden') === !!list.length) { return; }
    N.bannerKey = key;
    N.bannerList = list;
    N.carousel = carousel;
    N.interval = settings.interval || 8;
    if (N.bannerTimer) { clearTimeout(N.bannerTimer); N.bannerTimer = null; }
    if (!el) { return; }
    var wasHidden = el.classList.contains('hidden');
    if (!list.length) {
      el.classList.add('hidden');
      if (!wasHidden && IPTV.screens.shell) { IPTV.screens.shell.relayout(); }
      return;
    }
    if (N.bannerIndex >= list.length) { N.bannerIndex = 0; }
    N.renderBanner();
    el.classList.remove('hidden');
    if (IPTV.screens.shell) { IPTV.screens.shell.relayout(); }
    N.schedule();
  };

  N.schedule = function () {
    if (N.bannerTimer) { clearTimeout(N.bannerTimer); N.bannerTimer = null; }
    if (!N.carousel || N.bannerList.length < 2) { return; }
    var cur = N.bannerList[N.bannerIndex];
    var secs = (cur && cur.duration_seconds) ? cur.duration_seconds : N.interval;
    N.bannerTimer = setTimeout(function () {
      N.bannerIndex = (N.bannerIndex + 1) % N.bannerList.length;
      N.renderBanner();
      N.schedule();
    }, Math.max(3, secs) * 1000);
  };

  function bannerHtml(n, count) {
    return '<div class="banner-item level-' + levelOf(n) + '">' +
      '<span class="banner-icon">' + (levelOf(n) === 'info' ? 'i' : '!') + '</span>' +
      '<span class="banner-title">' + U.escapeHtml(n.title || '') + '</span>' +
      '<span class="banner-body">' + U.escapeHtml(n.body || '') + '</span>' +
      (count ? '<span class="banner-count">' + count + '</span>' : '') +
      '</div>';
  }

  N.renderBanner = function () {
    var el = N.bannerEl, list = N.bannerList;
    if (!el || !list.length) { return; }
    var html = '';
    if (N.carousel) {
      var n = list[N.bannerIndex] || list[0];
      html = bannerHtml(n, list.length > 1 ? (N.bannerIndex + 1) + '/' + list.length : '');
      el.className = 'banner carousel level-' + levelOf(n);
    } else {
      U.each(list.slice(0, 3), function (x) { html += bannerHtml(x, ''); });
      el.className = 'banner stacked level-' + levelOf(list[0]);
    }
    el.innerHTML = html;
  };

  /* ---------- Cinta ---------- */
  N.setTicker = function (list) {
    var t = doc.getElementById('ticker');
    if (!t) { return; }
    /* Con cinta, la barra de ayudas y el OSD suben para no quedar tapados */
    doc.documentElement.classList[list.length ? 'add' : 'remove']('ticker-on');
    if (!list.length) { t.classList.add('hidden'); t.__key = ''; return; }
    var worst = 'info';
    var text = list.map(function (n) {
      var l = levelOf(n);
      if (l === 'critical' || (l === 'warning' && worst === 'info')) { worst = l; }
      return (n.title ? n.title + ': ' : '') + (n.body || '');
    }).join('     •     ');
    var key = worst + '|' + text;
    if (t.__key === key) { t.classList.remove('hidden'); return; }
    t.__key = key;
    t.className = 'ticker level-' + worst;
    var span = t.querySelector('.ticker-text');
    span.textContent = text;
    /* Duración proporcional a la longitud del texto */
    var secs = Math.max(15, Math.round(text.length * 0.18));
    var track = t.querySelector('.ticker-track');
    track.style.webkitAnimationDuration = secs + 's';
    track.style.animationDuration = secs + 's';
  };

  /* ---------- Popups ---------- */
  N.nextPopup = function () {
    if (N.popupOpen || !N.popupQueue.length || !IPTV.app.profile) { return; }
    var top = IPTV.app.topName();
    /* No interrumpir la reproducción a pantalla completa, un diálogo abierto ni la pantalla de bloqueo */
    if (top !== 'shell' || UI.Dialog.top() || IPTV.app.isOnStack('block')) {
      if (!N.waitTimer) {
        N.waitTimer = setTimeout(function () { N.waitTimer = null; N.nextPopup(); }, 5000);
      }
      return;
    }
    var n = N.popupQueue.shift();
    var pid = IPTV.app.profile.id;
    N.popupOpen = true;
    N.current = n;
    UI.Dialog.open({
      title: n.title,
      text: n.body,
      level: n.level,
      className: 'notice-popup',
      buttons: [{ label: 'Entendido' }],
      onClose: function () {
        S.markSeen(pid, n.key);
        if (n.message) { IPTV.portal.markRead(n.message); }
        N.popupOpen = false;
        N.current = null;
        setTimeout(N.nextPopup, 400);
      }
    });
  };
})(window);
