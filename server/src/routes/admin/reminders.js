// Recordatorios programados (únicos o repetitivos).
import { Router } from 'express';
import { db, insertId } from '../../db/index.js';
import { adminOnly } from '../../lib/auth.js';
import { logAction } from '../../lib/log.js';
import { getSettings } from '../../lib/settings.js';
import { parseTime } from '../../lib/time.js';
import {
  HttpError, bool, int, now, oneOf, parseJson, requireFields,
} from '../../lib/util.js';
import {
  MESSAGE_KINDS, RECURRENCES, computeNextRun, runReminder, upcomingRuns,
} from '../../services/reminders.js';

const router = Router();
router.use((req, res, next) => (req.method === 'GET' ? next() : adminOnly(req, res, next)));

const intOrNull = (v) => int(v, null);

async function serialize(r, tz) {
  const target = r.target === 'user' ? await db('users').where({ id: r.user_id }).select('username').first()
    : r.target === 'package' ? await db('packages').where({ id: r.package_id }).select('name').first() : null;
  return {
    id: r.id,
    title: r.title,
    body: r.body || '',
    kind: r.kind,
    display: r.display,
    target: r.target,
    user_id: intOrNull(r.user_id),
    package_id: intOrNull(r.package_id),
    target_label: r.target === 'user' ? `Cliente: ${target?.username || '?'}`
      : r.target === 'package' ? `Paquete: ${target?.name || '?'}` : 'Todos los clientes',
    recurrence: r.recurrence,
    config: parseJson(r.config, {}) || {},
    message_ttl_days: Number(r.message_ttl_days),
    replace_previous: bool(r.replace_previous),
    starts_at: intOrNull(r.starts_at),
    ends_at: intOrNull(r.ends_at),
    active: bool(r.active),
    last_run_at: intOrNull(r.last_run_at),
    next_run_at: intOrNull(r.next_run_at),
    upcoming: bool(r.active) ? upcomingRuns(r, tz, 5) : [],
    sent_count: Number(r.sent_count),
    created_at: Number(r.created_at),
  };
}

async function fields(body, current = null) {
  const merged = { ...(current || {}), ...body };
  if (!current) requireFields(body, ['title']);
  const out = {};
  if (body.title !== undefined) out.title = String(body.title).slice(0, 255);
  if (body.body !== undefined) out.body = String(body.body ?? '');
  if (body.kind !== undefined || !current) out.kind = oneOf(merged.kind || 'general', MESSAGE_KINDS, 'kind');
  if (body.display !== undefined || !current) out.display = oneOf(merged.display || 'inbox', ['inbox', 'popup'], 'display');
  if (body.target !== undefined || !current) {
    out.target = oneOf(merged.target || 'all', ['all', 'user', 'package'], 'target');
    if (out.target === 'user' && !(await db('users').where({ id: int(merged.user_id, 0) }).first())) {
      throw new HttpError(400, 'Cliente destino no válido');
    }
    if (out.target === 'package' && !(await db('packages').where({ id: int(merged.package_id, 0) }).first())) {
      throw new HttpError(400, 'Paquete destino no válido');
    }
    out.user_id = out.target === 'user' ? int(merged.user_id) : null;
    out.package_id = out.target === 'package' ? int(merged.package_id) : null;
  }
  if (body.recurrence !== undefined || !current) out.recurrence = oneOf(merged.recurrence || 'once', RECURRENCES, 'recurrence');
  if (body.config !== undefined) {
    const c = body.config || {};
    const config = {};
    if (c.time !== undefined) {
      const { hour, minute } = parseTime(c.time);
      config.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
    if (Array.isArray(c.weekdays)) config.weekdays = [...new Set(c.weekdays.map(Number).filter((d) => d >= 1 && d <= 7))];
    if (c.month_day !== undefined) config.month_day = Math.max(1, Math.min(31, int(c.month_day, 1)));
    if (c.every_days !== undefined) config.every_days = Math.max(1, Math.min(365, int(c.every_days, 1)));
    if (Array.isArray(c.days_before)) config.days_before = [...new Set(c.days_before.map(Number).filter((d) => d >= 0 && d <= 60))];
    out.config = JSON.stringify(config);
  }
  const recurrence = out.recurrence || current?.recurrence;
  const config = parseJson(out.config ?? current?.config, {}) || {};
  if (recurrence === 'weekly' && !(config.weekdays || []).length) throw new HttpError(400, 'Elige al menos un día de la semana');
  if (recurrence === 'before_expiration' && !(config.days_before || []).length) {
    throw new HttpError(400, 'Indica cuántos días antes del vencimiento enviar el recordatorio');
  }
  if (body.message_ttl_days !== undefined) out.message_ttl_days = Math.max(1, Math.min(365, int(body.message_ttl_days, 7)));
  if (body.replace_previous !== undefined) out.replace_previous = bool(body.replace_previous);
  if (body.starts_at !== undefined) out.starts_at = intOrNull(body.starts_at);
  if (body.ends_at !== undefined) out.ends_at = intOrNull(body.ends_at);
  if (body.active !== undefined) out.active = bool(body.active);
  return out;
}

router.get('/reminders', async (_req, res) => {
  const tz = (await getSettings()).timezone;
  const rows = await db('reminders').orderBy('active', 'desc').orderBy('next_run_at').orderBy('id', 'desc');
  res.json(await Promise.all(rows.map((r) => serialize(r, tz))));
});

router.post('/reminders', async (req, res) => {
  const tz = (await getSettings()).timezone;
  const data = await fields(req.body || {});
  const t = now();
  const row = { active: true, config: '{}', ...data, created_by: req.admin.id, created_at: t, updated_at: t };
  row.next_run_at = row.active ? computeNextRun(row, t, tz) : null;
  const id = await insertId(db, 'reminders', row);
  await logAction(req.admin, 'reminder.create', 'reminder', id, { title: row.title, recurrence: row.recurrence });
  res.status(201).json(await serialize(await db('reminders').where({ id }).first(), tz));
});

router.get('/reminders/:id', async (req, res) => {
  const row = await db('reminders').where({ id: int(req.params.id, 0) }).first();
  if (!row) throw new HttpError(404, 'Recordatorio no encontrado');
  res.json(await serialize(row, (await getSettings()).timezone));
});

router.put('/reminders/:id', async (req, res) => {
  const current = await db('reminders').where({ id: int(req.params.id, 0) }).first();
  if (!current) throw new HttpError(404, 'Recordatorio no encontrado');
  const tz = (await getSettings()).timezone;
  const data = await fields(req.body || {}, current);
  const merged = { ...current, ...data };
  // Cambios de programación: se recalcula desde ahora. Reactivar uno "único" ya enviado lo vuelve a programar.
  if (data.recurrence === 'once' || (data.active && !bool(current.active) && merged.recurrence === 'once')) merged.last_run_at = null;
  data.next_run_at = bool(merged.active) ? computeNextRun(merged, now(), tz) : null;
  if (merged.last_run_at === null) data.last_run_at = null;
  await db('reminders').where({ id: current.id }).update({ ...data, updated_at: now() });
  await logAction(req.admin, 'reminder.update', 'reminder', current.id, { title: merged.title });
  res.json(await serialize(await db('reminders').where({ id: current.id }).first(), tz));
});

router.delete('/reminders/:id', async (req, res) => {
  const row = await db('reminders').where({ id: int(req.params.id, 0) }).first();
  if (!row) throw new HttpError(404, 'Recordatorio no encontrado');
  await db('reminders').where({ id: row.id }).del();
  await logAction(req.admin, 'reminder.delete', 'reminder', row.id, { title: row.title });
  res.json({ ok: true });
});

router.post('/reminders/:id/run', async (req, res) => {
  const row = await db('reminders').where({ id: int(req.params.id, 0) }).first();
  if (!row) throw new HttpError(404, 'Recordatorio no encontrado');
  const created = await runReminder(row, { force: true });
  await logAction(req.admin, 'reminder.run', 'reminder', row.id, { title: row.title, created });
  res.json({ ok: true, messages_created: created, reminder: await serialize(await db('reminders').where({ id: row.id }).first(), (await getSettings()).timezone) });
});

export default router;
