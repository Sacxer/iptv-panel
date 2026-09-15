/* Sección Series y detalle de serie (temporadas + episodios vía get_series_info). ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, S = IPTV.storage, F = IPTV.focus, UI = IPTV.ui, h = U.h;
  var sections = IPTV.sections = IPTV.sections || {};
  var screens = IPTV.screens = IPTV.screens || {};

  sections.series = UI.makeCatalogSection('series', {
    title: 'Series',
    icon: 'series',
    noun: 'series',
    onSelect: function (it, list, index) {
      if (IPTV.app.source.hasSeriesInfo) { IPTV.app.push('seriesDetail', { item: it }); }
      else { IPTV.app.play(it, { list: list, index: index }); }
    }
  });

  screens.seriesDetail = {
    create: function () {
      var self = this;
      var el = UI.detailSkeleton('series-detail');
      this.buttons = el.querySelector('.detail-buttons');
      this.extra = el.querySelector('.detail-extra');
      this.extra.innerHTML = '<div class="seasons scroll scroll-x" data-focus-group></div><div class="episodes vl"></div>';
      this.seasonsEl = this.extra.querySelector('.seasons');
      this.status = h('div', { className: 'muted episodes-status' });
      this.extra.insertBefore(this.status, this.seasonsEl);

      this.episodes = new UI.VList(this.extra.querySelector('.episodes'), {
        rowHeight: 96,
        rowClass: 'ep-row',
        emptyText: '',
        render: function (row, ep) {
          var pos = S.getPosition(IPTV.app.profile.id, ep);
          var sub = [];
          if (ep.duration) { sub.push(ep.duration); }
          if (pos && pos.t > 30) { sub.push('Visto hasta ' + U.formatDuration(pos.t)); }
          UI.renderRow(row, { num: 'E' + ep.episode, name: ep.name, logo: false, sub: sub.join(' · ') });
        },
        onSelect: function (ep, i) {
          var season = self.data.seasons[self.seasonIndex];
          IPTV.app.play(ep, { list: season.episodes, index: i });
        }
      });
      return el;
    },

    show: function (params) {
      var self = this, item = params.item;
      this.item = item;
      this.data = null;
      this.seasonIndex = 0;
      UI.fillDetail(this.el, item, { plot: item.plot, genre: item.genre, rating: item.rating, year: item.year, cast: item.cast, director: item.director });
      U.empty(this.seasonsEl);
      this.episodes.setItems([]);
      this.status.textContent = 'Cargando temporadas…';
      U.show(this.status, true);
      this.renderButtons();
      IPTV.app.source.getSeriesInfo(item, function (err, data) {
        if (self.item !== item) { return; }
        if (err || !data) { self.status.textContent = 'No se pudo cargar la serie' + (err && err.message ? ': ' + err.message : ''); return; }
        self.data = data;
        UI.fillDetail(self.el, item, data.info);
        if (!data.seasons.length) { self.status.textContent = 'Esta serie no tiene episodios disponibles'; return; }
        U.hide(self.status);
        self.renderSeasons();
        /* Temporada del último episodio visto */
        var recent = U.find(S.getRecents(IPTV.app.profile.id), function (r) { return r.type === 'episode' && String(r.seriesId) === String(item.id); });
        var si = 0, ei = 0;
        if (recent) {
          si = Math.max(0, U.findIndex(data.seasons, function (s) { return s.num === recent.season; }));
          ei = Math.max(0, U.findIndex(data.seasons[si].episodes, function (e) { return e.id === recent.id; }));
        }
        self.selectSeason(si, ei);
        self.episodes.focusIndex(ei);
      });
    },

    renderButtons: function () {
      var self = this, item = this.item;
      U.empty(this.buttons);
      var fav = UI.button(IPTV.app.isFavorite(item) ? '★ En favoritos' : '☆ Añadir a favoritos', function () {
        IPTV.app.toggleFavorite(item);
        self.renderButtons();
        F.set(self.buttons.firstChild);
      });
      this.buttons.appendChild(fav);
      if (!F.get() || !this.el.contains(F.get())) { F.set(fav); }
    },

    renderSeasons: function () {
      var self = this;
      U.empty(this.seasonsEl);
      U.each(this.data.seasons, function (s, i) {
        var b = UI.button(U.escapeHtml(s.name) + ' <span class="cnt">' + s.episodes.length + '</span>', function () {
          self.selectSeason(i, 0);
          self.episodes.focusIndex(0);
        }, 'season');
        b.__onFocus = function () { self.selectSeason(i, 0); };
        self.seasonsEl.appendChild(b);
      });
    },

    selectSeason: function (i, epIndex) {
      if (!this.data || !this.data.seasons[i]) { return; }
      if (this.seasonIndex === i && this.episodes.items === this.data.seasons[i].episodes) { return; }
      this.seasonIndex = i;
      var btns = this.seasonsEl.children, k;
      for (k = 0; k < btns.length; k++) { btns[k].classList[k === i ? 'add' : 'remove']('active'); }
      this.seasonsEl.__lastFocus = btns[i];
      this.episodes.setItems(this.data.seasons[i].episodes, epIndex || 0);
    },

    resume: function () {
      this.episodes.refresh();
      var ps = screens.player;
      /* Si el reproductor avanzó de episodio, sincronizar la selección */
      if (ps.lastItem && ps.lastItem.type === 'episode' && this.data) {
        var id = ps.lastItem.id, s = this.data.seasons[this.seasonIndex];
        var idx = s ? U.findIndex(s.episodes, function (e) { return e.id === id; }) : -1;
        if (idx >= 0) { this.episodes.focusIndex(idx); }
      }
    },

    onKey: function (action) {
      if (action === 'red') { IPTV.app.toggleFavorite(this.item); this.renderButtons(); return true; }
      if (action === 'chup' || action === 'chdown') {
        if (this.episodes.hasFocus()) { this.episodes.page(action === 'chup' ? -1 : 1); return true; }
      }
      return false;
    }
  };
})(window);
