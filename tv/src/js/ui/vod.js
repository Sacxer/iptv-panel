/* Catálogo genérico (categorías + rejilla de pósters), sección Películas y detalle de película. ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, S = IPTV.storage, F = IPTV.focus, UI = IPTV.ui, h = U.h;
  var sections = IPTV.sections = IPTV.sections || {};
  var screens = IPTV.screens = IPTV.screens || {};
  var FAV_CAT = '__fav';

  /*
   * Crea una sección de catálogo para kind = 'movie' | 'series'
   * opts: {title, icon, noun (plural), onSelect(item, list, index)}
   */
  UI.makeCatalogSection = function (kind, opts) {
    return {
      title: opts.title,
      icon: opts.icon,
      hints: UI.keyHint('ok', 'OK: ver detalle') + UI.keyHint('red', 'Favorito') + UI.keyHint('ch', 'CH+/CH-: página'),

      create: function () {
        var self = this;
        var el = h('div', { className: 'catalog-section' });
        el.innerHTML =
          '<div class="col col-cats"><div class="col-title">Categorías</div><div class="vl"></div></div>' +
          '<div class="col col-grid"><div class="col-title"><span class="g-cat"></span><span class="count"></span></div><div class="vg"></div></div>';
        this.catTitle = el.querySelector('.g-cat');
        this.countEl = el.querySelector('.count');

        this.cats = new UI.VList(el.querySelector('.vl'), {
          rowHeight: 76,
          rowClass: 'cat-row',
          emptyText: 'Cargando…',
          render: function (row, c) { UI.renderRow(row, { name: c.name, logo: false, extraHtml: '<span class="cnt">' + c.count + '</span>' }); },
          onFocus: function (c, i) { self.catDebounced(c, i); },
          onSelect: function (c, i) {
            self.catDebounced.cancel();
            self.loadCategory(c, i);
            self.grid.focusIndex(self.grid.index);
          }
        });

        this.grid = new UI.VGrid(el.querySelector('.vg'), {
          cellWidth: 244,
          cellHeight: 420,
          emptyText: 'No hay contenido en esta categoría',
          render: function (cell, it) {
            UI.renderPoster(cell, it, IPTV.app.isFavorite(it) ? '★' : (it.rating && parseFloat(it.rating) > 0 ? '★ ' + (Math.round(parseFloat(it.rating) * 10) / 10) : ''));
          },
          onSelect: function (it, i) { opts.onSelect(it, self.items, i); }
        });

        this.catDebounced = U.debounce(function (c, i) { self.loadCategory(c, i); }, 350);
        return el;
      },

      reset: function () {
        this.src = null;
        this.catId = null;
        this.cats.setItems([]);
        this.grid.setItems([]);
      },

      show: function () {
        var self = this, src = IPTV.app.source;
        if (this.src === src && src.isLoaded(kind)) { this.refreshFav(); return; }
        this.src = src;
        this.catId = null;
        this.cats.setEmptyText('Cargando…');
        this.cats.setItems([]);
        this.grid.setItems([]);
        this.catTitle.textContent = '';
        this.countEl.textContent = '';
        src.load(kind, function (err) {
          if (self.src !== src) { return; }
          if (err) { self.cats.setEmptyText('Error al cargar: ' + err.message); self.cats.setItems([]); return; }
          self.populate();
        });
      },

      populate: function () {
        var cats = this.src.getCategories(kind).slice();
        cats.splice(1, 0, { id: FAV_CAT, name: '★ Favoritos', count: this.favItems().length });
        this.catList = cats;
        this.cats.setEmptyText('No hay categorías');
        var last = S.get(kind + '.lastCat');
        var idx = Math.max(0, U.findIndex(cats, function (c) { return c.id === last; }));
        this.cats.setItems(cats, idx);
        this.loadCategory(cats[idx], idx);
        if (IPTV.screens.shell.current === kind && !IPTV.screens.shell.inSidebar()) { this.focusDefault(); }
      },

      favItems: function () {
        return S.getFavorites(IPTV.app.profile.id).filter(function (x) { return x.type === kind; });
      },

      refreshFav: function () {
        if (!this.catList) { return; }
        var fav = U.find(this.catList, function (c) { return c.id === FAV_CAT; });
        if (fav) { fav.count = this.favItems().length; this.cats.refresh(); }
        if (this.catId === FAV_CAT) { this.loadCategory(fav, this.cats.markedIndex, true); } else { this.grid.refresh(); }
      },

      loadCategory: function (c, i, keep) {
        if (!c || (this.catId === c.id && !keep)) { return; }
        this.catId = c.id;
        S.set(kind + '.lastCat', c.id);
        this.items = c.id === FAV_CAT ? this.favItems() : this.src.getItems(kind, c.id);
        this.catTitle.textContent = c.name;
        this.countEl.textContent = this.items.length + ' ' + opts.noun;
        this.grid.setItems(this.items, keep ? this.grid.index : 0);
        this.cats.mark(i);
      },

      focusDefault: function () {
        if (this.grid.items.length) { this.grid.focusIndex(this.grid.index); return true; }
        if (this.cats.items.length) { this.cats.focusIndex(this.cats.index); return true; }
        return false;
      },

      resume: function () { this.refreshFav(); },
      relayout: function () { this.cats.refresh(); this.grid.refresh(); },

      onKey: function (action) {
        if (action === 'chup' || action === 'chdown') {
          var d = action === 'chup' ? -1 : 1;
          if (this.cats.hasFocus()) { this.cats.page(d); return true; }
          if (this.grid.hasFocus()) { this.grid.page(d); return true; }
        }
        if (action === 'red' && this.grid.hasFocus()) {
          var it = this.grid.current();
          if (it) { IPTV.app.toggleFavorite(it); this.refreshFav(); }
          return true;
        }
        return false;
      }
    };
  };

  sections.movie = UI.makeCatalogSection('movie', {
    title: 'Películas',
    icon: 'movie',
    noun: 'películas',
    onSelect: function (it) { IPTV.app.push('vodDetail', { item: it }); }
  });

  /* ======================= Detalle de película ======================= */
  UI.detailSkeleton = function (extraClass) {
    var el = h('div', { className: 'detail-screen ' + (extraClass || '') });
    el.innerHTML =
      '<div class="detail-backdrop"><img alt=""></div>' +
      '<div class="detail-body">' +
      '  <div class="detail-poster"><div class="poster-ph"></div><img alt=""></div>' +
      '  <div class="detail-info">' +
      '    <div class="detail-title"></div>' +
      '    <div class="detail-meta"></div>' +
      '    <div class="detail-plot"></div>' +
      '    <div class="detail-credits"></div>' +
      '    <div class="detail-buttons"></div>' +
      '    <div class="detail-extra"></div>' +
      '  </div>' +
      '</div>';
    return el;
  };

  UI.fillDetail = function (el, item, info) {
    info = info || {};
    el.querySelector('.detail-title').textContent = item.name;
    var meta = [];
    if (info.year) { meta.push(String(info.year).substr(0, 4)); }
    if (info.genre) { meta.push(info.genre); }
    if (info.duration) { meta.push(info.duration); }
    if (info.rating && parseFloat(info.rating) > 0) { meta.push('★ ' + info.rating); }
    el.querySelector('.detail-meta').textContent = meta.join('  ·  ');
    el.querySelector('.detail-plot').textContent = info.plot || '';
    var credits = '';
    if (info.director) { credits += '<div><b>Dirección:</b> ' + U.escapeHtml(info.director) + '</div>'; }
    if (info.cast) { credits += '<div><b>Reparto:</b> ' + U.escapeHtml(info.cast) + '</div>'; }
    el.querySelector('.detail-credits').innerHTML = credits;
    var img = info.image || info.cover || item.logo;
    el.querySelector('.detail-poster .poster-ph').textContent = U.initials(item.name);
    U.setImg(el.querySelector('.detail-poster img'), img);
    U.setImg(el.querySelector('.detail-backdrop img'), img);
  };

  screens.vodDetail = {
    create: function () {
      var el = UI.detailSkeleton('vod-detail');
      this.buttons = el.querySelector('.detail-buttons');
      this.extra = el.querySelector('.detail-extra');
      return el;
    },

    show: function (params) {
      var self = this, item = params.item, src = IPTV.app.source;
      this.item = item;
      this.info = null;
      UI.fillDetail(this.el, item, { rating: item.rating, plot: item.plot });
      this.extra.innerHTML = '<div class="muted">Cargando información…</div>';
      this.renderButtons();
      src.getVodInfo(item, function (err, info) {
        if (self.item !== item) { return; }
        self.extra.innerHTML = err ? '<div class="muted">No se pudo cargar la información</div>' : '';
        if (info) {
          self.info = info;
          if (info.ext) { item.ext = info.ext; }
          UI.fillDetail(self.el, item, info);
        }
      });
    },

    renderButtons: function () {
      var self = this, item = this.item, pid = IPTV.app.profile.id;
      U.empty(this.buttons);
      var pos = S.getPosition(pid, item);
      var first;
      if (pos && pos.t > 30) {
        first = UI.button(U.icon('play') + ' Continuar (' + U.formatDuration(pos.t) + ')', function () { IPTV.app.play(item, { startTime: pos.t }); }, 'primary');
        this.buttons.appendChild(first);
        this.buttons.appendChild(UI.button('Desde el inicio', function () { IPTV.app.play(item, { startTime: 0 }); }));
      } else {
        first = UI.button(U.icon('play') + ' Reproducir', function () { IPTV.app.play(item, { startTime: 0 }); }, 'primary');
        this.buttons.appendChild(first);
      }
      var fav = UI.button(IPTV.app.isFavorite(item) ? '★ En favoritos' : '☆ Añadir a favoritos', function () {
        IPTV.app.toggleFavorite(item);
        fav.innerHTML = IPTV.app.isFavorite(item) ? '★ En favoritos' : '☆ Añadir a favoritos';
      });
      this.buttons.appendChild(fav);
      F.set(first);
    },

    resume: function () { this.renderButtons(); },

    onKey: function (action) {
      if (action === 'red') { IPTV.app.toggleFavorite(this.item); this.renderButtons(); return true; }
      if (action === 'play' || action === 'playpause') { IPTV.app.play(this.item); return true; }
      return false;
    }
  };
})(window);
