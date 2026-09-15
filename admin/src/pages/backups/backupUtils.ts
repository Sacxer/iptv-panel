import type { Backup } from '../../types';
import { formatNumber } from '../../utils/format';

/** Tamaño legible (B, KB, MB, GB). */
export function formatBytes(bytes: number | null | undefined): string {
  const b = Number(bytes ?? 0);
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('es-CO', { maximumFractionDigits: v >= 100 || i === 0 ? 0 : 1 })} ${units[i]}`;
}

/** Fecha y hora en la zona horaria del portal (las copias programadas usan esa zona). */
export function formatInZone(unix: number | null | undefined, timeZone: string | null | undefined, withWeekday = false): string {
  if (!unix) return '—';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: timeZone || undefined,
      weekday: withWeekday ? 'long' : undefined,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(new Date(unix * 1000))
      .replace(/,\s/g, ' ');
  } catch {
    return new Date(unix * 1000).toLocaleString('es-CO');
  }
}

export function backupDate(b: Backup): number {
  return b.backup_created_at ?? b.created_at;
}

export function rowsLabel(n: number | null | undefined): string {
  return `${formatNumber(n ?? 0)} fila${n === 1 ? '' : 's'}`;
}

export const WEEKDAYS: { value: number; short: string; long: string }[] = [
  { value: 1, short: 'Lun', long: 'lunes' },
  { value: 2, short: 'Mar', long: 'martes' },
  { value: 3, short: 'Mié', long: 'miércoles' },
  { value: 4, short: 'Jue', long: 'jueves' },
  { value: 5, short: 'Vie', long: 'viernes' },
  { value: 6, short: 'Sáb', long: 'sábado' },
  { value: 7, short: 'Dom', long: 'domingo' },
];

/** Nombres legibles de las tablas de la copia. */
export const TABLE_LABELS: Record<string, string> = {
  users: 'Clientes',
  admins: 'Usuarios del panel',
  streams: 'Canales y películas',
  categories: 'Categorías',
  packages: 'Paquetes',
  series: 'Series',
  devices: 'Dispositivos',
  device_alerts: 'Alertas de dispositivos',
  device_aliases: 'Firmas de dispositivos',
  external_clients: 'Clientes de WispHub',
  integration_runs: 'Sincronizaciones',
  logs: 'Registro de actividad',
  settings: 'Ajustes',
  servers: 'Servidores de streaming',
  stream_servers: 'Canales por servidor',
  user_packages: 'Paquetes por cliente',
  package_streams: 'Canales por paquete',
  package_series: 'Series por paquete',
  messages: 'Mensajes',
  message_reads: 'Mensajes leídos',
  notices: 'Avisos',
  outages: 'Cortes programados',
  reminders: 'Recordatorios',
  astra_sources: 'Fuentes Astra',
  astra_channels: 'Canales de Astra',
  transcode_profiles: 'Perfiles de transcodificación',
  epg_sources: 'Fuentes EPG',
  epg_channels: 'Canales de las guías',
  xtream_jobs: 'Migraciones XtreamUI',
};
