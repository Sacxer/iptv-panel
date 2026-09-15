/*
 * Reproductor a pantalla completa: OSD con logo/nombre/categoría/reloj que se oculta solo,
 * cambio de canal (CH+/CH-, arriba/abajo), pausa, avance/retroceso en VOD, indicador de carga,
 * mensajes de error con reintento automático, siguiente episodio y entrada numérica de canal.
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, S = IPTV.storage, UI = IPTV.ui, P = IPTV.player, h = U.h;
  var screens = IPTV.screens = IPTV.screens || {};
  var doc = root.document;

  var OSD_MS = 5000;
  var LIVE_RETRY_MS = 15000;

  screens.player = {
    create: function () {
      var el = h('div', { className: 'player-screen' });
      el.innerHTML =
        '<div class="osd osd-top">' +
        '  <div class="osd-logo"><span class="r-ph"></span><img alt=""></div>' +
        '  <div class="osd-titles"><div class="osd-name"></div><div class="osd-sub"></div><div class="osd-epg"></div></div>' +
        '  <div class="osd-clock"></div>' +
        '</div>' +
        '<div class="osd osd-bottom">' +
        '  <div class="osd-state"></div>' +
        '  <div class="osd-time"></div>' +
        '  <div class="progress osd-progress"><div class="progress-fill"></div><div class="progress-seek hidden"></div></div>' +
        '  <div class="osd-duration"></div>' +
        '  <div class="osd-hints"></div>' +
        '</div>' +
        UI.spinnerHtml.replace('spinner', 'spinner player-spinner hidden') +
        '<div class="player-msg hidden"><div class="pm-title"></div><div class="pm-detail"></div><div class="pm-hint"></div></div>' +
        '<div class="seek-indicator hidden"></div>' +
        '<div class="num-entry hidden"></div>' +
        '<div class="pause-indicator hidden">' + U.icon('pause') + '</div>';
      var q = function (s) { return el.querySelector(s); };
      this.osdTop = q('.osd-top');
      this.osdBottom = q('.osd-bottom');
      this.logo = q('.osd-logo');
      this.nameEl = q('.osd-name');
      this.subEl = q('.osd-sub');
      this.epgEl = q('.osd-epg');
      this.clockEl = q('.osd-clock');
      this.stateEl = q('.osd-state');
      this.timeEl = q('.osd-time');
      this.durEl = q('.osd-duration');
      this.progress = q('.osd-progress');
      this.fill = q('.osd-progress .progress-fill');
      this.seekMark = q('.progress-seek');
      this.hintsEl = q('.osd-hints');
      this.spinner = q('.player-spinner');
      this.msg = q('.player-msg');
      this.msgTitle = q('.pm-title');
      this.msgDetail = q('.pm-detail');
      this.msgHint = q('.pm-hint');
      this.seekInd = q('.seek-indicator');
      this.numEl = q('.num-entry');
      this.pauseInd = q('.pause-indicator');

      var self = this;
      this.handlers = {
        buffering: function (b) { if (self.active) { U.show(self.spinner, b && !self.errorShown); } },
        state: function (st) {
          if (!self.active) { return; }
          if (st === 'playing') { self.hideError(); U.show(self.pauseInd, false); self.renderState(); }
          if (st === 'paused') { U.show(self.pauseInd, true); self.showOsd(true); self.renderState(); }
        },
        retry: function (r) {
          if (!self.active) { return; }
          U.show(self.spinner, true);
          self.showMessage('Reconectando…', r.delay ? 'Nuevo intento en ' + Math.round(r.delay / 1000) + ' s (' + r.cycle + '/' + (r.maxCycles || r.cycle) + ')' : 'Probando formato alternativo', '', true);
        },
        error: function (msg) { if (self.active) { self.onError(msg); } },
        ended: function () { if (self.active) { self.onEnded(); } },
        time: function (t, d) { if (self.active) { self.onTime(t, d); } }
      };
      return el;
    },

    show: function (params) {
      var k;
      this.active = true;
      this.list = params.list || [];
      this.index = params.index || 0;
      this.fromPreview = !!params.fromPreview;
      this.keptItem = null;
      for (k in this.handlers) { if (this.handlers.hasOwnProperty(k)) { P.on(k, this.handlers[k]); } }
      var item = this.list[this.index];
      var self = this;
      this.clockTimer = setInterval(function () { self.clockEl.textContent = U.formatClock(); }, 10000);
      this.clockEl.textContent = U.formatClock();
      doc.documentElement.classList.add('video-on');
      if (this.fromPreview && P.isActive() && item && item.type === 'live') {
        this.item = item;
        this.lastItem = item;
        P.setRect(null);
        this.hideError();
        U.show(this.spinner, !!P.buffering);
        this.renderInfo();
        this.showOsd();
      } else {
        this.start(item, params.startTime || 0);
      }
    },

    hide: function () {
      var k;
      this.savePosition();
      this.active = false;
      for (k in this.handlers) { if (this.handlers.hasOwnProperty(k)) { P.off(k, this.handlers[k]); } }
      this.clearTimers();
      this.cancelNumber();
      U.hide(this.seekInd);
      if (this.fromPreview && this.item && this.item.type === 'live' && P.isActive()) {
        this.keptItem = this.item;  /* la sección TV en vivo continúa en la vista previa */
      } else {
        P.stop();
        doc.documentElement.classList.remove('video-on');
      }
    },

    clearTimers: function () {
      var self = this;
      U.each(['clockTimer', 'osdTimer', 'zapTimer', 'seekTimer', 'liveRetryTimer', 'countdownTimer'], function (t) {
        if (self[t]) { clearTimeout(self[t]); clearInterval(self[t]); self[t] = null; }
      });
    },

    /* ---------- Reproducción ---------- */
    start: function (item, startTime) {
      if (!item) { IPTV.app.pop(); return; }
      if (IPTV.app.currentBlock()) { IPTV.app.checkBlock(); return; }
      this.savePosition();
      this.item = item;
      this.lastItem = item;
      this.lastSave = 0;
      this.hideError();
      this.stopLiveRetry();
      U.show(this.pauseInd, false);
      U.show(this.spinner, true);
      P.setRect(null);
      var o = IPTV.app.playbackOptions(item);
      P.play(o.url, { live: o.live, altUrl: o.altUrl, startTime: startTime || 0 });
      S.addRecent(IPTV.app.profile.id, item);
      this.renderInfo();
      this.showOsd();
    },

    renderInfo: function () {
      var it = this.item, self = this;
      if (!it) { return; }
      var live = it.type === 'live';
      this.el.classList[live ? 'add' : 'remove']('is-live');
      this.nameEl.textContent = (live && it.num ? it.num + '   ' : '') + it.name;
      var sub = [];
      if (it.type === 'episode') { sub.push(it.seriesName || ''); sub.push('Temporada ' + it.season + ' · Episodio ' + it.episode); }
      else if (it.catName) { sub.push(it.catName); }
      if (IPTV.app.isFavorite(it)) { sub.push('★ Favorito'); }
      if (this.list.length > 1) { sub.push((this.index + 1) + ' / ' + this.list.length); }
      this.subEl.textContent = sub.join('  ·  ');
      this.logo.querySelector('.r-ph').textContent = U.initials(it.name);
      U.setImg(this.logo.querySelector('img'), it.logo);
      this.epgEl.textContent = '';
      this.stateEl.innerHTML = live ? '<span class="live-badge">EN VIVO</span>' : '';
      this.hintsEl.innerHTML = live
        ? UI.keyHint('ch', 'CH+/CH- o ▲▼: cambiar canal') + UI.keyHint('red', 'Favorito') + UI.keyHint('ok', 'Atrás: salir')
        : UI.keyHint('ok', 'OK: pausa') + UI.keyHint('ch', '◀ ▶: retroceder / avanzar') + UI.keyHint('red', 'Favorito');
      U.show(this.progress, !live);
      U.show(this.timeEl, !live);
      U.show(this.durEl, !live);
      if (live && IPTV.app.source && IPTV.app.source.type === 'xtream') {
        IPTV.app.source.getEpg(it, function (err, list) {
          if (self.item !== it) { return; }
          var now = U.nowSec(), cur = U.find(list || [], function (e) { return e.start <= now && e.end > now; });
          self.epgEl.textContent = cur ? 'Ahora: ' + cur.title : '';
        });
      }
      this.renderState();
    },

    renderState: function () {
      if (!this.item || this.item.type === 'live') { return; }
      this.stateEl.innerHTML = U.icon(P.paused ? 'play' : 'pause');
    },

    onTime: function (t, d) {
      if (!this.item || this.item.type === 'live') { return; }
      if (!this.seekTimer) {
        this.timeEl.textContent = U.formatDuration(t);
        this.durEl.textContent = d ? U.formatDuration(d) : '--:--';
        this.fill.style.width = d ? Math.min(100, t / d * 100) + '%' : '0%';
      }
      if (t > 0) { this.lastTime = t; this.lastDuration = d; }
      var now = Date.now();
      if (now - (this.lastSave || 0) > 15000 && t > 0) { this.lastSave = now; this.savePosition(); }
    },

    savePosition: function () {
      var it = this.item;
      if (!it || !IPTV.app.profile || (it.type !== 'movie' && it.type !== 'episode')) { return; }
      var t = P.time() || this.lastTime || 0, d = P.duration() || this.lastDuration || 0;
      if (t > 0) { S.setPosition(IPTV.app.profile.id, it, t, d); }
    },

    onEnded: function () {
      var it = this.item;
      if (it && (it.type === 'movie' || it.type === 'episode')) {
        S.setPosition(IPTV.app.profile.id, it, 0, 0);
        this.lastTime = 0;
      }
      if (it && it.type === 'episode' && this.index + 1 < this.list.length) {
        this.index++;
        UI.toast('Siguiente episodio');
        this.item = null;
        this.start(this.list[this.index], 0);
        return;
      }
      this.item = null;
      IPTV.app.pop();
    },

    /* ---------- Errores ---------- */
    showMessage: function (title, detail, hint, soft) {
      this.msgTitle.textContent = title;
      this.msgDetail.textContent = detail || '';
      this.msgHint.textContent = hint || '';
      this.msg.className = 'player-msg' + (soft ? ' soft' : '');
      this.errorShown = !soft;
    },

    hideError: function () {
      this.msg.className = 'player-msg hidden';
      this.errorShown = false;
      this.stopLiveRetry();
    },

    stopLiveRetry: function () {
      if (this.liveRetryTimer) { clearTimeout(this.liveRetryTimer); this.liveRetryTimer = null; }
      if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
    },

    onError: function (msg) {
      var self = this, it = this.item;
      U.hide(this.spinner);
      var what = it && it.type === 'live' ? 'No se pudo reproducir el canal' : 'No se pudo reproducir el contenido';
      if (it && it.type === 'live') {
        var left = Math.round(LIVE_RETRY_MS / 1000);
        this.showMessage(what, msg, 'Reintento automático en ' + left + ' s · OK: reintentar ahora · CH+/CH-: otro canal');
        this.stopLiveRetry();
        this.countdownTimer = setInterval(function () {
          left--;
          if (left > 0) { self.msgHint.textContent = 'Reintento automático en ' + left + ' s · OK: reintentar ahora · CH+/CH-: otro canal'; }
        }, 1000);
        this.liveRetryTimer = setTimeout(function () { self.retryNow(); }, LIVE_RETRY_MS);
      } else {
        this.showMessage(what, msg, 'OK: reintentar · Atrás: salir');
      }
      /* Si el servidor devolvió 403 por corte o suspensión, el portal lo indicará */
      if (IPTV.portal.enabled) { IPTV.portal.refresh(); }
    },

    retryNow: function () {
      var t = (this.item && this.item.type !== 'live') ? (this.lastTime || 0) : 0;
      this.start(this.item, t);
    },

    /* ---------- OSD ---------- */
    showOsd: function (sticky) {
      var self = this;
      this.el.classList.add('osd-visible');
      if (this.osdTimer) { clearTimeout(this.osdTimer); }
      this.osdTimer = null;
      if (!sticky) {
        this.osdTimer = setTimeout(function () {
          if (P.paused) { return; }
          self.el.classList.remove('osd-visible');
        }, OSD_MS);
      }
    },

    toggleOsd: function () {
      if (this.el.classList.contains('osd-visible')) {
        if (this.osdTimer) { clearTimeout(this.osdTimer); }
        this.el.classList.remove('osd-visible');
      } else { this.showOsd(); }
    },

    /* ---------- Cambio de canal ---------- */
    zap: function (delta) {
      var n = this.list.length, self = this;
      if (n < 2) { this.showOsd(); return; }
      this.index = (this.index + delta + n) % n;
      var it = this.list[this.index];
      /* Actualiza el OSD al instante y reproduce tras una breve pausa (zapping rápido) */
      this.savePosition();
      this.item = it;
      this.renderInfo();
      this.showOsd();
      P.stop(true);
      U.show(this.spinner, true);
      this.hideError();
      if (this.zapTimer) { clearTimeout(this.zapTimer); }
      this.zapTimer = setTimeout(function () {
        self.zapTimer = null;
        self.item = null;
        self.start(it, 0);
      }, 450);
    },

    /* ---------- Avance / retroceso ---------- */
    seek: function (dir) {
      var self = this, now = Date.now();
      if (!this.item || this.item.type === 'live') { this.showOsd(); return; }
      if (now - (this.lastSeekPress || 0) < 900) { this.seekCount = (this.seekCount || 0) + 1; } else { this.seekCount = 0; }
      this.lastSeekPress = now;
      var step = this.seekCount > 10 ? 120 : (this.seekCount > 4 ? 30 : 10);
      var d = P.duration() || this.lastDuration || 0;
      if (this.seekTarget === undefined || this.seekTarget === null) { this.seekTarget = P.time(); }
      this.seekTarget = Math.max(0, this.seekTarget + dir * step);
      if (d) { this.seekTarget = Math.min(this.seekTarget, Math.max(0, d - 3)); }
      this.seekInd.textContent = (dir > 0 ? '▶▶ ' : '◀◀ ') + U.formatDuration(this.seekTarget) + (d ? ' / ' + U.formatDuration(d) : '');
      U.show(this.seekInd, true);
      this.timeEl.textContent = U.formatDuration(this.seekTarget);
      if (d) { this.fill.style.width = (this.seekTarget / d * 100) + '%'; }
      this.showOsd();
      if (this.seekTimer) { clearTimeout(this.seekTimer); }
      this.seekTimer = setTimeout(function () {
        self.seekTimer = null;
        U.hide(self.seekInd);
        P.seekTo(self.seekTarget);
        self.lastTime = self.seekTarget;
        self.seekTarget = null;
      }, 800);
    },

    /* ---------- Número de canal ---------- */
    digit: function (dg) {
      var self = this;
      if (!this.item || this.item.type !== 'live') { return; }
      this.numBuffer = ((this.numBuffer || '') + dg).substr(0, 5);
      this.numEl.textContent = this.numBuffer;
      U.show(this.numEl, true);
      if (this.numTimer) { clearTimeout(this.numTimer); }
      this.numTimer = setTimeout(function () { self.commitNumber(); }, 1800);
    },

    commitNumber: function () {
      var num = parseInt(this.numBuffer, 10);
      this.cancelNumber();
      if (!num) { return; }
      var idx = U.findIndex(this.list, function (x) { return x.num === num; });
      if (idx >= 0) {
        this.index = idx;
        this.start(this.list[idx], 0);
        return;
      }
      /* Buscar en todos los canales */
      var all = IPTV.app.source ? IPTV.app.source.getAll('live') : [];
      var gi = U.findIndex(all, function (x) { return x.num === num; });
      if (gi >= 0) {
        this.list = all;
        this.index = gi;
        this.start(all[gi], 0);
      } else {
        UI.toast('Canal ' + num + ' no encontrado');
      }
    },

    cancelNumber: function () {
      if (this.numTimer) { clearTimeout(this.numTimer); this.numTimer = null; }
      this.numBuffer = '';
      if (this.numEl) { U.hide(this.numEl); }
    },

    /* ---------- Teclas ---------- */
    onKey: function (action, info) {
      var live = this.item && this.item.type === 'live';
      switch (action) {
        case 'back':
          if (this.numBuffer) { this.cancelNumber(); return true; }
          IPTV.app.pop();
          return true;
        case 'ok':
          if (this.numBuffer) { this.commitNumber(); return true; }
          if (this.errorShown) { this.retryNow(); return true; }
          if (live) { this.toggleOsd(); } else { P.togglePause(); this.showOsd(P.paused); }
          return true;
        case 'up': case 'chup':
          if (live || action === 'chup') { this.zap(1); } else { this.showOsd(); }
          return true;
        case 'down': case 'chdown':
          if (live || action === 'chdown') { this.zap(-1); } else { this.showOsd(); }
          return true;
        case 'left': this.seek(-1); return true;
        case 'right': this.seek(1); return true;
        case 'rw': this.seek(-1); return true;
        case 'ff': this.seek(1); return true;
        case 'play': if (this.errorShown) { this.retryNow(); } else { P.resume(); } this.showOsd(); return true;
        case 'pause': P.pause(); return true;
        case 'playpause': if (this.errorShown) { this.retryNow(); } else { P.togglePause(); this.showOsd(P.paused); } return true;
        case 'stop': IPTV.app.pop(); return true;
        case 'info': this.toggleOsd(); return true;
        case 'red':
          if (this.item) { IPTV.app.toggleFavorite(this.item); this.renderInfo(); this.showOsd(); }
          return true;
        case 'digit': this.digit(info.digit); return true;
      }
      return true;
    }
  };
})(window);
