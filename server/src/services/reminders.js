// Recordatorios programados: únicos o repetitivos, que generan mensajes para los clientes.
import { db, insertId } from '../db/index.js';
import { getSettings } from '../lib/settings.js';
import {
  addCalendarDays, daysInMonth, formatDate, parseTime, safeZone, zoneParts, zonedToUnix,
} from '../lib/time.js';
import { bool, now, parseJson } from '../lib/util.js';

export const MESSAGE_KINDS = ['payment', 'expiration', 'maintenance', 'promotion', 'support', 'general'];
export const RECURRENCES = ['once', 'daily', 'weekly', 'monthly', 'interval', 'before_expiration'];

/**
 * Próxima ejecución posterior a `from`, o null si ya no hay más.
 * config: { time: 'HH:MM', weekdays: [1..7], month_day: 1..31, every_days: N, days_before: [7,3,1] }
 */
export function computeNextRun(reminder, from, tz) {
  const zone = safeZone(tz);
  const config = parseJson(reminder.config, {}) || {};
  const { hour, minute } = parseTime(config.time);
  const startsAt = reminder.starts_at ? Number(reminder.starts_at) : null;
  const endsAt = reminder.ends_at ? Number(reminder.ends_at) : null;
  const base = Math.max(from, startsAt ? startsAt - 1 : from);
  const at = (date) => zonedToUnix({ ...date, hour, minute }, zone);
  const today = zoneParts(base, zone);
  let next = null;

  switch (reminder.recurrence) {
    case 'once':
      next = reminder.last_run_at ? null : Math.max(startsAt || from, from);
      break;
    case 'daily':
    case 'before_expiration': {
      next = at(today);
      if (next <= base) next = at(addCalendarDays(today, 1));
      break;
    }
    case 'weekly': {
      const days = (Array.isArray(config.weekdays) && config.weekdays.length ? config.weekdays : [1]).map(Number);
      for (let i = 0; i <= 7 && next === null; i++) {
        const date = addCalendarDays(today, i);
        const candidate = at(date);
        const weekday = zoneParts(candidate, zone).weekday;
        if (days.includes(weekday) && candidate > base) next = candidate;
      }
      break;
    }
    case 'monthly': {
      const wanted = Math.max(1, Math.min(31, Number(config.month_day) || 1));
      for (let i = 0; i < 3 && next === null; i++) {
        const month = ((today.month - 1 + i) % 12) + 1;
        const year = today.year + Math.floor((today.month - 1 + i) / 12);
        const candidate = at({ year, month, day: Math.min(wanted, daysInMonth(year, month)) });
        if (candidate > base) next = candidate;
      }
      break;
    }
    case 'interval': {
      const every = Math.max(1, Number(config.every_days) || 1);
      if (reminder.last_run_at) {
        next = at(addCalendarDays(zoneParts(Number(reminder.last_run_at), zone), every));
        if (next <= base) {
          // Atrasado (p. ej. el servidor estuvo apagado): hoy a la hora indicada o mañana.
          next = at(today);
          if (next <= base) next = at(addCalendarDays(today, 1));
        }
      } else {
        next = at(today);
        if (next <= base) next = at(addCalendarDays(today, 1));
      }
      break;
    }
    default:
      next = null;
  }
  if (next !== null && endsAt && next > endsAt) return null;
  return next;
}

/** Próximas N ejecuciones (para vista previa en el panel). */
export function upcomingRuns(reminder, tz, count = 5) {
  const runs = [];
  let from = now();
  let simulated = { ...reminder };
  for (let i = 0; i < count; i++) {
    const next = computeNextRun(simulated, from, tz);
    if (next === null) break;
    runs.push(next);
    simulated = { ...simulated, last_run_at: next };
    from = next;
  }
  return runs;
}

/** Usuarios destino según target (all | user | package), solo activos. */
function targetUsers(reminder) {
  const q = db('users').where('suspended', false).where('enabled', true);
  if (reminder.target === 'user') q.where('id', reminder.user_id);
  if (reminder.target === 'package') {
    q.whereIn('id', db('user_packages').where('package_id', reminder.package_id).select('user_id'));
  }
  return q;
}

/** Ejecuta un recordatorio: crea los mensajes correspondientes. Devuelve cuántos mensajes creó. */
export async function runReminder(reminder, { force = false } = {}) {
  const settings = await getSettings();
  const tz = safeZone(settings.timezone);
  const t = now();
  const ttl = Math.max(1, Number(reminder.message_ttl_days) || 7) * 86400;
  const base = {
    title: reminder.title,
    body: reminder.body || '',
    kind: reminder.kind,
    display: reminder.display,
    reminder_id: reminder.id,
    created_by: reminder.created_by,
    created_at: t,
    expires_at: t + ttl,
  };
  let created = 0;

  if (reminder.recurrence === 'before_expiration') {
    const config = parseJson(reminder.config, {}) || {};
    const daysBefore = (Array.isArray(config.days_before) && config.days_before.length ? config.days_before : [3])
      .map(Number).filter((d) => d >= 0 && d <= 60);
    const today = zoneParts(t, tz);
    for (const d of daysBefore) {
      const day = addCalendarDays(today, d);
      const from = zonedToUnix({ ...day, hour: 0, minute: 0 }, tz);
      const to = zonedToUnix({ ...addCalendarDays(day, 1), hour: 0, minute: 0 }, tz);
      const users = await targetUsers(reminder).whereNotNull('exp_date')
        .where('exp_date', '>=', from).where('exp_date', '<', to).select('id');
      for (const u of users) {
        // No repetir el mismo aviso al mismo cliente en el mismo día.
        const dup = await db('messages').where({ reminder_id: reminder.id, user_id: u.id }).where('created_at', '>', t - 20 * 3600).first();
        if (dup && !force) continue;
        await db('messages').insert({ ...base, target: 'user', user_id: u.id, package_id: null, expires_at: Math.max(to, t + ttl) });
        created++;
      }
    }
  } else {
    if (bool(reminder.replace_previous)) {
      await db('messages').where({ reminder_id: reminder.id })
        .where((w) => w.whereNull('expires_at').orWhere('expires_at', '>', t))
        .update({ expires_at: t });
    }
    await insertId(db, 'messages', {
      ...base,
      target: reminder.target,
      user_id: reminder.target === 'user' ? reminder.user_id : null,
      package_id: reminder.target === 'package' ? reminder.package_id : null,
    });
    created = 1;
  }

  const next = computeNextRun({ ...reminder, last_run_at: t }, t, tz);
  await db('reminders').where({ id: reminder.id }).update({
    last_run_at: t,
    next_run_at: next,
    active: next !== null && bool(reminder.active),
    sent_count: Number(reminder.sent_count || 0) + created,
    updated_at: t,
  });
  return created;
}

export async function runDueReminders() {
  const due = await db('reminders').where('active', true).whereNotNull('next_run_at').where('next_run_at', '<=', now());
  let total = 0;
  for (const r of due) {
    try {
      total += await runReminder(r);
    } catch (err) {
      console.error(`Recordatorio #${r.id} fallido:`, err.message);
    }
  }
  return total;
}

export function startReminderScheduler() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueReminders();
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => tick().catch(() => {}), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

/** Sustituye {nombre}, {usuario}, {vence}, {dias} y {servidor} con los datos del cliente. */
export function renderPlaceholders(text, user, settings) {
  if (!text || !text.includes('{')) return text || '';
  const tz = safeZone(settings.timezone);
  const exp = user.exp_date ? Number(user.exp_date) : null;
  const days = exp ? Math.max(0, Math.ceil((exp - now()) / 86400)) : null;
  const values = {
    nombre: user.full_name || user.username,
    usuario: user.username,
    vence: exp ? formatDate(exp, tz) : 'sin vencimiento',
    dias: days === null ? '' : String(days),
    servidor: settings.server_name,
  };
  return text.replace(/\{(nombre|usuario|vence|dias|servidor)\}/g, (_, k) => values[k]);
}
