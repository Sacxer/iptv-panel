import type { ReminderConfig, ReminderRecurrence } from '../types';
import { formatDateTime } from './format';

const WEEKDAY_NAMES = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const WEEKDAY_SHORT = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'];

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/** Texto legible de la recurrencia de un recordatorio. */
export function recurrenceText(recurrence: ReminderRecurrence, config: ReminderConfig, startsAt: number | null): string {
  const time = config.time || '09:00';
  switch (recurrence) {
    case 'once':
      return startsAt ? `Una vez: ${formatDateTime(startsAt)}` : 'Una vez, al activarlo';
    case 'daily':
      return `Todos los días a las ${time}`;
    case 'weekly': {
      const days = [...(config.weekdays ?? [])].sort((a, b) => a - b);
      if (days.length === 7) return `Todos los días a las ${time}`;
      if (days.length === 5 && days.every((d) => d <= 5)) return `De lunes a viernes a las ${time}`;
      return `Cada ${joinList(days.map((d) => WEEKDAY_NAMES[d] ?? String(d)))} a las ${time}`;
    }
    case 'monthly':
      return `Día ${config.month_day ?? 1} de cada mes a las ${time}`;
    case 'interval': {
      const n = config.every_days ?? 1;
      return n === 1 ? `Todos los días a las ${time}` : `Cada ${n} días a las ${time}`;
    }
    case 'before_expiration': {
      const days = [...(config.days_before ?? [])].sort((a, b) => b - a);
      if (days.length === 1 && days[0] === 0) return `El día del vencimiento a las ${time}`;
      const label = joinList(days.map(String));
      const unit = days.length === 1 && days[0] === 1 ? 'día' : 'días';
      return `${label} ${unit} antes del vencimiento a las ${time}`;
    }
    default:
      return recurrence;
  }
}

export const RECURRENCE_LABEL: Record<ReminderRecurrence, string> = {
  once: 'Una vez',
  daily: 'Diario',
  weekly: 'Semanal',
  monthly: 'Mensual',
  interval: 'Cada N días',
  before_expiration: 'Antes del vencimiento',
};

/** Sustituye las variables de plantilla con datos de un cliente de ejemplo. */
export function renderTemplate(text: string, sample: { nombre: string; usuario: string; vence: string; dias: string; servidor: string }): string {
  return text
    .replace(/\{nombre\}/g, sample.nombre)
    .replace(/\{usuario\}/g, sample.usuario)
    .replace(/\{vence\}/g, sample.vence)
    .replace(/\{dias\}/g, sample.dias)
    .replace(/\{servidor\}/g, sample.servidor);
}

export const TEMPLATE_VARS: { key: string; label: string }[] = [
  { key: '{nombre}', label: 'Nombre' },
  { key: '{usuario}', label: 'Usuario' },
  { key: '{vence}', label: 'Fecha de vencimiento' },
  { key: '{dias}', label: 'Días para vencer' },
  { key: '{servidor}', label: 'Nombre del servidor' },
];
