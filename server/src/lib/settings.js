import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { parseJson } from './util.js';

export const DEFAULT_SETTINGS = {
  server_name: 'Mi IPTV',
  public_url: '',
  stream_mode: 'redirect', // redirect | proxy | xtream_upstream
  xtream_upstream_url: '',
  epg_url: '',
  timezone: 'UTC',
  allow_all_without_package: true,
  connection_timeout_seconds: 60,
  xtream_db: { host: '', port: 3306, user: '', password: '', database: 'xtream_iptvpro' },
  // Dispositivos
  device_online_minutes: 10,
  device_inactive_days: 30,
  device_check_interval_minutes: 60,
  tvbox_default_ownership: 'company', // company | client | unknown
  device_alert_new_tvbox: true,
  device_inactive_message_client: false,
  // Revisión de canales y películas
  stream_check_enabled: true,
  stream_check_interval_minutes: 30,
  stream_check_batch: 500,
  stream_check_concurrency: 10,
  stream_check_timeout_seconds: 8,
  // Cortes: manual (solo portal) | external (clientes vinculados los controla la plataforma) | both
  cut_mode: 'manual',
  billing_integration: {
    enabled: false,
    provider: 'wisphub', // wisphub | custom
    base_url: 'https://api.wisphub.net/api',
    list_path: '/clientes/',
    api_key: '',
    auth_header: 'Authorization',
    auth_prefix: 'Api-Key ',
    page_size: 300,
    results_path: 'results',
    fields: {
      id: 'id_servicio', status: 'estado', document: 'cedula', username: 'usuario',
      name: 'nombre', email: 'email', phone: 'telefono', plan: 'plan_internet.nombre',
    },
    status_map: { free: ['Gratis'], active: ['Activo'], suspended: ['Suspendido', 'Cortado'], disabled: ['Cancelado', 'Retirado'] },
    match_by: ['document', 'email', 'phone', 'username'],
    auto_link: true,
    reactivate: true,
    interval_minutes: 15,
    suspension_reason: 'Servicio suspendido por falta de pago',
    webhook_token: '',
  },
  // Servidores de streaming
  node_fallback_direct: true, // si ningún servidor asignado está en línea, enviar al cliente a la fuente directa
  node_offline_seconds: 30,
  // EPG (guía de programación)
  epg_refresh_hours: 12,
  epg_auto_match: false, // emparejar automáticamente los canales sin EPG tras cada actualización de las guías
  epg_min_score: 85, // % mínimo para asignar sin confirmación
  epg_country: '', // código de país preferido en los ID XMLTV, p. ej. "co"
  epg_fill_logos: true,
  // Avisos
  notices_carousel_enabled: true,
  notices_carousel_seconds: 8,
  // Datos públicos de la empresa (política de privacidad, ficha de Google Play y soporte en la app)
  company_name: '',
  app_name: 'IPTV Player',
  support_email: '',
  support_phone: '',
  // Copias de seguridad
  backup: {
    schedule_enabled: false,
    frequency: 'daily', // daily | weekly | hours
    time: '03:00',
    weekdays: [7], // 1=lunes … 7=domingo (frecuencia semanal)
    every_hours: 12,
    keep_local: 10, // copias que se conservan en el servidor (las fijadas no cuentan)
    include_logs: true,
    include_epg: false, // la programación se vuelve a descargar sola
    encrypt: false,
    password: '',
    last_scheduled_at: null, // la próxima copia programada se calcula desde aquí
    google_drive: {
      auto_upload: true, // subir cada copia al terminar
      keep: 30, // copias que se conservan en Drive
      folder_name: 'Backups IPTV',
      folder_id: '',
      client_id: '',
      client_secret: '',
      refresh_token: '',
      account_email: '',
      connected_at: null,
    },
  },
};

/** Claves de ajustes propias de este servidor: no se exportan en los backups ni se pisan al restaurar. */
export const PRESERVED_SETTING_KEYS = ['backup', 'jwt_secret'];

let cache = null;

export async function getSettings() {
  if (cache) return cache;
  const rows = await db('settings').select('key', 'value');
  const stored = Object.fromEntries(rows.map((r) => [r.key, parseJson(r.value, null)]));
  cache = {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(Object.entries(stored).filter(([k]) => k in DEFAULT_SETTINGS)),
  };
  cache.xtream_db = { ...DEFAULT_SETTINGS.xtream_db, ...(stored.xtream_db || {}) };
  const bi = stored.billing_integration || {};
  cache.billing_integration = {
    ...DEFAULT_SETTINGS.billing_integration,
    ...bi,
    fields: { ...DEFAULT_SETTINGS.billing_integration.fields, ...(bi.fields || {}) },
    status_map: { ...DEFAULT_SETTINGS.billing_integration.status_map, ...(bi.status_map || {}) },
  };
  const bk = stored.backup || {};
  cache.backup = {
    ...DEFAULT_SETTINGS.backup,
    ...bk,
    google_drive: { ...DEFAULT_SETTINGS.backup.google_drive, ...(bk.google_drive || {}) },
  };
  {
    const sm = cache.billing_integration.status_map;
    const free = new Set((sm.free || []).map((x) => String(x).toLowerCase()));
    sm.active = (sm.active || []).filter((x) => !free.has(String(x).toLowerCase()));
  }
  return cache;
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
    if (key === 'backup') {
      next.backup = { ...current.backup, ...value, google_drive: { ...current.backup.google_drive, ...(value.google_drive || {}) } };
    } else {
      next[key] = key === 'xtream_db' || key === 'billing_integration' ? { ...current[key], ...value } : value;
    }
  }
  await db.transaction(async (trx) => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const value = JSON.stringify(next[key]);
      const exists = await trx('settings').where({ key }).first();
      if (exists) await trx('settings').where({ key }).update({ value });
      else await trx('settings').insert({ key, value });
    }
  });
  cache = null;
  return getSettings();
}

/** Versión de ajustes apta para enviar al panel (sin la contraseña de MySQL). */
export function publicSettings(s) {
  const { password, ...xdb } = s.xtream_db;
  const { api_key: apiKey, ...billing } = s.billing_integration;
  return {
    ...s,
    backup: publicBackupSettings(s.backup),
    xtream_db: { ...xdb, password_set: Boolean(password) },
    billing_integration: {
      ...billing,
      api_key_set: Boolean(apiKey),
      // Solo los últimos 4 caracteres, para confirmar cuál está guardada sin exponerla.
      api_key_hint: apiKey ? `••••${String(apiKey).slice(-4)}` : null,
    },
  };
}

/** Ajustes de backup sin secretos (contraseña de cifrado, secreto de cliente y token de Google). */
export function publicBackupSettings(b) {
  const { password, google_drive: gd, ...rest } = b;
  const { client_secret: secret, refresh_token: refresh, ...drive } = gd;
  return {
    ...rest,
    password_set: Boolean(password),
    google_drive: {
      ...drive,
      client_secret_set: Boolean(secret),
      connected: Boolean(refresh),
    },
  };
}

/** Olvida la caché de ajustes (p. ej. tras restaurar un backup). */
export function invalidateSettings() {
  cache = null;
}

/** Secreto JWT: variable de entorno o uno generado y persistido en la base de datos. */
export async function getJwtSecret(envSecret) {
  if (envSecret) return envSecret;
  const row = await db('settings').where({ key: 'jwt_secret' }).first();
  if (row) return parseJson(row.value, row.value);
  const secret = crypto.randomBytes(48).toString('hex');
  await db('settings').insert({ key: 'jwt_secret', value: JSON.stringify(secret) });
  return secret;
}
