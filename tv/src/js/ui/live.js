/* Sección TV en vivo: categorías + canales (virtualizados) + vista previa e información/EPG. ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, S = IPTV.storage, F = IPTV.focus, UI = IPTV.ui, P = IPTV.player, h = U.h;
  var sections = IPTV.sections = IPTV.sections || {};
  var doc = root.document;
  var FAV_CAT = '__fav';

  sections.live = {
    title: 'TV en vivo',
    icon: 'live',
    hints: UI.keyHint('ok', 'OK: vista previa / pantalla completa') + UI.keyHint('red', 'Favorito') + UI.keyHint('ch', 'CH+/CH-: página'),

    create: function () {
      var self = this;
      var el = h('div', { className: 'live-section' });
      el.innerHTML =
        '<div class="col col-cats"><div class="col-title">Categorías</div><div class="vl"></div></div>' +
        '<div class="col col-channels"><div class="col-title"><span class="ch-cat"></span><span class="count"></span></div><div class="vl"></div></div>' +
        '<div class="col col-info">' +
        '  <div class="preview"><div class="preview-ph">' + U.icon('live') + '<div>Pulse OK para ver la vista previa</div></div>' +
        '    <div class="preview-status hidden"></div>' + UI.spinnerHtml.replace('spinner', 'spinner hidden') + '</div>' +
        '  <div class="info-panel">' +
        '    <div class="info-head"><div class="info-logo"><span class="r-ph"></span><img alt=""></div><div class="info-titles"><div class="info-name"></div><div class="info-cat"></div></div></div>' +
        '    <div class="epg"></div>' +
        '  </div>' +
        '</div>';

      var cols = el.querySelectorAll('.vl');
      this.catTitle = el.querySelector('.ch-cat');
      this.countEl = el.querySelector('.count');
      this.previewEl = el.querySelector('.preview');
      this.previewPh = el.querySelector('.preview-ph');
      this.previewStatus = el.querySelector('.preview-status');
      this.previewSpinner = el.querySelector('.preview .spinner');
      this.infoName = el.querySelector('.info-name');
      this.infoCat = el.querySelector('.info-cat');
      this.infoLogo = el.querySelector('.info-logo');
      this.epgEl = el.querySelector('.epg');

      this.cats = new UI.VList(cols[0], {
        rowHeight: 76,
        rowClass: 'cat-row',
        emptyText: 'Cargando…',
        render: function (row, c) {
          UI.renderRow(row, { name: c.name, logo: false, extraHtml: '<span class="cnt">' + c.count + '</span>' });
        },
        onFocus: function (c, i) { self.catDebounced(c, i); },
        onSelect: function (c, i) {
          self.catDebounced.cancel();
          self.loadCategory(c, i);
          self.channels.focusIndex(self.channels.index);
        }
      });

      this.channels = new UI.VList(cols[1], {
        rowHeight: 92,
        rowClass: 'ch-row',
        emptyText: 'No hay canales en esta categoría',
        render: function (row, it) {
          var fav = IPTV.app.isFavorite(it);
          UI.renderRow(row, {
            num: it.num, name: it.name, logo: it.logo,
            extraHtml: (fav ? '<span class="star">★</span>' : '') + (self.previewItem && self.previewItem.id === it.id ? '<span class="live-dot"></span>' : '')
          });
        },
        onFocus: function (it) { self.infoDebounced(it); },
        onSelect: function (it, i) { self.selectChannel(it, i); }
      });

      this.catDebounced = U.debounce(function (c, i) { self.loadCategory(c, i); }, 350);
      this.infoDebounced = U.debounce(function (it) { self.updateInfo(it); }, 300);

      this.onPlayerEvent = {
        buffering: function (b) { if (self.previewing()) { U.show(self.previewSpinner, b); } },
        retry: function (r) { if (self.previewing()) { self.setPreviewStatus('Reintentando…'); } },
        state: function (st) { if (self.previewing() && st === 'playing') { self.setPreviewStatus(''); } },
        error: function (msg, status) {
          if (!self.previewing()) { return; }
          U.hide(self.previewSpinner);
          if (status === 429) { self.setPreviewStatus('Límite de conexiones alcanzado'); return; }
          if (status === 401 || status === 403) {
            self.setPreviewStatus('Sin acceso a este canal');
            if (IPTV.portal.enabled) { IPTV.portal.refresh(); }
            return;
          }
          self.setPreviewStatus('No se pudo reproducir el canal');
          /* ¿El servidor cambió de dirección? */
          var it = self.previewItem;
          IPTV.session.checkServer(function (moved) {
            if (moved && self.previewing() && self.previewItem === it) { self.startPreview(it); }
          });
        }
      };
      if (IPTV.lifecycle) {
        IPTV.lifecycle.on('online', function () {
          if (self.previewing() && !P.isActive()) { self.startPreview(self.previewItem); }
        });
        IPTV.lifecycle.on('offline', function () {
          if (!self.previewing()) { return; }
          IPTV.app.stopPlayback();
          U.hide(self.previewSpinner);
          self.setPreviewStatus('Sin conexión a la red');
        });
      }
      P.on('buffering', this.onPlayerEvent.buffering);
      P.on('retry', this.onPlayerEvent.retry);
      P.on('state', this.onPlayerEvent.state);
      P.on('error', this.onPlayerEvent.error);
      return el;
    },

    reset: function () {
      this.stopPreview();
      this.src = null;
      /* Otro perfil: la categoría anterior ya no aplica (si no, la lista queda vacía) */
      this.catId = null;
      this.catList = null;
      this.items = [];
      this.cats.setItems([]);
      this.channels.setItems([]);
      this.clearInfo();
    },

    show: function () {
      var self = this, app = IPTV.app, src = app.source;
      if (this.src === src && src.isLoaded('live')) {
        this.refreshFavCategory();
        return;
      }
      this.src = src;
      this.cats.setEmptyText('Cargando…');
      this.cats.setItems([]);
      this.channels.setItems([]);
      this.clearInfo();
      src.load('live', function (err) {
        if (self.src !== src) { return; }
        if (err) {
          self.cats.setEmptyText('Error al cargar: ' + err.message);
          self.cats.setItems([]);
          return;
        }
        self.populate();
      });
    },

    populate: function () {
      var cats = this.src.getCategories('live').slice();
      cats.splice(1, 0, { id: FAV_CAT, name: '★ Favoritos', count: this.favItems().length });
      this.cats.setEmptyText('No hay categorías');
      var last = S.get('live.lastCat');
      var idx = U.findIndex(cats, function (c) { return c.id === last; });
      if (idx < 0) { idx = 0; }
      this.catList = cats;
      this.cats.setItems(cats, idx);
      this.loadCategory(cats[idx], idx);
      var cur = F.get();
      if (!cur || !this.el.contains(cur)) {
        if (IPTV.screens.shell.canFocusContent('live')) { this.focusDefault(); }
      }
    },

    favItems: function () {
      return S.getFavorites(IPTV.app.profile.id).filter(function (x) { return x.type === 'live'; });
    },

    refreshFavCategory: function () {
      if (!this.catList) { return; }
      var fav = U.find(this.catList, function (c) { return c.id === FAV_CAT; });
      if (fav) { fav.count = this.favItems().length; this.cats.refresh(); }
      if (this.catId === FAV_CAT) { this.loadCategory(fav, this.cats.markedIndex, true); }
      else { this.channels.refresh(); }
    },

    loadCategory: function (c, i, keepIndex) {
      if (!c) { return; }
      if (this.catId === c.id && !keepIndex) { return; }
      this.catId = c.id;
      S.set('live.lastCat', c.id);
      var items = c.id === FAV_CAT ? this.favItems() : this.src.getItems('live', c.id);
      this.items = items;
      this.catTitle.textContent = c.name;
      this.countEl.textContent = items.length + ' canales';
      var idx = 0;
      if (keepIndex) { idx = this.channels.index; }
      else if (this.previewItem) {
        var pid = this.previewItem.id;
        idx = Math.max(0, U.findIndex(items, function (x) { return x.id === pid; }));
      }
      this.channels.setItems(items, idx);
      this.cats.mark(i);
      if (items.length && !this.previewItem) { this.infoDebounced(items[idx]); }
    },

    focusDefault: function () {
      if (this.channels.items.length) { this.channels.focusIndex(this.channels.index); return true; }
      if (this.cats.items.length) { this.cats.focusIndex(this.cats.index); return true; }
      return false;
    },

    /* ---------- Información / EPG ---------- */
    clearInfo: function () {
      this.infoName.textContent = '';
      this.infoCat.textContent = '';
      this.epgEl.innerHTML = '';
      U.setImg(this.infoLogo.querySelector('img'), '');
      this.infoLogo.querySelector('.r-ph').textContent = '';
    },

    updateInfo: function (it) {
      var self = this;
      if (!it) { this.clearInfo(); return; }
      this.infoItem = it;
      this.infoName.textContent = (it.num ? it.num + '  ' : '') + it.name;
      this.infoCat.textContent = it.catName || '';
      this.infoLogo.querySelector('.r-ph').textContent = U.initials(it.name);
      U.setImg(this.infoLogo.querySelector('img'), it.logo);
      this.epgEl.innerHTML = this.src && this.src.type === 'xtream' ? '<div class="epg-empty">Cargando guía…</div>' : '';
      if (!this.src || this.src.type !== 'xtream') { return; }
      this.src.getEpg(it, function (err, list) {
        if (self.infoItem !== it) { return; }
        self.epgEl.innerHTML = UI.epgHtml(list);
      });
    },

    /* ---------- Vista previa ---------- */
    previewing: function () { return !!this.previewItem && IPTV.app.topName() === 'shell' && IPTV.screens.shell.current === 'live'; },

    setPreviewStatus: function (t) {
      this.previewStatus.textContent = t;
      U.show(this.previewStatus, !!t);
    },

    selectChannel: function (it, i) {
      var settings = S.getSettings();
      if (!settings.preview) {
        IPTV.app.play(it, { list: this.items, index: i });
        return;
      }
      if (this.previewItem && this.previewItem.id === it.id && P.isActive()) {
        IPTV.app.play(it, { list: this.items, index: i, fromPreview: true });
        return;
      }
      this.startPreview(it);
    },

    startPreview: function (it) {
      if (IPTV.app.currentBlock()) { IPTV.app.checkBlock(); return; }
      this.previewItem = it;
      this.updateInfo(it);
      this.previewEl.classList.add('video-hole');
      U.hide(this.previewPh);
      this.setPreviewStatus('');
      U.show(this.previewSpinner, true);
      doc.documentElement.classList.add('video-on');
      P.setRect(this.previewEl.getBoundingClientRect());
      IPTV.app.startPlayback(it);
      S.addRecent(IPTV.app.profile.id, it);
      this.channels.refresh();
    },

    stopPreview: function () {
      if (!this.previewItem) { return; }
      this.previewItem = null;
      IPTV.app.stopPlayback();
      this.previewEl.classList.remove('video-hole');
      U.show(this.previewPh, true);
      U.hide(this.previewSpinner);
      this.setPreviewStatus('');
      doc.documentElement.classList.remove('video-on');
      if (this.channels) { this.channels.refresh(); }
    },

    hide: function () { this.stopPreview(); },
    pause: function () { },

    resume: function () {
      var ps = IPTV.screens.player;
      if (this.previewItem && P.isActive() && ps.keptItem) {
        /* Volvemos de pantalla completa: seguir en la vista previa con el canal actual */
        var it = ps.keptItem;
        ps.keptItem = null;
        this.previewItem = it;
        doc.documentElement.classList.add('video-on');
        this.previewEl.classList.add('video-hole');
        U.hide(this.previewPh);
        P.setRect(this.previewEl.getBoundingClientRect());
        var idx = U.findIndex(this.channels.items, function (x) { return x.id === it.id; });
        if (idx >= 0) { this.channels.focusIndex(idx); }
        this.updateInfo(it);
        this.channels.refresh();
      } else if (this.previewItem) {
        this.stopPreview();
      }
      this.refreshFavCategory();
    },

    relayout: function () {
      this.cats.refresh();
      this.channels.refresh();
      if (this.previewItem) { P.setRect(this.previewEl.getBoundingClientRect()); }
    },

    onBack: function () {
      if (this.previewItem) { this.stopPreview(); return true; }
      return false;
    },

    onKey: function (action) {
      var inCats = this.cats.hasFocus(), inCh = this.channels.hasFocus();
      if (action === 'chup' || action === 'chdown') {
        var d = action === 'chup' ? -1 : 1;
        if (inCats) { this.cats.page(d); return true; }
        if (inCh) { this.channels.page(d); return true; }
      }
      if (action === 'red' && inCh) {
        var it = this.channels.current();
        if (it) { IPTV.app.toggleFavorite(it); this.refreshFavCategory(); }
        return true;
      }
      if ((action === 'play' || action === 'playpause') && inCh) {
        var c = this.channels.current();
        if (c) { IPTV.app.play(c, { list: this.items, index: this.channels.index, fromPreview: !!(this.previewItem && this.previewItem.id === c.id) }); }
        return true;
      }
      if (action === 'stop') { this.stopPreview(); return true; }
      return false;
    }
  };

  /* HTML de la guía: ahora / después */
  UI.epgHtml = function (list) {
    if (!list || !list.length) { return '<div class="epg-empty">Sin información de guía</div>'; }
    var now = U.nowSec(), cur = null, next = null, i;
    for (i = 0; i < list.length; i++) {
      if (list[i].start <= now && list[i].end > now) { cur = list[i]; next = list[i + 1] || null; break; }
      if (list[i].start > now) { next = list[i]; break; }
    }
    var html = '';
    function hm(ts) { var d = new Date(ts * 1000); return U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()); }
    if (cur) {
      var pct = Math.round((now - cur.start) / Math.max(1, cur.end - cur.start) * 100);
      html += '<div class="epg-item now"><div class="epg-label">Ahora · ' + hm(cur.start) + ' - ' + hm(cur.end) + '</div>' +
        '<div class="epg-title">' + U.escapeHtml(cur.title) + '</div>' +
        '<div class="progress small"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        (cur.desc ? '<div class="epg-desc">' + U.escapeHtml(cur.desc) + '</div>' : '') + '</div>';
    }
    if (next) {
      html += '<div class="epg-item"><div class="epg-label">Después · ' + hm(next.start) + '</div><div class="epg-title">' + U.escapeHtml(next.title) + '</div></div>';
    }
    return html || '<div class="epg-empty">Sin información de guía</div>';
  };
})(window);
