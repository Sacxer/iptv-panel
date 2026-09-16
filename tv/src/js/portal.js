/*
 * Integración con el portal (/api/client): avisos, mensajes, cortes, estado del usuario, identidad del
 * portal y latido de reproducción. Solo se activa si GET {server}/api/client/ping responde como portal
 * (perfiles Xtream). Con un servidor Xtream ajeno o una lista M3U la app funciona igual sin estas funciones.
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util, H = IPTV.http;

  var REFRESH_MS = 5 * 60 * 1000;

  function Portal() {
    U.Emitter.call(this);
    this._timer = null;
    this.reset();
  }
  Portal.prototype = Object.create(U.Emitter.prototype);
  Portal.prototype.constructor = Portal;

  Portal.prototype.reset = function () {
    if (this._timer) { clearInterval(this._timer); }
    this._timer = null;
    if (this.heartbeat) { this.heartbeat.stop(); }
    this.heartbeat = new Heartbeat(this);
    this.enabled = false;
    this.server = '';
    this.user = '';
    this.pass = '';
    this.name = '';
    this.id = '';
    this.clientPorts = [];
    this.state = null;      /* última respuesta de /info (normalizada) */
    this.authError = false;
    this.lastUpdate = 0;
    this._gen = (this._gen || 0) + 1;
  };

  Portal.prototype.setServer = function (url) {
    if (!url) { return; }
    this.server = U.normalizeServer(url);
  };

  function session() { return IPTV.session; }

  /* Petición con reubicación: si falla por red / puerto del panel, busca el portal y repite una vez */
  Portal.prototype._request = function (method, path, body, cb, timeout, retried) {
    var self = this, used = this.server, gen = this._gen;
    var url = used + path;
    var done = function (err, data) {
      if (gen !== self._gen) { return; }
      if (err && err.canRelocate && !retried && session()) {
        session().connectionLost(err, used, function (moved) {
          if (gen !== self._gen) { return; }
          if (moved) { self._request(method, path, body, cb, timeout, true); } else { cb(err, null); }
        });
        return;
      }
      cb(err, data);
    };
    if (method === 'GET') {
      H.getJSON(url, done, timeout || 15000, { identity: true });
    } else {
      H.postJSON(url, body, done, timeout || 15000, { identity: true });
    }
  };

  Portal.prototype._creds = function (extra) {
    return U.extend({ username: this.user, password: this.pass }, extra || {});
  };

  /*
   * Comprueba si el servidor es un portal. cb(enabled)
   * Si el servidor es el puerto del panel o no responde y el perfil tiene identidad, se busca antes.
   */
  Portal.prototype.start = function (profile, cb) {
    var self = this;
    this.reset();
    var gen = this._gen;
    if (!profile || profile.type !== 'xtream') { if (cb) { cb(false); } return; }
    this.server = U.normalizeServer(profile.server);
    this.user = profile.username;
    this.pass = profile.password;

    var attempt = function (retried) {
      IPTV.lan.ping(self.server, function (r) {
        if (gen !== self._gen) { return; }
        if (r.status !== 'portal' && !retried && session() && (r.status === 'unreachable' || r.status === 'panelPort')) {
          var err = H.makeError(r.status === 'panelPort' ? 'panelPort' : 'network', r.status === 'panelPort' ? 404 : 0, '', { clientPort: r.suggestedPort });
          session().connectionLost(err, self.server, function (moved) {
            if (gen !== self._gen) { return; }
            if (moved) { attempt(true); } else if (cb) { cb(false); }
          });
          return;
        }
        if (r.status !== 'portal') {
          self.enabled = false;
          if (cb) { cb(false); }
          return;
        }
        self.enabled = true;
        self.name = r.name || '';
        self.id = r.id || '';
        self.clientPorts = r.clientPorts || [];
        self.refresh(function () { if (cb && gen === self._gen) { cb(true); } });
        self._timer = setInterval(function () { self.refresh(); }, REFRESH_MS);
      }, 8000);
    };
    attempt(false);
  };

  Portal.prototype.stop = function () { this.reset(); };

  Portal.prototype.refresh = function (cb) {
    var self = this, gen = this._gen;
    if (!this.enabled) { if (cb) { cb(); } return; }
    var path = '/api/client/info?' + U.qs(this._creds());
    this._request('GET', path, undefined, function (err, data) {
      if (gen !== self._gen) { return; }
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
      self.lastUpdate = Date.now();
      if (self.state.server_name) { self.name = self.state.server_name; }
      if (self.state.server && session()) {
        if (self.state.server.id) { self.id = self.state.server.id; }
        session().rememberPortal(self.state.server, self.clientPorts);
      }
      self.emit('update', self.state, {});
      if (cb) { cb(null); }
    });
  };

  function num(v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; }

  Portal.normalize = function (d) {
    d = d && typeof d === 'object' ? d : {};
    var ns = d.notice_settings && typeof d.notice_settings === 'object' ? d.notice_settings : {};
    var server = d.server && typeof d.server === 'object' ? d.server : null;
    var notices = [], messages = [];
    U.each(U.isArray(d.notices) ? d.notices : [], function (n) {
      if (!n || typeof n !== 'object') { return; }
      notices.push({
        id: n.id,
        title: n.title ? String(n.title) : '',
        body: n.body ? String(n.body) : '',
        level: (n.level === 'warning' || n.level === 'critical') ? n.level : 'info',
        display: (n.display === 'popup' || n.display === 'ticker') ? n.display : 'banner',
        duration_seconds: num(n.duration_seconds),
        starts_at: num(n.starts_at),
        ends_at: num(n.ends_at)
      });
    });
    U.each(U.isArray(d.messages) ? d.messages : [], function (m) {
      if (!m || typeof m !== 'object') { return; }
      messages.push({
        id: m.id,
        title: m.title ? String(m.title) : 'Mensaje',
        body: m.body ? String(m.body) : '',
        kind: m.kind ? String(m.kind) : 'general',
        display: m.display === 'popup' ? 'popup' : 'inbox',
        created_at: num(m.created_at) || 0,
        read: m.read === true
      });
    });
    var unread = 0;
    U.each(messages, function (m) { if (!m.read) { unread++; } });
    var interval = num(ns.interval_seconds);
    return {
      server_name: d.server_name ? String(d.server_name) : '',
      server: server ? { id: server.id ? String(server.id) : '', name: server.name ? String(server.name) : '', urls: U.isArray(server.urls) ? server.urls : [] } : null,
      user: d.user && typeof d.user === 'object' ? d.user : null,
      outage: d.outage && typeof d.outage === 'object' ? d.outage : null,
      notices: notices,
      messages: messages,
      unread: typeof d.unread_messages === 'number' ? d.unread_messages : unread,
      noticeSettings: {
        carousel: ns.carousel !== false,
        interval: interval && interval >= 3 ? interval : 8
      }
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
    this._request('POST', '/api/client/messages/' + encodeURIComponent(msg.id) + '/read', this._creds(), function (err) { if (cb) { cb(err); } });
  };

  /* Avisos visibles ahora mismo (según starts_at / ends_at) */
  Portal.prototype.activeNotices = function (display) {
    var now = U.nowSec(), out = [];
    if (!this.enabled || !this.state) { return out; }
    U.each(this.state.notices, function (n) {
      if (display && n.display !== display) { return; }
      if (n.starts_at && n.starts_at > now) { return; }
      if (n.ends_at && n.ends_at < now) { return; }
      out.push(n);
    });
    return out;
  };

  /* Mensajes no leídos con display "popup" */
  Portal.prototype.popupMessages = function () {
    var out = [];
    if (!this.enabled || !this.state) { return out; }
    U.each(this.state.messages, function (m) { if (!m.read && m.display === 'popup') { out.push(m); } });
    return out;
  };

  Portal.prototype.noticeSettings = function () {
    return (this.state && this.state.noticeSettings) || { carousel: true, interval: 8 };
  };

  /* Corte activo que no bloquea (se muestra como aviso) */
  Portal.prototype.activeOutage = function () {
    if (!this.enabled || !this.state || !this.state.outage) { return null; }
    var o = this.state.outage, now = U.nowSec();
    if (o.starts_at && o.starts_at > now) { return null; }
    if (o.ends_at && o.ends_at <= now) { return null; }
    return o;
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
      var reason = u.suspension_reason ? String(u.suspension_reason) : '';
      if (!reason && u.status === 'expired') { reason = 'Su suscripción venció el ' + U.formatUnixDate(u.exp_date) + '.'; }
      return { kind: u.status, title: titles[u.status] || 'Cuenta no disponible', reason: reason };
    }
    var o = this.activeOutage();
    if (o && o.block_playback) {
      return { kind: 'outage', title: o.title || 'Servicio interrumpido', reason: o.reason || '', until: o.ends_at || null };
    }
    return null;
  };

  /* ======================= Latido de reproducción ======================= */
  /*
   * POST /api/client/playing al empezar y cada interval_seconds; POST /api/client/stopped al terminar.
   * 429 → límite de conexiones: se avisa con el evento 'limit' del portal.
   */
  function Heartbeat(portal) {
    this.portal = portal;
    this.streamId = null;
    this.connectionId = null;
    this.timer = null;
    this.active = false;
    this.gen = 0;
  }

  Heartbeat.prototype.start = function (streamId) {
    var p = this.portal;
    var id = parseInt(streamId, 10);
    if (!p.enabled || !id) { this.stop(); return; }
    if (this.active && this.streamId === id) { return; }
    if (this.active) { this.stop(true); }
    this.streamId = id;
    this.active = true;
    this.gen++;
    this.beat(this.gen);
  };

  Heartbeat.prototype.beat = function (gen) {
    var self = this, p = this.portal;
    if (!this.active || gen !== this.gen) { return; }
    var body = p._creds({ stream_id: this.streamId });
    if (this.connectionId) { body.connection_id = this.connectionId; }
    p._request('POST', '/api/client/playing', body, function (err, data) {
      if (gen !== self.gen) {
        /* Se detuvo mientras esperábamos: cerrar la conexión recién abierta */
        if (!err && data && data.connection_id && data.connection_id !== self.connectionId) {
          p._request('POST', '/api/client/stopped', p._creds({ connection_id: data.connection_id }), U.noop, 10000);
        }
        return;
      }
      if (err) {
        if (err.status === 429) {
          self.active = false;
          p.emit('limit', err.message || 'Límite de conexiones alcanzado.');
          return;
        }
        self.schedule(gen, 30);
        return;
      }
      if (data && data.connection_id) { self.connectionId = data.connection_id; }
      var secs = parseInt(data && data.interval_seconds, 10) || 30;
      self.schedule(gen, U.clamp(secs, 10, 600));
    }, 15000);
  };

  Heartbeat.prototype.schedule = function (gen, secs) {
    var self = this;
    if (this.timer) { clearTimeout(this.timer); }
    this.timer = setTimeout(function () { self.beat(gen); }, secs * 1000);
  };

  /* Informa al portal que se detuvo la reproducción */
  Heartbeat.prototype.stop = function (switching) {
    var p = this.portal;
    this.gen++;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    var wasActive = this.active, id = this.connectionId;
    this.active = false;
    this.connectionId = null;
    this.streamId = null;
    if ((!wasActive && !id) || !p.enabled) { return; }
    /* Al cambiar de canal se cierra la conexión anterior; la nueva se abre con el siguiente latido */
    var body = p._creds(id ? { connection_id: id } : {});
    if (switching && !id) { return; }
    p._request('POST', '/api/client/stopped', body, U.noop, 10000);
  };

  IPTV.Portal = Portal;
  IPTV.portal = new Portal();
})(typeof window !== 'undefined' ? window : global);
