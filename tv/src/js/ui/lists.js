/* Secciones Favoritos y Recientes. ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, S = IPTV.storage, F = IPTV.focus, UI = IPTV.ui, h = U.h;
  var sections = IPTV.sections = IPTV.sections || {};

  var TYPE_LABEL = { live: 'Canal', movie: 'Película', series: 'Serie', episode: 'Episodio' };
  UI.TYPE_LABEL = TYPE_LABEL;

  UI.itemSubtitle = function (it) {
    var parts = [TYPE_LABEL[it.type] || ''];
    if (it.type === 'episode' && it.seriesName) { parts.push(it.seriesName + ' · T' + it.season + ' E' + it.episode); }
    else if (it.catName) { parts.push(it.catName); }
    return parts.join(' · ');
  };

  /* Abre un ítem desde una lista mixta; para canales usa como contexto los canales de la lista */
  UI.openFromList = function (it, list) {
    if (it.type === 'live') {
      var lives = list.filter(function (x) { return x.type === 'live'; });
      IPTV.app.play(it, { list: lives, index: U.findIndex(lives, function (x) { return x === it; }) });
    } else {
      IPTV.app.open(it);
    }
  };

  function makeListSection(cfg) {
    return {
      title: cfg.title,
      icon: cfg.icon,
      hints: cfg.hints,

      create: function () {
        var self = this;
        var el = h('div', { className: 'list-section' });
        var bar = h('div', { className: 'filter-bar' });
        this.filter = 'all';
        this.filterBtns = {};
        U.each([['all', 'Todo'], ['live', 'Canales'], ['movie', 'Películas'], ['series', 'Series'], ['episode', 'Episodios']], function (f) {
          var b = UI.button(f[1], function () { self.setFilter(f[0]); }, 'toggle small');
          b.__onFocus = function () { self.setFilter(f[0]); };
          self.filterBtns[f[0]] = b;
          bar.appendChild(b);
        });
        if (cfg.extraButton) {
          bar.appendChild(h('div', { className: 'flex-spacer' }));
          bar.appendChild(UI.button(cfg.extraButton.label, function () { cfg.extraButton.action(self); }, 'small danger'));
        }
        el.appendChild(bar);
        var listEl = h('div', { className: 'vl big-list' });
        el.appendChild(listEl);
        this.list = new UI.VList(listEl, {
          rowHeight: 100,
          rowClass: 'item-row',
          emptyText: cfg.empty,
          render: function (row, it) {
            UI.renderRow(row, { name: it.name, logo: it.logo, sub: UI.itemSubtitle(it) + (cfg.when ? cfg.when(it) : '') });
          },
          onSelect: function (it) { UI.openFromList(it, self.list.items); }
        });
        return el;
      },

      reset: function () { this.list.setItems([]); },

      setFilter: function (f) {
        if (this.filter === f && this.loaded) { return; }
        this.filter = f;
        var k;
        for (k in this.filterBtns) { if (this.filterBtns.hasOwnProperty(k)) { this.filterBtns[k].classList[k === f ? 'add' : 'remove']('active'); } }
        this.reload();
      },

      reload: function () {
        var f = this.filter;
        var all = cfg.load(IPTV.app.profile.id);
        this.loaded = true;
        this.list.setItems(f === 'all' ? all : all.filter(function (x) { return x.type === f; }), this.list.index);
      },

      show: function () { this.loaded = false; this.setFilter(this.filter); },
      resume: function () { this.reload(); },
      relayout: function () { this.list.refresh(); },

      focusDefault: function () {
        if (this.list.items.length) { this.list.focusIndex(this.list.index); return true; }
        F.set(this.filterBtns[this.filter]);
        return true;
      },

      onKey: function (action) {
        if ((action === 'chup' || action === 'chdown') && this.list.hasFocus()) { this.list.page(action === 'chup' ? -1 : 1); return true; }
        if (action === 'red' && this.list.hasFocus()) {
          var it = this.list.current();
          if (it) {
            if (cfg.onRed) { cfg.onRed(it, this); } else { IPTV.app.toggleFavorite(it); this.list.refresh(); }
          }
          return true;
        }
        return false;
      }
    };
  }

  sections.favorites = makeListSection({
    title: 'Favoritos',
    icon: 'fav',
    empty: 'Aún no tiene favoritos. Pulse el botón ROJO sobre un canal, película o serie para añadirlo.',
    hints: UI.keyHint('ok', 'OK: abrir') + UI.keyHint('red', 'Quitar de favoritos'),
    load: function (pid) { return S.getFavorites(pid); },
    onRed: function (it, sec) {
      IPTV.app.toggleFavorite(it);
      var idx = sec.list.index;
      sec.reload();
      if (sec.list.items.length) { sec.list.focusIndex(Math.min(idx, sec.list.items.length - 1)); }
      else { F.set(sec.filterBtns[sec.filter]); }
    }
  });

  sections.recents = makeListSection({
    title: 'Recientes',
    icon: 'recent',
    empty: 'Todavía no ha reproducido nada.',
    hints: UI.keyHint('ok', 'OK: abrir') + UI.keyHint('red', 'Favorito'),
    load: function (pid) { return S.getRecents(pid); },
    when: function (it) {
      if (!it.ts) { return ''; }
      var d = new Date(it.ts);
      return ' · ' + d.getDate() + '/' + U.pad2(d.getMonth() + 1) + ' ' + U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
    },
    extraButton: {
      label: 'Borrar historial',
      action: function (sec) {
        UI.Dialog.confirm('Borrar historial', '¿Borrar la lista de reproducidos recientemente?', 'Borrar', function () {
          S.clearRecents(IPTV.app.profile.id);
          sec.reload();
          F.set(sec.filterBtns[sec.filter]);
        }, 'Cancelar');
      }
    }
  });
})(window);
