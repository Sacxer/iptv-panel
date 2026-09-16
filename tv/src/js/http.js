/*
 * Peticiones HTTP con XMLHttpRequest (sin fetch, sin cookies). ES5.
 *
 * Errores: {status, kind, message, timeout?, clientPort?, canRelocate, data?}
 *   kind: network | timeout | panelPort | http | format | aborted
 *   panelPort = el portal respondió 404 "Los clientes usan el puerto N" (puerto del panel).
 *   canRelocate = el servidor pudo haber cambiado de dirección (red, tiempo, puerto del panel).
 *
 * Con {identity: true} se envían las cabeceras del equipo (X-Device-*, X-App-*). Si un servidor ajeno
 * rechaza esas cabeceras (CORS), se repite una vez sin ellas y se recuerda para ese origen.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util;
  var H = IPTV.http = {};

  H.DEFAULT_TIMEOUT = 20000;

  /* Función que devuelve las cabeceras de identificación (la define device.js) */
  H.identityHeaders = null;

  var noIdentity = {};
  var PANEL_HINT = /clientes usan el puerto (\d{1,5})/i;

  H.originOf = function (url) {
    var m = /^(https?:\/\/[^\/?#]+)/i.exec(String(url || ''));
    return m ? m[1].toLowerCase() : '';
  };

  /* Puerto de clientes en "Este es el puerto del panel. Los clientes usan el puerto N." */
  H.panelPortHint = function (text) {
    var m = PANEL_HINT.exec(String(text || ''));
    var p = m ? parseInt(m[1], 10) : 0;
    return (p > 0 && p < 65536) ? p : null;
  };

  function makeError(kind, status, message, extra) {
    var e = U.extend({ status: status, kind: kind, message: message }, extra || {});
    e.canRelocate = kind === 'network' || kind === 'timeout' || kind === 'panelPort';
    return e;
  }
  H.makeError = makeError;

  /* Una sola petición, sin reintentos */
  function send(opts, cb) {
    var xhr = new root.XMLHttpRequest();
    var done = false, timer = null, k;
    var method = opts.method || 'GET';

    function finish(err, res) {
      if (done) { return; }
      done = true;
      if (timer) { clearTimeout(timer); }
      cb(err, res);
    }

    try {
      xhr.open(method, opts.url, true);
    } catch (e) {
      finish(makeError('network', 0, 'La dirección del servidor no es válida'));
      return { abort: function () {} };
    }
    xhr.withCredentials = false;
    try {
      if (opts.body !== undefined) { xhr.setRequestHeader('Content-Type', opts.contentType || 'application/json'); }
      if (opts.json) { xhr.setRequestHeader('Accept', 'application/json'); }
      if (opts.headers) {
        for (k in opts.headers) {
          if (Object.prototype.hasOwnProperty.call(opts.headers, k) && opts.headers[k] !== '' && opts.headers[k] !== undefined && opts.headers[k] !== null) {
            xhr.setRequestHeader(k, String(opts.headers[k]));
          }
        }
      }
    } catch (eh) { /* cabecera no permitida: se omite */ }
    if (opts.onProgress) {
      xhr.onprogress = function (ev) { opts.onProgress(ev.loaded || 0, ev.lengthComputable ? ev.total : 0); };
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || done) { return; }
      var status = xhr.status;
      var text = '';
      try { text = xhr.responseText || ''; } catch (et) { text = ''; }
      var res = { status: status, text: text, data: null };
      if (opts.json) {
        try { res.data = text ? JSON.parse(text) : null; } catch (e) { res.parseError = true; }
      }
      if (status === 0) {
        finish(makeError('network', 0, 'No se pudo conectar con el servidor. Verifique su conexión a Internet.'), res);
      } else if (status >= 400) {
        var hint = status === 404 ? H.panelPortHint(res.data && res.data.error ? res.data.error : text) : null;
        if (hint) {
          finish(makeError('panelPort', status, 'Esta dirección es la del panel del servidor; las apps usan el puerto ' + hint + '.', { clientPort: hint }), res);
          return;
        }
        var msg = (res.data && res.data.error) ? String(res.data.error) : H.statusMessage(status);
        finish(makeError('http', status, msg, { data: res.data }), res);
      } else if (opts.json && res.parseError) {
        finish(makeError('format', status, 'Respuesta no válida del servidor. Verifique la dirección.'), res);
      } else {
        finish(null, res);
      }
    };
    timer = setTimeout(function () {
      if (done) { return; }
      done = true;
      try { xhr.abort(); } catch (e) { /* nada */ }
      cb(makeError('timeout', 0, 'El servidor tardó demasiado en responder.', { timeout: true }));
    }, opts.timeout || H.DEFAULT_TIMEOUT);

    try {
      xhr.send(opts.body !== undefined ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : null);
    } catch (e2) {
      finish(makeError('network', 0, 'No se pudo enviar la petición'));
    }
    return {
      abort: function () {
        if (done) { return; }
        done = true;
        if (timer) { clearTimeout(timer); }
        try { xhr.abort(); } catch (e) { /* nada */ }
      }
    };
  }

  H.statusMessage = function (status) {
    if (status === 401) { return 'Usuario o contraseña incorrectos.'; }
    if (status === 403) { return 'Acceso denegado: su cuenta no tiene acceso a este contenido.'; }
    if (status === 404) { return 'No se encontró el recurso en el servidor (404).'; }
    if (status === 429) { return 'Límite de conexiones alcanzado.'; }
    if (status >= 500) { return 'Error del servidor (' + status + '). Inténtelo más tarde.'; }
    return 'Respuesta inesperada del servidor (' + status + ').';
  };

  /*
   * H.request({method, url, body, json, timeout, onProgress, headers, identity}, function (err, res) {})
   * res: {status, text, data}. Devuelve un objeto con abort().
   */
  H.request = function (opts, cb) {
    var origin = H.originOf(opts.url);
    var handle = { inner: null, aborted: false, abort: function () { handle.aborted = true; if (handle.inner) { handle.inner.abort(); } } };
    var ids = (opts.identity && H.identityHeaders && !noIdentity[origin]) ? H.identityHeaders() : null;
    if (!ids) {
      handle.inner = send(opts, cb);
      return handle;
    }
    var started = Date.now();
    var withIds = U.extend({}, opts, { headers: U.extend({}, ids, opts.headers || {}) });
    handle.inner = send(withIds, function (err, res) {
      if (handle.aborted) { return; }
      /* Rechazo inmediato: posiblemente CORS de un servidor ajeno. Probar sin cabeceras propias. */
      if (err && err.kind === 'network' && Date.now() - started < 4000) {
        handle.inner = send(opts, function (err2, res2) {
          if (handle.aborted) { return; }
          if (!err2 || err2.kind !== 'network') { noIdentity[origin] = true; }
          cb(err2, res2);
        });
        return;
      }
      cb(err, res);
    });
    return handle;
  };

  /* Solo para pruebas */
  H._resetIdentityMemory = function () { noIdentity = {}; };

  H.getJSON = function (url, cb, timeout, extra) {
    return H.request(U.extend({ url: url, json: true, timeout: timeout }, extra || {}), function (err, res) {
      cb(err, res ? res.data : null, res);
    });
  };

  H.getText = function (url, cb, onProgress, timeout) {
    return H.request({ url: url, timeout: timeout || 120000, onProgress: onProgress }, function (err, res) {
      cb(err, res ? res.text : null);
    });
  };

  H.postJSON = function (url, body, cb, timeout, extra) {
    return H.request(U.extend({ method: 'POST', url: url, body: body, json: true, timeout: timeout, contentType: 'application/json' }, extra || {}), function (err, res) {
      cb(err, res ? res.data : null, res);
    });
  };

  U.noop = function () {};
})(typeof window !== 'undefined' ? window : global);
