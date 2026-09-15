/*
 * Avisos del portal según "display":
 *   banner → franja superior en la pantalla principal (rota si hay varios)
 *   popup  → diálogo que se muestra una sola vez por id
 *   ticker → cinta con texto desplazándose en la parte inferior (también sobre el reproductor)
 * Color según "level": info | warning | critical.
 * Cortes sin bloqueo de reproducción se muestran como banner de advertencia.
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
    popupQueue: [],
    popupOpen: false
  };

  N.attach = function (el) { N.bannerEl = el; };

  N.detach = function () {
    if (N.bannerTimer) { clearInterval(N.bannerTimer); N.bannerTimer = null; }
    if (N.bannerEl) { N.bannerEl.classList.add('hidden'); }
    N.bannerEl = null;
    N.setTicker([]);
  };

  function levelOf(n) { return (n.level === 'warning' || n.level === 'critical') ? n.level : 'info'; }

  N.update = function () {
    var portal = IPTV.portal;
    if (!portal.enabled || !portal.state || !IPTV.app.profile) {
      N.setBanners([]);
      N.setTicker([]);
      return;
    }
    var banners = portal.activeNotices('banner').slice();
    var out = portal.state.outage;
    if (out && !out.block_playback) {
      var reason = out.reason ? ': ' + out.reason : '';
      var until = out.ends_at ? ' (hasta ' + U.formatUnixDateTime(out.ends_at) + ')' : '';
      banners.unshift({ id: 'outage-' + out.id, title: out.title || 'Mantenimiento', body: (reason ? reason.substr(2) : '') + until, level: 'warning' });
    }
    N.setBanners(banners);
    N.setTicker(portal.activeNotices('ticker'));

    /* Popups una sola vez por id */
    var pid = IPTV.app.profile.id;
    U.each(portal.activeNotices('popup'), function (n) {
      if (S.wasSeen(pid, n.id)) { return; }
      if (U.find(N.popupQueue, function (q) { return q.id === n.id; })) { return; }
      N.popupQueue.push(n);
    });
    N.nextPopup();
  };

  N.setBanners = function (list) {
    N.bannerList = list;
    if (N.bannerTimer) { clearInterval(N.bannerTimer); N.bannerTimer = null; }
    var el = N.bannerEl;
    if (!el) { return; }
    var wasHidden = el.classList.contains('hidden');
    if (!list.length) {
      el.classList.add('hidden');
      if (!wasHidden && IPTV.screens.shell) { IPTV.screens.shell.relayout(); }
      return;
    }
    N.bannerIndex = 0;
    N.renderBanner();
    el.classList.remove('hidden');
    if (wasHidden && IPTV.screens.shell) { IPTV.screens.shell.relayout(); }
    if (list.length > 1) {
      N.bannerTimer = setInterval(function () {
        N.bannerIndex = (N.bannerIndex + 1) % N.bannerList.length;
        N.renderBanner();
      }, 8000);
    }
  };

  N.renderBanner = function () {
    var n = N.bannerList[N.bannerIndex], el = N.bannerEl;
    if (!n || !el) { return; }
    el.className = 'banner level-' + levelOf(n);
    el.innerHTML = '<span class="banner-icon">' + (levelOf(n) === 'info' ? 'i' : '!') + '</span>' +
      '<span class="banner-title">' + U.escapeHtml(n.title || '') + '</span>' +
      '<span class="banner-body">' + U.escapeHtml(n.body || '') + '</span>' +
      (N.bannerList.length > 1 ? '<span class="banner-count">' + (N.bannerIndex + 1) + '/' + N.bannerList.length + '</span>' : '');
  };

  N.setTicker = function (list) {
    var t = doc.getElementById('ticker');
    if (!t) { return; }
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

  N.nextPopup = function () {
    if (N.popupOpen || !N.popupQueue.length) { return; }
    var top = IPTV.app.topName();
    /* No interrumpir la reproducción a pantalla completa ni la pantalla de bloqueo */
    if (top !== 'shell' || UI.Dialog.top() || IPTV.app.isOnStack('block')) {
      if (!N.waitTimer) {
        N.waitTimer = setTimeout(function () { N.waitTimer = null; N.nextPopup(); }, 5000);
      }
      return;
    }
    var n = N.popupQueue.shift();
    var pid = IPTV.app.profile ? IPTV.app.profile.id : '';
    N.popupOpen = true;
    UI.Dialog.open({
      title: n.title || 'Aviso',
      text: n.body || '',
      level: levelOf(n),
      className: 'notice-popup',
      buttons: [{ label: 'Entendido' }],
      onClose: function () {
        if (pid) { S.markSeen(pid, n.id); }
        N.popupOpen = false;
        setTimeout(N.nextPopup, 400);
      }
    });
  };
})(window);
