/* Sección Cuenta: datos de la suscripción, ajustes y cambio de perfil. ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, S = IPTV.storage, F = IPTV.focus, UI = IPTV.ui, X = IPTV.Xtream, h = U.h;
  var sections = IPTV.sections = IPTV.sections || {};

  var FORMAT_LABEL = { auto: 'Automático', ts: 'MPEG-TS (.ts)', m3u8: 'HLS (.m3u8)' };

  sections.account = {
    title: 'Cuenta',
    icon: 'account',
    hints: '',

    create: function () {
      var el = h('div', { className: 'account-section scroll' });
      this.card = h('div', { className: 'account-card' });
      this.settings = h('div', { className: 'account-settings' });
      el.appendChild(this.card);
      el.appendChild(this.settings);
      return el;
    },

    reset: function () { },

    show: function () { this.render(); },
    resume: function () { this.render(); },
    onPortalUpdate: function () { this.render(true); },

    row: function (label, value, cls) {
      return '<div class="kv"><span class="k">' + U.escapeHtml(label) + '</span><span class="v ' + (cls || '') + '">' + U.escapeHtml(value) + '</span></div>';
    },

    render: function (keepFocus) {
      var self = this, app = IPTV.app, p = app.profile, auth = app.auth, portal = IPTV.portal;
      if (!p) { return; }
      var html = '<div class="account-title">' + U.escapeHtml(p.name) + '</div>';
      html += this.row('Tipo', p.type === 'm3u' ? 'Lista M3U' : 'Xtream Codes');
      if (p.type === 'm3u') {
        html += this.row('Lista', p.m3uUrl.replace(/(password|pass|pwd)=[^&]*/ig, '$1=••••'));
        var src = app.source;
        if (src) {
          html += this.row('Contenido', src.getAll('live').length + ' canales · ' + src.getAll('movie').length + ' películas · ' + src.getAll('series').length + ' series');
        }
      } else {
        html += this.row('Servidor', U.normalizeServer(p.server));
        html += this.row('Usuario', p.username);
        var pu = portal.enabled && portal.state ? portal.state.user : null;
        if (pu) {
          var st = { active: 'Activa', expired: 'Vencida', suspended: 'Suspendida', disabled: 'Deshabilitada' }[pu.status] || pu.status;
          html += this.row('Estado', st, pu.status === 'active' ? 'ok' : 'bad');
          html += this.row('Vence', pu.exp_date ? U.formatUnixDate(pu.exp_date) : 'Sin vencimiento');
          html += this.row('Conexiones máximas', String(pu.max_connections));
          if (pu.is_trial) { html += this.row('Prueba', 'Sí'); }
        } else if (auth && auth.user) {
          html += this.row('Estado', X.statusText(auth.status), auth.ok ? 'ok' : 'bad');
          html += this.row('Vence', auth.user.exp_date ? U.formatUnixDate(auth.user.exp_date) : 'Sin vencimiento');
          html += this.row('Conexiones', auth.user.active_cons + ' de ' + auth.user.max_connections);
          if (auth.user.is_trial) { html += this.row('Prueba', 'Sí'); }
        }
        if (portal.enabled) {
          html += this.row('Proveedor', portal.name || 'Portal');
        }
      }
      html += this.row('Reproductor', IPTV.platform + ' · ' + IPTV.player.describeEngines());
      html += this.row('Versión', IPTV.VERSION);
      this.card.innerHTML = html;

      if (keepFocus && this.settings.children.length) { return; }
      var focusedIdx = -1, cur = F.get(), i;
      for (i = 0; i < this.settings.children.length; i++) { if (this.settings.children[i] === cur) { focusedIdx = i; } }
      U.empty(this.settings);
      var settings = S.getSettings();

      if (p.type === 'xtream') {
        this.settings.appendChild(UI.button('Formato de canales en vivo: <b>' + FORMAT_LABEL[settings.liveFormat] + '</b>', function () {
          var order = ['auto', 'ts', 'm3u8'];
          var next = order[(order.indexOf(S.getSettings().liveFormat) + 1) % order.length];
          S.setSetting('liveFormat', next);
          self.render();
        }, 'setting'));
      }
      this.settings.appendChild(UI.button('Vista previa en TV en vivo: <b>' + (settings.preview ? 'Sí' : 'No') + '</b>', function () {
        S.setSetting('preview', !S.getSettings().preview);
        self.render();
      }, 'setting'));
      this.settings.appendChild(UI.button('Recargar contenido', function () { IPTV.app.reload(); }, 'setting'));
      this.settings.appendChild(UI.button('Cambiar de perfil', function () { IPTV.app.logout(); }, 'setting'));
      this.settings.appendChild(UI.button('Editar este perfil', function () { IPTV.app.push('profileForm', { profile: p }); }, 'setting'));
      this.settings.appendChild(UI.button('Salir de la aplicación', function () { IPTV.app.askExit(); }, 'setting danger'));
      if (focusedIdx >= 0 && this.settings.children[focusedIdx]) { F.set(this.settings.children[focusedIdx]); }
    }
  };
})(window);
