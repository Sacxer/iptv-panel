/*
 * Integración con el portal (/api/client): avisos, mensajes, cortes y estado del usuario.
 * Solo se activa si GET {server}/api/client/ping responde {"portal": true} (perfiles Xtream).
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util, H = IPTV.http;

  var REFRESH_MS = 5 * 60 * 1000;

  function Portal() {
    U.Emitter.call(this);
    this.reset();
  }
  Portal.prototype = Object.create(U.Emitter.prototype);
  Portal.prototype.constructor = Portal;

  Portal.prototype.reset = function () {
    if (this._timer) { clearInterval(this._timer); }
    this._timer = null;
    this.enabled = false;
    this.server = '';
    this.user = '';
    this.pass = '';
    this.name = '';
    this.state = null;      /* última respuesta de /info */
    this.authError = false;
  };

  /* Comprueba si el servidor es un portal. cb(enabled) */
  Portal.prototype.start = function (profile, cb) {
    var self = this;
    this.reset();
    if (!profile || profile.type !== 'xtream') { if (cb) { cb(false); } return; }
    this.server = U.normalizeServer(profile.server);
    this.user = profile.username;
    this.pass = profile.password;
    var server = this.server;
    H.getJSON(server + '/api/client/ping', function (err, data) {
      if (server !== self.server) { return; }  /* perfil cambiado mientras tanto */
      if (err || !data || data.portal !== true) {
        self.enabled = false;
        if (cb) { cb(false); }
        return;
      }
      self.enabled = true;
      self.name = data.name || '';
      self.refresh(function () { if (cb) { cb(true); } });
      self._timer = setInterval(function () { self.refresh(); }, REFRESH_MS);
    }, 8000);
  };

  Portal.prototype.stop = function () { this.reset(); };

  Portal.prototype.refresh = function (cb) {
    var self = this;
    if (!this.enabled) { if (cb) { cb(); } return; }
    var server = this.server;
    H.getJSON(server + '/api/client/info?' + U.qs({ username: this.user, password: this.pass }), function (err, data) {
      if (server !== self.server) { return; }
      if (err) {
        if (err.status === 401) {
          self.authError = true;
          self.emit('update', self.state, { authError: true });
        }
        /* errores de red: se conserva el último estado conocido */
        if (cb) { cb(err); }
        return;
      }
      self.authError = false;
      self.state = Portal.normalize(data);
      if (self.state.server_name) { self.name = self.state.server_name; }
      self.emit('update', self.state, {});
      if (cb) { cb(null); }
    }, 15000);
  };

  Portal.normalize = function (d) {
    d = d || {};
    return {
      server_name: d.server_name || '',
      user: d.user || null,
      outage: d.outage || null,
      notices: U.isArray(d.notices) ? d.notices : [],
      messages: U.isArray(d.messages) ? d.messages : [],
      unread: typeof d.unread_messages === 'number' ? d.unread_messages : 0
    };
  };

  Portal.prototype.markRead = function (msg, cb) {
    var self = this;
    if (!this.enabled || !msg || msg.read) { if (cb) { cb(null); } return; }
    msg.read = true;
    if (this.state) {
      this.state.unread = 0;
      U.each(this.state.messages, function (m) { if (!m.read) { self.state.unread++; } });
      this.emit('update', this.state, { local: true });
    }
    H.postJSON(this.server + '/api/client/messages/' + encodeURIComponent(msg.id) + '/read',
      { username: this.user, password: this.pass }, function (err) { if (cb) { cb(err); } });
  };

  /* Notificaciones visibles ahora mismo (según starts_at / ends_at) */
  Portal.prototype.activeNotices = function (display) {
    var now = U.nowSec(), out = [];
    if (!this.state) { return out; }
    U.each(this.state.notices, function (n) {
      if (display && n.display !== display) { return; }
      if (n.starts_at && n.starts_at > now) { return; }
      if (n.ends_at && n.ends_at < now) { return; }
      out.push(n);
    });
    return out;
  };

  /*
   * Motivo de bloqueo total (null si se puede usar la app).
   * {kind: 'outage'|'suspended'|'expired'|'disabled'|'auth', title, reason, until}
   */
  Portal.prototype.blockInfo = function () {
    if (!this.enabled) { return null; }
    if (this.authError) {
      return { kind: 'auth', title: 'Credenciales no válidas', reason: 'Su usuario o contraseña ya no son válidos.' };
    }
    var st = this.state;
    if (!st) { return null; }
    var u = st.user;
    if (u && u.status && u.status !== 'active') {
      var titles = { suspended: 'Servicio suspendido', expired: 'Suscripción vencida', disabled: 'Cuenta deshabilitada' };
      var reason = u.suspension_reason || '';
      if (!reason && u.status === 'expired') { reason = 'Su suscripción venció el ' + U.formatUnixDate(u.exp_date) + '.'; }
      return { kind: u.status, title: titles[u.status] || 'Cuenta no disponible', reason: reason };
    }
    if (st.outage && st.outage.block_playback) {
      var now = U.nowSec();
      if ((!st.outage.starts_at || st.outage.starts_at <= now) && (!st.outage.ends_at || st.outage.ends_at > now)) {
        return { kind: 'outage', title: st.outage.title || 'Servicio interrumpido', reason: st.outage.reason || '', until: st.outage.ends_at || null };
      }
    }
    return null;
  };

  IPTV.Portal = Portal;
  IPTV.portal = new Portal();
})(typeof window !== 'undefined' ? window : global);
