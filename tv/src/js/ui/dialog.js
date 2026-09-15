/* Diálogos modales, avisos breves (toast), botones y campos de texto para control remoto. ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, F = IPTV.focus, h = U.h;
  var UI = IPTV.ui = IPTV.ui || {};

  /* ---------- Botón navegable ---------- */
  UI.button = function (label, onOk, cls) {
    var b = h('div', { className: 'btn focusable ' + (cls || '') });
    b.innerHTML = label;
    b.__ok = onOk;
    return b;
  };

  /* ---------- Campo de texto: OK abre el teclado de la TV ---------- */
  UI.input = function (opts) {
    var inp = h('input', {
      className: 'input focusable',
      type: opts.type || 'text',
      placeholder: opts.placeholder || '',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false'
    });
    if (opts.value) { inp.value = opts.value; }
    if (opts.id) { inp.id = opts.id; }
    inp.__ok = function () {
      try { inp.focus(); } catch (e) { /* nada */ }
      /* Coloca el cursor al final */
      try { var l = inp.value.length; inp.setSelectionRange(l, l); } catch (e2) { /* nada */ }
    };
    inp.__isInput = true;
    inp.addEventListener('focus', function () {
      if (F.get() !== inp) { F.set(inp); }
      inp.classList.add('editing');
      root.document.documentElement.classList.add('editing');
    });
    inp.addEventListener('blur', function () {
      inp.classList.remove('editing');
      root.document.documentElement.classList.remove('editing');
    });
    if (opts.onInput) { inp.addEventListener('input', function () { opts.onInput(inp.value); }); }
    if (opts.onSubmit) { inp.__onSubmit = opts.onSubmit; }
    return inp;
  };

  UI.isEditing = function () {
    var a = root.document.activeElement;
    return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'));
  };

  /* ---------- Diálogos ---------- */
  var stack = [];
  var Dialog = UI.Dialog = {};

  /*
   * opts: {title, text, html, content (Element), buttons: [{label, action(dlg), cls}],
   *        level ('info'|'warning'|'critical'), onBack(dlg) → false para impedir cierre,
   *        onKey(action, info, dlg) → bool, focus: índice de botón, className, wide}
   */
  Dialog.open = function (opts) {
    var dlg = { opts: opts, closed: false };
    var box = h('div', { className: 'dialog ' + (opts.className || '') + (opts.level ? ' level-' + opts.level : '') + (opts.wide ? ' wide' : '') });
    if (opts.title) { box.appendChild(h('div', { className: 'dialog-title', text: opts.title })); }
    if (opts.text) { box.appendChild(h('div', { className: 'dialog-text', text: opts.text })); }
    if (opts.html) { box.appendChild(h('div', { className: 'dialog-text', html: opts.html })); }
    if (opts.content) { box.appendChild(opts.content); }
    var btns = h('div', { className: 'dialog-buttons' });
    var buttons = opts.buttons && opts.buttons.length ? opts.buttons : [{ label: 'Aceptar' }];
    var btnEls = [];
    U.each(buttons, function (b) {
      var el = UI.button(U.escapeHtml(b.label), function () {
        if (b.action) { if (b.action(dlg) === false) { return; } }
        dlg.close();
      }, b.cls || '');
      btnEls.push(el);
      btns.appendChild(el);
    });
    box.appendChild(btns);
    var backdrop = h('div', { className: 'dialog-backdrop' }, [box]);
    dlg.el = backdrop;
    dlg.box = box;
    dlg.buttons = btnEls;
    root.document.getElementById('dialogs').appendChild(backdrop);
    F.pushLayer(backdrop);
    stack.push(dlg);
    F.set(btnEls[U.clamp(opts.focus || 0, 0, btnEls.length - 1)]);

    dlg.close = function () {
      if (dlg.closed) { return; }
      dlg.closed = true;
      var i = stack.indexOf(dlg);
      if (i >= 0) { stack.splice(i, 1); }
      if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
      F.popLayer(backdrop);
      if (opts.onClose) { opts.onClose(dlg); }
    };
    dlg.back = function () {
      if (opts.onBack && opts.onBack(dlg) === false) { return; }
      dlg.close();
    };
    return dlg;
  };

  Dialog.top = function () { return stack.length ? stack[stack.length - 1] : null; };
  Dialog.closeAll = function () { while (stack.length) { stack[stack.length - 1].close(); } };

  Dialog.alert = function (title, text, onClose) {
    return Dialog.open({ title: title, text: text, buttons: [{ label: 'Aceptar' }], onClose: onClose });
  };

  Dialog.confirm = function (title, text, yesLabel, onYes, noLabel) {
    return Dialog.open({
      title: title, text: text, focus: 1,
      buttons: [{ label: yesLabel || 'Sí', action: function () { setTimeout(onYes, 0); } }, { label: noLabel || 'No' }]
    });
  };

  /* Menú simple de opciones */
  Dialog.menu = function (title, options) {
    var btns = [];
    U.each(options, function (o) { btns.push({ label: o.label, action: function () { setTimeout(o.action, 0); } }); });
    btns.push({ label: 'Cancelar' });
    return Dialog.open({ title: title, buttons: btns, className: 'menu' });
  };

  /* ---------- Toast ---------- */
  var toastTimer = null;
  UI.toast = function (text, ms) {
    var t = root.document.getElementById('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 2500);
  };

  /* ---------- Spinner ---------- */
  UI.spinnerHtml = '<div class="spinner"><div class="spinner-ring"></div></div>';
})(window);
