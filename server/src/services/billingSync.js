// Sincronización de cortes con plataformas de facturación externas (WispHub u otras con API JSON).
//
// Reglas:
//  - Solo se tocan clientes IPTV vinculados a un cliente externo (por ID externo o coincidencia de datos).
//  - Estado externo "suspendido" → se suspende el cliente IPTV (suspension_source = 'external').
//  - Estado externo "cancelado"  → se deshabilita el cliente IPTV.
//  - Estado externo "activo"     → se reactiva SOLO si la suspensión la hizo la plataforma externa:
//    un corte hecho a mano desde el portal nunca se levanta automáticamente.
//  - Estado externo "gratis"     → nunca se corta (se trata como activo y tiene prioridad sobre los demás).
//  - Una persona (misma cédula) con varios servicios tiene UNA cuenta IPTV: está activa si algún servicio
//    es gratis o activo; suspendida si ninguno lo es y alguno está suspendido; deshabilitada si todos están cancelados.
import crypto from 'node:crypto';
import { db, insertId } from '../db/index.js';
import { logAction } from '../lib/log.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { HttpError, bool, chunk, now } from '../lib/util.js';

export const WISPHUB_PRESET = {
  provider: 'wisphub',
  base_url: 'https://api.wisphub.net/api',
  list_path: '/clientes/',
  auth_header: 'Authorization',
  auth_prefix: 'Api-Key ',
  page_size: 300,
  results_path: 'results',
  fields: {
    id: 'id_servicio', status: 'estado', document: 'cedula', username: 'usuario',
    name: 'nombre', email: 'email', phone: 'telefono', plan: 'plan_internet.nombre',
  },
  status_map: { free: ['Gratis'], active: ['Activo'], suspended: ['Suspendido', 'Cortado'], disabled: ['Cancelado', 'Retirado'] },
};

const normalizeText = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const digits = (v) => String(v ?? '').replace(/\D/g, '');

function getPath(obj, path) {
  if (!path) return obj;
  return String(path).split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), obj);
}

function scalar(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return v.nombre ?? v.name ?? v.id ?? JSON.stringify(v);
  return String(v).trim();
}

export function normalizeRecord(raw, config) {
  const f = config.fields || {};
  const pick = (key, ...fallbacks) => {
    for (const path of [f[key], ...fallbacks]) {
      const v = path ? getPath(raw, path) : undefined;
      if (v !== undefined && v !== null && v !== '') return scalar(v);
    }
    return '';
  };
  return {
    external_id: pick('id', 'external_id', 'id'),
    status: pick('status', 'status', 'estado'),
    document_id: pick('document', 'document', 'cedula'),
    username: pick('username', 'username', 'usuario'),
    name: pick('name', 'name', 'nombre'),
    email: pick('email', 'email'),
    phone: pick('phone', 'phone', 'telefono'),
    plan: pick('plan', 'plan'),
  };
}

/** Servicio que manda sobre el estado de una cuenta con varios servicios: activo > suspendido > cancelado > desconocido. */
export function representativeService(services, config) {
  for (const wanted of ['free', 'active', 'suspended', 'disabled', 'unknown']) {
    const hit = services.find((s) => mapStatus(s.status, config) === wanted);
    if (hit) return hit;
  }
  return services[0];
}

/** Traduce el estado externo a free | active | suspended | disabled | unknown. */
export function mapStatus(status, config) {
  const value = normalizeText(status);
  if (!value) return 'unknown';
  // "free" primero: configuraciones antiguas tenían "Gratis" también en la lista de activos.
  for (const key of ['free', 'suspended', 'disabled', 'active']) {
    if ((config.status_map?.[key] || []).some((s) => normalizeText(s) === value)) return key;
  }
  return 'unknown';
}

function requestHeaders(config) {
  const headers = { Accept: 'application/json', 'User-Agent': 'IPTV-Portal/1.0' };
  if (config.api_key) headers[config.auth_header || 'Authorization'] = `${config.auth_prefix ?? ''}${config.api_key}`;
  return headers;
}

class NotJsonError extends HttpError {}

async function fetchJson(url, config) {
  const shown = url.split('?')[0];
  let res;
  try {
    res = await fetch(url, { headers: requestHeaders(config), signal: AbortSignal.timeout(30000) });
  } catch (err) {
    const code = err.cause?.code || err.name;
    const why = code === 'ENOTFOUND' ? 'el dominio no existe' : code === 'TimeoutError' ? 'no respondió en 30 s' : code || err.message;
    throw new HttpError(502, `No se pudo conectar con ${shown}: ${why}`);
  }
  const type = res.headers.get('content-type') || '';
  let body = null;
  if (type.includes('json')) body = await res.json().catch(() => null);
  else await res.body?.cancel().catch(() => {});
  const detail = body && typeof body === 'object' && body.detail ? ` (${body.detail})` : '';
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(400, `La plataforma rechazó la consulta (HTTP ${res.status})${detail}. Revisa que la API Key sea correcta`
      + ' y que el usuario que la generó tenga el permiso "Lista de clientes".');
  }
  if (res.status === 404) throw new NotJsonError(502, `No existe ${shown} (HTTP 404). Revisa la URL de consulta y la ruta de la lista.`);
  if (!res.ok) throw new HttpError(502, `La plataforma respondió HTTP ${res.status} en ${shown}${detail}`);
  if (body === null) {
    throw new NotJsonError(502, `${shown} respondió una página web (${type || 'sin tipo'}), no datos JSON. Revisa la URL de consulta de la API.`);
  }
  return body;
}

/** URL base candidata(s): WispHub publica la API bajo /api (https://api.wisphub.io/api). */
export function baseCandidates(config) {
  const base = String(config.base_url || '').trim().replace(/\/+$/, '');
  const list = [base];
  if (!/\/api$/i.test(base)) list.push(`${base}/api`);
  return list;
}

function buildUrl(base, config, offset, limit) {
  const path = String(config.list_path || '').replace(/^\/?/, '/');
  const url = new URL(base + path);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  return url.toString();
}

/** Primera página probando las URL base candidatas; devuelve la base que funcionó. */
async function resolveBase(config, limit) {
  let lastError = null;
  for (const base of baseCandidates(config)) {
    try {
      return { base, data: await fetchJson(buildUrl(base, config, 0, limit), config) };
    } catch (err) {
      lastError = err;
      if (!(err instanceof NotJsonError)) throw err; // credenciales o red: no tiene sentido probar otra ruta
    }
  }
  throw lastError;
}

/** Descarga todos los clientes externos (paginación limit/offset o lista completa). */
export async function fetchExternalClients(config, { maxPages = 1000, onlyFirstPage = false } = {}) {
  if (!config.base_url) throw new HttpError(400, 'Configura la URL de consulta de la API');
  if (!/^https?:\/\//i.test(config.base_url)) throw new HttpError(400, 'La URL de consulta debe empezar por https://');
  const limit = Math.max(1, Math.min(1000, Number(config.page_size) || 300));
  const all = [];
  let firstRaw = null;
  const resolved = await resolveBase(config, limit);
  for (let page = 0; page < maxPages; page++) {
    const data = page === 0 ? resolved.data : await fetchJson(buildUrl(resolved.base, config, page * limit, limit), config);
    const items = Array.isArray(data) ? data : getPath(data, config.results_path || 'results');
    if (!Array.isArray(items)) {
      throw new HttpError(502, `No se encontró la lista de clientes en la respuesta (ruta "${config.results_path}")`);
    }
    if (!firstRaw && items.length) [firstRaw] = items;
    all.push(...items);
    const total = Array.isArray(data) ? null : Number(data.count);
    if (onlyFirstPage || Array.isArray(data) || items.length < limit || (total && all.length >= total) || (!data.next && !total)) {
      return { records: all, firstRaw, total: total || all.length, base_url: resolved.base };
    }
  }
  return { records: all, firstRaw, total: all.length, base_url: resolved.base };
}

/** Si la URL que funcionó es distinta de la guardada (p. ej. faltaba /api), se corrige en Ajustes. */
async function rememberBase(config, baseUrl) {
  const saved = (await getSettings()).billing_integration;
  if (baseUrl && saved.base_url && saved.base_url.replace(/\/+$/, '') === String(config.base_url).replace(/\/+$/, '') && saved.base_url !== baseUrl) {
    await saveSettings({ billing_integration: { base_url: baseUrl } });
  }
}

export async function testConnection(config) {
  const { records, firstRaw, total, base_url: baseUrl } = await fetchExternalClients(config, { onlyFirstPage: true });
  const corrected = baseUrl !== String(config.base_url).trim().replace(/\/+$/, '') ? baseUrl : null;
  if (corrected) await rememberBase(config, corrected);
  const sample = records.slice(0, 5).map((r) => normalizeRecord(r, config));
  const statuses = [...new Set(records.map((r) => normalizeRecord(r, config).status).filter(Boolean))];
  return {
    ok: true,
    total,
    base_url: baseUrl,
    base_url_corrected: corrected,
    sample,
    raw_keys: firstRaw ? Object.keys(firstRaw) : [],
    status_values: statuses.map((s) => ({ value: s, maps_to: mapStatus(s, config) })),
    missing_fields: firstRaw
      ? Object.entries(config.fields || {}).filter(([, path]) => path && getPath(firstRaw, path) === undefined).map(([k, path]) => ({ field: k, path }))
      : [],
  };
}

/* ------------------------------------ Sincronización ------------------------------------ */

let running = false;
export const isSyncRunning = () => running;

/** Quita contraseñas, claves y tokens del registro externo antes de guardarlo (WispHub envía las del CPE, router y wifi). */
export function sanitizeRaw(record) {
  const SENSITIVE = /pass|clave|secret|token|api[_-]?key|pin|ssid/i;
  const clean = (value, depth = 0) => {
    if (Array.isArray(value)) return depth > 3 ? [] : value.map((v) => clean(v, depth + 1));
    if (value && typeof value === 'object') {
      if (depth > 3) return {};
      return Object.fromEntries(Object.entries(value).filter(([k]) => !SENSITIVE.test(k)).map(([k, v]) => [k, clean(v, depth + 1)]));
    }
    return value;
  };
  return clean(record);
}

async function upsertExternal(provider, normalized, rawRecords, t) {
  const existing = new Map((await db('external_clients').where({ provider }).select('id', 'external_id', 'user_id', 'link_method'))
    .map((r) => [r.external_id, r]));
  const rows = [];
  normalized.forEach((n, i) => {
    if (!n.external_id) return;
    const raw = JSON.stringify(sanitizeRaw(rawRecords[i])).slice(0, 4000);
    rows.push({ n, raw, prev: existing.get(n.external_id) });
  });
  await db.transaction(async (trx) => {
    for (const part of chunk(rows, 200)) {
      for (const { n, raw, prev } of part) {
        const data = {
          name: n.name.slice(0, 255), document_id: n.document_id.slice(0, 64), username: n.username.slice(0, 128),
          email: n.email.slice(0, 255), phone: n.phone.slice(0, 64), status: n.status.slice(0, 64), plan: n.plan.slice(0, 255),
          raw, synced_at: t,
        };
        if (prev) await trx('external_clients').where({ id: prev.id }).update(data);
        else await trx('external_clients').insert({ provider, external_id: n.external_id.slice(0, 128), ...data });
      }
    }
  });
}

/**
 * Vincula automáticamente clientes externos sin vínculo con clientes IPTV (coincidencia única).
 * En simulación no escribe nada y devuelve los vínculos propuestos.
 */
async function autoLink(provider, config, { dryRun = false } = {}) {
  const methods = (config.match_by || []).filter((m) => ['document', 'email', 'phone', 'username'].includes(m));
  const unlinked = await db('external_clients').where({ provider }).whereNull('user_id');
  const proposed = new Map(); // id de external_clients → { user_id, method }
  if (!unlinked.length) return { count: 0, proposed };
  const users = await db('users').select('id', 'username', 'email', 'phone', 'document_id', 'external_id');
  const linkedUserIds = new Set(await db('external_clients').where({ provider }).whereNotNull('user_id').pluck('user_id'));
  const byExternalId = new Map(users.filter((u) => u.external_id).map((u) => [u.external_id, u]));
  const index = { document: new Map(), email: new Map(), phone: new Map(), username: new Map() };
  const add = (map, key, u) => {
    if (!key) return;
    map.set(key, map.has(key) ? null : u); // null = ambiguo
  };
  for (const u of users) {
    add(index.document, digits(u.document_id), u); // por cédula: una cuenta puede tener varios servicios
    if (linkedUserIds.has(u.id)) continue;
    add(index.email, normalizeText(u.email), u);
    add(index.phone, digits(u.phone).slice(-10), u);
    add(index.username, normalizeText(u.username), u);
  }
  const keyOf = {
    document: (e) => digits(e.document_id), email: (e) => normalizeText(e.email),
    phone: (e) => digits(e.phone).slice(-10), username: (e) => normalizeText(e.username),
  };
  let linked = 0;
  for (const e of unlinked) {
    let user = byExternalId.get(e.external_id);
    let method = 'manual';
    if (!user && bool(config.auto_link)) {
      for (const m of methods) {
        const key = keyOf[m](e);
        if (key && (m !== 'phone' || key.length >= 7)) {
          const candidate = index[m].get(key);
          // Por email/teléfono/usuario solo cuentas sin vincular; por cédula también las que ya tienen servicios.
          if (candidate && (m === 'document' || !linkedUserIds.has(candidate.id))) {
            user = candidate;
            method = m;
            break;
          }
        }
      }
    }
    if (!user) continue;
    linkedUserIds.add(user.id);
    proposed.set(e.id, { user_id: user.id, method });
    if (!dryRun) {
      await db('external_clients').where({ id: e.id }).update({ user_id: user.id, link_method: method });
      await db('users').where({ id: user.id }).whereNull('external_id').update({ external_id: e.external_id });
    }
    linked++;
  }
  return { count: linked, proposed };
}

/** Decide y (si no es simulación) aplica los cambios de estado de un cliente vinculado. */
export async function applyStatus(user, external, config, { dryRun, t, suspensionReason, services = 1 }) {
  const mapped = mapStatus(external.status, config);
  // Un servicio gratis no se corta: para la decisión cuenta como activo.
  const desired = mapped === 'free' ? 'active' : mapped;
  const change = {
    user_id: user.id, username: user.username, external_id: external.external_id,
    external_name: external.name, external_status: external.status, services, action: null,
  };
  const patch = { external_status: String(external.status || '').slice(0, 64), external_synced_at: t };
  const suspended = bool(user.suspended);
  const enabled = bool(user.enabled);

  if (desired === 'suspended' && !suspended) {
    Object.assign(patch, { suspended: true, suspension_reason: suspensionReason, suspension_source: 'external' });
    change.action = 'suspend';
  } else if (desired === 'disabled' && enabled) {
    Object.assign(patch, { enabled: false, suspension_source: 'external' });
    change.action = 'disable';
  } else if (desired === 'active' && bool(config.reactivate) && user.suspension_source === 'external' && (suspended || !enabled)) {
    Object.assign(patch, { suspended: false, suspension_reason: null, enabled: true, suspension_source: null });
    change.action = 'reactivate';
  } else if (desired === 'active' && suspended && user.suspension_source !== 'external') {
    change.action = 'skip_manual'; // suspendido a mano en el portal: no se reactiva automáticamente
  } else if (desired === 'unknown') {
    change.action = 'unknown_status';
  }

  if (!dryRun) {
    await db('users').where({ id: user.id }).update({ ...patch, ...(change.action && !['skip_manual', 'unknown_status'].includes(change.action) ? { updated_at: t } : {}) });
    if (change.action === 'suspend' || change.action === 'disable') await db('connections').where({ user_id: user.id }).del();
  }
  return change;
}

/**
 * Sincroniza con la plataforma. scope "suspended": solo revisa las cuentas que hoy están cortadas
 * (para reactivar al instante a quien ya pagó) y no crea vínculos nuevos.
 */
export async function runBillingSync({
  trigger = 'manual', dryRun = false, admin = null, scope = 'all',
} = {}) {
  const settings = await getSettings();
  const config = settings.billing_integration;
  if (!config.base_url || !config.api_key) throw new HttpError(400, 'Configura la URL y la API Key de la plataforma externa');
  if (running) throw new HttpError(409, 'Ya hay una sincronización en curso');
  running = true;
  const t = now();
  const runId = await insertId(db, 'integration_runs', {
    provider: config.provider, trigger: dryRun ? 'dry_run' : trigger, status: 'running', started_at: t,
  });
  const stats = {
    fetched: 0, linked_now: 0, linked_total: 0, suspended: 0, disabled: 0, reactivated: 0,
    skipped_manual: 0, unknown_status: 0, unchanged: 0, unlinked_external: 0,
  };
  const changes = [];
  try {
    const { records, base_url: baseUrl } = await fetchExternalClients(config);
    await rememberBase(config, baseUrl);
    const normalized = records.map((r) => normalizeRecord(r, config));
    stats.fetched = normalized.length;
    // La copia local de los clientes externos se refresca siempre; los vínculos solo se guardan si no es simulación.
    await upsertExternal(config.provider, normalized, records, t);
    const { count: linkedNow, proposed } = scope === 'suspended'
      ? { count: 0, proposed: new Map() }
      : await autoLink(config.provider, config, { dryRun });
    stats.linked_now = linkedNow;

    const allExternal = await db('external_clients').where({ provider: config.provider });
    const linked = allExternal
      .map((e) => (e.user_id ? e : proposed.has(e.id) ? { ...e, user_id: proposed.get(e.id).user_id, proposed: true } : null))
      .filter(Boolean);
    stats.linked_total = linked.length;
    stats.unlinked_external = allExternal.length - linked.length;
    const byUser = new Map();
    for (const ext of linked) {
      if (!byUser.has(ext.user_id)) byUser.set(ext.user_id, []);
      byUser.get(ext.user_id).push(ext);
    }
    stats.accounts = byUser.size;
    const users = new Map((await db('users').whereIn('id', [...byUser.keys()])).map((u) => [u.id, u]));
    const suspensionReason = config.suspension_reason || 'Servicio suspendido por falta de pago';
    const applyChanges = !dryRun && settings.cut_mode !== 'manual';

    // Servicios de la misma cédula aún sin vincular también cuentan para decidir el estado de la cuenta.
    const byDocument = new Map();
    for (const e of allExternal) {
      const key = digits(e.document_id);
      if (key.length < 3) continue;
      if (!byDocument.has(key)) byDocument.set(key, []);
      byDocument.get(key).push(e);
    }

    stats.checked = 0;
    for (const [userId, linkedServices] of byUser) {
      const user = users.get(userId);
      if (!user) continue;
      if (scope === 'suspended' && !bool(user.suspended) && bool(user.enabled)) continue;
      stats.checked++;
      const ids = new Set(linkedServices.map((x) => x.id));
      const extra = linkedServices.flatMap((x) => byDocument.get(digits(x.document_id)) || []).filter((x) => !ids.has(x.id) && ids.add(x.id));
      const services = [...linkedServices, ...extra];
      const ext = representativeService(services, config);
      const change = await applyStatus(user, ext, config, { dryRun: !applyChanges, t, suspensionReason, services: services.length });
      if (services.some((s) => s.proposed)) change.new_link = true;
      const counter = {
        suspend: 'suspended', disable: 'disabled', reactivate: 'reactivated', skip_manual: 'skipped_manual', unknown_status: 'unknown_status',
      }[change.action] || 'unchanged';
      stats[counter]++;
      if (change.action) changes.push(change);
    }
    const status = 'done';
    stats.scope = scope;
    await db('integration_runs').where({ id: runId }).update({
      status, stats: JSON.stringify({ ...stats, applied: applyChanges }), changes: JSON.stringify(changes.slice(0, 2000)), finished_at: now(),
    });
    if (applyChanges && (stats.suspended || stats.disabled || stats.reactivated)) {
      await logAction(admin, 'billing.sync', 'integration', runId, { ...stats, trigger });
    }
    return { id: runId, status, trigger: dryRun ? 'dry_run' : trigger, stats: { ...stats, applied: applyChanges }, changes, started_at: t, finished_at: now() };
  } catch (err) {
    await db('integration_runs').where({ id: runId }).update({ status: 'error', error: err.message, stats: JSON.stringify(stats), finished_at: now() });
    throw err;
  } finally {
    running = false;
  }
}

/** Notificación entrante (webhook) de la plataforma externa para un cliente. */
/**
 * Actualiza solo los datos que trae la respuesta. El detalle de WispHub (/clientes/{id}/) trae estado y plan,
 * pero no nombre, cédula ni teléfono: no hay que borrarlos.
 */
async function mergeExternal(provider, normalized, rawRecords, t) {
  for (const [i, n] of normalized.entries()) {
    if (!n.external_id) continue;
    const prev = await db('external_clients').where({ provider, external_id: n.external_id }).first();
    const data = { synced_at: t };
    const fields = {
      name: [n.name, 255], document_id: [n.document_id, 64], username: [n.username, 128],
      email: [n.email, 255], phone: [n.phone, 64], status: [n.status, 64], plan: [n.plan, 255],
    };
    for (const [key, [value, max]] of Object.entries(fields)) if (value) data[key] = value.slice(0, max);
    if (prev) await db('external_clients').where({ id: prev.id }).update(data);
    else {
      await db('external_clients').insert({
        provider, external_id: n.external_id.slice(0, 128), raw: JSON.stringify(sanitizeRaw(rawRecords[i])).slice(0, 4000), ...data,
      });
    }
  }
}

/** Trae de la plataforma solo los servicios indicados: endpoint de detalle o, si no existe, la lista completa. */
async function fetchServices(config, ids) {
  const base = String(config.base_url || '').trim().replace(/\/+$/, '');
  const listPath = String(config.list_path || '/clientes/').replace(/^\/?/, '/').replace(/\/?$/, '/');
  const records = [];
  try {
    for (const id of ids) {
      const data = await fetchJson(`${base}${listPath}${encodeURIComponent(id)}/`, config);
      const items = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [data];
      records.push(...items.filter((r) => r && typeof r === 'object'));
    }
    return { records, method: 'detail' };
  } catch (err) {
    if (!(err instanceof NotJsonError)) throw err;
  }
  const wanted = new Set(ids.map(String));
  const { records: all } = await fetchExternalClients(config);
  return { records: all.filter((r) => wanted.has(normalizeRecord(r, config).external_id)), method: 'list' };
}

/** Consulta ya mismo los servicios de un cliente en la plataforma y aplica su estado (p. ej. acaba de pagar). */
export async function refreshUserFromPlatform(userId, { admin = null } = {}) {
  const settings = await getSettings();
  const config = settings.billing_integration;
  if (!config.base_url || !config.api_key) throw new HttpError(400, 'Configura la URL y la API Key de la plataforma externa');
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw new HttpError(404, 'Cliente no encontrado');
  const { provider } = config;

  const linked = await db('external_clients').where({ provider, user_id: user.id });
  const docs = new Set(linked.map((s) => digits(s.document_id)).filter((d) => d.length >= 3));
  const sameDocument = docs.size
    ? (await db('external_clients').where({ provider }).whereNull('user_id')).filter((e) => docs.has(digits(e.document_id)))
    : [];
  const ids = [...new Set([...linked, ...sameDocument].map((s) => s.external_id).concat(user.external_id ? [user.external_id] : []))];
  if (!ids.length) throw new HttpError(400, 'Este cliente no está vinculado a la plataforma externa');

  const t = now();
  const { records, method } = await fetchServices(config, ids);
  const normalized = records.map((r) => normalizeRecord(r, config));
  if (method === 'list') await upsertExternal(provider, normalized, records, t);
  else await mergeExternal(provider, normalized, records, t);
  if (user.external_id) {
    await db('external_clients').where({ provider, external_id: user.external_id }).whereNull('user_id')
      .update({ user_id: user.id, link_method: 'manual' });
  }
  const found = new Set(normalized.map((n) => n.external_id));
  const pool = await db('external_clients').where({ provider }).whereIn('external_id', ids);
  const fresh = pool.filter((s) => found.has(s.external_id));
  if (!fresh.length) throw new HttpError(404, 'La plataforma no devolvió los servicios de este cliente (¿lo eliminaron allá?)');

  const applyChanges = settings.cut_mode !== 'manual';
  const change = await applyStatus(user, representativeService(fresh, config), config, {
    dryRun: !applyChanges, t, suspensionReason: config.suspension_reason || 'Servicio suspendido por falta de pago', services: fresh.length,
  });
  const counter = {
    suspend: 'suspended', disable: 'disabled', reactivate: 'reactivated', skip_manual: 'skipped_manual', unknown_status: 'unknown_status',
  }[change.action] || 'unchanged';
  await db('integration_runs').insert({
    provider, trigger: 'user_refresh', status: 'done', started_at: t, finished_at: now(),
    stats: JSON.stringify({ fetched: records.length, checked: 1, [counter]: 1, applied: applyChanges, scope: 'user' }),
    changes: JSON.stringify([change]),
  });
  if (applyChanges && change.action && !['skip_manual', 'unknown_status'].includes(change.action)) {
    await logAction(admin, `billing.refresh.${change.action}`, 'user', user.id, { username: user.username, status: change.external_status });
  }
  return {
    applied: applyChanges,
    method,
    change,
    services: fresh.map((s) => ({
      external_id: s.external_id, name: s.name || '', status: s.status || '', status_mapped: mapStatus(s.status, config), plan: s.plan || '',
    })),
    missing: ids.filter((id) => !found.has(id)),
  };
}

/** Próxima sincronización automática (unix) o null si está apagada. */
export async function autoSyncInfo() {
  const settings = await getSettings();
  const config = settings.billing_integration;
  const enabled = bool(config.enabled) && settings.cut_mode !== 'manual' && Boolean(config.api_key);
  const every = Math.max(1, Number(config.interval_minutes) || 15);
  const last = await db('integration_runs').where({ trigger: 'auto' }).orderBy('started_at', 'desc').first();
  const lastAt = last ? Number(last.started_at) : null;
  return {
    enabled,
    interval_minutes: every,
    running,
    last_run_at: lastAt,
    last_status: last?.status || null,
    next_run_at: enabled ? Math.max(now(), (lastAt || 0) + every * 60) : null,
  };
}

export async function handleWebhook(token, body) {
  const settings = await getSettings();
  const config = settings.billing_integration;
  const expected = config.webhook_token || '';
  const valid = expected && token && expected.length === token.length
    && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  if (!valid) throw new HttpError(401, 'Token inválido');
  if (!bool(config.enabled) || settings.cut_mode === 'manual') {
    return { ok: true, applied: false, reason: 'Integración desactivada o modo de cortes manual' };
  }
  const n = normalizeRecord(body || {}, config);
  if (!n.external_id && !n.document_id && !n.username) throw new HttpError(400, 'Envía external_id, document o username');
  if (!n.status) throw new HttpError(400, 'Envía el estado (status)');

  let user = null;
  if (n.external_id) {
    await db('external_clients').where({ provider: config.provider, external_id: n.external_id })
      .update({ status: n.status.slice(0, 64), synced_at: now() });
    const ext = await db('external_clients').where({ provider: config.provider, external_id: n.external_id }).whereNotNull('user_id').first();
    if (ext) user = await db('users').where({ id: ext.user_id }).first();
  }
  if (!user && n.external_id) user = await db('users').where({ external_id: n.external_id }).first();
  if (!user && n.document_id) {
    const matches = await db('users').where({ document_id: n.document_id });
    if (matches.length === 1) [user] = matches;
  }
  if (!user && n.username) user = await db('users').where({ username: n.username }).first();
  if (!user) return { ok: true, applied: false, reason: 'Cliente no vinculado' };

  const t = now();
  const services = await db('external_clients').where({ provider: config.provider, user_id: user.id });
  const incoming = { ...n, external_id: n.external_id || user.external_id };
  const pool = services.length
    ? services.map((s) => (s.external_id === incoming.external_id ? { ...s, status: incoming.status } : s))
    : [incoming];
  const change = await applyStatus(user, representativeService(pool, config), config, {
    dryRun: false, t, suspensionReason: config.suspension_reason, services: pool.length,
  });
  await db('integration_runs').insert({
    provider: config.provider, trigger: 'webhook', status: 'done',
    stats: JSON.stringify({ [change.action || 'unchanged']: 1 }), changes: JSON.stringify([change]), started_at: t, finished_at: t,
  });
  if (change.action && !['skip_manual', 'unknown_status'].includes(change.action)) {
    await logAction(null, `billing.webhook.${change.action}`, 'user', user.id, { username: user.username, status: n.status });
  }
  return { ok: true, applied: Boolean(change.action), action: change.action, username: user.username };
}

export async function regenerateWebhookToken() {
  const token = crypto.randomBytes(24).toString('hex');
  await saveSettings({ billing_integration: { webhook_token: token } });
  return token;
}

export function startBillingScheduler() {
  let last = 0; // por si la base no responde: evita reintentar cada minuto
  const tick = async () => {
    const settings = await getSettings().catch(() => null);
    const config = settings?.billing_integration;
    if (!config || !bool(config.enabled) || settings.cut_mode === 'manual' || !config.api_key || running) return;
    const every = Math.max(1, Number(config.interval_minutes) || 15) * 60;
    const lastAuto = await db('integration_runs').where({ trigger: 'auto' }).max({ t: 'started_at' }).first().catch(() => null);
    const lastAt = Math.max(last, Number(lastAuto?.t) || 0);
    if (now() - lastAt < every) return;
    last = now();
    await runBillingSync({ trigger: 'auto' }).catch((err) => console.error('Sincronización de cortes fallida:', err.message));
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  setTimeout(tick, 30_000).unref();
  return () => clearInterval(timer);
}
