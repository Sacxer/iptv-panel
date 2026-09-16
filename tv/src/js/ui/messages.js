/* Sección Mensajes: bandeja de entrada del portal con marcado de leídos. ES5. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, F = IPTV.focus, UI = IPTV.ui, h = U.h;
  var sections = IPTV.sections = IPTV.sections || {};
  var KIND_LABEL = { payment: 'Pago', expiration: 'Vencimiento', maintenance: 'Mantenimiento', promotion: 'Promoción', support: 'Soporte', general: '' };

  sections.messages = {
    title: 'Mensajes',
    icon: 'messages',
    hints: UI.keyHint('ok', 'OK: leer mensaje') + UI.keyHint('green', 'Actualizar'),

    create: function () {
      var self = this;
      var el = h('div', { className: 'messages-section' });
      el.innerHTML = '<div class="col col-msgs"><div class="col-title">Bandeja de entrada</div><div class="vl"></div></div>' +
        '<div class="col col-msg-body"><div class="msg-view scroll"><div class="msg-title"></div><div class="msg-date"></div><div class="msg-body"></div></div></div>';
      this.titleEl = el.querySelector('.msg-title');
      this.dateEl = el.querySelector('.msg-date');
      this.bodyEl = el.querySelector('.msg-body');
      this.view = el.querySelector('.msg-view');
      this.list = new UI.VList(el.querySelector('.vl'), {
        rowHeight: 110,
        rowClass: 'msg-row',
        emptyText: 'No hay mensajes',
        render: function (row, m) {
          var kind = KIND_LABEL[m.kind] || '';
          UI.renderRow(row, {
            name: m.title, logo: false,
            sub: (kind ? kind + ' · ' : '') + U.formatUnixDateTime(m.created_at),
            extraHtml: m.read ? '' : '<span class="unread-dot"></span>'
          });
          row.classList[m.read ? 'remove' : 'add']('unread');
          row.setAttribute('data-kind', m.kind || 'general');
        },
        onFocus: function (m) { self.display(m, false); },
        onSelect: function (m) { self.display(m, true); }
      });
      return el;
    },

    reset: function () { this.list.setItems([]); this.display(null); },

    show: function () { this.render(); },
    resume: function () { this.render(); },
    onPortalUpdate: function () { this.render(); },

    render: function () {
      var portal = IPTV.portal;
      if (!portal.enabled) {
        this.list.setEmptyText('Los mensajes solo están disponibles con servidores compatibles con el portal.');
        this.list.setItems([]);
        this.display(null);
        return;
      }
      var msgs = (portal.state && portal.state.messages) || [];
      var cur = this.list.current(), idx = 0;
      if (cur) { idx = Math.max(0, U.findIndex(msgs, function (m) { return m.id === cur.id; })); }
      this.list.setEmptyText('No hay mensajes');
      this.list.setItems(msgs, idx);
      if (!msgs.length) { this.display(null); }
    },

    display: function (m, markRead) {
      if (!m) {
        this.titleEl.textContent = '';
        this.dateEl.textContent = '';
        this.bodyEl.textContent = '';
        return;
      }
      this.titleEl.textContent = m.title;
      this.dateEl.textContent = (KIND_LABEL[m.kind] ? KIND_LABEL[m.kind] + ' · ' : '') + U.formatUnixDateTime(m.created_at);
      this.bodyEl.textContent = m.body;
      this.view.scrollTop = 0;
      if (markRead && !m.read) {
        IPTV.portal.markRead(m);
        this.list.refresh();
      } else if (!m.read) {
        /* Se marca como leído tras 3 s de lectura */
        var self = this;
        if (this.readTimer) { clearTimeout(this.readTimer); }
        this.readTimer = setTimeout(function () {
          if (self.list.current() === m && self.list.hasFocus() && !m.read) { IPTV.portal.markRead(m); self.list.refresh(); }
        }, 3000);
      }
    },

    focusDefault: function () {
      if (this.list.items.length) { this.list.focusIndex(this.list.index); return true; }
      return false;
    },

    onKey: function (action) {
      if (action === 'green') { IPTV.portal.refresh(); UI.toast('Actualizando…'); return true; }
      if (action === 'down' || action === 'up') { return false; }
      if ((action === 'chup' || action === 'chdown')) {
        this.view.scrollTop += (action === 'chup' ? -200 : 200);
        return true;
      }
      return false;
    }
  };
})(window);
