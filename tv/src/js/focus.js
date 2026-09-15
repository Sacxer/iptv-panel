/*
 * Motor de navegación espacial con D-pad.
 *
 * - Los elementos navegables llevan la clase "focusable". El foco se marca con la clase "focused".
 * - Capas: Focus.pushLayer(el) limita la navegación a ese contenedor (pantallas, diálogos).
 * - Grupos: un contenedor con atributo data-focus-group recuerda su último hijo enfocado; al entrar
 *   desde fuera se restaura ese hijo. Si el grupo define el.__focusEnter(dir) se usa para decidir.
 * - Manejadores: cualquier ancestro puede definir el.__nav(dir, actual) y devolver true si gestionó el
 *   movimiento (lo usan las listas y rejillas virtualizadas).
 * - Atributos data-nav-left / data-nav-right / data-nav-up / data-nav-down = id de destino
 *   ("none" bloquea el movimiento en esa dirección).
 * - Acciones: el.__ok() al pulsar OK, el.__onFocus() al recibir foco, el.__onBlur() al perderlo.
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var doc = root.document;

  var F = IPTV.focus = {};
  var current = null;
  var layers = [];

  function inDom(el) { return !!(el && doc.body.contains(el)); }

  function isVisible(el) {
    if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) { return false; }
    var n = el;
    while (n && n !== doc.body) {
      if (n.classList && n.classList.contains('hidden')) { return false; }
      n = n.parentNode;
    }
    return true;
  }

  function isEnabled(el) { return !el.classList.contains('disabled') && !el.hasAttribute('disabled'); }

  F.root = function () { return layers.length ? layers[layers.length - 1].el : doc.body; };

  F.pushLayer = function (el) {
    if (current) { layers.length && (layers[layers.length - 1].last = current); }
    layers.push({ el: el, last: null, prev: current });
  };

  /* Quita la capa y restaura el foco previo */
  F.popLayer = function (el) {
    var i, layer = null;
    for (i = layers.length - 1; i >= 0; i--) {
      if (layers[i].el === el) { layer = layers[i]; layers.splice(i, 1); break; }
    }
    if (!layer) { return; }
    if (layer.prev && inDom(layer.prev) && isVisible(layer.prev) && F.root().contains(layer.prev)) {
      F.set(layer.prev);
    } else if (current && !F.root().contains(current)) {
      F.first();
    }
  };

  F.get = function () { return current; };

  F.groupOf = function (el) {
    var r = F.root(), n = el ? el.parentNode : null;
    while (n && n !== r && n !== doc.body) {
      if (n.hasAttribute && n.hasAttribute('data-focus-group')) { return n; }
      n = n.parentNode;
    }
    return null;
  };

  F.set = function (el, opts) {
    if (!el) { return; }
    var prev = current;
    if (prev === el) {
      if (!el.classList.contains('focused')) { el.classList.add('focused'); }
      return;
    }
    if (prev) {
      prev.classList.remove('focused');
      if (prev.__onBlur) { try { prev.__onBlur(); } catch (e) { IPTV.util.log(e); } }
    }
    current = el;
    el.classList.add('focused');
    var g = F.groupOf(el);
    if (g) { g.__lastFocus = el; }
    if (!(opts && opts.noScroll)) { F.ensureVisible(el); }
    if (el.__onFocus) { try { el.__onFocus(); } catch (e2) { IPTV.util.log(e2); } }
  };

  F.clear = function () {
    if (current) { current.classList.remove('focused'); }
    current = null;
  };

  /* Enfoca el primer elemento navegable de la capa (o del contenedor indicado) */
  F.first = function (container) {
    var c = container || F.root();
    var list = c.querySelectorAll('.focusable'), i;
    for (i = 0; i < list.length; i++) {
      if (isVisible(list[i]) && isEnabled(list[i])) {
        var g = F.groupOf(list[i]);
        F.set(g ? enterGroup(g, list[i], null) : list[i]);
        return true;
      }
    }
    return false;
  };

  /* Enfoca un contenedor usando su memoria de grupo si existe */
  F.focusIn = function (container) {
    if (!container) { return false; }
    if (container.hasAttribute('data-focus-group')) {
      var e = enterGroup(container, null, null);
      if (e) { F.set(e); return true; }
    }
    return F.first(container);
  };

  function enterGroup(g, fallback, dir) {
    var e = null;
    if (g.__focusEnter) { e = g.__focusEnter(dir); }
    if (!e && g.__lastFocus && inDom(g.__lastFocus) && g.contains(g.__lastFocus) && isVisible(g.__lastFocus)) { e = g.__lastFocus; }
    if (!e && !fallback) {
      var list = g.querySelectorAll('.focusable'), i;
      for (i = 0; i < list.length; i++) { if (isVisible(list[i]) && isEnabled(list[i])) { e = list[i]; break; } }
    }
    return e || fallback;
  }

  /* Desplaza contenedores .scroll para que el elemento sea visible */
  F.ensureVisible = function (el) {
    var n = el.parentNode;
    while (n && n !== doc.body) {
      if (n.classList && n.classList.contains('scroll')) {
        var scale = IPTV.scale || 1;
        var er = el.getBoundingClientRect(), nr = n.getBoundingClientRect();
        var margin = 30 * scale;
        if (n.classList.contains('scroll-x')) {
          if (er.left < nr.left + margin) { n.scrollLeft -= (nr.left + margin - er.left) / scale; }
          else if (er.right > nr.right - margin) { n.scrollLeft += (er.right - nr.right + margin) / scale; }
        } else {
          if (er.top < nr.top + margin) { n.scrollTop -= (nr.top + margin - er.top) / scale; }
          else if (er.bottom > nr.bottom - margin) { n.scrollTop += (er.bottom - nr.bottom + margin) / scale; }
        }
      }
      n = n.parentNode;
    }
  };

  /* Elige el mejor candidato en una dirección a partir de rectángulos */
  function pick(fromRect, cands, dir, strict) {
    var best = null, bestScore = Infinity, i, r, main, cross, overlap, cfx, cfy, ccx, ccy, score;
    cfx = (fromRect.left + fromRect.right) / 2;
    cfy = (fromRect.top + fromRect.bottom) / 2;
    for (i = 0; i < cands.length; i++) {
      r = cands[i].rect;
      ccx = (r.left + r.right) / 2;
      ccy = (r.top + r.bottom) / 2;
      if (dir === 'right' || dir === 'left') {
        if (strict) {
          main = dir === 'right' ? r.left - fromRect.right : fromRect.left - r.right;
          if (main < -2) { continue; }
        } else {
          main = dir === 'right' ? ccx - cfx : cfx - ccx;
          if (main <= 1) { continue; }
        }
        overlap = Math.min(r.bottom, fromRect.bottom) - Math.max(r.top, fromRect.top);
        cross = overlap > 0 ? 0 : -overlap;
        score = Math.max(main, 0) + cross * 3 + Math.abs(ccy - cfy) * 0.2;
      } else {
        if (strict) {
          main = dir === 'down' ? r.top - fromRect.bottom : fromRect.top - r.bottom;
          if (main < -2) { continue; }
        } else {
          main = dir === 'down' ? ccy - cfy : cfy - ccy;
          if (main <= 1) { continue; }
        }
        overlap = Math.min(r.right, fromRect.right) - Math.max(r.left, fromRect.left);
        cross = overlap > 0 ? 0 : -overlap;
        score = Math.max(main, 0) + cross * 3 + Math.abs(ccx - cfx) * 0.2;
      }
      if (score < bestScore) { bestScore = score; best = cands[i].el; }
    }
    return best;
  }

  /* Mueve el foco. Devuelve true si hubo movimiento o fue gestionado. */
  F.move = function (dir) {
    var r = F.root();
    if (!current || !inDom(current) || !r.contains(current) || !isVisible(current)) {
      return F.first();
    }

    /* 1) Manejadores personalizados desde el elemento hacia arriba */
    var n = current;
    while (n && n !== doc.body) {
      if (n.__nav && n.__nav(dir, current) === true) { return true; }
      var target = n.getAttribute && n.getAttribute('data-nav-' + dir);
      if (target) {
        if (target === 'none') { return true; }
        var t = doc.getElementById(target);
        if (t && isVisible(t)) {
          if (t.classList.contains('focusable')) { F.set(t); } else { F.focusIn(t); }
          return true;
        }
      }
      if (n === r) { break; }
      n = n.parentNode;
    }

    /* 2) Búsqueda espacial */
    var nodes = r.querySelectorAll('.focusable'), cands = [], i, el;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (el === current || !isEnabled(el) || !isVisible(el)) { continue; }
      cands.push({ el: el, rect: el.getBoundingClientRect() });
    }
    if (!cands.length) { return false; }
    var from = current.getBoundingClientRect();
    var best = pick(from, cands, dir, true) || pick(from, cands, dir, false);
    if (!best) { return false; }

    var g = F.groupOf(best);
    if (g && g !== F.groupOf(current) && !g.contains(current)) {
      best = enterGroup(g, best, dir) || best;
    }
    F.set(best);
    return true;
  };

  F.ok = function () {
    if (current && inDom(current) && current.__ok && isEnabled(current)) {
      current.__ok();
      return true;
    }
    return false;
  };

  /* Hace un elemento navegable con acciones */
  F.make = function (el, ok, onFocus) {
    el.classList.add('focusable');
    if (ok) { el.__ok = ok; }
    if (onFocus) { el.__onFocus = onFocus; }
    return el;
  };
})(window);
