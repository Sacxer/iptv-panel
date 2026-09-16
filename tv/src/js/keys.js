/* Mapeo de teclas del control remoto (Tizen, webOS, navegador). ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util;

  var K = IPTV.keys = {};

  /* keyCode → acción (valores por defecto de Samsung y LG) */
  var MAP = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down',
    13: 'ok', 29443: 'ok', 65376: 'ok',
    10009: 'back',            /* Samsung Return */
    461: 'back',              /* LG Back */
    8: 'back', 27: 'back', 65385: 'back',
    427: 'chup', 428: 'chdown', /* Samsung ChannelUp / ChannelDown */
    33: 'chup', 34: 'chdown',   /* LG canal +/- y RePág / AvPág */
    415: 'play', 19: 'pause', 413: 'stop', 10252: 'playpause',
    417: 'ff', 412: 'rw',
    10232: 'prev', 10233: 'next', /* Samsung MediaTrackPrevious / MediaTrackNext */
    403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
    457: 'info',
    10182: 'exit',
    /* Teclas multimedia de teclados de PC */
    179: 'playpause', 178: 'stop', 176: 'next', 177: 'prev', 228: 'ff', 227: 'rw'
  };

  /* Eventos sin keyCode (navegadores recientes, eventos sintéticos): se usa el nombre de la tecla */
  var KEY_CODES = {
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Left: 37, Up: 38, Right: 39, Down: 40,
    Enter: 13, Backspace: 8, Escape: 27, Esc: 27, PageUp: 33, PageDown: 34, ' ': 32, Spacebar: 32,
    '.': 190, ',': 188
  };
  var KEY_ACTIONS = {
    MediaPlayPause: 'playpause', MediaPlay: 'play', MediaPause: 'pause', MediaStop: 'stop',
    MediaFastForward: 'ff', MediaRewind: 'rw', MediaTrackNext: 'next', MediaTrackPrevious: 'prev',
    ColorF0Red: 'red', ColorF1Green: 'green', ColorF2Yellow: 'yellow', ColorF3Blue: 'blue',
    ChannelUp: 'chup', ChannelDown: 'chdown', Info: 'info', GoBack: 'back', BrowserBack: 'back', XF86Back: 'back'
  };

  K.codeFromKey = function (key) {
    if (!key) { return 0; }
    if (KEY_CODES[key]) { return KEY_CODES[key]; }
    if (key.length === 1) {
      var c = key.toUpperCase().charCodeAt(0);
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90)) { return c; }
    }
    return 0;
  };

  /* LG Magic Remote: el puntero aparece (1536) o desaparece (1537) */
  var POINTER = { 1536: 'show', 1537: 'hide' };

  /*
   * Teclado de PC (solo en el navegador y si no se está escribiendo):
   *   R/G/Y/B colores · I info · Espacio o P play/pausa · S stop · . avanzar · , retroceder
   *   N / M siguiente / anterior · RePág / AvPág canal · Retroceso o Esc atrás · Q salir
   */
  var DESKTOP = {
    82: 'red', 71: 'green', 89: 'yellow', 66: 'blue', 73: 'info',
    32: 'playpause', 80: 'playpause', 83: 'stop', 190: 'ff', 188: 'rw',
    78: 'next', 77: 'prev', 81: 'exit'
  };
  K.DESKTOP_HELP = [
    ['Flechas', 'Mover'], ['Enter', 'OK'], ['Retroceso / Esc', 'Atrás'],
    ['R G Y B', 'Botones de color'], ['RePág / AvPág', 'Canal + / -'],
    ['Espacio o P', 'Reproducir / pausa'], ['S', 'Detener'], [', / .', 'Retroceder / avanzar'],
    ['N / M', 'Siguiente / anterior'], ['I', 'Información'], ['0-9', 'Número de canal'], ['Q', 'Salir']
  ];

  /* Teclas que el televisor Samsung solo entrega a la app si se registran */
  var TIZEN_KEYS = [
    'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
    'MediaTrackPrevious', 'MediaTrackNext',
    'ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
  ];
  var TIZEN_ACTIONS = {
    MediaPlayPause: 'playpause', MediaPlay: 'play', MediaPause: 'pause', MediaStop: 'stop',
    MediaFastForward: 'ff', MediaRewind: 'rw', MediaTrackPrevious: 'prev', MediaTrackNext: 'next',
    ChannelUp: 'chup', ChannelDown: 'chdown',
    ColorF0Red: 'red', ColorF1Green: 'green', ColorF2Yellow: 'yellow', ColorF3Blue: 'blue', Info: 'info'
  };
  K.TIZEN_KEYS = TIZEN_KEYS;

  /* Registra las teclas especiales en Tizen (sin esto el televisor no las entrega a la app) */
  K.registerKeys = function () {
    var tvi;
    try { tvi = root.tizen && root.tizen.tvinputdevice; } catch (e) { tvi = null; }
    if (!tvi) { return 0; }
    var count = 0;
    var supported = {};
    try {
      U.each(tvi.getSupportedKeys ? tvi.getSupportedKeys() : [], function (k) { supported[k.name] = k; });
    } catch (e0) { supported = {}; }
    var hasList = Object.keys(supported).length > 0;
    U.each(TIZEN_KEYS, function (name) {
      if (hasList && !supported[name]) { return; }
      try {
        tvi.registerKey(name);
        count++;
        var k = supported[name] || (tvi.getKey ? tvi.getKey(name) : null);
        if (k && k.code && TIZEN_ACTIONS[name]) { MAP[k.code] = TIZEN_ACTIONS[name]; }
      } catch (e) { /* tecla no soportada en este modelo */ }
    });
    return count;
  };
  K.registerTizenKeys = K.registerKeys;

  /*
   * Traduce un KeyboardEvent a {action, digit, code, pointer}.
   * editing=true si hay un campo de texto activo.
   */
  K.translate = function (e, editing) {
    var code = e.keyCode || e.which || K.codeFromKey(e.key) || 0;
    var action = MAP[code] || KEY_ACTIONS[e.key] || null;
    var digit = null;

    if (POINTER[code]) { return { action: null, code: code, pointer: POINTER[code] }; }
    if (code >= 48 && code <= 57 && !e.shiftKey) { digit = code - 48; }
    else if (code >= 96 && code <= 105) { digit = code - 96; }

    if (editing) {
      /* Durante la edición, Backspace borra texto y las letras se escriben */
      if (code === 8 || code === 32 || digit !== null) { return { action: null, code: code }; }
      if (code === 33 || code === 34 || (code >= 176 && code <= 179)) { return { action: null, code: code }; }
      return { action: action, code: code };
    }
    if (!action && DESKTOP[code] && IPTV.platform === 'browser' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      action = DESKTOP[code];
    }
    if (!action && digit !== null) { action = 'digit'; }
    return { action: action, digit: digit, code: code };
  };

  K.isArrow = function (a) { return a === 'left' || a === 'right' || a === 'up' || a === 'down'; };

  /* webOS: volver a la pantalla de inicio del televisor (la app queda en segundo plano). true si se pudo. */
  K.platformBack = function () {
    try {
      if (root.webOS && typeof root.webOS.platformBack === 'function') { root.webOS.platformBack(); return true; }
      if (root.PalmSystem && typeof root.PalmSystem.platformBack === 'function') { root.PalmSystem.platformBack(); return true; }
    } catch (e) { /* nada */ }
    return false;
  };

  /* Salir de la aplicación según la plataforma */
  K.exitApp = function () {
    try {
      if (root.tizen && root.tizen.application) {
        root.tizen.application.getCurrentApplication().exit();
        return;
      }
    } catch (e) { /* sigue */ }
    if (IPTV.platform === 'webos') {
      /* webOS: window.close() cierra la app; platformBack() la deja en el lanzador */
      try { root.close(); return; } catch (e2) { /* sigue */ }
      try {
        if (root.webOS && typeof root.webOS.platformBack === 'function') { root.webOS.platformBack(); return; }
        if (root.PalmSystem && typeof root.PalmSystem.platformBack === 'function') { root.PalmSystem.platformBack(); return; }
      } catch (e3) { /* sigue */ }
    }
    try { root.close(); } catch (e4) { /* nada */ }
    /* Navegador: una pestaña abierta por el usuario no se puede cerrar desde la página */
    if (IPTV.platform === 'browser' && IPTV.ui && IPTV.ui.toast) {
      IPTV.ui.toast('En el televisor la aplicación se cerraría aquí.', 4000);
    }
  };
})(typeof window !== 'undefined' ? window : global);
