// Contenido de demostración para la revisión de las tiendas de TV (LG, Samsung). Lo usa deploy/demo-revision.sh
// después de preparar los videos. Solo para un servidor de pruebas: se niega si el portal ya tiene clientes reales.
//
// Uso (en el servidor, como el usuario del portal):
//   node scripts/demo-revision.js [--rehacer] [--forzar] [--medios http://IP]
//
// Crea: categorías, 3 canales en vivo (por el nodo de este servidor si existe), 4 películas y una serie con las
// películas abiertas de la Fundación Blender (Creative Commons Atribución), un paquete, un mensaje, un aviso y dos
// cuentas de prueba (lgqa1 y lgqa2). Sin --rehacer, si ya existe, solo vuelve a mostrar las cuentas.
import crypto from 'node:crypto';
import { config } from '../src/config.js';
import { db, migrate } from '../src/db/index.js';
import { setJwtSecret, signToken } from '../src/lib/auth.js';
import { getJwtSecret, getSettings } from '../src/lib/settings.js';

const MARKER = 'demo_revision';
export const ACCOUNTS = ['lgqa1', 'lgqa2'];

export const MOVIES = [
  {
    slug: 'bbb', name: 'Big Buck Bunny', year: 2008, genre: 'Animación, comedia', director: 'Sacha Goedegebure', secs: 596,
    cat: 'Animación', colors: ['#3f8f3a', '#a7d86a'],
    plot: 'Un conejo enorme y bonachón disfruta de un día tranquilo en el bosque hasta que tres roedores traviesos se meten con él. Entonces decide darles una lección.',
    credit: '© 2008 Blender Foundation | www.bigbuckbunny.org · Licencia Creative Commons Atribución 3.0',
  },
  {
    slug: 'ed', name: 'Elephants Dream', year: 2006, genre: 'Animación, ciencia ficción', director: 'Bassam Kurdali', secs: 654,
    cat: 'Ciencia ficción', colors: ['#3b2f5c', '#c77d3a'],
    plot: 'Emo y Proog recorren un mundo mecánico y extraño. Proog quiere mostrarle a Emo las maravillas de la Máquina, pero Emo no ve lo mismo.',
    credit: '© 2006 Blender Foundation / Netherlands Media Art Institute | www.elephantsdream.org · Licencia Creative Commons Atribución 2.5',
  },
  {
    slug: 'sintel', name: 'Sintel', year: 2010, genre: 'Animación, fantasía', director: 'Colin Levy', secs: 888,
    cat: 'Animación', colors: ['#5a3a22', '#d9a066'],
    plot: 'Sintel, una joven guerrera, recorre tierras peligrosas buscando al pequeño dragón que rescató y que le arrebataron.',
    credit: '© Blender Foundation | durian.blender.org · Licencia Creative Commons Atribución 3.0',
  },
  {
    slug: 'tos', name: 'Tears of Steel', year: 2012, genre: 'Ciencia ficción', director: 'Ian Hubert', secs: 734,
    cat: 'Ciencia ficción', colors: ['#0f2b3d', '#5fa3c7'],
    plot: 'En una Ámsterdam del futuro, un grupo de científicos y guerreros intenta salvar al mundo de unos robots destructivos reviviendo un recuerdo del pasado.',
    credit: '© Blender Foundation | mango.blender.org · Licencia Creative Commons Atribución 3.0',
  },
];

export const CHANNELS = [
  { slug: 'bbb', name: 'PTOVS Animación', short: 'AN', colors: ['#2f9e44', '#1b5e20'] },
  { slug: 'tos', name: 'PTOVS Ciencia Ficción', short: 'CF', colors: ['#1f78c8', '#0d3f73'] },
  { slug: 'ed', name: 'PTOVS Clásicos', short: 'CL', colors: ['#8e44ad', '#4a235a'] },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const svg = (w, h, body) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;
const gradient = (c1, c2, vertical = false) => `<defs><linearGradient id="g" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="1">`
  + `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`;

export function logo(short, [c1, c2]) {
  return svg(200, 200, `${gradient(c1, c2)}<rect width="200" height="200" rx="36" fill="url(#g)"/>`
    + `<text x="100" y="124" font-family="Segoe UI,Arial,sans-serif" font-size="70" font-weight="700" fill="#fff" text-anchor="middle">${esc(short)}</text>`);
}

export function poster(title, tag, [c1, c2]) {
  const lines = [];
  for (const w of title.split(' ')) {
    const last = lines[lines.length - 1];
    if (last && `${last} ${w}`.length <= 12) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  const text = lines.map((l, i) => `<text x="200" y="${420 + i * 52}" font-family="Georgia,serif" font-size="46" font-weight="700" fill="#fff" text-anchor="middle">${esc(l)}</text>`).join('');
  return svg(400, 600, `${gradient(c1, c2, true)}<rect width="400" height="600" fill="url(#g)"/>`
    + '<circle cx="200" cy="190" r="90" fill="#ffffff" opacity=".18"/>'
    + `<rect y="360" width="400" height="240" fill="#000" opacity=".35"/>${text}`
    + `<text x="200" y="580" font-family="Segoe UI,Arial,sans-serif" font-size="20" letter-spacing="4" fill="#ffffffcc" text-anchor="middle">${esc(tag)}</text>`);
}

export function backdrop([c1, c2]) {
  return svg(1280, 720, `${gradient(c1, c2)}<rect width="1280" height="720" fill="url(#g)"/>`
    + '<circle cx="980" cy="200" r="150" fill="#ffffff" opacity=".12"/>'
    + '<path d="M0 560 Q160 510 320 560 T640 560 T960 560 T1280 560 V720 H0Z" fill="#00000033"/>');
}

/** Contraseña aleatoria con letras y números (el portal acepta A-Z a-z 0-9 . _ @ ! # $ * -). */
export function randomPassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(length), (b) => chars[b % chars.length]).join('');
}

export function mediaBaseFrom(publicUrl) {
  try {
    const u = new URL(publicUrl);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return '';
  }
}

async function adminApi(panelUrl) {
  setJwtSecret(await getJwtSecret(config.jwtSecret));
  const admin = await db('admins').where({ role: 'admin', enabled: true }).orderBy('id').first();
  if (!admin) throw new Error('No hay un administrador activo en el portal');
  const token = signToken(admin);
  return async (method, path, body) => {
    const res = await fetch(`${panelUrl}/api/admin${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data?.error || ''}`);
    return data;
  };
}

async function readMarker() {
  const row = await db('settings').where({ key: MARKER }).first();
  return row ? JSON.parse(row.value) : null;
}

async function writeMarker(value) {
  const json = JSON.stringify(value);
  if (await db('settings').where({ key: MARKER }).first()) await db('settings').where({ key: MARKER }).update({ value: json });
  else await db('settings').insert({ key: MARKER, value: json });
}

async function removePrevious(api, m) {
  const tryDelete = async (path) => {
    try { await api('DELETE', path); } catch { /* ya no existe */ }
  };
  for (const id of m.users || []) await tryDelete(`/users/${id}`);
  for (const id of m.streams || []) await tryDelete(`/streams/${id}`);
  for (const id of m.series || []) await tryDelete(`/series/${id}`);
  for (const id of m.packages || []) await tryDelete(`/packages/${id}`);
  for (const id of m.categories || []) await tryDelete(`/categories/${id}`);
  for (const id of m.messages || []) await tryDelete(`/messages/${id}`);
  for (const id of m.notices || []) await tryDelete(`/notices/${id}`);
  await db('settings').where({ key: MARKER }).del();
}

function printAccounts(rows, base, log) {
  log('\nCuentas de prueba para la revisión (pantallas simultáneas: 3):');
  for (const u of rows) log(`  Usuario: ${u.username}   Contraseña: ${u.password}`);
  log(`Servidor para las apps: ${base}`);
}

/** opts: { rehacer, forzar, medios, panelUrl, log } → { accounts, created, reused } */
export async function loadDemo(opts = {}) {
  const log = opts.log || console.log;
  const panelUrl = opts.panelUrl || `http://127.0.0.1:${config.port}`;
  const settings = await getSettings();
  const base = (opts.medios || process.env.DEMO_MEDIA_BASE || mediaBaseFrom(settings.public_url)).replace(/\/+$/, '');
  if (!base) throw new Error('No se sabe la dirección pública del servidor: indíquela con --medios http://IP');
  const clientsUrl = settings.public_url || base;

  const marker = await readMarker();
  const others = await db('users').whereNotIn('username', ACCOUNTS).count({ c: '*' }).first();
  if (Number(others.c) > 0 && !marker && !opts.forzar) {
    throw new Error(`Este portal ya tiene ${others.c} clientes. Este contenido es solo para un servidor de pruebas (use --forzar si está seguro).`);
  }
  const api = await adminApi(panelUrl);

  if (marker && !opts.rehacer) {
    log('El contenido de demostración ya estaba cargado (para volver a crearlo: --rehacer).');
    const accounts = await db('users').whereIn('username', ACCOUNTS).orderBy('username').select('username', 'password');
    printAccounts(accounts, clientsUrl, log);
    return { accounts, created: marker, reused: true };
  }
  if (marker) await removePrevious(api, marker);
  // Cuentas con el mismo nombre de una carga anterior incompleta
  for (const u of await db('users').whereIn('username', ACCOUNTS).select('id')) await api('DELETE', `/users/${u.id}`);

  const created = { categories: [], streams: [], series: [], packages: [], users: [], messages: [], notices: [] };

  const patch = { timezone: 'America/Bogota' };
  if (!settings.server_name || settings.server_name === 'Mi IPTV') patch.server_name = process.env.DEMO_APP_NAME || 'PTOVS TV';
  if (!settings.company_name) patch.company_name = process.env.DEMO_COMPANY || 'PTOVS';
  if (!settings.app_name) patch.app_name = process.env.DEMO_APP_NAME || 'PTOVS TV';
  await api('PUT', '/settings', patch);

  const category = async (name, type, order) => {
    const c = await api('POST', '/categories', { name, type, sort_order: order });
    created.categories.push(c.id);
    return c.id;
  };
  const liveCat = await category('Canales PTOVS', 'live', 0);
  const movieCats = { Animación: await category('Animación', 'movie', 1), 'Ciencia ficción': await category('Ciencia ficción', 'movie', 2) };
  const seriesCat = await category('Series', 'series', 3);

  // Canales: por el nodo de este servidor (entrega .ts y HLS) si está instalado.
  const localNode = await db('settings').where({ key: 'local_node_server_id' }).first();
  const nodeId = localNode ? Number(JSON.parse(localNode.value)) : 0;
  const node = nodeId ? await db('servers').where({ id: nodeId, enabled: true }).first() : null;
  let order = 1;
  for (const ch of CHANNELS) {
    const s = await api('POST', '/streams', {
      type: 'live', name: ch.name, category_id: liveCat, logo: logo(ch.short, ch.colors), sort_order: order++,
      source_url: `${base}/demo/live/${ch.slug}/index.m3u8`, container_extension: 'ts',
      ...(node ? { delivery_mode: 'restream', server_ids: [node.id] } : {}),
    });
    created.streams.push(s.id);
  }

  const vodIds = [];
  for (const m of MOVIES) {
    const s = await api('POST', '/streams', {
      type: 'movie', name: m.name, category_id: movieCats[m.cat], logo: poster(m.name, 'PELÍCULA', m.colors),
      source_url: `${base}/demo/vod/${m.slug}/index.m3u8`, container_extension: 'm3u8',
      info: {
        plot: `${m.plot} ${m.credit}.`, genre: m.genre, releasedate: `${m.year}-01-01`, rating: '8.0',
        duration: `${Math.round(m.secs / 60)} min`, duration_secs: m.secs, director: m.director, cast: 'Blender Foundation',
        backdrop_path: [backdrop(m.colors)],
      },
    });
    created.streams.push(s.id);
    vodIds.push(s.id);
  }

  const series = await api('POST', '/series', {
    name: 'Cine abierto', category_id: seriesCat, genre: 'Animación', release_date: '2012-01-01', rating: '8.0',
    plot: 'Los cortometrajes de la Fundación Blender, uno por episodio. © Blender Foundation · Licencias Creative Commons Atribución.',
    cover: poster('Cine abierto', 'SERIE', ['#123b5c', '#e07a3f']), backdrop: backdrop(['#123b5c', '#e07a3f']),
  });
  created.series.push(series.id);
  let ep = 1;
  for (const m of MOVIES) {
    await api('POST', `/series/${series.id}/episodes`, {
      season: 1, episode_num: ep++, name: m.name, container_extension: 'm3u8',
      source_url: `${base}/demo/vod/${m.slug}/index.m3u8`,
      info: { plot: `${m.plot} ${m.credit}.`, duration: `${Math.round(m.secs / 60)} min` },
    });
  }

  const pkg = await api('POST', '/packages', {
    name: 'Revisión de tiendas', description: 'Contenido de demostración (películas abiertas de Blender)',
    stream_ids: created.streams, series_ids: [series.id],
  });
  created.packages.push(pkg.id);

  const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
  const accounts = [];
  for (const username of ACCOUNTS) {
    const password = randomPassword();
    const u = await api('POST', '/users', {
      username, password, full_name: 'Cuenta de prueba para la revisión', max_connections: 3, exp_date: exp, package_ids: [pkg.id],
    });
    created.users.push(u.id);
    accounts.push({ username, password });
  }

  const msg = await api('POST', '/messages', {
    title: 'Bienvenido', target: 'all', kind: 'general', display: 'inbox',
    body: 'Esta es una cuenta de demostración. Aquí verá los canales, películas y series de su plan. Si necesita ayuda, comuníquese con soporte.',
  });
  created.messages.push(msg.id);
  const notice = await api('POST', '/notices', {
    title: 'Cuenta de demostración', level: 'info', display: 'banner', target: 'all',
    body: 'El contenido de esta cuenta son películas abiertas de la Fundación Blender.',
  });
  created.notices.push(notice.id);

  await writeMarker({ ...created, created_at: Date.now() });
  log(`Contenido cargado: ${CHANNELS.length} canales${node ? ` (por el nodo «${node.name}»)` : ''}, ${MOVIES.length} películas y 1 serie.`);
  printAccounts(accounts, clientsUrl, log);
  return { accounts, created, reused: false };
}

if (process.argv[1]?.endsWith('demo-revision.js')) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--medios');
  try {
    await migrate();
    await loadDemo({ rehacer: args.includes('--rehacer'), forzar: args.includes('--forzar'), medios: i >= 0 ? args[i + 1] : undefined });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}
