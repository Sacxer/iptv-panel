// EPG: descarga de guías XMLTV, emparejamiento automático de canales y guía combinada para los clientes.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import zlib from 'node:zlib';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { logAction } from '../lib/log.js';
import { getSettings } from '../lib/settings.js';
import { HttpError, bool, chunk, now } from '../lib/util.js';

export const GUIDE_DIR = path.join(path.dirname(config.db.file), 'epg');
export const GUIDE_FILE = path.join(GUIDE_DIR, 'guide.xml.gz');

/* ------------------------------------ Lectura XMLTV ------------------------------------ */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decodeXml = (s) => String(s || '')
  .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Recorre una guía XMLTV (plana o .gz) sin cargarla entera en memoria. Emite bloques <channel> y <programme>. */
export async function* xmltvBlocks(url, { timeoutMs = 180_000 } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'IPTV-Portal/1.0' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  } catch (err) {
    throw new HttpError(502, `No se pudo descargar la guía: ${err.cause?.code || err.message}`);
  }
  if (!res.ok || !res.body) throw new HttpError(502, `La guía respondió HTTP ${res.status}`);

  const iterator = Readable.fromWeb(res.body)[Symbol.asyncIterator]();
  const first = await iterator.next();
  const gzip = !first.done && first.value[0] === 0x1f && first.value[1] === 0x8b;
  const raw = Readable.from((async function* joined() {
    if (!first.done) yield first.value;
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }()));
  const input = gzip ? raw.pipe(zlib.createGunzip()) : raw;
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let sawTv = false;

  for await (const part of input) {
    buffer += decoder.write(part);
    if (!sawTv && buffer.length > 4096 && !/<tv[\s>]/i.test(buffer)) {
      throw new HttpError(502, 'La URL no es una guía XMLTV (no contiene <tv>)');
    }
    if (/<tv[\s>]/i.test(buffer)) sawTv = true;
    for (;;) {
      const start = buffer.search(/<(channel|programme)[\s>]/);
      if (start === -1) {
        buffer = buffer.slice(-20); // conservar un posible inicio de etiqueta partido
        break;
      }
      const type = buffer.startsWith('<channel', start) ? 'channel' : 'programme';
      const endTag = `</${type}>`;
      const end = buffer.indexOf(endTag, start);
      if (end === -1) {
        buffer = buffer.slice(start);
        break;
      }
      yield { type, xml: buffer.slice(start, end + endTag.length) };
      buffer = buffer.slice(end + endTag.length);
    }
  }
  if (!sawTv) throw new HttpError(502, 'La URL no es una guía XMLTV (no contiene <tv>)');
}

export function parseChannel(xml) {
  const id = decodeXml((/<channel\s[^>]*id="([^"]*)"/.exec(xml) || [])[1] || '').trim();
  const names = [...xml.matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g)].map((m) => decodeXml(m[1]).trim()).filter(Boolean);
  const icon = decodeXml((/<icon\s[^>]*src="([^"]*)"/.exec(xml) || [])[1] || '');
  return { id, names: [...new Set(names)], icon };
}

const programmeChannel = (xml) => decodeXml((/<programme\s[^>]*channel="([^"]*)"/.exec(xml) || [])[1] || '');

/** Hora XMLTV "20260915060000 -0500" → segundos unix. */
export function parseXmltvTime(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{2}):?(\d{2})?/.exec(String(value || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, sec = '00', tzh = '+00', tzm = '00'] = m;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec)) / 1000;
  const offset = (Math.abs(Number(tzh)) * 3600 + Number(tzm) * 60) * (tzh.startsWith('-') ? -1 : 1);
  return utc - offset;
}

export function parseProgramme(xml) {
  const attr = (name) => decodeXml((new RegExp(`<programme\\s[^>]*${name}="([^"]*)"`).exec(xml) || [])[1] || '');
  const tag = (name) => {
    const m = new RegExp(`<${name}(?:\\s+lang="([^"]*)")?[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
    return m ? { text: decodeXml(m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim(), lang: m[1] || '' } : { text: '', lang: '' };
  };
  const title = tag('title');
  return {
    channel_id: attr('channel'),
    start: parseXmltvTime(attr('start')),
    stop: parseXmltvTime(attr('stop')),
    title: title.text,
    description: tag('desc').text,
    lang: title.lang,
  };
}

/* ------------------------------------ Normalización ------------------------------------ */

const QUALITY = /\b(uhd|fhd|hd|sd|4k|8k|hevc|h ?265|h ?264|1080[pi]?|720p?|576[pi]?|480p?|50 ?fps|60 ?fps|backup|bkp|alt)\b/g;
const NUMBER_WORDS = {
  uno: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '10', once: '11', doce: '12', trece: '13',
};
// Prefijos de país/región que traen muchas listas: "CO: ", "ES | ", "[LATAM] ". Solo códigos conocidos para no cortar nombres reales.
const PREFIX = /^\s*[[(]?\s*(?:co|es|us|usa|mx|ar|pe|cl|ec|ve|bo|py|uy|pa|cr|gt|hn|sv|ni|do|pr|cu|br|pt|uk|gb|fr|it|de|ca|latam|lat|int)\s*[\])]?\s*(?:[:|\-»•]+)\s*/;

/** Nombre de canal comparable: sin tildes, calidad, prefijos de país ni símbolos. */
export function normalizeChannelName(name) {
  return String(name || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[ᴴᴰᵁˢ]+/g, ' ')
    .replace(PREFIX, '')
    .replace(/\btelevisi[oó]n\b/g, 'tv')
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' ')
    .replace(/[_.]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2') // "6hd" → "6 hd"
    .replace(/([a-z])(\d)/g, '$1 $2') // "espn3" → "espn 3"
    .replace(/\b(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece)\b/g, (w) => NUMBER_WORDS[w])
    .replace(QUALITY, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "CanalRCN.co" → { name: "canal rcn", country: "co" } */
export function splitXmltvId(id) {
  const raw = String(id || '').replace(/@.*$/, '');
  const m = /^(.*)\.([a-z]{2})$/i.exec(raw);
  return { name: normalizeChannelName(m ? m[1] : raw), country: m ? m[2].toLowerCase() : '' };
}

const tokens = (s) => s.split(' ').filter((x) => x.length > 1 || /\d/.test(x));

function bigrams(s) {
  const c = s.replace(/ /g, '');
  const out = new Map();
  for (let i = 0; i < c.length - 1; i++) {
    const b = c.slice(i, i + 2);
    out.set(b, (out.get(b) || 0) + 1);
  }
  return { map: out, size: Math.max(0, c.length - 1) };
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const [k, n] of a.map) inter += Math.min(n, b.map.get(k) || 0);
  return (2 * inter) / (a.size + b.size);
}

/** Similitud 0..1 entre dos nombres ya normalizados. */
export function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  const ca = a.replace(/ /g, '');
  const cb = b.replace(/ /g, '');
  if (ca === cb) return 1;
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  const tokenDice = ta.size + tb.size ? (2 * common) / (ta.size + tb.size) : 0;
  const charDice = dice(bigrams(a), bigrams(b)) * 0.95;
  let score = Math.max(tokenDice, charDice);
  // Números distintos (Canal 1 vs Canal 2, ESPN 2 vs ESPN 3) casi siempre son canales distintos.
  const na = a.match(/\d+/g)?.join(',') || '';
  const nb = b.match(/\d+/g)?.join(',') || '';
  if (na !== nb) score -= 0.25;
  // Las versiones "+" (Win Sports+, Canal Trece +) son otros canales.
  if (/\bplus\b/.test(a) !== /\bplus\b/.test(b)) score -= 0.25;
  return Math.max(0, Math.min(1, score));
}

/** Variantes para comparar: también sin "canal"/"tv" delante ("Canal RCN" ≈ "RCN"). */
export function nameVariants(norm) {
  const out = [norm];
  const stripped = norm.replace(/^(canal|tv) /, '');
  if (stripped !== norm && stripped.length >= 2) out.push(stripped);
  return out;
}

/* -------------------------------------- Fuentes -------------------------------------- */

const refreshing = new Set();
export const isRefreshing = (id) => refreshing.has(id);
let guideState = { building: false, built_at: null, channels: 0, programmes: 0, size: 0, error: null };
export const guideStatus = () => {
  const exists = fs.existsSync(GUIDE_FILE);
  return { ...guideState, exists, size: exists ? fs.statSync(GUIDE_FILE).size : 0, built_at: guideState.built_at ?? (exists ? Math.floor(fs.statSync(GUIDE_FILE).mtimeMs / 1000) : null) };
};

/** Descarga una fuente y guarda su lista de canales. */
export async function refreshSource(source) {
  if (refreshing.has(source.id)) throw new HttpError(409, 'Esta guía ya se está actualizando');
  refreshing.add(source.id);
  const t = now();
  await db('epg_sources').where({ id: source.id }).update({ status: 'refreshing', last_error: null, updated_at: t });
  try {
    const channels = new Map();
    let programmes = 0;
    let firstAt = null;
    let lastAt = null;
    let current = 0;
    const nowTs = now();
    for await (const block of xmltvBlocks(source.url)) {
      if (block.type === 'programme') {
        programmes++;
        const start = parseXmltvTime((/start="([^"]*)"/.exec(block.xml) || [])[1]);
        const stop = parseXmltvTime((/stop="([^"]*)"/.exec(block.xml) || [])[1]);
        if (start && (firstAt === null || start < firstAt)) firstAt = start;
        if (stop && (lastAt === null || stop > lastAt)) lastAt = stop;
        if (start && stop && start <= nowTs && stop > nowTs) current++;
        continue;
      }
      const ch = parseChannel(block.xml);
      if (!ch.id || channels.has(ch.id)) continue;
      channels.set(ch.id, ch);
    }
    await db.transaction(async (trx) => {
      await trx('epg_channels').where({ source_id: source.id }).del();
      for (const part of chunk([...channels.values()], 300)) {
        await trx('epg_channels').insert(part.map((ch) => {
          const idInfo = splitXmltvId(ch.id);
          return {
            source_id: source.id,
            xmltv_id: ch.id.slice(0, 255),
            display_names: JSON.stringify(ch.names.slice(0, 10)),
            icon: ch.icon || null,
            country: idInfo.country || null,
            search_text: [...new Set([idInfo.name, ...ch.names.map(normalizeChannelName)])].join(' | ').slice(0, 2000),
          };
        }));
      }
    });
    await db('epg_sources').where({ id: source.id }).update({
      status: 'ok', channel_count: channels.size, programme_count: programmes, last_fetch_at: now(), updated_at: now(),
      first_programme_at: firstAt, last_programme_at: lastAt, current_programmes: current,
    });
    return { channels: channels.size, programmes, first_programme_at: firstAt, last_programme_at: lastAt, current_programmes: current };
  } catch (err) {
    await db('epg_sources').where({ id: source.id }).update({ status: 'error', last_error: err.message.slice(0, 1000), updated_at: now() });
    throw err;
  } finally {
    refreshing.delete(source.id);
  }
}

/* ----------------------------------- Emparejamiento ----------------------------------- */

async function loadCandidates() {
  const rows = await db('epg_channels').join('epg_sources', 'epg_sources.id', 'epg_channels.source_id')
    .where('epg_sources.enabled', true)
    .select('epg_channels.*', 'epg_sources.name as source_name', 'epg_sources.priority as source_priority');
  const candidates = rows.map((r) => {
    const names = JSON.parse(r.display_names || '[]');
    const idInfo = splitXmltvId(r.xmltv_id);
    const keys = [...new Set([...names.map(normalizeChannelName), idInfo.name].filter(Boolean))];
    return {
      xmltv_id: r.xmltv_id, display_name: names[0] || r.xmltv_id, icon: r.icon || '', country: r.country || idInfo.country,
      source_id: r.source_id, source_name: r.source_name, priority: Number(r.source_priority) || 0, keys,
    };
  });
  // Índice por palabra y por las 3 primeras letras para no comparar contra toda la guía.
  const index = new Map();
  const add = (k, c) => {
    if (!index.has(k)) index.set(k, new Set());
    index.get(k).add(c);
  };
  for (const c of candidates) {
    for (const key of c.keys) {
      for (const variant of nameVariants(key)) {
        for (const tk of tokens(variant)) add(`t:${tk}`, c);
        add(`p:${variant.replace(/ /g, '').slice(0, 3)}`, c);
      }
    }
  }
  return { candidates, index };
}

function rankFor(streamName, { index }, country) {
  const norm = normalizeChannelName(streamName);
  if (!norm) return [];
  const pool = new Set();
  for (const variant of nameVariants(norm)) {
    for (const tk of tokens(variant)) for (const c of index.get(`t:${tk}`) || []) pool.add(c);
    for (const c of index.get(`p:${variant.replace(/ /g, '').slice(0, 3)}`) || []) pool.add(c);
  }
  const scored = [];
  for (const c of pool) {
    let best = 0;
    for (const key of c.keys) {
      for (const a of nameVariants(norm)) for (const b of nameVariants(key)) best = Math.max(best, nameSimilarity(a, b));
    }
    if (country && c.country) best += c.country === country ? 0.05 : -0.1;
    scored.push({ ...c, score: Math.round(Math.max(0, Math.min(1, best)) * 100) });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.priority - b.priority));
  // Un mismo ID puede venir de varias guías: se deja el de mayor prioridad.
  const seen = new Set();
  return scored.filter((c) => (seen.has(c.xmltv_id) ? false : seen.add(c.xmltv_id))).slice(0, 5);
}

/**
 * Empareja canales en vivo con la guía.
 * options: { stream_ids?, filter?: { category_id?, search?, source? }, only_missing = true, min_score?, fill_logos?, dry_run? }
 */
export async function matchStreams(options = {}, admin = null) {
  const settings = await getSettings();
  const minScore = Math.max(50, Math.min(100, Number(options.min_score ?? settings.epg_min_score) || 85));
  const fillLogos = options.fill_logos ?? settings.epg_fill_logos;
  const country = String(options.country ?? settings.epg_country ?? '').toLowerCase().trim();
  const dryRun = bool(options.dry_run);
  const onlyMissing = options.only_missing !== false;

  const q = db('streams').where({ type: 'live' }).where('epg_locked', false);
  if (Array.isArray(options.stream_ids) && options.stream_ids.length) q.whereIn('id', options.stream_ids.map(Number));
  const f = options.filter || {};
  if (f.category_id) q.where('category_id', Number(f.category_id));
  if (f.search) q.where('name', 'like', `%${String(f.search)}%`);
  if (f.source) q.where('source', String(f.source));
  if (onlyMissing) q.where((w) => w.whereNull('epg_channel_id').orWhere('epg_channel_id', ''));
  const streams = await q.select('id', 'name', 'logo', 'epg_channel_id').orderBy('name');

  const loaded = await loadCandidates();
  if (!loaded.candidates.length) throw new HttpError(400, 'No hay canales de guía cargados. Agrega una fuente EPG y actualízala.');

  const t = now();
  const summary = { dry_run: dryRun, checked: streams.length, assigned: 0, suggested: 0, not_found: 0, logos_filled: 0, min_score: minScore };
  const results = [];
  const updates = [];
  for (const s of streams) {
    const ranked = rankFor(s.name, loaded, country);
    const best = ranked[0];
    const item = {
      stream_id: s.id, name: s.name, current: s.epg_channel_id || null,
      match: best ? { xmltv_id: best.xmltv_id, display_name: best.display_name, icon: best.icon, source: best.source_name, score: best.score } : null,
      alternatives: ranked.slice(1, 4).map((c) => ({ xmltv_id: c.xmltv_id, display_name: c.display_name, source: c.source_name, score: c.score })),
      action: 'none',
    };
    if (best && best.score >= minScore) {
      item.action = 'assign';
      summary.assigned++;
      const patch = { epg_channel_id: best.xmltv_id, epg_match_score: best.score, epg_matched_at: t };
      if (fillLogos && !s.logo && best.icon) {
        patch.logo = best.icon;
        item.logo_filled = true;
        summary.logos_filled++;
      }
      updates.push({ id: s.id, patch });
    } else if (best && best.score >= 60) {
      item.action = 'suggest';
      summary.suggested++;
    } else {
      summary.not_found++;
    }
    results.push(item);
  }
  if (!dryRun && updates.length) {
    await db.transaction(async (trx) => {
      for (const u of updates) await trx('streams').where({ id: u.id }).update({ ...u.patch, updated_at: t });
    });
    await logAction(admin, 'epg.match', 'stream', null, { assigned: summary.assigned, logos: summary.logos_filled, min_score: minScore });
  }
  return { ...summary, results: results.slice(0, 5000) };
}

/* ------------------------------------ Guía combinada ------------------------------------ */

/** Genera guide.xml.gz con solo los canales usados en el portal (y su programación). */
export async function buildGuide() {
  if (guideState.building) throw new HttpError(409, 'La guía ya se está generando');
  guideState = { ...guideState, building: true, error: null };
  const tmp = `${GUIDE_FILE}.tmp`;
  let batch = null;
  try {
    fs.mkdirSync(GUIDE_DIR, { recursive: true });
    const used = new Set((await db('streams').where({ type: 'live', enabled: true }).whereNotNull('epg_channel_id')
      .whereNot('epg_channel_id', '').distinct('epg_channel_id').pluck('epg_channel_id')));
    const sources = await db('epg_sources').where({ enabled: true }).orderBy('priority').orderBy('id');
    const gz = zlib.createGzip();
    const out = fs.createWriteStream(tmp);
    gz.pipe(out);
    const write = (s) => (gz.write(s) ? null : new Promise((r) => gz.once('drain', r)));
    await write('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n<tv generator-info-name="IPTV Portal">\n');
    const owner = new Map(); // xmltv_id → fuente que lo aporta (la de mayor prioridad)
    let channels = 0;
    let programmes = 0;
    // Programación para "ahora / siguiente": nueva generación (batch) que reemplaza a la anterior al terminar.
    batch = now();
    const windowStart = batch - 6 * 3600;
    const windowEnd = batch + 8 * 86400;
    let pendingRows = [];
    let stored = 0;
    const flush = async () => {
      if (!pendingRows.length) return;
      const rows = pendingRows;
      pendingRows = [];
      for (const part of chunk(rows, 250)) await db('epg_programmes').insert(part);
    };
    for (const source of sources) {
      try {
        for await (const block of xmltvBlocks(source.url)) {
          if (block.type === 'channel') {
            const { id } = parseChannel(block.xml);
            if (!used.has(id) || owner.has(id)) continue;
            owner.set(id, source.id);
            channels++;
            await write(`${block.xml}\n`);
          } else {
            const id = programmeChannel(block.xml);
            if (!used.has(id) || owner.get(id) !== source.id) continue;
            programmes++;
            await write(`${block.xml}\n`);
            const p = parseProgramme(block.xml);
            if (p.start && p.stop && p.stop >= windowStart && p.start <= windowEnd) {
              pendingRows.push({
                channel_id: id.slice(0, 255), start: p.start, stop: p.stop, title: p.title.slice(0, 500) || null,
                description: p.description.slice(0, 4000) || null, lang: (p.lang || '').slice(0, 8) || null, batch,
              });
              stored++;
              if (pendingRows.length >= 1000) await flush();
            }
          }
        }
      } catch (err) {
        console.error(`EPG "${source.name}": ${err.message}`);
      }
    }
    await flush();
    await db('epg_programmes').whereNot('batch', batch).del();
    await write('</tv>\n');
    await new Promise((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
      gz.end();
    });
    fs.renameSync(tmp, GUIDE_FILE);
    guideState = { building: false, built_at: now(), channels, programmes, stored_programmes: stored, error: null };
    return guideStatus();
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    if (batch) await db('epg_programmes').where({ batch }).del().catch(() => {}); // se conserva la programación anterior
    guideState = { ...guideState, building: false, error: err.message };
    throw err;
  }
}

/** Programas de un canal desde `from` (los que aún no terminaron), para las acciones EPG de la API Xtream. */
export async function programmesFor(channelId, { from = now(), limit = null, since = null } = {}) {
  if (!channelId) return [];
  const q = db('epg_programmes').where({ channel_id: channelId }).orderBy('start');
  if (since !== null) q.where('stop', '>', since);
  else q.where('stop', '>', from);
  if (limit) q.limit(limit);
  return q;
}

/** Actualiza todas las fuentes, empareja (si está activado) y regenera la guía. */
export async function refreshAll({ admin = null } = {}) {
  const settings = await getSettings();
  const sources = await db('epg_sources').where({ enabled: true });
  const result = { sources: 0, errors: 0, match: null, guide: null };
  for (const s of sources) {
    try {
      await refreshSource(s);
      result.sources++;
    } catch {
      result.errors++;
    }
  }
  if (bool(settings.epg_auto_match)) {
    result.match = await matchStreams({ only_missing: true }, admin).then((m) => ({ assigned: m.assigned, suggested: m.suggested })).catch(() => null);
  }
  result.guide = await buildGuide().catch((err) => ({ error: err.message }));
  return result;
}

export function startEpgScheduler() {
  let running = false;
  const tick = async () => {
    if (running) return;
    const settings = await getSettings().catch(() => null);
    if (!settings) return;
    const every = Math.max(1, Number(settings.epg_refresh_hours) || 12) * 3600;
    const due = await db('epg_sources').where({ enabled: true })
      .where((w) => w.whereNull('last_fetch_at').orWhere('last_fetch_at', '<', now() - every)).first();
    if (!due) return;
    running = true;
    try {
      await refreshAll();
    } catch (err) {
      console.error('Actualización de EPG fallida:', err.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => tick().catch(() => {}), 10 * 60_000);
  timer.unref();
  setTimeout(() => tick().catch(() => {}), 60_000).unref();
  return () => clearInterval(timer);
}
