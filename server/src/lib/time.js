// Utilidades de fecha según la zona horaria configurada (sin dependencias externas).

const formatters = new Map();

function formatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return formatters.get(tz);
}

export function safeZone(tz) {
  try {
    formatter(tz || 'UTC');
    return tz || 'UTC';
  } catch {
    return 'UTC';
  }
}

const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Partes locales de un instante unix: { year, month, day, hour, minute, second, weekday (1=lunes … 7=domingo) }. */
export function zoneParts(ts, tz) {
  const out = {};
  for (const p of formatter(safeZone(tz)).formatToParts(new Date(ts * 1000))) {
    if (p.type === 'weekday') out.weekday = WEEKDAYS[p.value];
    else if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Convierte una fecha/hora local de la zona a segundos unix (maneja cambios de horario). */
export function zonedToUnix({ year, month, day, hour = 0, minute = 0 }, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  const offsetAt = (ts) => {
    const p = zoneParts(ts, tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - ts;
  };
  let result = guess - offsetAt(guess);
  const second = offsetAt(result);
  if (guess - second !== result) result = guess - second;
  return result;
}

/** Suma días a una fecha de calendario { year, month, day }. */
export function addCalendarDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatDate(ts, tz) {
  if (!ts) return '';
  const p = zoneParts(ts, tz);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

export function parseTime(value, fallback = '09:00') {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || fallback));
  const [hour, minute] = m ? [Number(m[1]), Number(m[2])] : [9, 0];
  return { hour: Math.min(23, hour), minute: Math.min(59, minute) };
}
