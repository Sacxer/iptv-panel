/*
 * Identidad del equipo y datos de red. ES5.
 *
 * - Cabeceras para el portal y la API Xtream: X-Device-Id (aleatorio y persistente), X-Device-Type: smart_tv,
 *   X-Device-Brand / X-Device-Model (Samsung: webapis.productinfo / tizen.systeminfo; LG: luna / PalmSystem),
 *   X-App-Name, X-App-Version, X-App-Build, X-App-Distribution (tizen | webos). Todo en ASCII.
 * - Redes locales reales para buscar el portal: Tizen (tizen.systeminfo ETHERNET_NETWORK / WIFI_NETWORK y
 *   webapis.network) y webOS (luna://com.webos.service.connectionmanager/getStatus).
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util;

  var D = IPTV.device = {
    id: '',
    type: 'smart_tv',
    brand: '',
    model: '',
    os: '',
    ready: false
  };

  /* ---------- Utilidades ---------- */
  D.ascii = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[áàäâã]/g, 'a').replace(/[ÁÀÄÂÃ]/g, 'A').replace(/[éèëê]/g, 'e').replace(/[ÉÈËÊ]/g, 'E')
      .replace(/[íìïî]/g, 'i').replace(/[ÍÌÏÎ]/g, 'I').replace(/[óòöôõ]/g, 'o').replace(/[ÓÒÖÔÕ]/g, 'O')
      .replace(/[úùüû]/g, 'u').replace(/[ÚÙÜÛ]/g, 'U').replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
      .replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().substr(0, 80);
  };

  D.uuid = function () {
    var bytes = [], i, c = root.crypto || root.msCrypto;
    try {
      if (c && c.getRandomValues) {
        var arr = new Uint8Array(16);
        c.getRandomValues(arr);
        for (i = 0; i < 16; i++) { bytes.push(arr[i]); }
      }
    } catch (e) { bytes = []; }
    if (bytes.length !== 16) {
      for (i = 0; i < 16; i++) { bytes.push(Math.floor(Math.random() * 256)); }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = '';
    for (i = 0; i < 16; i++) {
      hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
      if (i === 3 || i === 5 || i === 7 || i === 9) { hex += '-'; }
    }
    return hex;
  };

  /* Número de compilación: 1.2.3 → 10203 (lo que el portal guarda como app_build) */
  D.buildNumber = function (version) {
    var m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''));
    if (!m) { return 0; }
    return parseInt(m[1], 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
  };

  /* Llamada luna:// en webOS sin webOSTV.js (PalmServiceBridge es nativo del televisor) */
  var bridges = [];
  D.luna = function (uri, params, cb, timeoutMs) {
    var done = false;
    function finish(r) {
      if (done) { return; }
      done = true;
      cb(r);
    }
    try {
      if (root.webOS && root.webOS.service && typeof root.webOS.service.request === 'function') {
        var i = uri.lastIndexOf('/');
        root.webOS.service.request(uri.substring(0, i), {
          method: uri.substring(i + 1),
          parameters: params || {},
          onSuccess: function (r) { finish(r); },
          onFailure: function () { finish(null); }
        });
      } else if (typeof root.PalmServiceBridge !== 'undefined') {
        var bridge = new root.PalmServiceBridge();
        bridges.push(bridge);
        bridge.onservicecallback = function (msg) {
          var r = null;
          try { r = JSON.parse(msg); } catch (e) { r = null; }
          var k = bridges.indexOf(bridge);
          if (k >= 0 && !(params && params.subscribe)) { bridges.splice(k, 1); }
          if (params && params.subscribe) { cb(r && r.returnValue !== false ? r : null); return; }
          finish(r && r.returnValue !== false ? r : null);
        };
        bridge.call(uri, JSON.stringify(params || {}));
      } else {
        finish(null);
        return;
      }
    } catch (e2) {
      finish(null);
      return;
    }
    if (!(params && params.subscribe)) {
      setTimeout(function () { finish(null); }, timeoutMs || 3000);
    }
  };

  function tizenCapability(key) {
    try { return root.tizen.systeminfo.getCapability(key); } catch (e) { return ''; }
  }

  function uaModel(ua) {
    var m = /(Chrome|Firefox|Edg|Safari)\/(\d+)/.exec(ua);
    return m ? (m[1] === 'Edg' ? 'Edge' : m[1]) + ' ' + m[2] : 'Navegador';
  }

  function platform() { return IPTV.platform || U.detectPlatform(); }

  /* ---------- Inicio ---------- */
  D.init = function (cb) {
    var S = IPTV.storage, ua = (root.navigator && root.navigator.userAgent) || '';
    var id = S.get('deviceId', '');
    if (!id || typeof id !== 'string') {
      id = D.uuid();
      S.set('deviceId', id);
    }
    D.id = id;
    var pf = platform();
    var finished = false;
    function done() {
      if (finished) { return; }
      finished = true;
      D.ready = true;
      if (cb) { cb(); }
    }

    if (pf === 'tizen') {
      D.brand = 'Samsung';
      try {
        var pi = root.webapis && root.webapis.productinfo;
        if (pi) { D.model = (pi.getRealModel && pi.getRealModel()) || (pi.getModel && pi.getModel()) || ''; }
      } catch (e) { D.model = ''; }
      if (!D.model) { D.model = tizenCapability('http://tizen.org/system/model_name') || 'Smart TV'; }
      var ver = tizenCapability('http://tizen.org/feature/platform.version');
      D.os = 'Tizen' + (ver ? ' ' + ver : '');
      done();
      return;
    }

    if (pf === 'webos') {
      D.brand = 'LG';
      var info = null;
      try { info = root.PalmSystem && root.PalmSystem.deviceInfo ? JSON.parse(root.PalmSystem.deviceInfo) : null; } catch (e1) { info = null; }
      if (info) {
        D.model = info.modelName || '';
        D.os = 'webOS' + (info.platformVersion ? ' ' + info.platformVersion : '');
        D.webosMajor = parseInt(info.platformVersionMajor, 10) || parseInt(info.platformVersion, 10) || 0;
      } else {
        D.os = 'webOS';
      }
      /* Respaldo: la versión del motor web (webOS 23 = Chromium 94 o superior) */
      if (!D.webosMajor) {
        var cm = /Chrome\/(\d+)/.exec(ua);
        var chrome = cm ? parseInt(cm[1], 10) : 0;
        D.webosMajor = chrome >= 108 ? 9 : (chrome >= 94 ? 8 : (chrome >= 87 ? 7 : (chrome >= 79 ? 6 : 0)));
      }
      D.luna('luna://com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName', 'firmwareVersion', 'sdkVersion'] }, function (r) {
        if (r) {
          if (r.modelName) { D.model = r.modelName; }
          if (r.sdkVersion) {
            D.os = 'webOS ' + r.sdkVersion;
            D.webosMajor = parseInt(r.sdkVersion, 10) || D.webosMajor;
          }
        }
        if (!D.model) { D.model = 'Smart TV'; }
        done();
      }, 2000);
      return;
    }

    D.brand = 'Navegador';
    D.model = uaModel(ua);
    D.os = /Windows/.test(ua) ? 'Windows' : (/Mac OS X/.test(ua) ? 'macOS' : (/Linux/.test(ua) ? 'Linux' : ''));
    done();
  };

  /* Cabeceras de identificación */
  D.headers = function () {
    var cfg = IPTV.config || {};
    var h = {
      'X-Device-Id': D.id,
      'X-Device-Type': D.type,
      'X-Device-Brand': D.ascii(D.brand),
      'X-Device-Model': D.ascii(D.model),
      'X-App-Name': D.ascii(cfg.appName || 'IPTV Player'),
      'X-App-Version': D.ascii(cfg.version || IPTV.VERSION || '')
    };
    var build = cfg.build || D.buildNumber(cfg.version);
    if (build) { h['X-App-Build'] = String(build); }
    if (cfg.distribution === 'tizen' || cfg.distribution === 'webos') { h['X-App-Distribution'] = cfg.distribution; }
    return h;
  };

  /* Todas las peticiones con {identity: true} (portal y API Xtream) llevan estas cabeceras */
  if (IPTV.http) {
    IPTV.http.identityHeaders = function () { return D.id ? D.headers() : null; };
  }

  /* ---------- Redes locales ---------- */
  /*
   * D.networks(cb) → cb([{name, address, prefix, gateway, preferred}]) o cb(null) si no se sabe.
   */
  D.networks = function (cb) {
    var pf = platform(), L = IPTV.lan, out = [];
    var finished = false;
    function add(name, address, mask, gateway, anyAddress) {
      if (anyAddress ? L.ipToInt(address) === null : !L.isLanAddress(address)) { return; }
      if (U.find(out, function (n) { return n.address === address; })) { return; }
      var prefix = typeof mask === 'number' ? mask : L.prefixFromMask(mask);
      out.push({ name: name, address: address, prefix: prefix || 24, gateway: L.ipToInt(gateway) !== null && gateway !== '0.0.0.0' ? gateway : null, preferred: true });
    }
    function done(list) {
      if (finished) { return; }
      finished = true;
      cb(list);
    }

    if (pf === 'tizen') {
      var pending = 2;
      var step = function () {
        pending--;
        if (pending > 0) { return; }
        /* Respaldo: Samsung Product API (webapis.network) */
        try {
          var n = root.webapis && root.webapis.network;
          if (n && n.getIp) {
            var type = n.getActiveConnectionType ? n.getActiveConnectionType() : 0;
            add(type === 1 ? 'wifi' : 'ethernet', n.getIp(), n.getSubnetMask ? n.getSubnetMask() : '', n.getGateway ? n.getGateway() : '');
          }
        } catch (e) { /* sin permiso o no disponible */ }
        done(out.length ? out : null);
      };
      U.each(['ETHERNET_NETWORK', 'WIFI_NETWORK'], function (prop) {
        var called = false;
        var once = function (v) {
          if (called) { return; }
          called = true;
          if (v && v.ipAddress && (v.status === undefined || v.status === 'ON')) {
            add(prop === 'WIFI_NETWORK' ? 'wifi' : 'ethernet', v.ipAddress, v.subnetMask || '', v.gateway || '');
          }
          step();
        };
        try {
          root.tizen.systeminfo.getPropertyValue(prop, once, function () { once(null); });
          setTimeout(function () { once(null); }, 2000);
        } catch (e2) { once(null); }
      });
      return;
    }

    if (pf === 'webos') {
      D.luna('luna://com.webos.service.connectionmanager/getStatus', {}, function (r) {
        if (r) {
          U.each(['wired', 'wifi'], function (k) {
            var n = r[k];
            if (n && n.state === 'connected' && n.ipAddress) { add(k === 'wifi' ? 'wifi' : 'ethernet', n.ipAddress, n.netmask || n.subnetMask || '', n.gateway || ''); }
          });
        }
        done(out.length ? out : null);
      }, 3000);
      return;
    }

    /* Navegador: la página no puede conocer su IP. Se usan la dirección de la página (si es de red local)
       y las redes indicadas en la configuración o en ?lan=192.168.1.0/24 */
    var cfg = IPTV.config || {};
    var nets = [];
    try {
      var m = /[?&]lan=([^&#]+)/.exec(root.location.search || '');
      if (m) { nets = decodeURIComponent(m[1]).split(','); }
    } catch (e3) { nets = []; }
    if (!nets.length && cfg.lanFallback) { nets = cfg.lanFallback.slice(); }
    U.each(nets, function (cidr) {
      var p = String(cidr).trim().split('/');
      /* En desarrollo se permite cualquier red (p. ej. 127.0.0.0/30 para probar con un portal local) */
      add('config', p[0], p[1] ? parseInt(p[1], 10) : 24, '', !!cfg.dev);
    });
    try {
      var host = root.location.hostname;
      if (L.isLanAddress(host)) { add('pagina', host, 24, ''); }
    } catch (e4) { /* nada */ }
    done(out.length ? out : null);
  };
})(typeof window !== 'undefined' ? window : global);
