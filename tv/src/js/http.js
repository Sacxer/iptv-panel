/* Peticiones HTTP con XMLHttpRequest (sin fetch, sin cookies). ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util;
  var H = IPTV.http = {};

  H.DEFAULT_TIMEOUT = 20000;

  /*
   * H.request({method, url, body, json, timeout, onProgress}, function (err, res) {})
   * err: {status, message} ; res: {status, text, data}
   * Devuelve un objeto con abort().
   */
  H.request = function (opts, cb) {
    var xhr = new root.XMLHttpRequest();
    var done = false, timer = null;
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
      finish({ status: 0, message: 'URL no válida' });
      return { abort: function () {} };
    }
    xhr.withCredentials = false;
    if (opts.body !== undefined) {
      xhr.setRequestHeader('Content-Type', opts.contentType || 'application/json');
    }
    if (opts.onProgress) {
      xhr.onprogress = function (ev) { opts.onProgress(ev.loaded || 0, ev.lengthComputable ? ev.total : 0); };
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      var status = xhr.status;
      var text = xhr.responseText || '';
      var res = { status: status, text: text, data: null };
      if (opts.json) {
        try { res.data = text ? JSON.parse(text) : null; } catch (e) { res.parseError = true; }
      }
      if (status === 0) {
        finish({ status: 0, message: 'No se pudo conectar con el servidor' }, res);
      } else if (status >= 400) {
        var msg = (res.data && res.data.error) ? res.data.error : 'Error del servidor (' + status + ')';
        finish({ status: status, message: msg, data: res.data }, res);
      } else if (opts.json && res.parseError) {
        finish({ status: status, message: 'Respuesta no válida del servidor' }, res);
      } else {
        finish(null, res);
      }
    };
    timer = setTimeout(function () {
      try { xhr.abort(); } catch (e) { /* nada */ }
      finish({ status: 0, timeout: true, message: 'Tiempo de espera agotado' });
    }, opts.timeout || H.DEFAULT_TIMEOUT);

    try {
      xhr.send(opts.body !== undefined ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : null);
    } catch (e2) {
      finish({ status: 0, message: 'No se pudo enviar la petición' });
    }
    return { abort: function () { done = true; if (timer) { clearTimeout(timer); } try { xhr.abort(); } catch (e) { /* nada */ } } };
  };

  H.getJSON = function (url, cb, timeout) {
    return H.request({ url: url, json: true, timeout: timeout }, function (err, res) {
      cb(err, res ? res.data : null);
    });
  };

  H.getText = function (url, cb, onProgress, timeout) {
    return H.request({ url: url, timeout: timeout || 120000, onProgress: onProgress }, function (err, res) {
      cb(err, res ? res.text : null);
    });
  };

  H.postJSON = function (url, body, cb, timeout) {
    return H.request({ method: 'POST', url: url, body: body, json: true, timeout: timeout, contentType: 'application/json' }, function (err, res) {
      cb(err, res ? res.data : null);
    });
  };

  U.noop = function () {};
})(typeof window !== 'undefined' ? window : global);
