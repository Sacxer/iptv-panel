/*
 * Pantallas de perfiles: lista de perfiles guardados y formulario de inicio de sesión. ES5.
 *
 * Según la configuración (session.loginOptions):
 *   - Normal (allowCustomServer/allowM3U true): Xtream Codes (servidor + usuario + contraseña, con
 *     "Buscar servidor en mi red") o Lista M3U. Si operator.json trae serverUrls, el servidor viene
 *     sugerido y el cliente solo escribe usuario y contraseña.
 *   - Restringida (ambos false): solo usuario y contraseña; el servidor se elige solo (dirección guardada,
 *     serverUrls o búsqueda en la red local).
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, S = IPTV.storage, F = IPTV.focus, UI = IPTV.ui, h = U.h;
  var screens = IPTV.screens = IPTV.screens || {};

  function appName() { return (IPTV.config && IPTV.config.appName) || 'IPTV Player'; }

  UI.brandHtml = function () {
    return '<div class="brand"><div class="brand-logo">' + U.icon('live') + '</div><div class="brand-name">' + U.escapeHtml(appName()) + '</div></div>';
  };

  /* Texto de ayuda con el contacto del operador (operator.json → support) */
  UI.supportText = function () {
    var s = (IPTV.config && IPTV.config.support) || {}, parts = [];
    if (s.phone) { parts.push('Tel. ' + s.phone); }
    if (s.whatsapp) { parts.push('WhatsApp ' + s.whatsapp); }
    if (s.email) { parts.push(s.email); }
    if (s.web) { parts.push(s.web); }
    if (!parts.length) { return ''; }
    return (s.name ? s.name + ': ' : '') + parts.join(' · ');
  };

  function profileTypeLabel(p) {
    if (p.type === 'm3u') { return 'Lista M3U'; }
    if (p.auto || IPTV.session.isOperatorServer(p.server)) { return 'Usuario ' + (p.username || ''); }
    return 'Xtream Codes';
  }

  /* ======================= Lista de perfiles ======================= */
  screens.login = {
    create: function () {
      var el = h('div', { className: 'login-screen' });
      el.innerHTML =
        UI.brandHtml() +
        '<div class="login-title">¿Quién está viendo?</div>' +
        '<div class="login-error hidden"></div>' +
        '<div class="profiles scroll scroll-x"></div>' +
        '<div class="hint">OK: conectar · Flecha abajo: editar o eliminar · Atrás: salir</div>' +
        '<div class="support hint"></div>';
      this.list = el.querySelector('.profiles');
      this.err = el.querySelector('.login-error');
      this.support = el.querySelector('.support');
      return el;
    },

    show: function (params) {
      var self = this;
      this.el.querySelector('.brand-name').textContent = appName();
      this.support.textContent = UI.supportText();
      U.show(this.support, !!this.support.textContent);
      if (params.error && !params.editProfile) {
        this.err.textContent = params.error;
        this.err.classList.remove('hidden');
      } else {
        this.err.classList.add('hidden');
      }
      this.render();
      var profiles = S.getProfiles();
      if (params.editProfile) {
        var p = params.editProfile;
        setTimeout(function () { IPTV.app.push('profileForm', { profile: p, error: params.error, canSearch: params.canSearch }); }, 0);
        return;
      }
      if (!profiles.length && !params.error) {
        setTimeout(function () { IPTV.app.push('profileForm', { first: true }); }, 0);
        return;
      }
      var lastId = S.get('lastProfile');
      var card = lastId ? self.list.querySelector('[data-id="' + lastId + '"] .profile-card') : null;
      F.set(card || self.list.querySelector('.profile-card') || self.list.querySelector('.focusable'));
    },

    resume: function () {
      this.render();
      if (!S.getProfiles().length) {
        setTimeout(function () { IPTV.app.push('profileForm', { first: true }); }, 0);
        return;
      }
      F.first(this.list);
    },

    render: function () {
      var self = this, profiles = S.getProfiles();
      U.empty(this.list);
      U.each(profiles, function (p) {
        var col = h('div', { className: 'profile-col', 'data-id': p.id });
        var card = h('div', { className: 'profile-card focusable' });
        card.innerHTML =
          '<div class="profile-avatar">' + U.escapeHtml(U.initials(p.name)) + '</div>' +
          '<div class="profile-name">' + U.escapeHtml(p.name) + '</div>' +
          '<div class="profile-type">' + U.escapeHtml(profileTypeLabel(p)) + '</div>';
        card.__ok = function () {
          S.set('lastProfile', p.id);
          IPTV.app.connect(p);
        };
        var actions = h('div', { className: 'profile-actions' }, [
          UI.button('Editar', function () { IPTV.app.push('profileForm', { profile: p }); }, 'small'),
          UI.button('Eliminar', function () {
            UI.Dialog.confirm('Eliminar perfil', '¿Eliminar el perfil "' + p.name + '"? Se borrarán sus favoritos y recientes.', 'Eliminar', function () {
              S.deleteProfile(p.id);
              self.render();
              if (!S.getProfiles().length) { IPTV.app.push('profileForm', { first: true }); return; }
              F.first(self.list);
            }, 'Cancelar');
          }, 'small danger')
        ]);
        col.appendChild(card);
        col.appendChild(actions);
        self.list.appendChild(col);
      });
      var add = h('div', { className: 'profile-col' });
      var addCard = h('div', { className: 'profile-card add focusable' });
      var opts = IPTV.session.loginOptions();
      addCard.innerHTML = '<div class="profile-avatar">' + U.icon('plus') + '</div><div class="profile-name">Agregar perfil</div>' +
        '<div class="profile-type">' + (opts.restricted ? 'Otra cuenta' : (opts.showM3U ? 'Xtream o M3U' : 'Xtream Codes')) + '</div>';
      addCard.__ok = function () { IPTV.app.push('profileForm', {}); };
      add.appendChild(addCard);
      this.list.appendChild(add);
    },

    onBack: function () { IPTV.app.backFromHome(); return true; }
  };

  /* ======================= Formulario de perfil ======================= */
  screens.profileForm = {
    create: function () {
      var self = this;
      var el = h('div', { className: 'form-screen' });
      var box = h('div', { className: 'form-box' });
      this.titleEl = h('div', { className: 'form-title', text: 'Iniciar sesión' });
      box.appendChild(this.titleEl);
      this.subtitle = h('div', { className: 'form-subtitle muted' });
      box.appendChild(this.subtitle);

      this.typeX = UI.button('Xtream Codes', function () { self.setType('xtream'); }, 'toggle');
      this.typeM = UI.button('Lista M3U', function () { self.setType('m3u'); }, 'toggle');
      this.typeRow = h('div', { className: 'form-row' }, [h('label', { text: 'Tipo de conexión' }), h('div', { className: 'toggle-group' }, [this.typeX, this.typeM])]);
      box.appendChild(this.typeRow);

      this.name = UI.input({ placeholder: 'Opcional. Ej.: Sala' });
      this.nameRow = row('Nombre del perfil', this.name);
      box.appendChild(this.nameRow);

      this.xFields = h('div', { className: 'form-group' });
      this.server = UI.input({ placeholder: 'http://servidor.com:25461', type: 'url', onInput: function () { self.foundServer = null; } });
      this.searchBtn = UI.button('Buscar en mi red', function () { self.searchLan(); }, 'small');
      this.serverRow = h('div', { className: 'form-row' }, [h('label', { text: 'URL del servidor' }), h('div', { className: 'input-with-btn' }, [this.server, this.searchBtn])]);
      this.autoRow = h('div', { className: 'form-row auto-server' });
      this.autoText = h('div', { className: 'auto-text' });
      this.autoSearchBtn = UI.button('Buscar servidor en mi red', function () { self.searchLan(); }, 'small');
      this.autoRow.appendChild(h('label', { text: 'Servidor' }));
      this.autoRow.appendChild(h('div', { className: 'input-with-btn' }, [this.autoText, this.autoSearchBtn]));
      this.user = UI.input({ placeholder: 'Usuario' });
      this.pass = UI.input({ placeholder: 'Contraseña', type: 'password', onSubmit: function () { self.save(); } });
      this.showPass = UI.button('Mostrar', function () {
        var vis = self.pass.type === 'password';
        self.pass.type = vis ? 'text' : 'password';
        self.showPass.textContent = vis ? 'Ocultar' : 'Mostrar';
      }, 'small');
      this.xFields.appendChild(this.serverRow);
      this.xFields.appendChild(this.autoRow);
      this.xFields.appendChild(row('Usuario', this.user));
      this.xFields.appendChild(h('div', { className: 'form-row' }, [h('label', { text: 'Contraseña' }), h('div', { className: 'input-with-btn' }, [this.pass, this.showPass])]));
      box.appendChild(this.xFields);

      this.mFields = h('div', { className: 'form-group hidden' });
      this.m3u = UI.input({ placeholder: 'http://servidor.com/lista.m3u', type: 'url', onSubmit: function () { self.save(); } });
      this.mFields.appendChild(row('URL de la lista M3U', this.m3u));
      box.appendChild(this.mFields);

      this.error = h('div', { className: 'form-error hidden' });
      box.appendChild(this.error);

      this.saveBtn = UI.button('Ingresar', function () { self.save(); }, 'primary');
      this.cancelBtn = UI.button('Cancelar', function () { self.cancel(); });
      box.appendChild(h('div', { className: 'form-buttons' }, [this.saveBtn, this.cancelBtn]));
      box.appendChild(h('div', { className: 'hint', text: 'Pulse OK sobre un campo para escribir con el teclado del televisor.' }));
      this.support = h('div', { className: 'hint support' });
      box.appendChild(this.support);
      el.appendChild(box);

      function row(label, input) {
        return h('div', { className: 'form-row' }, [h('label', { text: label }), input]);
      }
      return el;
    },

    show: function (params) {
      var p = params.profile || null;
      var o = IPTV.session.loginOptions();
      this.opts = o;
      this.editing = p;
      this.foundServer = null;
      this.titleEl.textContent = p ? 'Editar perfil' : (params.first ? 'Bienvenido a ' + appName() : 'Iniciar sesión');
      this.subtitle.textContent = o.restricted || (o.prefillServer && !p)
        ? 'Ingrese el usuario y la contraseña de su suscripción.'
        : 'Ingrese los datos que le entregó su proveedor.';
      this.name.value = p ? p.name : '';
      this.server.value = p && p.server ? p.server : (o.prefillServer || '');
      this.user.value = p && p.username ? p.username : '';
      this.pass.value = p && p.password ? p.password : '';
      this.pass.type = 'password';
      this.showPass.textContent = 'Mostrar';
      this.m3u.value = p && p.m3uUrl ? p.m3uUrl : '';
      U.show(this.typeRow, o.showM3U);
      U.show(this.nameRow, !o.restricted);
      U.show(this.serverRow, o.showServer);
      U.show(this.autoRow, !o.showServer);
      this.renderAutoServer(p ? p.server : '');
      this.support.textContent = UI.supportText() ? '¿Necesita ayuda? ' + UI.supportText() : '';
      U.show(this.support, !!this.support.textContent);
      this.setType(p && o.showM3U ? p.type : 'xtream');
      this.setError(params.error || '');
      this.saveBtn.textContent = p ? 'Guardar y conectar' : 'Ingresar';
      if (params.canSearch && params.error) {
        F.set(o.showServer ? this.searchBtn : this.autoSearchBtn);
      } else if (p) {
        F.set(this.saveBtn);
      } else if (o.showM3U) {
        F.set(this.typeX);
      } else {
        F.set(this.user);
      }
    },

    /* Se prueban todas las direcciones del operador: solo se muestra una si ya se conoce (perfil o búsqueda) */
    renderAutoServer: function (url) {
      this.autoText.textContent = url ? 'Automático · ' + url.replace(/^https?:\/\//, '') : 'Automático (servidor de ' + appName() + ')';
    },

    setType: function (t) {
      this.type = t;
      this.typeX.classList[t === 'xtream' ? 'add' : 'remove']('active');
      this.typeM.classList[t === 'm3u' ? 'add' : 'remove']('active');
      U.show(this.xFields, t === 'xtream');
      U.show(this.mFields, t === 'm3u');
    },

    setError: function (msg) {
      this.error.textContent = msg;
      U.show(this.error, !!msg);
    },

    /* "Buscar servidor en mi red": solo portales (responden /api/client/ping) */
    searchLan: function () {
      var self = this;
      this.setError('');
      UI.findServerOnLan({ onlyKnown: this.opts.restricted }, function (s) {
        if (!s) { return; }
        self.foundServer = s;
        if (self.opts.showServer) {
          self.server.value = s.url;
          F.set(self.user.value ? self.saveBtn : self.user);
        } else {
          self.renderAutoServer(s.url);
          F.set(self.user.value ? self.saveBtn : self.user);
        }
        UI.toast('Servidor encontrado: ' + (s.name || s.url), 3500);
      });
    },

    save: function () {
      var SS = IPTV.session, R = IPTV.relocate, o = this.opts;
      var p = this.editing ? U.extend({}, this.editing) : {};
      var prevServer = p.server || '';
      p.type = o.showM3U ? this.type : 'xtream';
      p.name = o.restricted ? '' : this.name.value.trim();
      if (p.type === 'xtream') {
        var server;
        if (o.showServer) {
          server = U.normalizeServer(this.server.value);
          if (!server || !R.normalizeBase(server)) { this.setError('Ingrese la URL del servidor (por ejemplo http://servidor.com:25461).'); F.set(this.server); return; }
        } else {
          server = this.foundServer ? this.foundServer.url : (p.server || '');
        }
        p.server = server;
        p.username = this.user.value.trim();
        p.password = this.pass.value;
        delete p.m3uUrl;
        if (!p.username) { this.setError('Ingrese el usuario.'); F.set(this.user); return; }
        if (!p.password) { this.setError('Ingrese la contraseña.'); F.set(this.pass); return; }
        if (!p.name) { p.name = p.username; }
        p.auto = o.restricted || SS.isOperatorServer(server) || (!!this.foundServer && R.sameUrl(this.foundServer.url, server));
        /* Otro servidor: la identidad guardada ya no aplica (salvo que la búsqueda confirme el mismo portal) */
        if (prevServer && server && !R.sameUrl(prevServer, server)) {
          var sameId = this.foundServer && this.foundServer.id && this.foundServer.id === p.portalId;
          if (!sameId) { delete p.portalId; delete p.portalUrls; delete p.clientPorts; }
        }
        if (this.foundServer && R.sameUrl(this.foundServer.url, server)) {
          if (this.foundServer.id) { p.portalId = this.foundServer.id; }
          if (this.foundServer.clientPorts && this.foundServer.clientPorts.length) { p.clientPorts = this.foundServer.clientPorts.slice(); }
        }
      } else {
        p.m3uUrl = this.m3u.value.trim();
        delete p.server; delete p.username; delete p.password; delete p.auto;
        delete p.portalId; delete p.portalUrls; delete p.clientPorts;
        if (!/^https?:\/\/.+/i.test(p.m3uUrl)) { this.setError('Ingrese una URL válida que empiece por http:// o https://'); F.set(this.m3u); return; }
        if (!p.name) { p.name = 'Lista M3U'; }
      }
      p = S.saveProfile(p);
      S.set('lastProfile', p.id);
      IPTV.app.connect(p);
    },

    cancel: function () {
      if (S.getProfiles().length) {
        if (IPTV.app.stack.length > 1) { IPTV.app.pop(); } else { IPTV.app.reset('login'); }
      } else {
        IPTV.app.backFromHome();
      }
    },

    onBack: function () { this.cancel(); return true; }
  };
})(window);
