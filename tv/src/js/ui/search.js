/* Sección Buscar: canales, películas y series por nombre (sin distinguir tildes). ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, F = IPTV.focus, UI = IPTV.ui, h = U.h;
  var sections = IPTV.sections = IPTV.sections || {};
  var KINDS = ['live', 'movie', 'series'];
  var LIMIT = 150;

  sections.search = {
    title: 'Buscar',
    icon: 'search',
    hints: UI.keyHint('ok', 'OK sobre el campo: escribir') + UI.keyHint('red', 'Favorito'),

    create: function () {
      var self = this;
      var el = h('div', { className: 'search-section' });
      this.input = UI.input({
        placeholder: 'Escriba el nombre de un canal, película o serie',
        onInput: U.debounce(function (v) { self.run(v); }, 600),
        onSubmit: function (v) { self.run(v, true); }
      });
      this.status = h('div', { className: 'search-status muted' });
      var bar = h('div', { className: 'search-bar' }, [this.input]);
      el.appendChild(bar);
      el.appendChild(this.status);
      var listEl = h('div', { className: 'vl big-list' });
      el.appendChild(listEl);
      this.list = new UI.VList(listEl, {
        rowHeight: 100,
        rowClass: 'item-row',
        emptyText: '',
        render: function (row, it) { UI.renderRow(row, { name: it.name, logo: it.logo, sub: UI.itemSubtitle(it) }); },
        onSelect: function (it) { UI.openFromList(it, self.list.items); }
      });
      return el;
    },

    reset: function () {
      this.input.value = '';
      this.lastQuery = '';
      this.list.setItems([]);
      this.status.textContent = '';
    },

    show: function () {
      if (!this.lastQuery) { this.status.textContent = 'Mínimo 2 letras.'; }
    },

    focusDefault: function () {
      if (this.list.items.length) { this.list.focusIndex(this.list.index); } else { F.set(this.input); }
      return true;
    },

    run: function (q, focusResults, afterLoad) {
      var self = this, src = IPTV.app.source;
      q = String(q || '').trim();
      if (q.length < 2) { this.list.setItems([]); this.status.textContent = 'Mínimo 2 letras.'; this.lastQuery = ''; return; }
      this.lastQuery = q;
      var pending = 0;
      U.each(KINDS, function (k) { if (!src.isLoaded(k)) { pending++; } });
      if (pending && !afterLoad) {
        this.status.textContent = 'Cargando catálogo para buscar…';
        U.each(KINDS, function (k) {
          if (src.isLoaded(k)) { return; }
          src.load(k, function () {
            pending--;
            if (pending === 0 && self.lastQuery === q) { self.run(q, focusResults, true); }
          });
        });
        return;
      }
      var res = [], counts = {};
      U.each(KINDS, function (k) {
        var r = src.search(k, q, LIMIT);
        counts[k] = r.length;
        res = res.concat(r);
      });
      this.list.setItems(res, 0);
      this.status.textContent = res.length
        ? (counts.live + ' canales · ' + counts.movie + ' películas · ' + counts.series + ' series')
        : 'Sin resultados para "' + q + '"';
      if (focusResults && res.length) { this.list.focusIndex(0); }
    },

    resume: function () { this.list.refresh(); },
    relayout: function () { this.list.refresh(); },

    onKey: function (action) {
      if ((action === 'chup' || action === 'chdown') && this.list.hasFocus()) { this.list.page(action === 'chup' ? -1 : 1); return true; }
      if (action === 'red' && this.list.hasFocus()) {
        var it = this.list.current();
        if (it) { IPTV.app.toggleFavorite(it); }
        return true;
      }
      return false;
    }
  };
})(window);
