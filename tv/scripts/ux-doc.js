'use strict';
/*
 * npm run ux-doc -- --test-user USUARIO --test-pass CLAVE [opciones]
 *
 * Crea dist/lg-ux-scenario.pdf: el documento de uso (UX Scenario) que LG Seller Lounge pide para la revisión,
 * con la estructura de la plantilla oficial de LG (v4.3) y las capturas de assets/store/screenshots
 * (npm run shots). Va en inglés, que es lo que leen los revisores de LG. Queda en dist/ (no se sube a GitHub)
 * porque lleva la cuenta de prueba.
 *
 * Opciones:
 *   --test-user / --test-pass   cuenta de prueba (se pueden repetir; sin --test-pass la clave va solo en Seller Lounge → Test Info)
 *   --screens N                 pantallas simultáneas de cada cuenta de prueba (por defecto 3)
 *   --review-url URL            dirección pública que usarán los revisores (por defecto la última de serverUrls)
 *   --tested-on "texto"         televisores en los que se probó (ej. "LG 43UR7800 (webOS 23)")
 *   --seller "nombre"           vendedor tal como aparece en Seller Lounge (por defecto operator.json → vendor)
 *   --out archivo.pdf           otra ruta de salida
 *   --preview carpeta           además guarda cada página como PNG (para revisarla sin abrir el PDF)
 * Los datos que falten salen marcados como PENDING en rojo.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');
const cfg = require('./lib/appconfig');
const { sleep, withBrowser } = require('./lib/browser');

const TV_DIR = cfg.TV_DIR;
const SHOTS = path.join(TV_DIR, 'assets', 'store', 'screenshots');

function parseArgs(argv) {
  const o = { users: [], passes: [], screens: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--test-user') o.users.push(next());
    else if (a === '--test-pass') o.passes.push(next());
    else if (a === '--screens') o.screens = Number(next()) || 3;
    else if (a === '--review-url') o.reviewUrl = next();
    else if (a === '--tested-on') o.testedOn = next();
    else if (a === '--seller') o.seller = next();
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '--browser') o.browser = next();
    else if (a === '--preview') o.preview = path.resolve(next());
    else throw new Error(`Opción desconocida: ${a}`);
  }
  if (o.passes.length > o.users.length) throw new Error('Cada --test-pass necesita su --test-user');
  return o;
}

const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PENDING = (what) => `<span class="pending">PENDING: ${esc(what)}</span>`;
const es = (t) => `<span class="es">«${esc(t)}»</span>`;

function img(name) {
  const file = path.join(SHOTS, `${name}.png`);
  if (!fs.existsSync(file)) throw new Error(`Falta la captura ${path.relative(TV_DIR, file)}: ejecute primero npm run shots`);
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
}

/* Pantalla con recuadros numerados (coordenadas sobre 1920x1080) y tabla de descripción */
function screenPage(section, title, shot, marks, details) {
  const boxes = marks.map((m, i) => {
    const [x0, y0, x1, y1] = m.box;
    const st = `left:${(x0 / 19.2).toFixed(2)}%;top:${(y0 / 10.8).toFixed(2)}%;width:${((x1 - x0) / 19.2).toFixed(2)}%;height:${((y1 - y0) / 10.8).toFixed(2)}%`;
    return `<div class="box" style="${st}"><span class="num">${i + 1}</span></div>`;
  }).join('');
  const rows = marks.map((m, i) => `<tr><td class="n">${i + 1}</td><td>${m.text}</td></tr>`).join('');
  return `<section class="page">
  <header><h1>${esc(section)}</h1><div class="brand">UX Scenario</div></header>
  <div class="screen-wrap">
    <div class="left"><h2>${esc(title)}</h2><div class="shot"><img src="${img(shot)}">${boxes}</div></div>
    <table class="desc"><thead><tr><th colspan="2">Description</th></tr></thead><tbody>${rows}</tbody></table>
  </div>
  <div class="details"><b>Detailed Information</b>${details}</div>
</section>`;
}

function build(opts) {
  const op = cfg.loadOperator().data;
  const pkg = cfg.packageInfo();
  const ids = cfg.appIds(op, 'store');
  const appName = op.appName || 'IPTV Player';
  const seller = opts.seller || op.vendor || '';
  const urls = (op.serverUrls || []).filter((u) => !cfg.isPlaceholderUrl(u));
  const reviewUrl = opts.reviewUrl || (urls.length > 1 ? urls[urls.length - 1] : '');
  const privacy = op.privacyUrl && !cfg.isPlaceholderUrl(op.privacyUrl) ? op.privacyUrl : (reviewUrl ? `${reviewUrl.replace(/\/+$/, '')}/privacidad` : '');
  const support = op.support || {};
  const contact = [support.email, support.phone, support.whatsapp && `WhatsApp ${support.whatsapp}`, support.web].filter(Boolean).join(' · ');
  const today = new Date().toISOString().slice(0, 10);
  const missing = [];
  const need = (value, label) => {
    if (value) return esc(value);
    missing.push(label);
    return PENDING(label);
  };

  // Sin --test-pass la contraseña se indica solo en Seller Lounge → Test Info (no queda escrita en el documento)
  const accounts = opts.users.length
    ? opts.users.map((u, i) => `<tr><td>${i + 1}</td><td><code>${esc(u)}</code></td><td>${opts.passes[i]
      ? `<code>${esc(opts.passes[i])}</code>` : 'Entered in Seller Lounge → Test Info'}</td><td>${opts.screens}</td></tr>`).join('')
    : `<tr><td>1</td><td>${need('', 'test username')}</td><td>${PENDING('test password')}</td><td>${opts.screens}</td></tr>`;

  const basic = [
    ['App Information', 'App Title', esc(appName)],
    ['', 'App ID / Version', `${esc(ids.webos)} · ${esc(pkg.version)}`],
    ['', 'Seller', need(seller, 'seller name')],
    ['', 'Category', 'Entertainment'],
    ['', 'File Type', 'Web (packaged web app, .ipk; no hosted pages)'],
    ['', 'Optimized Resolution', '1920*1080 (16:9)'],
    ['', 'Service Area Information', 'Colombia (CO)'],
    ['', 'App Service Language', 'Spanish'],
    ['', 'Geo-IP Block', 'No'],
    ['', 'SDK Version', `webOS TV 4.0 or later (web app, ES5)${opts.testedOn ? `. Tested on: ${esc(opts.testedOn)}` : ''}`],
    ['', 'In-App Ad', 'Not Applicable'],
    ['', 'Paid Content', 'Subscription (contracted directly with the operator outside the app; there is no payment or sign-up inside the app)'],
    ['', 'Sound (For Game Type)', 'Not Applicable'],
    ['Test Information', 'Service URL (For Web Type)', 'Not Applicable (packaged app)'],
    ['', 'Test URL (For Web Type)', 'Not Applicable'],
    ['', 'Content server for QA', need(reviewUrl, 'public server address for QA')],
    ['', 'Service Platform', 'webOS'],
  ].map(([cat, item, value]) => `<tr><td class="cat">${cat}</td><td class="item">${item}</td><td>${value}</td></tr>`).join('');

  const pages = [];

  pages.push(`<section class="page cover">
  <div class="cover-box">
    <div class="cover-title">${esc(appName)}</div>
    <div class="cover-sub">UX Scenario Document</div>
    <div class="cover-meta">Based on the LG Seller Lounge template (file version 4.3)<br>
    App version ${esc(pkg.version)} · ${esc(ids.webos)} · ${today}</div>
  </div>
</section>`);

  pages.push(`<section class="page">
  <header><h1>Table of Contents</h1><div class="brand">UX Scenario</div></header>
  <ol class="toc">
    <li>Basic Information</li><li>Document History</li><li>App Overview and Screen Flow</li>
    <li>Detailed Login Information</li><li>Main Page Description</li><li>Sub Page Description</li>
    <li>Paid Content</li><li>In-App Ad</li><li>Appendix: Remote Control Keys and Behavior</li>
  </ol>
  <p class="note">The app user interface is in Spanish. Spanish labels are shown like ${es('this')} followed by their English meaning.</p>
</section>`);

  pages.push(`<section class="page">
  <header><h1>1. Basic Information</h1><div class="brand">UX Scenario</div></header>
  <table class="grid basic"><thead><tr><th>Category</th><th>Items</th><th>Input (By Developer)</th></tr></thead><tbody>${basic}</tbody></table>
</section>`);

  pages.push(`<section class="page">
  <header><h1>2. Document History</h1><div class="brand">UX Scenario</div></header>
  <table class="grid"><thead><tr><th>Version</th><th>Date</th><th>App version</th><th>Description</th></tr></thead>
  <tbody><tr><td>1.0</td><td>${today}</td><td>${esc(pkg.version)}</td><td>Initial submission to LG Content Store.</td></tr></tbody></table>
</section>`);

  pages.push(`<section class="page">
  <header><h1>3. App Overview and Screen Flow</h1><div class="brand">UX Scenario</div></header>
  <p>${esc(appName)} is the official TV app of ${seller ? esc(seller) : 'the operator'}, an Internet and TV service provider in Colombia.
  Subscribers sign in with the username and password they receive from the operator and watch the operator's live TV channels,
  movies and series, delivered by the operator's own servers. The app does not include any content, playlists or
  third-party servers, and users cannot add their own sources.</p>
  <div class="flow">
    <div class="node">Sign in<br>${es('Bienvenido')}</div><div class="arrow">→</div>
    <div class="node main">Main menu<br>${es('TV en vivo')} (Live TV)</div><div class="arrow">→</div>
    <div class="col">
      <div class="node">${es('Películas')} Movies → Movie details → Player</div>
      <div class="node">${es('Series')} → Series details → Episode → Player</div>
      <div class="node">${es('Favoritos')} Favorites · ${es('Recientes')} Recently watched</div>
      <div class="node">${es('Buscar')} Search → Result → Details / Player</div>
      <div class="node">${es('Mensajes')} Messages from the operator</div>
      <div class="node">${es('Cuenta')} Account and settings → Sign out / Exit</div>
      <div class="node">Live TV channel → Preview → Full-screen player</div>
    </div>
  </div>
  <p class="note">Back always returns to the previous screen. Back on the main screen asks for exit confirmation
  (on webOS 23 and later it returns to the TV Home screen as required by the LG back-button guideline).</p>
</section>`);

  pages.push(`<section class="page">
  <header><h1>4. Detailed Login Information</h1><div class="brand">UX Scenario</div></header>
  <table class="grid"><thead><tr><th>#</th><th>Username</th><th>Password</th><th>Simultaneous screens</th></tr></thead><tbody>${accounts}</tbody></table>
  <ul>
    <li>No activation code is needed. Each account can be used on several TVs at the same time, up to the number of simultaneous screens shown above (only while playing video).</li>
    <li>The app connects automatically to the operator's server. For QA it uses the public address ${need(reviewUrl, 'public server address for QA')}. No VPN is needed and there is no Geo-IP block.</li>
    <li>How to sign in: on the first screen select ${es('Usuario')} (Username) and ${es('Contraseña')} (Password), press OK to type with the TV keyboard, then select ${es('Ingresar')} (Sign in).</li>
    <li>The session is kept after closing the app or restarting the TV. To sign out: ${es('Cuenta')} (Account) → ${es('Cambiar de perfil')} (Switch profile), then delete the profile if desired.</li>
    <li>The test accounts only give access to demo content: open movies of the Blender Foundation (Creative Commons Attribution) and demo channels that replay them. The screenshots in this document show sample content.</li>
  </ul>
</section>`);

  pages.push(screenPage('5. Main Page Description', '1. Start Page (Sign in)', '0-inicio-sesion', [
    { box: [405, 210, 1030, 320], text: `App title and instructions: ${es('Ingrese el usuario y la contraseña de su suscripción')} (Enter the username and password of your subscription).` },
    { box: [405, 378, 1170, 458], text: `${es('Servidor')} Server: always the operator's server (${es('Automático')}). It cannot be changed in this version.` },
    { box: [1178, 385, 1515, 452], text: `${es('Buscar servidor en mi red')}: finds the operator's server on the home network if its local address changed. Only the operator's server is accepted.` },
    { box: [405, 509, 1515, 590], text: `${es('Usuario')} Username. OK opens the TV virtual keyboard.` },
    { box: [405, 640, 1362, 721], text: `${es('Contraseña')} Password. OK opens the TV virtual keyboard.` },
    { box: [1369, 647, 1515, 714], text: `${es('Mostrar')} Show / hide the password.` },
    { box: [405, 738, 592, 822], text: `${es('Ingresar')} Sign in. Wrong credentials show an error message; an expired or suspended account shows a notice.` },
    { box: [598, 738, 791, 822], text: `${es('Cancelar')} Cancel: returns to the previous screen (on the first launch it behaves like Back).` },
  ], `<p>Shown on the first launch and after signing out. Navigation: Up/Down between fields, OK to edit, Back to leave.
  The Magic Remote pointer can select every element.</p>`));

  pages.push(screenPage('5. Main Page Description', '2. Main Page (Live TV)', '1-tv-en-vivo', [
    { box: [12, 110, 306, 758], text: `Main menu: ${es('TV en vivo')} Live TV, ${es('Películas')} Movies, ${es('Series')}, ${es('Favoritos')} Favorites, ${es('Recientes')} Recently watched, ${es('Buscar')} Search, ${es('Mensajes')} Messages (badge = unread), ${es('Cuenta')} Account.` },
    { box: [356, 96, 1884, 169], text: 'Notice from the operator (information, maintenance). Rotates automatically.' },
    { box: [340, 230, 662, 764], text: `${es('Categorías')} Channel categories and ${es('Favoritos')}. Count on the right.` },
    { box: [684, 230, 1222, 1024], text: 'Channel list. OK once: preview on the right. OK again: full-screen player. Red key: add/remove favorite. CH+/CH-: page.' },
    { box: [1256, 188, 1904, 556], text: 'Live preview of the selected channel.' },
    { box: [1266, 574, 1884, 724], text: 'Channel name, category and program guide (EPG) when available.' },
    { box: [1270, 22, 1884, 84], text: 'Operator name, date and time.' },
    { box: [356, 1026, 1134, 1074], text: 'Key hints for the current screen (OK, Red, CH+/CH-).' },
  ], `<p>This is the first screen after signing in. Left from the lists moves the focus to the main menu.
  Back from the lists moves to the menu; Back on the menu asks for exit confirmation (webOS 22 and earlier) or returns to the TV Home (webOS 23 and later).</p>`));

  pages.push(`<section class="page">
  <header><h1>6. Sub Page Description</h1><div class="brand">UX Scenario</div></header>
  <h2>1. Flow Chart</h2>
  <table class="grid"><thead><tr><th>From</th><th>Action</th><th>To</th><th>Back returns to</th></tr></thead><tbody>
    <tr><td>Live TV list</td><td>OK (twice)</td><td>Full-screen player</td><td>Live TV list</td></tr>
    <tr><td>${es('Películas')} Movies grid</td><td>OK</td><td>Movie details</td><td>Movies grid</td></tr>
    <tr><td>Movie details</td><td>${es('Reproducir')} Play</td><td>Player (asks to resume if watched before)</td><td>Movie details</td></tr>
    <tr><td>${es('Series')} grid</td><td>OK</td><td>Series details (seasons, episodes)</td><td>Series grid</td></tr>
    <tr><td>Series details</td><td>OK on an episode</td><td>Player (N/M or Next/Previous: other episode)</td><td>Series details</td></tr>
    <tr><td>${es('Buscar')} Search</td><td>OK on a result</td><td>Details or player</td><td>Search</td></tr>
    <tr><td>${es('Mensajes')} Messages</td><td>OK</td><td>Message text (marked as read)</td><td>Main menu</td></tr>
    <tr><td>${es('Cuenta')} Account</td><td>${es('Cambiar de perfil')}</td><td>Profiles / Sign in</td><td>Account</td></tr>
    <tr><td>${es('Cuenta')} Account</td><td>${es('Salir de la aplicación')}</td><td>Exit confirmation → app closes</td><td>Account</td></tr>
  </tbody></table>
</section>`);

  pages.push(screenPage('6. Sub Page Description', '2. Full-screen Player (live channel)', '2-reproductor', [
    { box: [60, 40, 575, 155], text: 'Channel logo, number, name, category and position in the list.' },
    { box: [1730, 45, 1865, 105], text: 'Current time.' },
    { box: [60, 950, 192, 1000], text: `${es('EN VIVO')} LIVE indicator.` },
    { box: [60, 1002, 730, 1042], text: 'Key hints: CH+/CH- or Up/Down change channel, Red: favorite, Back: leave the player.' },
  ], `<p>Live: OK or Info shows/hides this bar; number keys jump to a channel. Movies and episodes show a progress bar with elapsed/total time:
  OK or Play/Pause pauses and resumes, Left/Right or Rewind/Fast Forward seek, Stop or Back closes the player, Next/Previous change episode.
  A loading indicator is shown while buffering. If the network drops, a message appears and playback restarts automatically when it comes back.
  Playback always uses the full screen (16:9).</p>`));

  pages.push(screenPage('6. Sub Page Description', '3. Movies', '3-peliculas', [
    { box: [12, 190, 306, 276], text: `${es('Películas')} menu item (selected).` },
    { box: [340, 230, 662, 604], text: 'Movie categories and favorites.' },
    { box: [690, 232, 1890, 1024], text: 'Poster grid with rating. OK: details. Red: favorite. CH+/CH-: page. The Magic Remote wheel scrolls.' },
    { box: [1774, 186, 1890, 218], text: 'Number of movies in the category.' },
  ], `<p>The ${es('Series')} screen works the same way with series posters.</p>`));

  pages.push(screenPage('6. Sub Page Description', '4. Movie Details', '4-detalle-pelicula', [
    { box: [96, 76, 504, 684], text: 'Poster.' },
    { box: [566, 80, 1780, 375], text: 'Title, year, genre, duration, rating, synopsis, director and cast.' },
    { box: [566, 405, 839, 490], text: `${es('Reproducir')} Play. If the movie was partly watched, the app offers ${es('Continuar')} (resume) or start from the beginning.` },
    { box: [841, 405, 1180, 490], text: `${es('Añadir a favoritos')} Add to / remove from favorites.` },
  ], '<p>Back returns to the movie grid with the same movie focused.</p>'));

  pages.push(screenPage('6. Sub Page Description', '5. Series Details', '5-serie', [
    { box: [96, 76, 404, 534], text: 'Series poster.' },
    { box: [466, 80, 1610, 258], text: 'Title, year, genre, rating and synopsis.' },
    { box: [472, 304, 811, 387], text: `${es('Añadir a favoritos')} Add to / remove from favorites.` },
    { box: [472, 406, 1075, 489], text: `Season tabs (${es('Temporada')}). Left/Right to change season.` },
    { box: [466, 500, 1810, 784], text: 'Episodes of the selected season. OK plays the episode.' },
  ], '<p>After an episode ends, the next one can be played with Next (N).</p>'));

  pages.push(screenPage('6. Sub Page Description', '6. Search', 'ux-buscar', [
    { box: [362, 190, 1879, 271], text: 'Search field. OK opens the TV virtual keyboard. Results update while typing.' },
    { box: [362, 276, 710, 309], text: 'Number of channels, movies and series found.' },
    { box: [356, 316, 1870, 418], text: 'Results. OK opens the movie/series details or plays the channel. Red: favorite.' },
  ], '<p>Search looks in channel, movie and series names (accents and letter case are ignored). An empty result shows a message.</p>'));

  pages.push(screenPage('6. Sub Page Description', '7. Messages', 'ux-mensajes', [
    { box: [340, 190, 942, 343], text: `${es('Bandeja de entrada')} Inbox. A dot marks unread messages.` },
    { box: [976, 188, 1884, 1004], text: 'Selected message: title, date and text. Opening a message marks it as read.' },
    { box: [356, 1026, 732, 1074], text: 'OK: read message. Green key: refresh.' },
  ], '<p>Messages are sent by the operator (service notices, maintenance, payment reminders). Important messages can also appear as a pop-up that is closed with OK or Back.</p>'));

  pages.push(screenPage('6. Sub Page Description', '8. Account and Settings', 'ux-cuenta', [
    { box: [356, 192, 1164, 810], text: 'Account details: username, status, expiry date, simultaneous screens, server, provider, privacy policy address, app version and TV model.' },
    { box: [1196, 198, 1884, 280], text: `${es('Formato de canales en vivo')} Live stream format: automatic, TS or HLS.` },
    { box: [1202, 288, 1878, 370], text: `${es('Vista previa en TV en vivo')} Live preview on/off.` },
    { box: [1202, 377, 1878, 459], text: `${es('Buscar servidor')} Find the operator's server on the home network.` },
    { box: [1202, 466, 1878, 548], text: `${es('Recargar contenido')} Reload channels and content.` },
    { box: [1202, 555, 1878, 637], text: `${es('Cambiar de perfil')} Sign out / switch profile.` },
    { box: [1202, 643, 1878, 725], text: `${es('Editar este perfil')} Edit the profile name and credentials.` },
    { box: [1202, 731, 1878, 813], text: `${es('Salir de la aplicación')} Exit the app (with confirmation).` },
  ], `<p>Privacy policy: ${need(privacy, 'privacy policy URL')}. Support: ${contact ? esc(contact) : 'the contact e-mail shown in the store listing'}.</p>`));

  pages.push(screenPage('6. Sub Page Description', '9. Exit Confirmation', 'ux-salir', [
    { box: [596, 378, 1324, 702], text: `${es('¿Desea salir de ...?')} Do you want to exit? Shown when pressing Back on the main menu or selecting ${es('Salir de la aplicación')}.` },
    { box: [652, 575, 789, 657], text: `${es('Salir')} Exit: closes the app.` },
    { box: [793, 575, 992, 657], text: `${es('Cancelar')} Cancel (default focus): returns to the app.` },
  ], `<p>On webOS 23 and later, Back on the main menu returns to the TV Home screen (webOS.platformBack) without this dialog, following the LG back-button guideline.
  The Home and Exit keys of the remote are handled by the TV. Playback stops when the app goes to the background and resumes when it returns.</p>`));

  pages.push(`<section class="page">
  <header><h1>7. Paid Content</h1><div class="brand">UX Scenario</div></header>
  <p><b>Type: Subscription, contracted outside the app.</b></p>
  <ul>
    <li>Customers contract the TV service directly with ${seller ? esc(seller) : 'the operator'} (together with their Internet service) and receive a username and password.</li>
    <li>There is no purchase, payment method, sign-up or price inside the app.</li>
    <li>If an account is suspended or expired, the app shows a notice with the operator's support contact instead of the content.</li>
    <li>For QA please use the test accounts in section 4; no payment is needed.</li>
  </ul>
  <h1 class="sub">8. In-App Ad</h1>
  <p>Not applicable: the app shows no advertising. Operator notices (section 5, item 2) are service information, not ads.</p>
</section>`);

  pages.push(`<section class="page">
  <header><h1>[Appendix] Remote Control Keys and Behavior</h1><div class="brand">UX Scenario</div></header>
  <table class="grid keys"><thead><tr><th>Key</th><th>Action</th></tr></thead><tbody>
    <tr><td>Arrows</td><td>Move the focus. Every selectable element shows a highlighted focus.</td></tr>
    <tr><td>OK</td><td>Select. On text fields: open the TV keyboard.</td></tr>
    <tr><td>Back</td><td>Previous screen; on the main menu: exit confirmation (webOS 22 and earlier) or TV Home (webOS 23 and later).</td></tr>
    <tr><td>Magic Remote pointer / wheel</td><td>Pointing focuses an element, click = OK; the wheel scrolls lists and grids.</td></tr>
    <tr><td>Red</td><td>Add/remove favorite.</td></tr>
    <tr><td>Green</td><td>Refresh (Messages).</td></tr>
    <tr><td>CH+ / CH-</td><td>Next/previous page in lists; next/previous channel in the player.</td></tr>
    <tr><td>Play, Pause, Stop, Rewind, Fast Forward</td><td>Playback control (movies and episodes).</td></tr>
    <tr><td>Next / Previous</td><td>Next/previous episode or channel.</td></tr>
    <tr><td>Number keys</td><td>In the full-screen live player: go to a channel number.</td></tr>
    <tr><td>Info</td><td>Show/hide the player information bar.</td></tr>
    <tr><td>Home, Exit, Volume, Power</td><td>Handled by the TV (not captured by the app).</td></tr>
  </tbody></table>
  <p class="note">Network: without connection the app shows ${es('Sin conexión a la red')} (No network connection) and retries automatically. Data sent to the operator's server: a random device identifier, TV brand and model, app version, username and the channel being watched (to apply the simultaneous screens limit). No advertising or third-party services.</p>
</section>`);

  const css = `
  @page { size: 13.333in 7.5in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #1c2230; font-size: 12.5pt; }
  .page { width: 13.333in; height: 7.5in; padding: 0.35in 0.45in; page-break-after: always; position: relative; overflow: hidden; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #2846aa; margin-bottom: 0.18in; padding-bottom: 4px; }
  h1 { font-size: 22pt; margin: 0; }
  h1.sub { margin-top: 0.3in; font-size: 20pt; }
  h2 { font-size: 14pt; margin: 0 0 6px; }
  .brand { color: #2846aa; font-weight: 700; }
  .cover { background: linear-gradient(90deg, #141a2b, #2846aa); color: #fff; display: flex; align-items: center; justify-content: center; }
  .cover-box { text-align: center; }
  .cover-title { font-size: 54pt; font-weight: 700; }
  .cover-sub { font-size: 28pt; margin-top: 8px; }
  .cover-meta { margin-top: 24px; font-size: 13pt; color: #c9d6f5; line-height: 1.6; }
  .toc { font-size: 17pt; line-height: 1.9; }
  .note { color: #4a5470; }
  .es { color: #1b4fd6; font-weight: 600; }
  .pending { background: #ffe1e1; color: #b00020; font-weight: 700; padding: 0 4px; }
  table.grid { width: 100%; border-collapse: collapse; font-size: 11.5pt; }
  table.grid th { background: #3a3f4b; color: #fff; text-align: left; padding: 5px 8px; }
  table.grid td { border-bottom: 1px dotted #9aa3b5; padding: 4px 8px; vertical-align: top; }
  table.basic td.cat { font-weight: 700; background: #e6e9f0; width: 16%; }
  table.basic td.item { font-weight: 600; background: #f1f3f7; width: 24%; }
  code { background: #eef1f7; padding: 1px 5px; border-radius: 3px; font-size: 12pt; }
  .screen-wrap { display: flex; gap: 0.2in; }
  .left { width: 8.3in; }
  .shot { position: relative; width: 8.3in; height: 4.669in; border: 1px solid #333; }
  .shot img { width: 100%; height: 100%; display: block; }
  .box { position: absolute; border: 3px solid #e3001b; }
  .num { position: absolute; left: -3px; top: -3px; transform: translate(-60%, -60%); background: #e3001b; color: #fff; font-weight: 700;
    font-size: 10pt; width: 20px; height: 20px; border-radius: 50%; text-align: center; line-height: 20px; }
  table.desc { flex: 1; border-collapse: collapse; font-size: 10.5pt; align-self: flex-start; }
  table.desc th { background: #3a3f4b; color: #fff; text-align: left; padding: 5px 8px; }
  table.desc td { border: 1px solid #b7bdc9; padding: 3px 6px; vertical-align: top; }
  table.desc td.n { width: 24px; text-align: center; font-weight: 700; }
  .details { position: absolute; left: 0.45in; right: 0.45in; bottom: 0.3in; background: #e8eaef; padding: 6px 10px; font-size: 10.5pt; }
  .details p { margin: 3px 0 0; }
  .flow { display: flex; align-items: center; gap: 10px; margin: 0.2in 0; }
  .node { border: 2px solid #2846aa; border-radius: 8px; padding: 6px 10px; background: #f3f6fd; margin: 3px 0; }
  .node.main { background: #2846aa; color: #fff; }
  .node.main .es { color: #fff; }
  .arrow { font-size: 26pt; color: #2846aa; }
  .col { display: flex; flex-direction: column; }
  ul { line-height: 1.5; }
  table.keys td:first-child { width: 28%; font-weight: 600; }
  `;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(appName)} UX Scenario</title><style>${css}</style></head><body>${pages.join('\n')}</body></html>`;
  return { html, missing, appName };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { html, missing, appName } = build(opts);
  const out = opts.out || path.join(TV_DIR, 'dist', 'lg-ux-scenario.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = path.join(os.tmpdir(), `lg-ux-${process.pid}.html`);
  fs.writeFileSync(tmp, html);
  try {
    await withBrowser(async (c) => {
      await c.send('Page.enable');
      await c.send('Page.navigate', { url: url.pathToFileURL(tmp).href });
      await sleep(2000);
      const pdf = await c.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
      fs.writeFileSync(out, Buffer.from(pdf.data, 'base64'));
      if (opts.preview) {
        /* Una página mide 13.333 x 7.5 pulgadas = 1280 x 720 px a 96 ppp */
        fs.mkdirSync(opts.preview, { recursive: true });
        await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
        await sleep(500);
        const r = await c.send('Runtime.evaluate', { expression: 'document.querySelectorAll(".page").length', returnByValue: true });
        for (let i = 0; i < r.result.value; i++) {
          const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: i * 720, width: 1280, height: 720, scale: 1 } });
          fs.writeFileSync(path.join(opts.preview, `pagina-${String(i + 1).padStart(2, '0')}.png`), Buffer.from(shot.data, 'base64'));
        }
      }
    }, { browser: opts.browser });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  console.log(`Documento de uso de ${appName} para LG: ${path.relative(process.cwd(), out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
  if (missing.length) console.log(`Faltan datos (salen en rojo como PENDING): ${[...new Set(missing)].join(', ')}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { build };
