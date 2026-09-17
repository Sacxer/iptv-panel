import { Router } from 'express';
import { db, whereSearch, insertId, BATCH_SIZE } from '../../db/index.js';
import { CONTENT_SECTIONS, parseSections } from '../../lib/access.js';
import { isReseller } from '../../lib/auth.js';
import { logAction } from '../../lib/log.js';
import { serializeUser, serializeUsers } from '../../lib/serialize.js';
import { getSettings } from '../../lib/settings.js';
import { deleteAutoDevicesOf } from '../../services/devices.js';
import { publicBaseUrl } from '../../services/network.js';
import {
  HttpError, addDuration, bool, chunk, idList, int, now, oneOf, paging, randomString,
} from '../../lib/util.js';

const router = Router();

/** Consulta base de usuarios visibles para el administrador actual. */
function visibleUsers(req) {
  const q = db('users');
  if (isReseller(req)) q.where('users.owner_id', req.admin.id);
  return q;
}

async function loadUser(req, id) {
  const user = await visibleUsers(req).where('users.id', int(id, 0)).first();
  if (!user) throw new HttpError(404, 'Usuario no encontrado');
  return user;
}

function applyStatusFilter(q, status) {
  const t = now();
  const notExpired = (w) => w.whereNull('exp_date').orWhere('exp_date', '>', t);
  switch (status) {
    case 'suspended':
      return q.where('suspended', true);
    case 'disabled':
      return q.where('suspended', false).where('enabled', false);
    case 'expired':
      return q.where('suspended', false).where('enabled', true).whereNotNull('exp_date').where('exp_date', '<=', t);
    case 'active':
      return q.where('suspended', false).where('enabled', true).where(notExpired);
    case 'expiring':
      return q.where('suspended', false).where('enabled', true)
        .where('exp_date', '>', t).where('exp_date', '<=', t + 7 * 86400);
    case 'trial':
      return q.where('is_trial', true);
    default:
      return q;
  }
}

async function setUserPackages(trx, userId, packageIds) {
  await trx('user_packages').where({ user_id: userId }).del();
  const ids = idList(packageIds);
  if (!ids.length) return;
  const existing = await trx('packages').whereIn('id', ids).pluck('id');
  for (const part of chunk(existing, BATCH_SIZE)) {
    await trx('user_packages').insert(part.map((package_id) => ({ user_id: userId, package_id })));
  }
}

/**
 * Secciones que ve el cliente: arreglo con "live", "movies", "series". Vacío o null = automático (según paquetes).
 */
function contentSectionsValue(value) {
  if (value === null || value === '') return null;
  const list = Array.isArray(value) ? value : String(value).split(',');
  const unknown = list.map((s) => String(s).trim()).filter((s) => s && !CONTENT_SECTIONS.includes(s));
  if (unknown.length) throw new HttpError(400, `Sección desconocida: ${unknown.join(', ')} (usa live, movies o series)`);
  const sections = parseSections(list);
  return sections ? sections.join(',') : null;
}

/** Valida y normaliza los campos editables de un usuario. */
async function userFields(req, body, { creating }) {
  const out = {};
  if (body.username !== undefined) {
    const username = String(body.username).trim();
    if (!/^[A-Za-z0-9._@-]{3,128}$/.test(username)) {
      throw new HttpError(400, 'El usuario debe tener 3-128 caracteres: letras, números, . _ @ -');
    }
    out.username = username;
  }
  if (body.password !== undefined) {
    const password = String(body.password);
    if (!/^[A-Za-z0-9._@!#$*-]{3,128}$/.test(password)) {
      throw new HttpError(400, 'La contraseña debe tener 3-128 caracteres sin espacios ni / ? & %');
    }
    out.password = password;
  }
  for (const f of ['full_name', 'email', 'phone', 'notes']) {
    if (body[f] !== undefined) out[f] = body[f] === null ? null : String(body[f]).slice(0, f === 'notes' ? 5000 : 255);
  }
  if (body.document_id !== undefined) out.document_id = body.document_id ? String(body.document_id).trim().slice(0, 64) : null;
  if (body.external_id !== undefined && !isReseller(req)) {
    out.external_id = body.external_id ? String(body.external_id).trim().slice(0, 128) : null;
    if (out.external_id) {
      const clash = await db('users').where({ external_id: out.external_id }).first();
      if (clash && (creating || clash.id !== int(req.params.id))) {
        throw new HttpError(409, `El ID externo ya está vinculado al cliente "${clash.username}"`);
      }
    }
  }
  if (body.duration && body.duration.amount) {
    oneOf(body.duration.unit, ['days', 'months', 'years', 'hours'], 'duration.unit');
    out.exp_date = addDuration(now(), body.duration.amount, body.duration.unit);
  } else if (body.exp_date !== undefined) {
    out.exp_date = body.exp_date === null || body.exp_date === '' ? null : int(body.exp_date);
  }
  if (body.max_connections !== undefined) {
    out.max_connections = Math.max(0, Math.min(100, int(body.max_connections, 1)));
  }
  if (body.enabled !== undefined) out.enabled = bool(body.enabled);
  if (body.is_trial !== undefined) out.is_trial = bool(body.is_trial);
  if (body.content_sections !== undefined) out.content_sections = contentSectionsValue(body.content_sections);
  if (body.owner_id !== undefined && !isReseller(req)) {
    const ownerId = int(body.owner_id);
    if (ownerId !== null && !(await db('admins').where({ id: ownerId }).first())) {
      throw new HttpError(400, 'Propietario no válido');
    }
    out.owner_id = ownerId;
  }
  if (creating) {
    if (!out.username) {
      if (!bool(body.random)) throw new HttpError(400, 'El campo "username" es obligatorio');
      out.username = randomString(8);
    }
    if (!out.password) {
      if (!bool(body.random)) throw new HttpError(400, 'El campo "password" es obligatorio');
      out.password = randomString(10);
    }
    if (out.owner_id === undefined || isReseller(req)) out.owner_id = req.admin.id;
  }
  if (out.username) {
    const clash = await db('users').where({ username: out.username }).first();
    if (clash && (creating || clash.id !== int(req.params.id))) {
      throw new HttpError(409, `El usuario "${out.username}" ya existe`);
    }
  }
  return out;
}

router.get('/', async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const q = visibleUsers(req);
  whereSearch(q, ['username', 'full_name', 'email', 'phone', 'notes', 'document_id', 'external_id'], req.query.search);
  if (req.query.external === 'linked') q.whereNotNull('external_id');
  if (req.query.external === 'unlinked') q.whereNull('external_id');
  if (['manual', 'external'].includes(req.query.suspension_source)) q.where('suspension_source', req.query.suspension_source);
  applyStatusFilter(q, req.query.status);
  if (req.query.package_id) {
    q.whereIn('users.id', db('user_packages').where('package_id', int(req.query.package_id, 0)).select('user_id'));
  }
  if (req.query.source) q.where('source', String(req.query.source));
  if (req.query.owner_id && !isReseller(req)) q.where('owner_id', int(req.query.owner_id, 0));

  const total = Number((await q.clone().count({ c: '*' }).first()).c);
  const sort = ['created_at', 'exp_date', 'username', 'last_seen_at'].includes(req.query.sort) ? req.query.sort : 'created_at';
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  const rows = await q.select('users.*').orderBy(sort, order).orderBy('id', order).limit(limit).offset(offset);
  res.json({ data: await serializeUsers(rows), total, page, limit });
});

router.post('/', async (req, res) => {
  const fields = await userFields(req, req.body || {}, { creating: true });
  const t = now();
  const id = await db.transaction(async (trx) => {
    const userId = await insertId(trx, 'users', { max_connections: 1, ...fields, source: 'local', created_at: t, updated_at: t });
    await setUserPackages(trx, userId, req.body.package_ids);
    return userId;
  });
  const user = await db('users').where({ id }).first();
  await logAction(req.admin, 'user.create', 'user', id, { username: user.username });
  res.status(201).json(await serializeUser(user));
});

router.post('/bulk', async (req, res) => {
  const { action } = req.body || {};
  oneOf(action, ['enable', 'disable', 'suspend', 'reactivate', 'delete', 'extend', 'set_packages', 'set_content'], 'action');
  const contentValue = action === 'set_content' ? contentSectionsValue(req.body.content_sections ?? null) : undefined;
  let skipped = 0;
  const idsQuery = visibleUsers(req).whereIn('id', idList(req.body.ids));
  if (['suspend', 'reactivate', 'enable', 'disable'].includes(action) && (await getSettings()).cut_mode === 'external') {
    // En modo "plataforma externa", los clientes vinculados solo los corta/activa la plataforma.
    skipped = Number((await idsQuery.clone().whereNotNull('external_id').count({ c: '*' }).first()).c);
    idsQuery.whereNull('external_id');
  }
  const ids = await idsQuery.pluck('id');
  if (!ids.length) return res.json({ affected: 0, skipped });
  const t = now();
  await db.transaction(async (trx) => {
    for (const part of chunk(ids, BATCH_SIZE)) {
      const q = () => trx('users').whereIn('id', part);
      if (action === 'enable') await q().update({ enabled: true, updated_at: t });
      if (action === 'disable') await q().update({ enabled: false, updated_at: t });
      if (action === 'suspend') {
        await q().update({ suspended: true, suspension_reason: req.body.reason || 'Servicio suspendido', suspension_source: 'manual', updated_at: t });
      }
      if (action === 'reactivate') {
        await q().update({ suspended: false, suspension_reason: null, suspension_source: null, enabled: true, updated_at: t });
      }
      if (action === 'delete') {
        await deleteAutoDevicesOf(trx, part); // sus equipos detectados; los TV Box de la empresa quedan disponibles
        await q().del();
      }
      if (action === 'extend') {
        oneOf(req.body.unit, ['days', 'months', 'years'], 'unit');
        for (const u of await q().select('id', 'exp_date')) {
          if (u.exp_date === null) continue; // sin vencimiento: nada que extender
          const base = Math.max(t, Number(u.exp_date));
          await trx('users').where({ id: u.id }).update({ exp_date: addDuration(base, req.body.amount, req.body.unit), updated_at: t });
        }
      }
      if (action === 'set_packages') {
        for (const id of part) await setUserPackages(trx, id, req.body.package_ids);
      }
      if (action === 'set_content') await q().update({ content_sections: contentValue, updated_at: t });
    }
  });
  await logAction(req.admin, `user.bulk.${action}`, 'user', null, { ids, reason: req.body.reason, skipped });
  res.json({ affected: ids.length, skipped });
});

router.get('/:id', async (req, res) => {
  res.json(await serializeUser(await loadUser(req, req.params.id)));
});

router.put('/:id', async (req, res) => {
  const user = await loadUser(req, req.params.id);
  const fields = await userFields(req, req.body || {}, { creating: false });
  await db.transaction(async (trx) => {
    await trx('users').where({ id: user.id }).update({ ...fields, updated_at: now() });
    if (req.body.package_ids !== undefined) await setUserPackages(trx, user.id, req.body.package_ids);
  });
  await logAction(req.admin, 'user.update', 'user', user.id, { username: fields.username || user.username });
  res.json(await serializeUser(await db('users').where({ id: user.id }).first()));
});

router.delete('/:id', async (req, res) => {
  const user = await loadUser(req, req.params.id);
  await db.transaction(async (trx) => {
    await deleteAutoDevicesOf(trx, [user.id]);
    await trx('users').where({ id: user.id }).del();
  });
  await logAction(req.admin, 'user.delete', 'user', user.id, { username: user.username });
  res.json({ ok: true });
});

/** En modo de cortes "plataforma externa", un cliente vinculado no se corta ni se activa a mano. */
async function assertManualCutsAllowed(user) {
  if (user.external_id && (await getSettings()).cut_mode === 'external') {
    throw new HttpError(409, 'Este cliente está vinculado a la plataforma externa: sus cortes y reactivaciones se gestionan allí');
  }
}

router.post('/:id/suspend', async (req, res) => {
  const user = await loadUser(req, req.params.id);
  await assertManualCutsAllowed(user);
  const reason = String(req.body?.reason || 'Servicio suspendido').slice(0, 1000);
  await db('users').where({ id: user.id }).update({
    suspended: true, suspension_reason: reason, suspension_source: 'manual', updated_at: now(),
  });
  await db('connections').where({ user_id: user.id }).del();
  await logAction(req.admin, 'user.suspend', 'user', user.id, { username: user.username, reason });
  res.json(await serializeUser(await db('users').where({ id: user.id }).first()));
});

router.post('/:id/reactivate', async (req, res) => {
  const user = await loadUser(req, req.params.id);
  await assertManualCutsAllowed(user);
  await db('users').where({ id: user.id }).update({
    suspended: false, suspension_reason: null, suspension_source: null, enabled: true, updated_at: now(),
  });
  await logAction(req.admin, 'user.reactivate', 'user', user.id, { username: user.username });
  res.json(await serializeUser(await db('users').where({ id: user.id }).first()));
});

router.post('/:id/extend', async (req, res) => {
  const user = await loadUser(req, req.params.id);
  const unit = oneOf(req.body?.unit, ['days', 'months', 'years'], 'unit');
  const amount = int(req.body?.amount, 0);
  if (amount <= 0) throw new HttpError(400, 'La cantidad debe ser mayor que 0');
  if (user.exp_date === null) throw new HttpError(400, 'El usuario no tiene vencimiento; edítalo para asignar una fecha');
  const base = Math.max(now(), Number(user.exp_date));
  const exp = addDuration(base, amount, unit);
  await db('users').where({ id: user.id }).update({ exp_date: exp, updated_at: now() });
  await logAction(req.admin, 'user.extend', 'user', user.id, { username: user.username, amount, unit, exp_date: exp });
  res.json(await serializeUser(await db('users').where({ id: user.id }).first()));
});

router.get('/:id/connections', async (req, res) => {
  const user = await loadUser(req, req.params.id);
  const settings = await getSettings();
  const rows = await db('connections')
    .leftJoin('streams', 'streams.id', 'connections.stream_id')
    .where('connections.user_id', user.id)
    .where('connections.last_seen_at', '>=', now() - settings.connection_timeout_seconds)
    .select('connections.*', 'streams.name as stream_name')
    .orderBy('connections.started_at', 'desc');
  res.json(rows.map((c) => ({ ...c, username: user.username })));
});

router.get('/:id/m3u-url', async (req, res) => {
  const user = await loadUser(req, req.params.id);
  // Nunca "localhost" ni IPs privadas en los enlaces para clientes (salvo que no haya otra opción).
  const base = await publicBaseUrl(req);
  const qs = `username=${encodeURIComponent(user.username)}&password=${encodeURIComponent(user.password)}`;
  res.json({
    m3u_url: `${base}/get.php?${qs}&type=m3u_plus&output=ts`,
    m3u8_url: `${base}/get.php?${qs}&type=m3u_plus&output=m3u8`,
    epg_url: `${base}/xmltv.php?${qs}`,
    xtream: { server: base, username: user.username, password: user.password },
  });
});

export default router;
