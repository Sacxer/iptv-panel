/*
 * Componentes virtualizados para listas enormes (20k+ entradas):
 *   VList → lista vertical de filas de alto fijo.
 *   VGrid → rejilla de celdas de tamaño fijo.
 * Solo se crean en el DOM los elementos visibles; se reutilizan al desplazarse.
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, F = IPTV.focus, h = U.h;
  var UI = IPTV.ui = IPTV.ui || {};

  function toggleClass(el, cls, on) {
    if (on) { el.classList.add(cls); } else { el.classList.remove(cls); }
  }

  /* ============================== VList ============================== */
  /*
   * opts: rowHeight, render(rowEl, item, index), onSelect(item, index), onFocus(item, index),
   *       emptyText, rowClass, onKey(action, item, index) → bool
   */
  function VList(container, opts) {
    var self = this;
    this.c = container;
    this.o = opts || {};
    this.rh = this.o.rowHeight || 80;
    this.items = [];
    this.index = 0;
    this.top = 0;
    this.rows = [];
    this.markedIndex = -1;

    container.classList.add('vlist');
    container.setAttribute('data-focus-group', '');
    this.inner = h('div', { className: 'vlist-inner' });
    this.bar = h('div', { className: 'vlist-bar hidden' }, [h('div', { className: 'vlist-thumb' })]);
    this.emptyEl = h('div', { className: 'vlist-empty hidden', text: this.o.emptyText || 'Sin elementos' });
    container.appendChild(this.inner);
    container.appendChild(this.bar);
    container.appendChild(this.emptyEl);

    container.__nav = function (dir) { return self.nav(dir); };
    container.__focusEnter = function () {
      if (!self.items.length) { return null; }
      self.render();
      return self.rowFor(self.index);
    };
    container.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!self.items.length) { return; }
      var d = e.deltaY > 0 ? 1 : -1;
      if (self.hasFocus()) { self.focusIndex(self.index + d); }
      else { self.top = U.clamp(self.top + d, 0, Math.max(0, self.items.length - self.visibleCount())); self.render(false, true); }
    });
  }

  VList.prototype.visibleCount = function () {
    var hgt = this.c.clientHeight || this.o.height || 600;
    return Math.max(1, Math.floor(hgt / this.rh));
  };

  VList.prototype.setItems = function (items, index) {
    this.items = items || [];
    this.index = U.clamp(index || 0, 0, Math.max(0, this.items.length - 1));
    this.top = Math.max(0, this.index - Math.floor(this.visibleCount() / 2));
    var hadFocus = this.hasFocus();
    this.render(true);
    toggleClass(this.emptyEl, 'hidden', this.items.length > 0);
    if (hadFocus) {
      if (this.items.length) { F.set(this.rowFor(this.index)); } else { F.clear(); }
    }
  };

  VList.prototype.setEmptyText = function (t) { this.emptyEl.textContent = t; };

  VList.prototype.hasFocus = function () {
    var cur = F.get();
    return !!(cur && this.c.contains(cur));
  };

  VList.prototype.render = function (force, freeScroll) {
    var vis = this.visibleCount(), n = this.items.length, i, idx, row, self = this;
    if (!freeScroll) {
      if (this.index < this.top) { this.top = this.index; }
      if (this.index >= this.top + vis) { this.top = this.index - vis + 1; }
    }
    this.top = U.clamp(this.top, 0, Math.max(0, n - vis));

    while (this.rows.length < vis) {
      row = h('div', { className: 'vrow focusable ' + (this.o.rowClass || '') });
      row.style.height = this.rh + 'px';
      row.style.top = (this.rows.length * this.rh) + 'px';
      row.__idx = -1;
      (function (r) {
        r.__ok = function () { if (r.__idx >= 0 && self.o.onSelect) { self.o.onSelect(self.items[r.__idx], r.__idx); } };
        r.__onFocus = function () { if (r.__idx >= 0) { self._focused(r.__idx); } };
      })(row);
      this.inner.appendChild(row);
      this.rows.push(row);
    }

    for (i = 0; i < this.rows.length; i++) {
      row = this.rows[i];
      idx = this.top + i;
      if (i < vis && idx < n) {
        toggleClass(row, 'hidden', false);
        if (force || row.__idx !== idx || row.__item !== this.items[idx]) {
          row.__idx = idx;
          row.__item = this.items[idx];
          this.o.render(row, this.items[idx], idx);
        }
        toggleClass(row, 'selected', idx === this.index);
        toggleClass(row, 'marked', idx === this.markedIndex);
      } else {
        toggleClass(row, 'hidden', true);
        row.__idx = -1;
        row.__item = null;
        if (F.get() === row) { F.clear(); }
      }
    }

    if (n > vis) {
      toggleClass(this.bar, 'hidden', false);
      var th = Math.max(30, Math.floor(vis / n * this.c.clientHeight));
      var thumb = this.bar.firstChild;
      thumb.style.height = th + 'px';
      thumb.style.top = Math.floor((this.c.clientHeight - th) * (this.top / Math.max(1, n - vis))) + 'px';
    } else {
      toggleClass(this.bar, 'hidden', true);
    }
    toggleClass(this.emptyEl, 'hidden', n > 0);
  };

  VList.prototype.rowFor = function (idx) {
    var i;
    for (i = 0; i < this.rows.length; i++) { if (this.rows[i].__idx === idx) { return this.rows[i]; } }
    return null;
  };

  VList.prototype._focused = function (idx) {
    var prev = this.index;
    this.index = idx;
    if (prev !== idx) {
      var p = this.rowFor(prev);
      if (p) { p.classList.remove('selected'); }
    }
    var r = this.rowFor(idx);
    if (r) { r.classList.add('selected'); }
    if (this.o.onFocus) { this.o.onFocus(this.items[idx], idx); }
  };

  VList.prototype.focusIndex = function (i) {
    if (!this.items.length) { return; }
    i = U.clamp(i, 0, this.items.length - 1);
    this.index = i;
    this.render();
    var r = this.rowFor(i);
    if (!r) { return; }
    if (F.get() === r) { this._focused(i); } else { F.set(r); }
  };

  /* Cambia el índice sin tomar el foco */
  VList.prototype.setIndex = function (i) {
    if (!this.items.length) { return; }
    this.index = U.clamp(i, 0, this.items.length - 1);
    this.top = Math.max(0, this.index - Math.floor(this.visibleCount() / 2));
    this.render();
  };

  VList.prototype.nav = function (dir) {
    if (!this.items.length) { return false; }
    if (dir === 'up') { if (this.index > 0) { this.focusIndex(this.index - 1); return true; } return false; }
    if (dir === 'down') { if (this.index < this.items.length - 1) { this.focusIndex(this.index + 1); return true; } return false; }
    return false;
  };

  VList.prototype.page = function (delta) {
    var step = this.visibleCount() * delta;
    if (this.hasFocus()) { this.focusIndex(this.index + step); } else { this.setIndex(this.index + step); }
  };

  VList.prototype.current = function () { return this.items[this.index] || null; };

  VList.prototype.refresh = function () { this.render(true); };

  /* Marca (p. ej. categoría activa o canal en reproducción) */
  VList.prototype.mark = function (idx) { this.markedIndex = idx; this.render(); };

  /* ============================== VGrid ============================== */
  /*
   * opts: cellWidth, cellHeight, cols (opcional), render(cell, item, index), onSelect, onFocus, emptyText
   */
  function VGrid(container, opts) {
    var self = this;
    this.c = container;
    this.o = opts || {};
    this.cw = this.o.cellWidth || 240;
    this.ch = this.o.cellHeight || 400;
    this.items = [];
    this.index = 0;
    this.topRow = 0;
    this.cells = [];

    container.classList.add('vgrid');
    container.setAttribute('data-focus-group', '');
    this.inner = h('div', { className: 'vgrid-inner' });
    this.emptyEl = h('div', { className: 'vlist-empty hidden', text: this.o.emptyText || 'Sin elementos' });
    this.bar = h('div', { className: 'vlist-bar hidden' }, [h('div', { className: 'vlist-thumb' })]);
    container.appendChild(this.inner);
    container.appendChild(this.bar);
    container.appendChild(this.emptyEl);

    container.__nav = function (dir) { return self.nav(dir); };
    container.__focusEnter = function () {
      if (!self.items.length) { return null; }
      self.render();
      return self.cellFor(self.index);
    };
    container.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!self.items.length) { return; }
      var d = e.deltaY > 0 ? self.cols() : -self.cols();
      if (self.hasFocus()) { self.focusIndex(self.index + d); }
    });
  }

  VGrid.prototype.cols = function () {
    return this.o.cols || Math.max(1, Math.floor((this.c.clientWidth || 1200) / this.cw));
  };
  VGrid.prototype.visibleRows = function () {
    return Math.max(1, Math.floor((this.c.clientHeight || 800) / this.ch));
  };
  VGrid.prototype.hasFocus = VList.prototype.hasFocus;
  VGrid.prototype.setEmptyText = VList.prototype.setEmptyText;
  VGrid.prototype.current = VList.prototype.current;

  VGrid.prototype.setItems = function (items, index) {
    this.items = items || [];
    this.index = U.clamp(index || 0, 0, Math.max(0, this.items.length - 1));
    this.topRow = Math.floor(this.index / this.cols());
    var hadFocus = this.hasFocus();
    this.render(true);
    if (hadFocus) {
      if (this.items.length) { F.set(this.cellFor(this.index)); } else { F.clear(); }
    }
  };

  VGrid.prototype.render = function (force) {
    var cols = this.cols(), vr = this.visibleRows(), n = this.items.length, self = this;
    var rows = Math.ceil(n / cols), row = Math.floor(this.index / cols), i, idx, cell, need;
    if (row < this.topRow) { this.topRow = row; }
    if (row >= this.topRow + vr) { this.topRow = row - vr + 1; }
    this.topRow = U.clamp(this.topRow, 0, Math.max(0, rows - vr));
    need = vr * cols;

    while (this.cells.length < need) {
      cell = h('div', { className: 'vcell focusable' });
      cell.style.width = this.cw + 'px';
      cell.style.height = this.ch + 'px';
      cell.__idx = -1;
      (function (c) {
        c.__ok = function () { if (c.__idx >= 0 && self.o.onSelect) { self.o.onSelect(self.items[c.__idx], c.__idx); } };
        c.__onFocus = function () { if (c.__idx >= 0) { self._focused(c.__idx); } };
      })(cell);
      this.inner.appendChild(cell);
      this.cells.push(cell);
    }
    for (i = 0; i < this.cells.length; i++) {
      cell = this.cells[i];
      idx = this.topRow * cols + i;
      if (i < need && idx < n) {
        cell.classList.remove('hidden');
        cell.style.left = ((i % cols) * this.cw) + 'px';
        cell.style.top = (Math.floor(i / cols) * this.ch) + 'px';
        if (force || cell.__idx !== idx || cell.__item !== this.items[idx]) {
          cell.__idx = idx;
          cell.__item = this.items[idx];
          this.o.render(cell, this.items[idx], idx);
        }
      } else {
        cell.classList.add('hidden');
        cell.__idx = -1;
        cell.__item = null;
        if (F.get() === cell) { F.clear(); }
      }
    }
    if (rows > vr) {
      this.bar.classList.remove('hidden');
      var hh = this.c.clientHeight, th = Math.max(30, Math.floor(vr / rows * hh));
      this.bar.firstChild.style.height = th + 'px';
      this.bar.firstChild.style.top = Math.floor((hh - th) * (this.topRow / Math.max(1, rows - vr))) + 'px';
    } else {
      this.bar.classList.add('hidden');
    }
    toggleClass(this.emptyEl, 'hidden', n > 0);
  };

  VGrid.prototype.cellFor = function (idx) {
    var i;
    for (i = 0; i < this.cells.length; i++) { if (this.cells[i].__idx === idx) { return this.cells[i]; } }
    return null;
  };

  VGrid.prototype._focused = function (idx) {
    this.index = idx;
    if (this.o.onFocus) { this.o.onFocus(this.items[idx], idx); }
  };

  VGrid.prototype.focusIndex = function (i) {
    if (!this.items.length) { return; }
    i = U.clamp(i, 0, this.items.length - 1);
    this.index = i;
    this.render();
    var c = this.cellFor(i);
    if (!c) { return; }
    if (F.get() === c) { this._focused(i); } else { F.set(c); }
  };

  VGrid.prototype.nav = function (dir) {
    var cols = this.cols(), n = this.items.length, i = this.index;
    if (!n) { return false; }
    switch (dir) {
      case 'left': if (i % cols > 0) { this.focusIndex(i - 1); return true; } return false;
      case 'right': if (i % cols < cols - 1 && i + 1 < n) { this.focusIndex(i + 1); return true; } return false;
      case 'up': if (i - cols >= 0) { this.focusIndex(i - cols); return true; } return false;
      case 'down':
        if (Math.floor(i / cols) < Math.floor((n - 1) / cols)) { this.focusIndex(Math.min(i + cols, n - 1)); return true; }
        return false;
    }
    return false;
  };

  VGrid.prototype.page = function (delta) {
    var step = this.visibleRows() * this.cols() * delta;
    if (this.hasFocus()) { this.focusIndex(this.index + step); }
    else { this.index = U.clamp(this.index + step, 0, Math.max(0, this.items.length - 1)); this.render(); }
  };

  VGrid.prototype.refresh = function () { this.render(true); };

  UI.VList = VList;
  UI.VGrid = VGrid;

  /* ---------- Render auxiliar: póster con respaldo de iniciales ---------- */
  UI.renderPoster = function (cell, item, extraBadge) {
    if (!cell.__built) {
      cell.__built = true;
      cell.innerHTML = '<div class="poster"><div class="poster-ph"></div><img alt=""><div class="poster-badge hidden"></div></div><div class="poster-title"></div>';
    }
    var ph = cell.querySelector('.poster-ph');
    ph.textContent = U.initials(item.name);
    U.setImg(cell.querySelector('img'), item.logo);
    cell.querySelector('.poster-title').textContent = item.name;
    var badge = cell.querySelector('.poster-badge');
    if (extraBadge) { badge.textContent = extraBadge; badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); }
  };

  /* Fila con logo, número, nombre y detalle */
  UI.renderRow = function (row, opts) {
    if (!row.__built) {
      row.__built = true;
      row.innerHTML = '<span class="r-num"></span><span class="r-logo"><span class="r-ph"></span><img alt=""></span>' +
        '<span class="r-text"><span class="r-name"></span><span class="r-sub"></span></span><span class="r-extra"></span>';
    }
    var num = row.querySelector('.r-num');
    num.textContent = opts.num !== undefined && opts.num !== null ? String(opts.num) : '';
    toggleClass(num, 'hidden', opts.num === undefined || opts.num === null);
    var logo = row.querySelector('.r-logo');
    toggleClass(logo, 'hidden', opts.logo === false);
    if (opts.logo !== false) {
      row.querySelector('.r-ph').textContent = U.initials(opts.name);
      U.setImg(row.querySelector('img'), opts.logo);
    }
    row.querySelector('.r-name').textContent = opts.name || '';
    var sub = row.querySelector('.r-sub');
    sub.textContent = opts.sub || '';
    toggleClass(sub, 'hidden', !opts.sub);
    row.querySelector('.r-extra').innerHTML = opts.extraHtml || '';
  };
})(window);
