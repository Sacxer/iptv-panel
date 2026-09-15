const pad = (n: number) => String(n).padStart(2, '0');

/** dd/mm/yyyy HH:mm a partir de segundos unix. */
export function formatDateTime(unix: number | null | undefined, empty = '—'): string {
  if (unix === null || unix === undefined || !Number.isFinite(unix)) return empty;
  const d = new Date(unix * 1000);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** dd/mm/yyyy a partir de segundos unix. */
export function formatDate(unix: number | null | undefined, empty = '—'): string {
  if (unix === null || unix === undefined || !Number.isFinite(unix)) return empty;
  const d = new Date(unix * 1000);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** Valor para <input type="datetime-local"> (hora local). */
export function unixToLocalInput(unix: number | null | undefined): string {
  if (unix === null || unix === undefined || !Number.isFinite(unix)) return '';
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToUnix(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Suma meses o días a una fecha unix (en hora local). */
export function addToUnix(unix: number, amount: number, unit: 'days' | 'months'): number {
  const d = new Date(unix * 1000);
  if (unit === 'days') d.setDate(d.getDate() + amount);
  else d.setMonth(d.getMonth() + amount);
  return Math.floor(d.getTime() / 1000);
}

/** Texto relativo del vencimiento: "en 5 días", "hace 2 días", "hoy". */
export function relativeExpiry(unix: number | null): string {
  if (unix === null) return 'Sin vencimiento';
  const diff = unix - nowUnix();
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400);
  const hours = Math.floor(abs / 3600);
  if (diff >= 0) {
    if (days >= 1) return `en ${days} ${days === 1 ? 'día' : 'días'}`;
    if (hours >= 1) return `en ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    return 'en menos de 1 hora';
  }
  if (days >= 1) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  if (hours >= 1) return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  return 'hace un momento';
}

export function daysUntil(unix: number | null): number | null {
  if (unix === null) return null;
  return Math.floor((unix - nowUnix()) / 86400);
}

/** Duración legible entre dos instantes (segundos). */
export function formatElapsed(fromUnix: number, toUnix = nowUnix()): string {
  let s = Math.max(0, toUnix - fromUnix);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (h > 0) return `${h} h ${pad(m)} min`;
  if (m > 0) return `${m} min ${pad(s)} s`;
  return `${s} s`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0';
  return n.toLocaleString('es-CO');
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePassword(length = 10): string {
  const out: string[] = [];
  const buf = new Uint32Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < length; i++) buf[i] = Math.floor(Math.random() * 1e9);
  for (let i = 0; i < length; i++) out.push(ALPHABET[buf[i] % ALPHABET.length]);
  return out.join('');
}

export function generateUsername(): string {
  return `user${generatePassword(6).toLowerCase()}`;
}

export function truncate(text: string | null | undefined, max = 80): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ['http:', 'https:', 'rtmp:', 'rtsp:', 'udp:', 'rtp:', 'srt:'].includes(u.protocol);
  } catch {
    return false;
  }
}

/** Representación de texto del campo `details` de un Log (puede ser texto u objeto). */
export function logDetails(details: unknown): string {
  if (details === null || details === undefined || details === '') return '';
  let value: unknown = details;
  if (typeof details === 'string') {
    const trimmed = details.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return details;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return details;
    }
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
      .join(' · ');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function plural(n: number, singular: string, pluralForm: string): string {
  return `${formatNumber(n)} ${n === 1 ? singular : pluralForm}`;
}

/** Copia al portapapeles con respaldo para contextos no seguros (http). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* se intenta el respaldo */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** "hace 3 min", "hace 2 h", "hace 34 días". */
export function timeAgo(unix: number | null | undefined, empty = 'Nunca'): string {
  if (unix === null || unix === undefined || !Number.isFinite(unix)) return empty;
  const diff = Math.max(0, nowUnix() - unix);
  if (diff < 60) return 'hace un momento';
  const min = Math.floor(diff / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `hace ${mo} meses`;
  const y = Math.floor(d / 365);
  return `hace ${y} ${y === 1 ? 'año' : 'años'}`;
}

export function isValidMac(mac: string): boolean {
  return /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(mac);
}

/** Bytes en GB con un decimal ("5,1 GB"). */
export function formatGB(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const gb = bytes / 1024 ** 3;
  return `${gb.toLocaleString('es-CO', { maximumFractionDigits: gb >= 100 ? 0 : 1 })} GB`;
}

export function formatMB(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  return `${Math.round(bytes / 1024 ** 2).toLocaleString('es-CO')} MB`;
}

/** Bits por segundo en Mbps ("12,4 Mbps"). */
export function formatMbps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return '—';
  const mbps = bps / 1_000_000;
  return `${mbps.toLocaleString('es-CO', { maximumFractionDigits: mbps >= 100 ? 0 : mbps >= 10 ? 1 : 2 })} Mbps`;
}

/** Segundos a texto corto: "12 d 4 h", "3 h 12 min", "45 min". */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

/** HH:mm:ss local. */
export function formatClock(unix: number): string {
  const d = new Date(unix * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** "en 3 h", "en 2 días" para instantes futuros; "hace X" para pasados. */
export function timeFromNow(unix: number | null | undefined, empty = '—'): string {
  if (unix === null || unix === undefined || !Number.isFinite(unix)) return empty;
  const diff = unix - nowUnix();
  if (diff <= 0) return timeAgo(unix);
  if (diff < 60) return 'en menos de 1 min';
  const min = Math.floor(diff / 60);
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `en ${h} h`;
  const d = Math.floor(h / 24);
  return `en ${d} ${d === 1 ? 'día' : 'días'}`;
}
