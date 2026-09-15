/* Mapeo de teclas del control remoto (Tizen, webOS, navegador). ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util;

  var K = IPTV.keys = {};

  /* keyCode → acción */
  var MAP = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down',
    13: 'ok', 29443: 'ok', 65376: 'ok',
    10009: 'back', 461: 'back', 8: 'back', 27: 'back', 65385: 'back',
    427: 'chup', 428: 'chdown', 33: 'chup', 34: 'chdown',
    415: 'play', 19: 'pause', 413: 'stop', 10252: 'playpause', 179: 'playpause',
    417: 'ff', 412: 'rw', 228: 'ff', 227: 'rw',
    403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
    457: 'info',
    10182: 'exit'
  };

  /* Teclado de PC (solo si no se está escribiendo): R/G/Y/B colores, I info, espacio play/pausa */
  var DESKTOP = { 82: 'red', 71: 'green', 89: 'yellow', 66: 'blue', 73: 'info', 32: 'playpause', 83: 'stop' };

  var TIZEN_KEYS = [
    'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
    'ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
  ];
  var TIZEN_ACTIONS = {
    MediaPlayPause: 'playpause', MediaPlay: 'play', MediaPause: 'pause', MediaStop: 'stop',
    MediaFastForward: 'ff', MediaRewind: 'rw', ChannelUp: 'chup', ChannelDown: 'chdown',
    ColorF0Red: 'red', ColorF1Green: 'green', ColorF2Yellow: 'yellow', ColorF3Blue: 'blue', Info: 'info'
  };

  /* Registra teclas especiales en Tizen (sin esto el televisor no las entrega a la app) */
  K.registerTizenKeys = function () {
    var tvi;
    try { tvi = root.tizen && root.tizen.tvinputdevice; } catch (e) { tvi = null; }
    if (!tvi) { return; }
    U.each(TIZEN_KEYS, function (name) {
      try {
        tvi.registerKey(name);
        if (tvi.getKey && TIZEN_ACTIONS[name]) {
          var k = tvi.getKey(name);
          if (k && k.code) { MAP[k.code] = TIZEN_ACTIONS[name]; }
        }
      } catch (e) { /* tecla no soportada en este modelo */ }
    });
  };

  /* Traduce un KeyboardEvent a {action, digit}. editing=true si hay un campo de texto activo. */
  K.translate = function (e, editing) {
    var code = e.keyCode || e.which || 0;
    var action = MAP[code] || null;
    var digit = null;

    if (code >= 48 && code <= 57) { digit = code - 48; }
    else if (code >= 96 && code <= 105) { digit = code - 96; }

    if (editing) {
      /* Durante la edición, Backspace borra texto (no es "atrás") */
      if (code === 8) { return { action: null, code: code }; }
      if (digit !== null) { return { action: null, code: code }; }
      if (code === 32) { return { action: null, code: code }; }
      return { action: action, code: code };
    }
    if (!action && DESKTOP[code] && IPTV.platform === 'browser' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      action = DESKTOP[code];
    }
    if (!action && digit !== null) { action = 'digit'; }
    return { action: action, digit: digit, code: code };
  };

  K.isArrow = function (a) { return a === 'left' || a === 'right' || a === 'up' || a === 'down'; };

  /* Salir de la aplicación según la plataforma */
  K.exitApp = function () {
    try {
      if (root.tizen && root.tizen.application) {
        root.tizen.application.getCurrentApplication().exit();
        return;
      }
    } catch (e) { /* sigue */ }
    try {
      if (root.webOS && typeof root.webOS.platformBack === 'function') { root.webOS.platformBack(); return; }
      if (root.PalmSystem && typeof root.PalmSystem.platformBack === 'function') { root.PalmSystem.platformBack(); return; }
    } catch (e2) { /* sigue */ }
    try { root.close(); } catch (e3) { /* nada */ }
  };
})(typeof window !== 'undefined' ? window : global);
