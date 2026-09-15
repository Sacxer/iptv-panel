/* Pantallas de perfiles: lista de perfiles guardados y formulario (Xtream Codes / M3U). ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, S = IPTV.storage, F = IPTV.focus, UI = IPTV.ui, h = U.h;
  var screens = IPTV.screens = IPTV.screens || {};

  /* ======================= Lista de perfiles ======================= */
  screens.login = {
    create: function () {
      var el = h('div', { className: 'login-screen' });
      el.innerHTML =
        '<div class="brand"><div class="brand-logo">' + U.icon('live') + '</div><div class="brand-name">IPTV Player</div></div>' +
        '<div class="login-title">¿Quién está viendo?</div>' +
        '<div class="login-error hidden"></div>' +
        '<div class="profiles scroll scroll-x"></div>' +
        '<div class="hint">OK: conectar · Flecha abajo: editar o eliminar · Atrás: salir</div>';
      this.list = el.querySelector('.profiles');
      this.err = el.querySelector('.login-error');
      return el;
    },

    show: function (params) {
      var self = this;
      if (params.error) {
        this.err.textContent = params.error;
        this.err.classList.remove('hidden');
      } else {
        this.err.classList.add('hidden');
      }
      this.render();
      var profiles = S.getProfiles();
      if (!profiles.length && !params.error) {
        setTimeout(function () { IPTV.app.push('profileForm', { first: true }); }, 0);
        return;
      }
      if (params.editProfile) {
        var p = params.editProfile;
        setTimeout(function () { IPTV.app.push('profileForm', { profile: p, error: params.error }); }, 0);
        return;
      }
      var lastId = S.get('lastProfile');
      var card = lastId ? self.list.querySelector('[data-id="' + lastId + '"] .profile-card') : null;
      F.set(card || self.list.querySelector('.profile-card') || self.list.querySelector('.focusable'));
    },

    resume: function () { this.render(); F.first(this.list); },

    render: function () {
      var self = this, profiles = S.getProfiles();
      U.empty(this.list);
      U.each(profiles, function (p) {
        var col = h('div', { className: 'profile-col', 'data-id': p.id });
        var card = h('div', { className: 'profile-card focusable' });
        card.innerHTML =
          '<div class="profile-avatar">' + U.escapeHtml(U.initials(p.name)) + '</div>' +
          '<div class="profile-name">' + U.escapeHtml(p.name) + '</div>' +
          '<div class="profile-type">' + (p.type === 'm3u' ? 'Lista M3U' : 'Xtream Codes') + '</div>';
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
      addCard.innerHTML = '<div class="profile-avatar">' + U.icon('plus') + '</div><div class="profile-name">Agregar perfil</div><div class="profile-type">Xtream o M3U</div>';
      addCard.__ok = function () { IPTV.app.push('profileForm', {}); };
      add.appendChild(addCard);
      this.list.appendChild(add);
    },

    onBack: function () { IPTV.app.askExit(); return true; }
  };

  /* ======================= Formulario de perfil ======================= */
  screens.profileForm = {
    create: function () {
      var self = this;
      var el = h('div', { className: 'form-screen' });
      var box = h('div', { className: 'form-box' });
      box.appendChild(h('div', { className: 'form-title', text: 'Nuevo perfil' }));
      this.title = box.firstChild;

      this.typeX = UI.button('Xtream Codes', function () { self.setType('xtream'); }, 'toggle');
      this.typeM = UI.button('Lista M3U', function () { self.setType('m3u'); }, 'toggle');
      box.appendChild(h('div', { className: 'form-row' }, [h('label', { text: 'Tipo de conexión' }), h('div', { className: 'toggle-group' }, [this.typeX, this.typeM])]));

      this.name = UI.input({ placeholder: 'Ej.: Casa' });
      box.appendChild(row('Nombre del perfil', this.name));

      this.xFields = h('div', { className: 'form-group' });
      this.server = UI.input({ placeholder: 'http://servidor.com:25461', type: 'url' });
      this.user = UI.input({ placeholder: 'Usuario' });
      this.pass = UI.input({ placeholder: 'Contraseña', type: 'password' });
      this.showPass = UI.button('Mostrar', function () {
        var vis = self.pass.type === 'password';
        self.pass.type = vis ? 'text' : 'password';
        self.showPass.textContent = vis ? 'Ocultar' : 'Mostrar';
      }, 'small');
      this.xFields.appendChild(row('URL del servidor', this.server));
      this.xFields.appendChild(row('Usuario', this.user));
      this.xFields.appendChild(h('div', { className: 'form-row' }, [h('label', { text: 'Contraseña' }), h('div', { className: 'input-with-btn' }, [this.pass, this.showPass])]));
      box.appendChild(this.xFields);

      this.mFields = h('div', { className: 'form-group hidden' });
      this.m3u = UI.input({ placeholder: 'http://servidor.com/lista.m3u', type: 'url' });
      this.mFields.appendChild(row('URL de la lista M3U', this.m3u));
      box.appendChild(this.mFields);

      this.error = h('div', { className: 'form-error hidden' });
      box.appendChild(this.error);

      this.saveBtn = UI.button('Guardar y conectar', function () { self.save(); }, 'primary');
      this.cancelBtn = UI.button('Cancelar', function () { self.cancel(); });
      box.appendChild(h('div', { className: 'form-buttons' }, [this.saveBtn, this.cancelBtn]));
      box.appendChild(h('div', { className: 'hint', text: 'Pulse OK sobre un campo para escribir con el teclado de la TV.' }));
      el.appendChild(box);

      function row(label, input) {
        return h('div', { className: 'form-row' }, [h('label', { text: label }), input]);
      }
      return el;
    },

    show: function (params) {
      var p = params.profile || null;
      this.editing = p;
      this.first = !!params.first;
      this.title.textContent = p ? 'Editar perfil' : 'Nuevo perfil';
      this.name.value = p ? p.name : '';
      this.server.value = p && p.server ? p.server : '';
      this.user.value = p && p.username ? p.username : '';
      this.pass.value = p && p.password ? p.password : '';
      this.pass.type = 'password';
      this.showPass.textContent = 'Mostrar';
      this.m3u.value = p && p.m3uUrl ? p.m3uUrl : '';
      this.setType(p ? p.type : 'xtream');
      this.setError(params.error || '');
      F.set(p ? this.saveBtn : this.typeX);
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

    save: function () {
      var p = this.editing ? U.extend({}, this.editing) : {};
      p.type = this.type;
      p.name = this.name.value.trim();
      if (p.type === 'xtream') {
        p.server = U.normalizeServer(this.server.value);
        p.username = this.user.value.trim();
        p.password = this.pass.value;
        delete p.m3uUrl;
        if (!p.server) { this.setError('Ingrese la URL del servidor.'); F.set(this.server); return; }
        if (!p.username) { this.setError('Ingrese el usuario.'); F.set(this.user); return; }
        if (!p.password) { this.setError('Ingrese la contraseña.'); F.set(this.pass); return; }
        if (!p.name) { p.name = p.username; }
      } else {
        p.m3uUrl = this.m3u.value.trim();
        delete p.server; delete p.username; delete p.password;
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
        IPTV.app.askExit();
      }
    },

    onBack: function () { this.cancel(); return true; }
  };
})(window);
