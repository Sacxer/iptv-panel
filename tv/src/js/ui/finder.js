/*
 * "Buscar servidor en mi red": diálogo con avance y botón Cancelar, y selector cuando hay varios portales.
 * ES5.
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;
  var U = IPTV.util, UI = IPTV.ui, h = U.h;

  /* Diálogo de avance. opts: {title, text, onCancel} → {update(label, fraction), close()} */
  UI.progressDialog = function (opts) {
    var content = h('div', { className: 'progress-dialog' });
    var label = h('div', { className: 'dialog-text pd-label', text: opts.text || '' });
    var bar = h('div', { className: 'progress' }, [h('div', { className: 'progress-fill' })]);
    content.appendChild(h('div', { html: UI.spinnerHtml }));
    content.appendChild(label);
    content.appendChild(bar);
    var closedByCode = false;
    var dlg = UI.Dialog.open({
      title: opts.title,
      content: content,
      className: 'finder',
      /* Cancelar, Atrás o cerrar: onClose avisa la cancelación */
      buttons: [{ label: 'Cancelar' }],
      onClose: function () { if (!closedByCode && opts.onCancel) { opts.onCancel(); } }
    });
    return {
      update: function (text, fraction) {
        label.textContent = text || '';
        if (typeof fraction === 'number') { bar.firstChild.style.width = Math.round(U.clamp(fraction, 0, 1) * 100) + '%'; }
      },
      close: function () { closedByCode = true; dlg.close(); }
    };
  };

  /* Elegir uno de varios portales encontrados. cb(server | null) */
  UI.chooseServer = function (servers, cb) {
    var answered = false;
    var buttons = [];
    U.each(servers.slice(0, 6), function (s) {
      buttons.push({
        label: (s.name || 'Servidor IPTV') + '  ·  ' + s.url.replace(/^https?:\/\//, ''),
        action: function () { answered = true; setTimeout(function () { cb(s); }, 0); }
      });
    });
    buttons.push({ label: 'Cancelar' });
    UI.Dialog.open({
      title: 'Se encontraron ' + servers.length + ' servidores',
      text: 'Elija el servidor de su proveedor:',
      className: 'menu',
      buttons: buttons,
      onClose: function () { if (!answered) { setTimeout(function () { cb(null); }, 0); } }
    });
  };

  /*
   * Busca portales en la red local (solo servidores que responden /api/client/ping como portal).
   * opts: {onlyKnown}. cb(server | null)
   */
  UI.findServerOnLan = function (opts, cb) {
    opts = opts || {};
    var finished = false, handle = null;
    var pd = UI.progressDialog({
      title: 'Buscar servidor en mi red',
      text: 'Buscando el servidor en su red local…',
      onCancel: function () {
        if (finished) { return; }
        finished = true;
        if (handle) { handle.cancel(); }
        cb(null);
      }
    });
    handle = IPTV.session.findServer({
      lanOnly: true,
      onlyKnown: !!opts.onlyKnown,
      onProgress: function (p) { if (!finished) { pd.update(p.label, p.fraction); } }
    }, function (found, info) {
      if (finished) { return; }
      finished = true;
      pd.close();
      info = info || {};
      if (info.cancelled) { cb(null); return; }
      if (found) { cb(found); return; }
      if (info.servers && info.servers.length > 1) { UI.chooseServer(info.servers, cb); return; }
      UI.Dialog.alert('Servidor no encontrado', info.noNetwork
        ? 'No se pudo conocer la red del televisor. Verifique que esté conectado por cable o Wi-Fi, o escriba la dirección del servidor.'
        : 'No se encontró ningún servidor en su red local. Verifique que el televisor esté en la misma red que el servidor, o escriba la dirección.');
      cb(null);
    });
  };
})(window);
