import type {
  DeliveryMode,
  ServerStatus,
  ServerStreamState,
  TranscodeHw,
  CutMode,
  MessageDisplay,
  MessageKind,
  DeviceActivity,
  DeviceAlertType,
  DeviceInventoryStatus,
  DeviceOwnership,
  DeviceSource,
  DeviceType,
  CategoryType,
  ContentSource,
  JobStatus,
  NoticeDisplay,
  NoticeLevel,
  Role,
  StreamMode,
  UserStatus,
} from '../types';

export type Tone = 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'purple' | 'orange' | 'teal';

export const USER_STATUS: Record<UserStatus, { label: string; tone: Tone }> = {
  active: { label: 'Activo', tone: 'green' },
  expired: { label: 'Vencido', tone: 'amber' },
  suspended: { label: 'Suspendido', tone: 'red' },
  disabled: { label: 'Deshabilitado', tone: 'gray' },
};

export const SOURCE_LABEL: Record<ContentSource, string> = {
  local: 'Local',
  xtreamui: 'XtreamUI',
  m3u: 'M3U',
  astra: 'Astra',
};

export const CATEGORY_TYPE_LABEL: Record<CategoryType, string> = {
  live: 'Canales en vivo',
  movie: 'Películas',
  series: 'Series',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  reseller: 'Revendedor',
};

export const NOTICE_LEVEL: Record<NoticeLevel, { label: string; tone: Tone }> = {
  info: { label: 'Información', tone: 'blue' },
  warning: { label: 'Advertencia', tone: 'amber' },
  critical: { label: 'Crítico', tone: 'red' },
};

export const NOTICE_DISPLAY: Record<NoticeDisplay, { label: string; description: string }> = {
  banner: { label: 'Banner', description: 'Franja fija en la parte superior de la app.' },
  popup: { label: 'Ventana emergente', description: 'Ventana modal que el cliente debe cerrar.' },
  ticker: { label: 'Cinta', description: 'Texto desplazándose en la parte inferior.' },
};

export const STREAM_MODE: Record<StreamMode, { label: string; description: string }> = {
  redirect: {
    label: 'Redirección',
    description:
      'El servidor valida al cliente y le responde con un 302 hacia la fuente original. Consume muy poco ancho de banda, pero la URL de origen queda expuesta al reproductor.',
  },
  proxy: {
    label: 'Proxy',
    description:
      'El servidor retransmite el flujo al cliente. Oculta las fuentes y permite controlar mejor las conexiones, pero todo el tráfico de video pasa por este servidor.',
  },
  xtream_upstream: {
    label: 'XtreamUI de origen',
    description:
      'Redirige la reproducción al XtreamUI antiguo usando las mismas credenciales del cliente. Útil durante la transición mientras las fuentes siguen en el panel viejo.',
  },
};

export const JOB_STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  running: { label: 'En curso', tone: 'blue' },
  done: { label: 'Completado', tone: 'green' },
  error: { label: 'Error', tone: 'red' },
};

export const MIGRATION_STEP_LABEL: Record<string, string> = {
  connect: 'Conectando',
  categories: 'Categorías',
  packages: 'Paquetes',
  bouquets: 'Paquetes',
  streams: 'Canales y películas',
  live: 'Canales',
  movie: 'Películas',
  series: 'Series',
  episodes: 'Episodios',
  users: 'Clientes',
  resellers: 'Revendedores',
  done: 'Finalizado',
};

// ---------- Dispositivos ----------

export const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  tvbox: 'TV Box',
  smart_tv: 'Smart TV',
  mobile: 'Celular',
  tablet: 'Tablet',
  pc: 'PC',
  stb: 'Decodificador',
  unknown: 'Desconocido',
};

export const DEVICE_OWNERSHIP: Record<DeviceOwnership, { label: string; tone: Tone }> = {
  company: { label: 'Empresa', tone: 'purple' },
  client: { label: 'Cliente', tone: 'blue' },
  unknown: { label: 'Desconocido', tone: 'gray' },
};

export const DEVICE_INVENTORY: Record<DeviceInventoryStatus, { label: string; tone: Tone }> = {
  available: { label: 'En bodega', tone: 'orange' },
  assigned: { label: 'Asignado', tone: 'green' },
  review: { label: 'En revisión', tone: 'amber' },
  retired: { label: 'Retirado', tone: 'gray' },
};

export const DEVICE_ACTIVITY_LABEL: Record<DeviceActivity, string> = {
  xtream_api: 'Xtream API',
  m3u: 'Lista M3U',
  stream: 'Reproducción',
  app: 'App',
};

export const DEVICE_SOURCE_LABEL: Record<DeviceSource, string> = {
  auto: 'Detectado',
  manual: 'Manual',
};

export const DEVICE_ALERT: Record<DeviceAlertType, { label: string; tone: Tone }> = {
  inactive: { label: 'Inactividad', tone: 'amber' },
  new_tvbox: { label: 'TV Box nuevo', tone: 'blue' },
  foreign_user: { label: 'Usado por otro cliente', tone: 'red' },
};

// ---------- Mensajes / recordatorios ----------

export const MESSAGE_KIND: Record<MessageKind, { label: string; tone: Tone }> = {
  payment: { label: 'Pago', tone: 'green' },
  expiration: { label: 'Vencimiento', tone: 'orange' },
  maintenance: { label: 'Mantenimiento', tone: 'amber' },
  promotion: { label: 'Promoción', tone: 'purple' },
  support: { label: 'Soporte', tone: 'blue' },
  general: { label: 'General', tone: 'gray' },
};

export const MESSAGE_DISPLAY: Record<MessageDisplay, string> = {
  inbox: 'Bandeja',
  popup: 'Ventana emergente al abrir la app',
};

// ---------- Modos de corte ----------

export const CUT_MODE: Record<CutMode, { label: string; short: string }> = {
  manual: { label: 'Manual', short: 'Solo desde el portal' },
  external: { label: 'Plataforma externa', short: 'Cortes y reactivaciones según WispHub' },
  both: { label: 'Ambos', short: 'WispHub y cortes manuales' },
};

/** Acciones del registro de actividad con un texto propio. */
export const LOG_ACTION_LABEL: Record<string, string> = {
  'system.public_url_follow': 'La IP del servidor cambió: URL actualizada',
  'server.ip_follow': 'La IP del nodo cambió: URL actualizada',
  'system.ports': 'Cambió los puertos para clientes',
  'system.ports_separation': 'Cambió la separación de panel y clientes',
  'server.use_ip': 'Eligió la IP de una interfaz para el nodo',
};

export const BILLING_ACTION: Record<string, { label: string; tone: Tone }> = {
  suspend: { label: 'Suspender', tone: 'red' },
  disable: { label: 'Deshabilitar', tone: 'gray' },
  reactivate: { label: 'Reactivar', tone: 'green' },
  skip_manual: { label: 'Omitido: corte manual', tone: 'amber' },
  unknown_status: { label: 'Estado desconocido', tone: 'purple' },
};

export const BILLING_TRIGGER: Record<string, { label: string; tone: Tone }> = {
  auto: { label: 'Automática', tone: 'blue' },
  manual: { label: 'Manual', tone: 'purple' },
  dry_run: { label: 'Simulación', tone: 'amber' },
  webhook: { label: 'Webhook', tone: 'green' },
  check_suspended: { label: 'Revisión de suspendidos', tone: 'teal' },
  user_refresh: { label: 'Cliente actualizado', tone: 'orange' },
};

export const BACKUP_TRIGGER: Record<string, { label: string; tone: Tone }> = {
  manual: { label: 'Manual', tone: 'purple' },
  scheduled: { label: 'Automática', tone: 'blue' },
  pre_restore: { label: 'Antes de restaurar', tone: 'amber' },
  upload: { label: 'Subida', tone: 'teal' },
  drive: { label: 'De Drive', tone: 'green' },
};

/** Cómo se vinculó un cliente externo con su cliente IPTV. */
export const LINK_METHOD: Record<string, string> = {
  manual: 'Manual',
  document: 'Por cédula',
  email: 'Por email',
  phone: 'Por teléfono',
  username: 'Por usuario',
  external_id: 'Por ID externo',
  bulk: 'En lote',
  same_document: 'Misma cédula',
  created: 'Cuenta creada',
};

export const MAPPED_STATUS: Record<string, { label: string; tone: Tone }> = {
  free: { label: 'Gratis', tone: 'teal' },
  active: { label: 'Activo', tone: 'green' },
  suspended: { label: 'Suspendido', tone: 'red' },
  disabled: { label: 'Deshabilitado', tone: 'gray' },
  unknown: { label: 'Sin mapear', tone: 'purple' },
};

/** Explicación del estado externo Gratis. */
export const FREE_HINT = 'No le afecta el corte';

// ---------- Streaming ----------

export const DELIVERY_MODE: Record<DeliveryMode, { label: string; short: string; tone: Tone }> = {
  default: { label: 'Predeterminado (según Ajustes)', short: 'Predeterminado', tone: 'gray' },
  direct: { label: 'Directo (direct source)', short: 'Directo', tone: 'blue' },
  restream: { label: 'Reenvío por servidor', short: 'Reenvío', tone: 'purple' },
  transcode: { label: 'Transcodificar', short: 'Transcodificado', tone: 'orange' },
};

export const SERVER_STATUS: Record<ServerStatus, { label: string; tone: Tone }> = {
  online: { label: 'En línea', tone: 'green' },
  offline: { label: 'Fuera de línea', tone: 'red' },
  pending: { label: 'Pendiente de instalar', tone: 'amber' },
  disabled: { label: 'Deshabilitado', tone: 'gray' },
};

export const STREAM_STATE: Record<ServerStreamState, { label: string; tone: Tone }> = {
  running: { label: 'Emitiendo', tone: 'green' },
  starting: { label: 'Iniciando', tone: 'blue' },
  error: { label: 'Error', tone: 'red' },
  idle: { label: 'Inactivo', tone: 'gray' },
};

export const TRANSCODE_HW: Record<TranscodeHw, { label: string; encoders: string[] }> = {
  cpu: { label: 'CPU', encoders: ['libx264', 'libx265'] },
  nvenc: { label: 'NVIDIA NVENC', encoders: ['h264_nvenc', 'hevc_nvenc'] },
  qsv: { label: 'Intel QSV', encoders: ['h264_qsv', 'hevc_qsv'] },
  vaapi: { label: 'VAAPI', encoders: ['h264_vaapi', 'hevc_vaapi'] },
};

/** Nombre legible de un encoder de FFmpeg. */
export function encoderLabel(encoder: string): string {
  const e = encoder.toLowerCase();
  if (e === 'libx264') return 'CPU x264';
  if (e === 'libx265') return 'CPU x265';
  if (e.includes('nvenc')) return `NVIDIA NVENC${e.startsWith('hevc') ? ' H.265' : ''}`;
  if (e.includes('qsv')) return `Intel QSV${e.startsWith('hevc') ? ' H.265' : ''}`;
  if (e.includes('vaapi')) return `VAAPI${e.startsWith('hevc') ? ' H.265' : ''}`;
  return encoder;
}
