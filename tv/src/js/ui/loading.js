/* Pantalla de carga / conexión. ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, UI = IPTV.ui, h = U.h;
  var screens = IPTV.screens = IPTV.screens || {};

  screens.loading = {
    create: function () {
      var self = this;
      var el = h('div', { className: 'loading-screen' });
      el.innerHTML =
        '<div class="brand"><div class="brand-logo">' + U.icon('live') + '</div><div class="brand-name">IPTV Player</div></div>' +
        UI.spinnerHtml +
        '<div class="loading-text"></div>' +
        '<div class="progress hidden"><div class="progress-fill"></div></div>';
      this.text = el.querySelector('.loading-text');
      this.bar = el.querySelector('.progress');
      this.fill = el.querySelector('.progress-fill');
      this.cancelBtn = UI.button('Cancelar', function () { self.cancel(); });
      el.appendChild(h('div', { className: 'loading-actions' }, [this.cancelBtn]));
      return el;
    },
    show: function (params) {
      this.setText(params.text || 'Cargando…');
      IPTV.focus.set(this.cancelBtn);
    },
    setText: function (text, frac) {
      if (!this.el) { return; }
      this.text.textContent = text || '';
      if (typeof frac === 'number') {
        this.bar.classList.remove('hidden');
        this.fill.style.width = Math.round(U.clamp(frac, 0, 1) * 100) + '%';
      } else {
        this.bar.classList.add('hidden');
      }
    },
    cancel: function () {
      IPTV.app.source = null;
      IPTV.app.profile = null;
      IPTV.portal.stop();
      IPTV.storage.remove('activeProfile');
      IPTV.app.reset('login');
    },
    onBack: function () { this.cancel(); return true; }
  };
})(window);
