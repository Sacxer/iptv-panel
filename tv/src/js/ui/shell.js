/*
 * Pantalla principal: menú lateral + barra superior + área de secciones.
 * Cada sección se registra en IPTV.sections[id] con:
 *   {title, icon, create() → Element, show(), hide(), pause(), resume(), relayout(),
 *    onKey(action, info) → bool, onBack() → bool, focusDefault(), hints}
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, F = IPTV.focus, UI = IPTV.ui, h = U.h;
  var screens = IPTV.screens = IPTV.screens || {};
  var sections = IPTV.sections = IPTV.sections || {};

  var ORDER = ['live', 'movie', 'series', 'favorites', 'recents', 'search', 'messages', 'account'];

  UI.keyHint = function (color, text) {
    return '<span class="kh"><span class="key ' + color + '"></span>' + U.escapeHtml(text) + '</span>';
  };

  screens.shell = {
    create: function () {
      var self = this;
      var el = h('div', { className: 'shell' });

      /* Menú lateral */
      var side = h('div', { className: 'sidebar', 'data-focus-group': '' });
      side.appendChild(h('div', { className: 'side-brand', html: '<span class="brand-logo small">' + U.icon('live') + '</span><span class="side-brand-name">IPTV</span>' }));
      var nav = h('div', { className: 'side-nav' });
      this.navItems = {};
      U.each(ORDER, function (id) {
        var sec = sections[id];
        if (!sec) { return; }
        var item = h('div', { className: 'side-item focusable', 'data-section': id });
        item.innerHTML = U.icon(sec.icon) + '<span class="side-label">' + U.escapeHtml(sec.title) + '</span><span class="badge hidden"></span>';
        item.__ok = function () { self.open(id, true); };
        nav.appendChild(item);
        self.navItems[id] = item;
      });
      side.appendChild(nav);
      this.profileLabel = h('div', { className: 'side-profile' });
      side.appendChild(this.profileLabel);
      side.__nav = function (dir) {
        if (dir === 'right') {
          var cur = F.get();
          var id = cur && cur.getAttribute('data-section');
          if (id) { self.open(id, true); return true; }
        }
        return false;
      };
      this.sidebar = side;
      el.appendChild(side);

      /* Contenido */
      var main = h('div', { className: 'main' });
      main.innerHTML =
        '<div class="topbar"><div class="section-title"></div><div class="topbar-right"><span class="server-name"></span><span class="clock-date"></span><span class="clock"></span></div></div>' +
        '<div class="banner hidden"></div>' +
        '<div class="section-host"></div>' +
        '<div class="hints"></div>';
      this.titleEl = main.querySelector('.section-title');
      this.serverEl = main.querySelector('.server-name');
      this.clockEl = main.querySelector('.clock');
      this.dateEl = main.querySelector('.clock-date');
      this.banner = main.querySelector('.banner');
      this.host = main.querySelector('.section-host');
      this.hintsEl = main.querySelector('.hints');
      el.appendChild(main);
      this.main = main;
      return el;
    },

    show: function () {
      var self = this, app = IPTV.app;
      /* Nuevo perfil: recrear secciones */
      U.each(ORDER, function (id) {
        var sec = sections[id];
        if (sec && sec.el) {
          sec.el.classList.add('hidden');
          if (sec.reset) { sec.reset(); }
        }
      });
      this.current = null;
      this.profileLabel.innerHTML = U.icon('account') + '<span>' + U.escapeHtml(app.profile ? app.profile.name : '') + '</span>';
      this.updateServerName();
      this.tick();
      if (this.clockTimer) { clearInterval(this.clockTimer); }
      this.clockTimer = setInterval(function () { self.tick(); }, 10000);
      this.onPortalUpdate();
      if (IPTV.notices) { IPTV.notices.attach(this.banner); IPTV.notices.update(); }
      this.open(U.findIndex(ORDER, function (x) { return x === IPTV.storage.get('lastSection'); }) >= 0 ? IPTV.storage.get('lastSection') : 'live', true);
    },

    hide: function () {
      if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = null; }
      if (this.current && sections[this.current].hide) { sections[this.current].hide(); }
      this.current = null;
      if (IPTV.notices) { IPTV.notices.detach(); }
    },

    pause: function () {
      var sec = this.current && sections[this.current];
      if (sec && sec.pause) { sec.pause(); }
    },

    resume: function () {
      var sec = this.current && sections[this.current];
      this.tick();
      if (sec && sec.resume) { sec.resume(); }
    },

    tick: function () {
      var d = new Date();
      this.clockEl.textContent = U.formatClock(d);
      this.dateEl.textContent = U.formatDateLong(d);
    },

    updateServerName: function () {
      var p = IPTV.portal;
      this.serverEl.textContent = (p.enabled && p.name) ? p.name : '';
    },

    /* Abre una sección; focusContent=true mueve el foco al contenido */
    open: function (id, focusContent) {
      var sec = sections[id];
      if (!sec) { return; }
      if (this.current !== id) {
        var prev = this.current && sections[this.current];
        if (prev) {
          if (prev.hide) { prev.hide(); }
          prev.el.classList.add('hidden');
        }
        if (!sec.el) {
          sec.el = sec.create();
          sec.el.classList.add('section');
          this.host.appendChild(sec.el);
        }
        sec.el.classList.remove('hidden');
        this.current = id;
        IPTV.storage.set('lastSection', id);
        this.titleEl.textContent = sec.title;
        U.each(ORDER, function (k) { var n = screens.shell.navItems[k]; if (n) { n.classList[k === id ? 'add' : 'remove']('active'); } });
        this.setHints(sec.hints || '');
        if (sec.show) { sec.show(); }
      }
      if (focusContent) {
        if (!(sec.focusDefault && sec.focusDefault())) {
          if (!F.focusIn(sec.el)) { F.set(this.navItems[id]); }
        }
      }
    },

    setHints: function (html) { this.hintsEl.innerHTML = html || ''; },

    focusSidebar: function () {
      F.set(this.navItems[this.current] || this.sidebar.querySelector('.side-item'));
    },

    inSidebar: function () {
      var cur = F.get();
      return !!(cur && this.sidebar.contains(cur));
    },

    relayout: function () {
      var sec = this.current && sections[this.current];
      if (sec && sec.relayout) { sec.relayout(); }
    },

    onPortalUpdate: function () {
      var st = IPTV.portal.state;
      var n = (IPTV.portal.enabled && st) ? st.unread : 0;
      var item = this.navItems && this.navItems.messages;
      if (item) {
        var b = item.querySelector('.badge');
        b.textContent = n > 99 ? '99+' : String(n);
        b.classList[n > 0 ? 'remove' : 'add']('hidden');
      }
      if (this.el) { this.updateServerName(); }
      var sec = sections[this.current];
      if (sec && sec.onPortalUpdate) { sec.onPortalUpdate(); }
    },

    onKey: function (action, info) {
      var sec = this.current && sections[this.current];
      if (!this.inSidebar() && sec && sec.onKey && sec.onKey(action, info)) { return true; }
      if (action === 'back') {
        if (!this.inSidebar()) {
          if (sec && sec.onBack && sec.onBack()) { return true; }
          this.focusSidebar();
          return true;
        }
        IPTV.app.askExit();
        return true;
      }
      if ((action === 'chup' || action === 'chdown') && this.inSidebar()) { return true; }
      return false;
    }
  };
})(window);
