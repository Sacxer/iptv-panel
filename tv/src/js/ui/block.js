/*
 * Pantalla de bloqueo total: corte con block_playback, usuario suspendido / vencido / deshabilitado.
 * Detiene la reproducción e impide navegar hasta que el estado cambie.
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, F = IPTV.focus, UI = IPTV.ui, h = U.h;
  var screens = IPTV.screens = IPTV.screens || {};

  screens.block = {
    create: function () {
      var self = this;
      var el = h('div', { className: 'block-screen' });
      el.innerHTML =
        '<div class="block-box">' +
        '  <div class="block-icon">!</div>' +
        '  <div class="block-title"></div>' +
        '  <div class="block-reason"></div>' +
        '  <div class="block-until"></div>' +
        '  <div class="block-contact">Por favor, contacte a su proveedor.</div>' +
        '  <div class="block-buttons"></div>' +
        '</div>';
      this.titleEl = el.querySelector('.block-title');
      this.reasonEl = el.querySelector('.block-reason');
      this.untilEl = el.querySelector('.block-until');
      var btns = el.querySelector('.block-buttons');
      this.retryBtn = UI.button('Reintentar', function () { self.retry(); }, 'primary');
      btns.appendChild(this.retryBtn);
      btns.appendChild(UI.button('Cambiar de perfil', function () { IPTV.app.logout(); }));
      btns.appendChild(UI.button('Salir', function () { IPTV.app.askExit(); }));
      return el;
    },

    show: function (params) {
      this.update(params.info);
      F.set(this.retryBtn);
    },

    update: function (info) {
      info = info || {};
      this.info = info;
      var hidden = this.el.classList.contains('hidden');
      this.el.className = 'screen block-screen kind-' + (info.kind || 'other') + (hidden ? ' hidden' : '');
      this.titleEl.textContent = info.title || 'Servicio no disponible';
      this.reasonEl.textContent = info.reason || '';
      U.show(this.reasonEl, !!info.reason);
      this.untilEl.textContent = info.until ? 'Se estima que el servicio se restablezca el ' + U.formatUnixDateTime(info.until) + '.' : '';
      U.show(this.untilEl, !!info.until);
    },

    retry: function () {
      var app = IPTV.app;
      UI.toast('Comprobando…');
      if (app.xtreamBlock) {
        /* El bloqueo vino del login Xtream: volver a autenticar */
        app.reload();
        return;
      }
      IPTV.portal.refresh(function () {
        app.checkBlock();
        if (app.isOnStack('block')) { UI.toast('El servicio sigue sin estar disponible'); }
      });
    },

    onKey: function (action) {
      if (action === 'back') { IPTV.app.askExit(); return true; }
      if (U.find(['left', 'right', 'up', 'down', 'ok'], function (a) { return a === action; })) { return false; }
      return true; /* bloquear el resto de teclas (canales, reproducción…) */
    }
  };
})(window);
