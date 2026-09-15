/* Polyfills mínimos para navegadores antiguos de TV (Chromium 47+). ES5 puro. */
(function (w) {
  'use strict';

  if (!Object.keys) {
    Object.keys = function (o) {
      var r = [], k;
      for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { r.push(k); } }
      return r;
    };
  }

  if (typeof Object.assign !== 'function') {
    Object.assign = function (target) {
      var i, k, src;
      if (target === null || target === undefined) { throw new TypeError('Object.assign: destino nulo'); }
      var to = Object(target);
      for (i = 1; i < arguments.length; i++) {
        src = arguments[i];
        if (src !== null && src !== undefined) {
          for (k in src) {
            if (Object.prototype.hasOwnProperty.call(src, k)) { to[k] = src[k]; }
          }
        }
      }
      return to;
    };
  }

  if (!String.prototype.trim) {
    String.prototype.trim = function () { return this.replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, ''); };
  }

  if (!Function.prototype.bind) {
    Function.prototype.bind = function (ctx) {
      var fn = this, args = Array.prototype.slice.call(arguments, 1);
      return function () { return fn.apply(ctx, args.concat(Array.prototype.slice.call(arguments))); };
    };
  }

  if (!Date.now) { Date.now = function () { return new Date().getTime(); }; }

  if (w) {
    if (!w.requestAnimationFrame) {
      w.requestAnimationFrame = w.webkitRequestAnimationFrame || function (cb) { return w.setTimeout(function () { cb(Date.now()); }, 16); };
      w.cancelAnimationFrame = w.webkitCancelAnimationFrame || function (id) { w.clearTimeout(id); };
    }

    /* Element.closest / matches */
    if (w.Element) {
      var EP = w.Element.prototype;
      if (!EP.matches) {
        EP.matches = EP.webkitMatchesSelector || EP.msMatchesSelector || function (s) {
          var m = (this.document || this.ownerDocument).querySelectorAll(s), i = m.length;
          while (--i >= 0 && m.item(i) !== this) { /* vacío */ }
          return i > -1;
        };
      }
      if (!EP.closest) {
        EP.closest = function (s) {
          var el = this;
          while (el && el.nodeType === 1) {
            if (el.matches(s)) { return el; }
            el = el.parentElement || el.parentNode;
          }
          return null;
        };
      }
    }

    /* Mini Promise (solo por si alguna librería lo necesita en TVs muy antiguas). La app usa callbacks. */
    if (typeof w.Promise !== 'function') {
      var MiniPromise = function (executor) {
        var self = this;
        self._s = 0; self._v = undefined; self._q = [];
        function settle(state, val) {
          if (self._s !== 0) { return; }
          if (state === 1 && val && typeof val.then === 'function') { val.then(function (v) { settle(1, v); }, function (e) { settle(2, e); }); return; }
          self._s = state; self._v = val;
          setTimeout(function () { var i; for (i = 0; i < self._q.length; i++) { self._q[i](); } self._q = []; }, 0);
        }
        try { executor(function (v) { settle(1, v); }, function (e) { settle(2, e); }); } catch (e) { settle(2, e); }
      };
      MiniPromise.prototype.then = function (ok, ko) {
        var self = this;
        return new MiniPromise(function (resolve, reject) {
          function run() {
            var cb = self._s === 1 ? ok : ko;
            if (typeof cb !== 'function') { if (self._s === 1) { resolve(self._v); } else { reject(self._v); } return; }
            try { resolve(cb(self._v)); } catch (e) { reject(e); }
          }
          if (self._s === 0) { self._q.push(run); } else { setTimeout(run, 0); }
        });
      };
      MiniPromise.prototype['catch'] = function (ko) { return this.then(null, ko); };
      MiniPromise.resolve = function (v) { return new MiniPromise(function (r) { r(v); }); };
      MiniPromise.reject = function (e) { return new MiniPromise(function (r, j) { j(e); }); };
      w.Promise = MiniPromise;
    }
  }
})(typeof window !== 'undefined' ? window : null);
