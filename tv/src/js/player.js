/*
 * Abstracción de reproductor con tres motores elegidos en tiempo de ejecución:
 *   avplay  → Samsung Tizen (webapis.avplay): TS y HLS nativos.
 *   html5   → <video> nativo (webOS: HLS y MPEG-TS nativos; MP4 en todos).
 *   hls     → hls.js (navegador de escritorio, .m3u8 vía MSE) si está en lib/.
 *   mpegts  → mpegts.js (navegador de escritorio, .ts vía MSE) si está en lib/.
 *
 * Para cada URL se arma una lista de intentos (motor + URL). Si uno falla se pasa al siguiente
 * (p. ej. .ts → .m3u8). Para contenido en vivo, al agotar los intentos se reintenta el ciclo
 * completo hasta MAX_CYCLES veces con espera.
 *
 * Eventos: 'state' (playing|paused|buffering|stopped), 'buffering' (bool), 'time' (t, d),
 *          'retry' ({attempt, total, cycle, delay}), 'error' (mensaje), 'ended'.
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var U = IPTV.util;
  var doc = root.document;

  var MAX_CYCLES = 3;
  var RETRY_DELAY = 4000;
  var STALL_TIMEOUT = 25000;

  var P = new U.Emitter();
  IPTV.player = P;

  P.engine = null;       /* motor activo */
  P.engineName = '';
  P.url = '';
  P.opts = {};
  P.playing = false;
  P.paused = false;
  P.rect = null;         /* null = pantalla completa */

  var session = 0;
  var attempts = [];
  var attemptIndex = 0;
  var cycle = 0;
  var retryTimer = null;
  var stallTimer = null;
  var timeTimer = null;
  var lastTime = -1;

  /* ======================= Motor AVPlay (Tizen) ======================= */
  var AVPlayEngine = {
    name: 'avplay',
    available: function () {
      try { return !!(root.webapis && root.webapis.avplay); } catch (e) { return false; }
    },
    init: function () {
      if (this._obj) { return; }
      var obj = doc.getElementById('av-player');
      if (!obj) {
        obj = doc.createElement('object');
        obj.id = 'av-player';
        obj.setAttribute('type', 'application/avplayer');
        doc.getElementById('video-layer').appendChild(obj);
      }
      this._obj = obj;
      var self = this;
      doc.addEventListener('visibilitychange', function () {
        try {
          var av = root.webapis.avplay;
          if (doc.hidden) { if (P.engine === self) { av.suspend(); } }
          else if (P.engine === self) { av.restore(); }
        } catch (e) { /* nada */ }
      });
    },
    load: function (url, opts, sid) {
      var av = root.webapis.avplay;
      this.init();
      try { av.stop(); } catch (e0) { /* nada */ }
      try { av.close(); } catch (e1) { /* nada */ }
      try {
        av.open(url);
      } catch (e2) {
        engineError(sid, 'No se pudo abrir el contenido');
        return;
      }
      av.setListener({
        onbufferingstart: function () { if (sid === session) { setBuffering(true); } },
        onbufferingprogress: function () { },
        onbufferingcomplete: function () { if (sid === session) { setBuffering(false); } },
        oncurrentplaytime: function () { if (sid === session) { onProgressTick(); } },
        onstreamcompleted: function () { if (sid === session) { onEnded(); } },
        onerror: function (type) { engineError(sid, 'Error de reproducción (' + type + ')'); },
        onevent: function () { }
      });
      try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e3) { /* nada */ }
      this.applyRect();
      try {
        if (opts.live) { av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 3); }
      } catch (e4) { /* opcional */ }
      setBuffering(true);
      av.prepareAsync(function () {
        if (sid !== session) { return; }
        try {
          if (opts.startTime && !opts.live) { av.seekTo(Math.floor(opts.startTime * 1000)); }
        } catch (e5) { /* nada */ }
        try { av.play(); } catch (e6) { engineError(sid, 'No se pudo iniciar la reproducción'); return; }
        setBuffering(false);
        onPlaying();
      }, function (err) {
        engineError(sid, 'No se pudo preparar el contenido' + (err && err.name ? ' (' + err.name + ')' : ''));
      });
    },
    stop: function () {
      try { root.webapis.avplay.stop(); } catch (e) { /* nada */ }
      try { root.webapis.avplay.close(); } catch (e2) { /* nada */ }
    },
    pause: function () { try { root.webapis.avplay.pause(); } catch (e) { /* nada */ } },
    resume: function () { try { root.webapis.avplay.play(); } catch (e) { /* nada */ } },
    seekTo: function (sec) {
      try { root.webapis.avplay.seekTo(Math.floor(sec * 1000), function () {}, function () {}); } catch (e) { /* nada */ }
    },
    time: function () { try { return root.webapis.avplay.getCurrentTime() / 1000; } catch (e) { return 0; } },
    duration: function () { try { return root.webapis.avplay.getDuration() / 1000; } catch (e) { return 0; } },
    applyRect: function () {
      var r = screenRect();
      if (this._obj) {
        this._obj.style.left = r.x + 'px'; this._obj.style.top = r.y + 'px';
        this._obj.style.width = r.w + 'px'; this._obj.style.height = r.h + 'px';
      }
      try { root.webapis.avplay.setDisplayRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)); } catch (e) { /* estado no válido */ }
    }
  };

  /* ======================= Motor <video> (HTML5, hls.js, mpegts.js) ======================= */
  function video() { return doc.getElementById('video'); }

  var Html5Engine = {
    name: 'html5',
    lib: null,         /* 'hls' | 'mpegts' | null */
    _inst: null,
    _bound: false,
    available: function () { return !!video(); },
    bind: function () {
      if (this._bound) { return; }
      this._bound = true;
      var v = video(), self = this;
      v.addEventListener('waiting', function () { if (P.engine === self) { setBuffering(true); } });
      v.addEventListener('stalled', function () { if (P.engine === self && !v.paused) { setBuffering(true); } });
      v.addEventListener('playing', function () { if (P.engine === self) { setBuffering(false); onPlaying(); } });
      v.addEventListener('canplay', function () { if (P.engine === self && !P.paused) { setBuffering(false); } });
      v.addEventListener('timeupdate', function () { if (P.engine === self) { onProgressTick(); } });
      v.addEventListener('ended', function () { if (P.engine === self) { onEnded(); } });
      v.addEventListener('error', function () {
        if (P.engine !== self || !v.getAttribute('src') && !self._inst) { return; }
        var code = v.error ? v.error.code : 0;
        engineError(self._sid, 'Error de reproducción' + (code ? ' (código ' + code + ')' : ''));
      });
    },
    load: function (url, opts, sid) {
      var v = video(), self = this;
      this.bind();
      this.destroyLib();
      this._sid = sid;
      this.applyRect();
      setBuffering(true);
      var mode = opts.engineMode || 'native';

      if (mode === 'hls' && root.Hls) {
        var hls = new root.Hls({ maxBufferLength: 30, liveSyncDurationCount: 3, enableWorker: true });
        this._inst = hls; this.lib = 'hls';
        hls.on(root.Hls.Events.ERROR, function (ev, data) {
          if (sid !== session || !data || !data.fatal) { return; }
          engineError(sid, 'Error HLS (' + (data.details || data.type) + ')');
        });
        hls.on(root.Hls.Events.MANIFEST_PARSED, function () { playVideo(v, opts, sid); });
        hls.loadSource(url);
        hls.attachMedia(v);
        return;
      }
      if (mode === 'mpegts' && root.mpegts) {
        var mp = root.mpegts.createPlayer({ type: 'mpegts', isLive: !!opts.live, url: url },
          { enableWorker: false, lazyLoad: false, liveBufferLatencyChasing: !!opts.live, enableStashBuffer: true });
        this._inst = mp; this.lib = 'mpegts';
        mp.on(root.mpegts.Events.ERROR, function (type, detail) {
          engineError(sid, 'Error MPEG-TS (' + (detail || type) + ')');
        });
        mp.attachMediaElement(v);
        mp.load();
        playVideo(v, opts, sid);
        return;
      }
      this.lib = null;
      v.src = url;
      try { v.load(); } catch (e) { /* nada */ }
      playVideo(v, opts, sid);
    },
    destroyLib: function () {
      if (this._inst) {
        try {
          if (this.lib === 'hls') { this._inst.destroy(); }
          else if (this.lib === 'mpegts') { this._inst.pause(); this._inst.unload(); this._inst.detachMediaElement(); this._inst.destroy(); }
        } catch (e) { /* nada */ }
      }
      this._inst = null;
      this.lib = null;
    },
    stop: function () {
      var v = video();
      this.destroyLib();
      try { v.pause(); } catch (e) { /* nada */ }
      v.removeAttribute('src');
      try { v.load(); } catch (e2) { /* nada */ }
    },
    pause: function () { try { video().pause(); } catch (e) { /* nada */ } },
    resume: function () { try { var p = video().play(); if (p && p['catch']) { p['catch'](function () {}); } } catch (e) { /* nada */ } },
    seekTo: function (sec) { try { video().currentTime = sec; } catch (e) { /* nada */ } },
    time: function () { return video().currentTime || 0; },
    duration: function () { var d = video().duration; return (d && isFinite(d)) ? d : 0; },
    applyRect: function () {
      var r = screenRect(), v = video();
      v.style.left = r.x + 'px'; v.style.top = r.y + 'px';
      v.style.width = r.w + 'px'; v.style.height = r.h + 'px';
    }
  };

  function playVideo(v, opts, sid) {
    if (sid !== session) { return; }
    var started = false;
    function start() {
      if (started) { return; }
      started = true;
      if (opts.startTime && !opts.live) { try { v.currentTime = opts.startTime; } catch (e) { /* nada */ } }
    }
    if (opts.startTime && !opts.live) {
      if (v.readyState >= 1) { start(); } else { v.addEventListener('loadedmetadata', function h() { v.removeEventListener('loadedmetadata', h); start(); }); }
    }
    try {
      var p = v.play();
      if (p && typeof p.then === 'function') {
        p.then(null, function (err) {
          if (sid !== session) { return; }
          /* NotAllowedError (autoplay) no es un error del stream */
          if (err && err.name === 'NotAllowedError') { setBuffering(false); P.paused = true; P.emit('state', 'paused'); return; }
          if (err && err.name === 'AbortError') { return; }
          engineError(sid, 'No se pudo reproducir (' + (err && err.name ? err.name : 'desconocido') + ')');
        });
      }
    } catch (e) { engineError(sid, 'No se pudo reproducir'); }
  }

  /* ======================= Rectángulo de vídeo ======================= */
  function screenRect() {
    if (!P.rect) { return { x: 0, y: 0, w: root.innerWidth, h: root.innerHeight }; }
    return P.rect;
  }

  /* rect en píxeles CSS de pantalla (getBoundingClientRect) o null para pantalla completa */
  P.setRect = function (rect) {
    P.rect = rect ? { x: rect.left !== undefined ? rect.left : rect.x, y: rect.top !== undefined ? rect.top : rect.y, w: rect.width !== undefined ? rect.width : rect.w, h: rect.height !== undefined ? rect.height : rect.h } : null;
    var layer = doc.getElementById('video-layer');
    if (layer) { layer.className = P.rect ? 'windowed' : 'fullscreen'; }
    if (P.engine) { P.engine.applyRect(); }
  };

  /* ======================= Intentos ======================= */
  /* Construye la lista de intentos [{engine, url, mode}] para una URL */
  P.buildAttempts = function (url, opts, altUrl) {
    var list = [], platform = IPTV.platform, ext = U.urlExt(url);
    var urls = [url];
    if (altUrl && altUrl !== url) { urls.push(altUrl); }

    U.each(urls, function (u) {
      var e = U.urlExt(u);
      if (platform === 'tizen' && AVPlayEngine.available()) {
        list.push({ engine: AVPlayEngine, url: u, mode: 'avplay' });
        return;
      }
      if (platform === 'webos') {
        list.push({ engine: Html5Engine, url: u, mode: 'native' });
        return;
      }
      /* navegador de escritorio / otros */
      if (e === 'm3u8') {
        var v = video();
        var nativeHls = v && v.canPlayType && v.canPlayType('application/vnd.apple.mpegurl');
        if (nativeHls) { list.push({ engine: Html5Engine, url: u, mode: 'native' }); }
        if (root.Hls && root.Hls.isSupported()) { list.push({ engine: Html5Engine, url: u, mode: 'hls' }); }
        if (!nativeHls && !(root.Hls && root.Hls.isSupported())) { list.push({ engine: Html5Engine, url: u, mode: 'native' }); }
      } else if (e === 'ts' || (opts.live && e === '')) {
        var feat = root.mpegts && root.mpegts.getFeatureList ? root.mpegts.getFeatureList() : null;
        if (feat && (opts.live ? feat.mseLivePlayback : feat.msePlayback)) { list.push({ engine: Html5Engine, url: u, mode: 'mpegts' }); }
        else { list.push({ engine: Html5Engine, url: u, mode: 'native' }); }
      } else {
        list.push({ engine: Html5Engine, url: u, mode: 'native' });
      }
    });
    /* webOS: si el HLS nativo falla y hls.js está disponible, probarlo al final */
    if (platform === 'webos' && root.Hls && root.Hls.isSupported()) {
      U.each(urls, function (u) { if (U.urlExt(u) === 'm3u8') { list.push({ engine: Html5Engine, url: u, mode: 'hls' }); } });
    }
    if (!list.length) { list.push({ engine: Html5Engine, url: url, mode: 'native' }); }
    return list;
  };

  /* ======================= API pública ======================= */
  /*
   * P.play(url, {live, startTime, altUrl})
   */
  P.play = function (url, opts) {
    P.stop(true);
    session++;
    P.url = url;
    P.opts = opts || {};
    attempts = P.buildAttempts(url, P.opts, P.opts.altUrl);
    attemptIndex = 0;
    cycle = 0;
    startAttempt();
  };

  function startAttempt() {
    var a = attempts[attemptIndex];
    var sid = ++session;
    clearTimers();
    P.engine = a.engine;
    P.engineName = a.mode;
    P.currentUrl = a.url;
    P.playing = false;
    P.paused = false;
    lastTime = -1;
    U.log('Reproduciendo', a.mode, a.url);
    var o = U.extend({}, P.opts, { engineMode: a.mode });
    try {
      a.engine.load(a.url, o, sid);
    } catch (e) {
      U.log('Fallo al cargar', e);
      engineError(sid, 'No se pudo iniciar el reproductor');
    }
    armStall(sid);
    timeTimer = setInterval(function () { if (sid === session) { onProgressTick(); } }, 1000);
  }

  function clearTimers() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    if (timeTimer) { clearInterval(timeTimer); timeTimer = null; }
  }

  function armStall(sid) {
    if (stallTimer) { clearTimeout(stallTimer); }
    stallTimer = setTimeout(function () {
      if (sid !== session) { return; }
      if (P.buffering && !P.paused) { engineError(sid, 'La señal no responde'); }
    }, STALL_TIMEOUT);
  }

  function setBuffering(b) {
    if (P.buffering === b) { return; }
    P.buffering = b;
    P.emit('buffering', b);
    if (b) { armStall(session); }
  }

  function onPlaying() {
    P.playing = true;
    P.paused = false;
    cycle = 0;
    P.emit('state', 'playing');
  }

  function onProgressTick() {
    if (!P.engine) { return; }
    var t = P.engine.time(), d = P.engine.duration();
    if (t !== lastTime) {
      if (lastTime >= 0 && t > lastTime && P.buffering && !P.paused) { setBuffering(false); }
      if (!P.playing && t > 0 && lastTime >= 0) { onPlaying(); }
      lastTime = t;
      if (stallTimer && !P.buffering) { clearTimeout(stallTimer); stallTimer = null; }
    }
    P.emit('time', t, d);
  }

  function onEnded() {
    if (P.opts.live) {
      engineError(session, 'La transmisión se interrumpió');
      return;
    }
    clearTimers();
    P.playing = false;
    P.emit('ended');
  }

  function engineError(sid, msg) {
    if (sid !== session) { return; }
    U.log('Error de reproductor:', msg, P.engineName, P.currentUrl);
    session++;  /* invalida eventos del intento fallido */
    clearTimers();
    try { if (P.engine) { P.engine.stop(); } } catch (e) { /* nada */ }
    setBuffering(false);
    P.lastError = msg;

    if (attemptIndex + 1 < attempts.length) {
      attemptIndex++;
      P.emit('retry', { attempt: attemptIndex + 1, total: attempts.length, cycle: cycle + 1, delay: 0, message: msg });
      startAttempt();
      return;
    }
    if (P.opts.live && cycle + 1 < MAX_CYCLES) {
      cycle++;
      attemptIndex = 0;
      P.emit('retry', { attempt: 1, total: attempts.length, cycle: cycle + 1, maxCycles: MAX_CYCLES, delay: RETRY_DELAY, message: msg });
      var mySid = session;
      retryTimer = setTimeout(function () { if (mySid === session) { startAttempt(); } }, RETRY_DELAY);
      return;
    }
    P.engine = null;
    P.playing = false;
    P.emit('error', msg);
  }

  /* Reinicia desde cero la reproducción actual */
  P.retry = function (startTime) {
    if (!P.url) { return; }
    P.play(P.url, U.extend({}, P.opts, startTime ? { startTime: startTime } : {}));
  };

  P.stop = function (silent) {
    session++;
    clearTimers();
    if (P.engine) { try { P.engine.stop(); } catch (e) { /* nada */ } }
    P.engine = null;
    P.playing = false;
    P.paused = false;
    P.buffering = false;
    if (!silent) { P.url = ''; P.emit('state', 'stopped'); }
  };

  P.isActive = function () { return !!P.engine || !!retryTimer; };

  P.pause = function () {
    if (!P.engine || P.paused) { return; }
    P.engine.pause();
    P.paused = true;
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    P.emit('state', 'paused');
  };

  P.resume = function () {
    if (!P.engine || !P.paused) { return; }
    P.engine.resume();
    P.paused = false;
    P.emit('state', 'playing');
  };

  P.togglePause = function () { if (P.paused) { P.resume(); } else { P.pause(); } };

  P.seekTo = function (sec) {
    if (!P.engine || P.opts.live) { return; }
    var d = P.engine.duration();
    if (d > 0) { sec = U.clamp(sec, 0, Math.max(0, d - 2)); } else { sec = Math.max(0, sec); }
    P.engine.seekTo(sec);
    armStall(session);
  };

  P.time = function () { return P.engine ? P.engine.time() : 0; };
  P.duration = function () { return P.engine ? P.engine.duration() : 0; };

  P.init = function () {
    if (IPTV.platform === 'tizen' && AVPlayEngine.available()) {
      AVPlayEngine.init();
      var v = video();
      if (v) { v.style.display = 'none'; }
    }
    P.setRect(null);
    root.addEventListener('resize', function () { if (P.engine && !P.rect) { P.engine.applyRect(); } });
  };

  P.describeEngines = function () {
    var out = [];
    if (AVPlayEngine.available()) { out.push('AVPlay'); }
    out.push('HTML5');
    if (root.Hls) { out.push('hls.js'); }
    if (root.mpegts) { out.push('mpegts.js'); }
    return out.join(', ');
  };
})(window);
