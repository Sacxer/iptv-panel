// Vinculación en lote de clientes de la plataforma externa (WispHub) con clientes IPTV,
// creando opcionalmente las cuentas IPTV que no existan.
import { db, insertId, whereSearch } from '../db/index.js';
import { logAction } from '../lib/log.js';
import { getSettings } from '../lib/settings.js';
import {
  HttpError, addDuration, bool, idList, int, now, oneOf, randomString,
} from '../lib/util.js';
import { mapStatus, representativeService } from './billingSync.js';

const normalizeText = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const PASSWORD_RE = /^[A-Za-z0-9._@!#$*-]{3,128}$/;
const MATCH_METHODS = ['document', 'email', 'phone', 'username'];

const keyOf = {
  document: (x) => digits(x.document_id),
  email: (x) => normalizeText(x.email),
  phone: (x) => {
    const d = digits(x.phone).slice(-10);
    return d.length >= 7 ? d : '';
  },
  username: (x) => normalizeText(x.username),
};

/** Índices de clientes IPTV aún no vinculados; un valor null marca coincidencia ambigua. */
async function buildUserIndex(provider) {
  const linked = new Set(await db('external_clients').where({ provider }).whereNotNull('user_id').pluck('user_id'));
  const users = await db('users').select('id', 'username', 'email', 'phone', 'document_id', 'external_id', 'suspended', 'suspension_source');
  const index = Object.fromEntries(MATCH_METHODS.map((m) => [m, new Map()]));
  const byExternalId = new Map();
  for (const u of users) {
    const docKey = keyOf.document(u);
    // Por cédula se incluyen también cuentas ya vinculadas: la misma persona puede tener varios servicios.
    if (docKey) index.document.set(docKey, index.document.has(docKey) ? null : u);
    if (linked.has(u.id)) continue;
    if (u.external_id) byExternalId.set(String(u.external_id), u);
    for (const m of MATCH_METHODS.filter((x) => x !== 'document')) {
      const key = keyOf[m](u);
      if (key) index[m].set(key, index[m].has(key) ? null : u);
    }
  }
  return { index, byExternalId, used: new Set() };
}

function findMatch(ext, methods, idx) {
  const direct = idx.byExternalId.get(String(ext.external_id));
  if (direct && !idx.used.has(direct.id)) return { user: direct, method: 'external_id' };
  let ambiguous = false;
  for (const m of methods) {
    const key = keyOf[m](ext);
    if (!key || !idx.index[m].has(key)) continue;
    const user = idx.index[m].get(key);
    if (user === null) {
      ambiguous = true;
      continue;
    }
    if (m === 'document' || !idx.used.has(user.id)) return { user, method: m };
  }
  return { user: null, ambiguous };
}

function usernameFor(ext, from) {
  const source = {
    usuario: ext.username,
    cedula: digits(ext.document_id),
    email: String(ext.email || '').split('@')[0],
    id: `wh${ext.external_id}`,
  }[from] ?? ext.username;
  let base = String(source || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._@-]+/g, '.').replace(/^[.\-@]+|[.\-@]+$/g, '').slice(0, 60);
  if (base.length < 3) base = `wh${ext.external_id}`.replace(/[^A-Za-z0-9._@-]+/g, '');
  return base;
}

async function uniqueUsername(base, planned, conn) {
  let candidate = base;
  for (let n = 2; ; n++) {
    if (!planned.has(candidate.toLowerCase()) && !(await conn('users').whereRaw('lower(username) = ?', [candidate.toLowerCase()]).first())) {
      planned.add(candidate.toLowerCase());
      return candidate;
    }
    candidate = `${base}-${n}`;
  }
}

function passwordFor(ext, mode, fixed) {
  if (mode === 'fixed') return fixed;
  if (mode === 'cedula') {
    const d = digits(ext.document_id);
    return d.length >= 4 ? d : randomString(8);
  }
  return randomString(8);
}

/** Estado IPTV que corresponde al estado externo (solo campos a cambiar). */
function statusPatch(ext, config, reason) {
  const mapped = mapStatus(ext.status, config);
  const desired = mapped === 'free' ? 'active' : mapped;
  if (desired === 'suspended') return { suspended: true, suspension_reason: reason, suspension_source: 'external', enabled: true };
  if (desired === 'disabled') return { enabled: false, suspended: false, suspension_reason: null, suspension_source: 'external' };
  if (desired === 'active') return { enabled: true, suspended: false, suspension_reason: null, suspension_source: null };
  return {};
}

/**
 * options: {
 *   status: 'all'|'active'|'suspended'|'disabled'|'unknown', ids?, search?, plan_contains?,
 *   match_by?, create_missing?, apply_status?, dry_run?,
 *   create: { username_from: 'usuario'|'cedula'|'email'|'id', password_mode: 'random'|'cedula'|'fixed', password?,
 *             package_ids?, max_connections?, duration?: {amount, unit} | null }
 * }
 */
export async function bulkLink(options = {}, admin = null) {
  const settings = await getSettings();
  const config = settings.billing_integration;
  const provider = config.provider;
  const status = oneOf(options.status || 'all', ['all', 'free', 'active', 'suspended', 'disabled', 'unknown'], 'status');
  const methods = (Array.isArray(options.match_by) ? options.match_by : config.match_by || []).filter((m) => MATCH_METHODS.includes(m));
  const dryRun = bool(options.dry_run);
  const createMissing = bool(options.create_missing);
  const applyStatus = bool(options.apply_status);
  const create = options.create || {};
  // Por defecto usuario y contraseña = cédula (solo dígitos).
  const usernameFrom = oneOf(create.username_from || 'cedula', ['usuario', 'cedula', 'email', 'id'], 'create.username_from');
  const passwordMode = oneOf(create.password_mode || 'cedula', ['random', 'cedula', 'fixed'], 'create.password_mode');
  if (createMissing && passwordMode === 'fixed' && !PASSWORD_RE.test(String(create.password || ''))) {
    throw new HttpError(400, 'La contraseña fija debe tener 3-128 caracteres sin espacios ni / ? & %');
  }
  const packageIds = idList(create.package_ids);
  if (packageIds.length) {
    const found = await db('packages').whereIn('id', packageIds).pluck('id');
    if (found.length !== packageIds.length) throw new HttpError(400, 'Algún paquete no existe');
  }
  const maxConnections = Math.max(0, Math.min(100, int(create.max_connections, 1)));
  const duration = create.duration && int(create.duration.amount, 0) > 0
    ? { amount: int(create.duration.amount), unit: oneOf(create.duration.unit, ['days', 'months', 'years'], 'create.duration.unit') }
    : null;

  const q = db('external_clients').where({ provider }).whereNull('user_id');
  const ids = idList(options.ids);
  if (ids.length) q.whereIn('id', ids);
  whereSearch(q, ['name', 'document_id', 'username', 'email', 'phone', 'external_id'], options.search);
  let rows = await q.orderBy('name');
  if (status !== 'all') rows = rows.filter((r) => mapStatus(r.status, config) === status);
  if (options.plan_contains) {
    const needle = normalizeText(options.plan_contains);
    rows = rows.filter((r) => normalizeText(r.plan).includes(needle));
  }

  const idx = await buildUserIndex(provider);
  const plannedUsernames = new Set();
  const t = now();
  const reason = config.suspension_reason || 'Servicio suspendido por falta de pago';
  const summary = {
    dry_run: dryRun, selected: rows.length, linked: 0, created: 0, grouped: 0, no_match: 0, ambiguous: 0,
    status_applied: { free: 0, active: 0, suspended: 0, disabled: 0 },
  };
  const items = [];
  const credentials = [];
  const createdByDocument = new Map(); // cédula → { key, userId, username } de cuentas creadas en esta ejecución
  const accounts = new Map(); // clave de cuenta → { userId, user, username, services: [ext], items: [item] }
  const track = (key, data, ext, item) => {
    if (!accounts.has(key)) accounts.set(key, { ...data, services: [], items: [] });
    accounts.get(key).services.push(ext);
    accounts.get(key).items.push(item);
  };

  const run = async (trx) => {
    for (const ext of rows) {
      const item = { external_id: ext.external_id, name: ext.name, external_status: ext.status, action: null, username: null };
      const docKey = keyOf.document(ext);
      const sameRun = docKey ? createdByDocument.get(docKey) : null;
      const match = sameRun ? { user: null } : findMatch(ext, methods, idx);
      let userId = null;

      if (sameRun) {
        // Otro servicio de una persona a la que ya se le creó cuenta en esta misma ejecución.
        userId = sameRun.userId;
        item.action = 'link';
        item.method = 'same_document';
        item.username = sameRun.username;
        summary.grouped++;
        if (!dryRun) await trx('external_clients').where({ id: ext.id }).update({ user_id: userId, link_method: 'document' });
        track(sameRun.key, { userId, username: sameRun.username }, ext, item);
      } else if (match.user) {
        idx.used.add(match.user.id);
        userId = match.user.id;
        item.action = 'link';
        item.username = match.user.username;
        item.method = match.method;
        summary.linked++;
        if (!dryRun) {
          await trx('external_clients').where({ id: ext.id }).update({ user_id: userId, link_method: match.method === 'external_id' ? 'manual' : match.method });
          await trx('users').where({ id: userId }).whereNull('external_id').update({ external_id: ext.external_id, updated_at: t });
        }
        track(`u${userId}`, { userId, user: match.user, username: match.user.username }, ext, item);
      } else if (createMissing) {
        const username = await uniqueUsername(usernameFor(ext, usernameFrom), plannedUsernames, trx);
        item.action = 'create';
        item.username = username;
        summary.created++;
        const accountKey = `new:${username}`;
        if (!dryRun) {
          const password = passwordFor(ext, passwordMode, create.password);
          const passwordSource = passwordMode === 'cedula' && password !== digits(ext.document_id) ? 'random' : passwordMode;
          userId = await insertId(trx, 'users', {
            username,
            password,
            full_name: (ext.name || '').slice(0, 255) || null,
            email: (ext.email || '').slice(0, 255) || null,
            phone: (ext.phone || '').slice(0, 64) || null,
            document_id: digits(ext.document_id).slice(0, 64) || null,
            exp_date: duration ? addDuration(t, duration.amount, duration.unit) : null,
            max_connections: maxConnections,
            enabled: true,
            suspended: false,
            is_trial: false,
            notes: `Creado desde ${provider} (servicio ${ext.external_id})`,
            owner_id: admin?.id ?? null,
            source: 'local',
            external_id: ext.external_id,
            external_status: ext.status,
            external_synced_at: t,
            created_at: t,
            updated_at: t,
          });
          if (packageIds.length) await trx('user_packages').insert(packageIds.map((package_id) => ({ user_id: userId, package_id })));
          await trx('external_clients').where({ id: ext.id }).update({ user_id: userId, link_method: 'created' });
          credentials.push({ username, password, password_source: passwordSource, name: ext.name || '', external_id: ext.external_id });
        }
        if (docKey && docKey.length >= 3) createdByDocument.set(docKey, { key: accountKey, userId, username });
        track(accountKey, { userId, username }, ext, item);
      } else {
        item.action = match.ambiguous ? 'ambiguous' : 'no_match';
        summary[item.action]++;
      }

      items.push(item);
    }

    // Estado por cuenta, considerando TODOS los servicios de la persona: los de esta ejecución, los ya vinculados
    // y los de la misma cédula aún sin sincronizar (no se suspende a quien tiene otro servicio activo o gratis).
    if (applyStatus) {
      const byDocument = new Map();
      for (const e of await trx('external_clients').where({ provider })) {
        const key = keyOf.document(e);
        if (key.length < 3) continue;
        if (!byDocument.has(key)) byDocument.set(key, []);
        byDocument.get(key).push(e);
      }
      for (const account of accounts.values()) {
        const seen = new Set(account.services.map((s) => s.id));
        let services = [...account.services];
        const add = (list) => {
          for (const e of list) if (!seen.has(e.id)) { seen.add(e.id); services.push(e); }
        };
        if (account.userId) add(await trx('external_clients').where({ provider, user_id: account.userId }));
        for (const s of account.services) add(byDocument.get(keyOf.document(s)) || []);
        services = services.filter(Boolean);
        const rep = representativeService(services, config);
        const desired = mapStatus(rep.status, config);
        const patch = statusPatch(rep, config, reason);
        const manualCut = account.user && bool(account.user.suspended) && account.user.suspension_source === 'manual';
        if ((desired === 'active' || desired === 'free') && manualCut) {
          for (const it of account.items) it.status_skipped = 'corte manual';
          continue;
        }
        if (!Object.keys(patch).length) continue;
        summary.status_applied[desired]++;
        for (const it of account.items) it.status_applied = desired;
        if (!dryRun && account.userId) {
          await trx('users').where({ id: account.userId })
            .update({ ...patch, external_status: String(rep.status || '').slice(0, 64), external_synced_at: t, updated_at: t });
          if (desired !== 'active' && desired !== 'free') await trx('connections').where({ user_id: account.userId }).del();
        }
      }
    }
  };

  if (dryRun) await run(db);
  else await db.transaction(run);

  if (!dryRun) {
    await logAction(admin, 'billing.bulk_link', 'integration', null, {
      status, plan_contains: options.plan_contains || undefined, linked: summary.linked, created: summary.created,
      status_applied: summary.status_applied,
    });
  }
  summary.accounts = accounts.size;
  return { ...summary, items: items.slice(0, 1000), credentials };
}
