// Tipos del contrato de API (docs/API.md, sección 3: /api/admin).
// Todas las fechas son segundos unix (entero) o null.

export type Role = 'admin' | 'reseller';

export interface AdminMe {
  id: number;
  username: string;
  role: Role;
}

export interface LoginResponse {
  token: string;
  admin: AdminMe;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface OkResponse {
  ok: boolean;
}

export interface AffectedResponse {
  affected: number;
  /** Omitidos (p. ej. clientes vinculados en modo de corte externo). */
  skipped?: number;
}

export type TimeUnit = 'days' | 'months';

export interface Duration {
  amount: number;
  unit: TimeUnit;
}

// ---------- Usuarios ----------

export type UserStatus = 'active' | 'expired' | 'suspended' | 'disabled';
export type UserStatusFilter = UserStatus | 'expiring' | 'trial';
export type UserSource = 'local' | 'xtreamui';
/** Secciones de las apps: canales en vivo, películas y series. */
export type ContentSection = 'live' | 'movies' | 'series';

export interface User {
  id: number;
  username: string;
  password: string;
  full_name: string;
  email: string;
  phone: string;
  exp_date: number | null;
  max_connections: number;
  enabled: boolean;
  suspended: boolean;
  suspension_reason: string | null;
  suspension_source?: SuspensionSource | null;
  document_id?: string | null;
  external_id?: string | null;
  external_status?: string | null;
  external_synced_at?: number | null;
  /** Servicios de la plataforma unidos a esta cuenta (una cuenta por persona). */
  external_services?: ExternalService[];
  is_trial: boolean;
  status: UserStatus;
  notes: string;
  owner_id: number | null;
  owner_username: string | null;
  source: UserSource;
  xtream_id: number | null;
  package_ids: number[];
  /** Secciones que ve el cliente en las apps. Vacío = automático (según sus paquetes). */
  content_sections: ContentSection[];
  active_connections: number;
  /** Número de dispositivos del cliente. */
  device_count?: number;
  last_seen_at: number | null;
  last_ip: string | null;
  created_at: number;
  updated_at: number;
}

export interface UserInput {
  username?: string;
  password?: string;
  random?: boolean;
  exp_date?: number | null;
  duration?: Duration;
  max_connections?: number;
  is_trial?: boolean;
  package_ids?: number[];
  /** [] = automático (según sus paquetes). */
  content_sections?: ContentSection[];
  notes?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  enabled?: boolean;
  owner_id?: number;
  document_id?: string;
  external_id?: string | null;
}

export interface UserListParams {
  search?: string;
  status?: UserStatusFilter | '';
  package_id?: number | '';
  source?: UserSource | '';
  owner_id?: number | '';
  external?: 'linked' | 'unlinked' | '';
  suspension_source?: SuspensionSource | '';
  sort?: 'created_at' | 'exp_date' | 'username';
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export type UserBulkAction =
  | 'enable'
  | 'disable'
  | 'suspend'
  | 'reactivate'
  | 'delete'
  | 'extend'
  | 'set_packages'
  | 'set_content';

export interface UserBulkInput {
  ids: number[];
  action: UserBulkAction;
  reason?: string;
  amount?: number;
  unit?: TimeUnit;
  package_ids?: number[];
  /** Para `set_content`: [] = automático (según sus paquetes). */
  content_sections?: ContentSection[];
}

export interface UserAccess {
  m3u_url: string;
  /** Campo adicional devuelto por el servidor (no está en el contrato). */
  m3u8_url?: string;
  /** Campo adicional devuelto por el servidor (no está en el contrato). */
  epg_url?: string;
  xtream: {
    server: string;
    username: string;
    password: string;
  };
}

// ---------- Paquetes ----------

export interface Package {
  id: number;
  name: string;
  description: string;
  stream_count: number;
  series_count: number;
  user_count: number;
  created_at: number;
  stream_ids?: number[];
  series_ids?: number[];
}

export interface PackageInput {
  name: string;
  description: string;
  stream_ids: number[];
  series_ids: number[];
}

// ---------- Categorías ----------

export type CategoryType = 'live' | 'movie' | 'series';

export interface Category {
  id: number;
  name: string;
  type: CategoryType;
  sort_order: number;
  item_count: number;
}

export interface CategoryInput {
  name: string;
  type: CategoryType;
  sort_order: number;
}

// ---------- Streams ----------

export type StreamType = 'live' | 'movie';
export type ContentSource = 'local' | 'xtreamui' | 'm3u' | 'astra';

export interface StreamInfo {
  plot: string;
  genre: string;
  rating: string;
  releasedate: string;
  duration: string;
  cover: string;
}

export interface Stream {
  id: number;
  type: StreamType;
  name: string;
  category_id: number | null;
  category_name: string | null;
  logo: string;
  source_url: string;
  backup_urls: string[];
  epg_channel_id: string;
  /** Puntuación del emparejamiento automático con la guía (0-100). */
  epg_match_score?: number | null;
  /** EPG asignado a mano: el emparejamiento automático no lo cambia. */
  epg_locked?: boolean;
  container_extension: string;
  tv_archive_duration: number;
  sort_order: number;
  enabled: boolean;
  info: StreamInfo;
  package_ids: number[];
  source: ContentSource;
  created_at: number;
  health_status?: HealthStatus;
  health_checked_at?: number | null;
  health_ms?: number | null;
  health_error?: string | null;
  health_down_since?: number | null;
  delivery_mode?: DeliveryMode;
  transcode_profile_id?: number | null;
  transcode_profile_name?: string | null;
  always_on?: boolean;
  server_ids?: number[];
  servers?: { id: number; name: string }[];
  active_connections?: number;
}

export type HealthStatus = 'online' | 'offline' | 'unknown';

export interface HealthCounts {
  online: number;
  offline: number;
  unknown: number;
  total: number;
}

export interface StreamCheckRun {
  total: number;
  done: number;
  online: number;
  offline: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface StreamHealth {
  live: HealthCounts;
  movie: HealthCounts;
  running: boolean;
  progress: { total: number; done: number; online: number; offline: number } | null;
  started_at: number | null;
  finished_at: number | null;
  last_result: StreamCheckRun | null;
  settings?: Record<string, unknown>;
}

export interface StreamCheckResponse extends Partial<StreamHealth> {
  results?: { id: number; status: HealthStatus; ms: number | null; error: string | null }[];
}

export interface OfflineStream {
  id: number;
  type: StreamType;
  name: string;
  logo: string;
  category_name: string | null;
  health_error: string | null;
  health_checked_at: number | null;
  down_since: number | null;
}

export interface StreamInput {
  type: StreamType;
  name: string;
  category_id: number | null;
  logo: string;
  source_url: string;
  backup_urls: string[];
  epg_channel_id: string;
  epg_locked?: boolean;
  container_extension: string;
  tv_archive_duration: number;
  sort_order: number;
  enabled: boolean;
  info: StreamInfo;
  package_ids: number[];
  delivery_mode?: DeliveryMode;
  transcode_profile_id?: number | null;
  always_on?: boolean;
  server_ids?: number[];
}

export type StreamSortMode = 'alpha' | 'alpha_desc' | 'number' | 'added' | 'added_desc' | 'epg';

export interface StreamListParams {
  type: StreamType;
  category_id?: number | '';
  search?: string;
  enabled?: 'true' | 'false' | '';
  health?: HealthStatus | '';
  package_id?: number | '';
  delivery_mode?: DeliveryMode | '';
  server_id?: number | '';
  source?: ContentSource | '';
  watching?: boolean;
  page?: number;
  limit?: number;
}

export type StreamBulkAction =
  | 'enable'
  | 'disable'
  | 'delete'
  | 'set_category'
  | 'add_to_package'
  | 'remove_from_package'
  | 'set_delivery';

export interface StreamBulkInput {
  ids: number[];
  action: StreamBulkAction;
  category_id?: number;
  package_id?: number;
  delivery_mode?: DeliveryMode;
  transcode_profile_id?: number | null;
  server_ids?: number[];
  always_on?: boolean;
}

export interface M3UImportInput {
  url?: string;
  content?: string;
  type: 'auto' | 'live' | 'movie';
  create_categories: boolean;
  package_id?: number;
  skip_duplicates: boolean;
}

export interface M3UImportResult {
  created: number;
  skipped: number;
  categories_created: number;
}

// ---------- Series ----------

export interface Series {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  cover: string;
  plot: string;
  cast: string;
  director: string;
  genre: string;
  release_date: string;
  rating: string;
  backdrop: string;
  youtube_trailer: string;
  episode_count: number;
  package_ids: number[];
  source: ContentSource;
  created_at: number;
}

export type SeriesInput = Omit<Series, 'id' | 'category_name' | 'episode_count' | 'source' | 'created_at'>;

export interface Episode {
  id: number;
  series_id: number;
  season: number;
  episode_num: number;
  name: string;
  source_url: string;
  container_extension: string;
  info: { plot: string; duration: string };
  enabled: boolean;
}

export type EpisodeInput = Omit<Episode, 'id' | 'series_id'>;

// ---------- Mensajes / Avisos / Cortes ----------

export type MessageTarget = 'all' | 'user' | 'package';

export interface Message {
  id: number;
  title: string;
  body: string;
  target: MessageTarget;
  user_id: number | null;
  package_id: number | null;
  target_label: string;
  expires_at: number | null;
  kind?: MessageKind;
  display?: MessageDisplay;
  reminder_id?: number | null;
  read_count: number;
  created_at: number;
}

export interface MessageInput {
  title: string;
  body: string;
  target: MessageTarget;
  user_id: number | null;
  package_id: number | null;
  expires_at: number | null;
  kind: MessageKind;
  display: MessageDisplay;
}

export type MessageKind = 'payment' | 'expiration' | 'maintenance' | 'promotion' | 'support' | 'general';
export type MessageDisplay = 'inbox' | 'popup';

export type ReminderRecurrence = 'once' | 'daily' | 'weekly' | 'monthly' | 'interval' | 'before_expiration';

export interface ReminderConfig {
  time?: string;
  weekdays?: number[];
  month_day?: number;
  every_days?: number;
  days_before?: number[];
}

export interface Reminder {
  id: number;
  title: string;
  body: string;
  kind: MessageKind;
  display: MessageDisplay;
  target: MessageTarget;
  user_id: number | null;
  package_id: number | null;
  target_label: string;
  recurrence: ReminderRecurrence;
  config: ReminderConfig;
  message_ttl_days: number;
  replace_previous: boolean;
  starts_at: number | null;
  ends_at: number | null;
  active: boolean;
  last_run_at: number | null;
  next_run_at: number | null;
  upcoming: number[];
  sent_count: number;
  created_at: number;
}

export type ReminderInput = Omit<Reminder, 'id' | 'target_label' | 'last_run_at' | 'next_run_at' | 'upcoming' | 'sent_count' | 'created_at'>;

export type NoticeLevel = 'info' | 'warning' | 'critical';
export type NoticeDisplay = 'banner' | 'popup' | 'ticker';

export interface Notice {
  id: number;
  title: string;
  body: string;
  level: NoticeLevel;
  display: NoticeDisplay;
  target: 'all' | 'package';
  package_id: number | null;
  starts_at: number | null;
  ends_at: number | null;
  sort_order?: number;
  duration_seconds?: number | null;
  active: boolean;
  created_at: number;
}

export type NoticeInput = Omit<Notice, 'id' | 'created_at'>;

export interface Outage {
  id: number;
  title: string;
  reason: string;
  scope: 'global' | 'package';
  package_id: number | null;
  starts_at: number;
  ends_at: number | null;
  block_playback: boolean;
  active_now: boolean;
  created_at: number;
}

export type OutageInput = Omit<Outage, 'id' | 'active_now' | 'created_at'>;

// ---------- Conexiones ----------

export interface Connection {
  id: number;
  user_id: number;
  username: string;
  stream_id: number | null;
  stream_name: string | null;
  ip: string;
  user_agent: string;
  started_at: number;
  last_seen_at: number;
  mode?: ConnectionMode;
  tracking?: ConnectionTracking;
  server_id?: number | null;
  server_name?: string | null;
}

export type ConnectionMode = 'redirect' | 'xtream_upstream' | 'proxy' | 'node' | 'app';
export type ConnectionTracking = 'exact' | 'estimated';

export interface StreamConnection {
  id: number;
  user_id: number;
  username: string;
  full_name: string | null;
  ip: string;
  user_agent: string;
  mode: ConnectionMode;
  tracking: ConnectionTracking;
  server_id: number | null;
  server_name: string | null;
  started_at: number;
  last_seen_at: number;
}

// ---------- Administradores ----------

export interface AdminAccount {
  id: number;
  username: string;
  role: Role;
  enabled: boolean;
  user_count: number;
  created_at: number;
}

export interface AdminInput {
  username: string;
  password?: string;
  role: Role;
  enabled: boolean;
}

// ---------- Ajustes ----------

export type StreamMode = 'redirect' | 'proxy' | 'xtream_upstream';

export interface XtreamDbSettings {
  host: string;
  port: number;
  user: string;
  database: string;
  password_set: boolean;
}

export interface Settings {
  server_name: string;
  public_url: string;
  /** La URL para clientes sigue a su interfaz si cambia la IP (DHCP, cortes de luz). */
  public_url_auto?: boolean;
  /** Interfaz de la IP de la URL (solo lectura). */
  public_url_interface?: string | null;
  /** Otras direcciones del portal (dominio, IP de otra red, VPN…) que prueban la app y los nodos. Máx. 10. */
  alternate_urls?: string[];
  /** Identificador fijo del portal (solo lectura). */
  install_id?: string;
  stream_mode: StreamMode;
  xtream_upstream_url: string;
  epg_url: string;
  company_name?: string;
  app_name?: string;
  support_email?: string;
  support_phone?: string;
  epg_refresh_hours?: number;
  epg_auto_match?: boolean;
  epg_min_score?: number;
  epg_country?: string;
  epg_fill_logos?: boolean;
  timezone: string;
  allow_all_without_package: boolean;
  connection_timeout_seconds: number;
  device_online_minutes: number;
  device_inactive_days: number;
  device_check_interval_minutes: number;
  tvbox_default_ownership: DeviceOwnership;
  device_alert_new_tvbox: boolean;
  device_inactive_message_client: boolean;
  stream_check_enabled: boolean;
  stream_check_interval_minutes: number;
  stream_check_batch: number;
  stream_check_concurrency: number;
  stream_check_timeout_seconds: number;
  cut_mode?: CutMode;
  notices_carousel_enabled?: boolean;
  notices_carousel_seconds?: number;
  node_fallback_direct?: boolean;
  node_offline_seconds?: number;
  xtream_db: XtreamDbSettings;
}

export type SettingsInput = Partial<Omit<Settings, 'xtream_db'>> & {
  xtream_db?: Partial<Omit<XtreamDbSettings, 'password_set'>> & { password?: string };
};

// ---------- Guía EPG ----------

export type EpgSourceStatus = 'pending' | 'refreshing' | 'ok' | 'error';

export interface EpgSource {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  /** Menor = preferida. */
  priority: number;
  status: EpgSourceStatus;
  last_error: string | null;
  channel_count: number;
  programme_count: number;
  first_programme_at?: number | null;
  last_programme_at?: number | null;
  /** Programas en emisión en este momento. */
  current_programmes?: number | null;
  /** La programación ya terminó: sirve para emparejar pero no muestra la guía de hoy. */
  outdated?: boolean;
  last_fetch_at: number | null;
  created_at: number;
}

export interface EpgGuideState {
  building: boolean;
  built_at: number | null;
  channels: number;
  programmes: number;
  size: number;
  exists: boolean;
  error: string | null;
}

export interface EpgStatus {
  sources: EpgSource[];
  guide: EpgGuideState;
  streams: { live: number; with_epg: number; without_epg: number; locked: number };
  epg_channels: number;
}

export interface EpgChannel {
  id: number;
  xmltv_id: string;
  display_names: string[];
  icon: string;
  country: string;
  source_id: number;
  source_name: string;
  used_by: number;
}

export interface EpgMatchCandidate {
  xmltv_id: string;
  display_name: string;
  icon?: string;
  source: string;
  score: number;
}

export type EpgMatchAction = 'assign' | 'suggest' | 'none';

export interface EpgMatchItem {
  stream_id: number;
  name: string;
  current: string | null;
  match: EpgMatchCandidate | null;
  alternatives: EpgMatchCandidate[];
  action: EpgMatchAction;
  logo_filled?: boolean;
}

export interface EpgMatchInput {
  stream_ids?: number[];
  filter?: { category_id?: number; search?: string; source?: string };
  only_missing: boolean;
  min_score?: number;
  fill_logos?: boolean;
  country?: string;
  dry_run?: boolean;
}

export interface EpgMatchResult {
  dry_run: boolean;
  checked: number;
  assigned: number;
  suggested: number;
  not_found: number;
  logos_filled: number;
  min_score: number;
  results: EpgMatchItem[];
}

export interface EpgAssignResult {
  ok: boolean;
  stream_id: number;
  epg_channel_id: string;
  epg_locked: boolean;
}

// ---------- Red del servidor ----------

export type NetworkPortType = 'ethernet' | 'wifi' | 'vpn' | 'virtual' | 'loopback' | string;
export type IpScope = 'public' | 'private' | 'cgnat' | 'link-local' | 'loopback' | string;

export interface NetworkAddress {
  address: string;
  family: 'IPv4' | 'IPv6' | string;
  cidr: number | null;
  scope: IpScope;
}

export interface NetworkPort {
  name: string;
  description: string;
  type: NetworkPortType;
  type_label: string;
  status: 'up' | 'down' | 'disconnected' | string;
  speed_mbps: number | null;
  mac: string | null;
  physical?: boolean;
  default_route: boolean;
  gateway: string | null;
  addresses: NetworkAddress[];
}

export interface ListeningPort {
  ip: string;
  port: number;
  process: string | null;
  all_interfaces: boolean;
  scope: string;
  service: string | null;
  portal: boolean;
}

export interface NetworkSuggestion {
  url: string;
  ip: string;
  port: number;
  interface: string;
  interface_type: NetworkPortType;
  scope: IpScope;
  default_route: boolean;
  reason: string;
  responds: boolean;
}

export interface PublicIpInfo {
  address: string | null;
  source?: string | null;
  scope?: IpScope | null;
  error?: string | null;
}

export interface PortListener {
  port: number;
  role: 'panel' | 'clients' | string;
  status: 'listening' | 'waiting' | 'error' | string;
  error: string | null;
  /** Milisegundos desde que está en ese estado. */
  since: number | null;
}

export interface PortsInfo {
  panel_port: number;
  client_ports: number[];
  source: 'panel' | 'env' | string;
  discovery_port: number | null;
  public_url: string;
  listeners: PortListener[];
  firewall_helper: boolean;
  /** Separación panel / clientes: el panel no atiende a los clientes y los puertos de clientes no sirven el panel. */
  separate_ports?: boolean;
  separation_active?: boolean;
  xtream: { on_server: string | null; migrated_from: string | null; suggested_port: number | null; original_port: number | null };
}

export interface PortsSaveResult extends PortsInfo {
  results: { port: number; ok: boolean; error?: string; closed?: boolean; already?: boolean }[];
  public_url_changed: string | null;
  firewall: { port: number; ok: boolean; manual?: string; error?: string }[];
}

export interface PortCheck {
  port: number;
  available: boolean;
  in_use_by_portal?: boolean;
  panel?: boolean;
  code?: string;
  error?: string;
}

export interface NetworkInfo {
  network_ports: NetworkPort[];
  listening: ListeningPort[];
  portal_ports: number[];
  suggestions: NetworkSuggestion[];
  public_ip: PublicIpInfo | string | null;
  current_public_url: string;
  effective_base_url: string;
}

// ---------- Versión y actualizaciones (GitHub) ----------

export interface GithubAppRelease {
  tag: string;
  version_name: string;
  name: string | null;
  notes: string | null;
  prerelease: boolean;
  published_at: number | null;
  url: string | null;
  assets: { name: string; size: number; abi: string | null; sha256: string | null; download_url: string }[];
}

export interface UpdatesOverview {
  current: {
    version: string;
    commit: string | null;
    branch: string | null;
    repo: string | null;
    installed_at: number | null;
    source: 'installer' | 'git' | 'unknown' | string;
    node: string;
  };
  /** Repositorio y rama de las actualizaciones (automáticos). */
  repo: string;
  branch: string;
  settings: UpdatesSettings;
  checking: boolean;
  importing: boolean;
  last: {
    checked_at: number | null;
    repo: string;
    branch: string;
    error: string | null;
    panel: {
      current_version: string;
      current_commit: string | null;
      latest_version: string | null;
      latest_commit: string | null;
      latest_message: string | null;
      latest_date: number | null;
      update_available: boolean | null;
      commits_behind: number | null;
      changes: { sha: string; message: string; date: number | null }[];
      install_command: string | null;
      compare_url: string | null;
    } | null;
    app: {
      latest: GithubAppRelease | null;
      beta: GithubAppRelease | null;
      imported: boolean;
      release_id: number | null;
      published: boolean;
    } | null;
  } | null;
}

export interface UpdatesSettings {
  check_enabled: boolean;
  check_hours: number;
  auto_import_app: boolean;
  auto_publish_app: boolean;
}

export interface AppImportResult {
  tag: string;
  version_name: string;
  release_id: number | null;
  published: boolean;
  files: ({ name: string; abi: string; version_code: number; replaced: boolean; warnings: string[] } | { name: string; error: string })[];
  overview: UpdatesOverview;
}

export interface DashboardUpdates {
  version: string;
  checked_at: number | null;
  panel_update_available: boolean | null;
  app_latest: string | null;
  app_update_pending: boolean;
}

// ---------- Actualizaciones de la app ----------

export type AppTarget = 'tvbox' | 'smart_tv' | 'mobile' | 'tablet' | 'pc' | 'stb';

export interface AppReleaseFile {
  id: number;
  abi: string;
  version_code: number;
  filename: string;
  size: number;
  sha256: string;
  downloads: number;
  created_at: number;
  missing: boolean;
}

export interface AppRelease {
  id: number;
  package_name: string;
  version_name: string;
  version_code: number;
  channel: 'stable' | 'beta';
  notes: string;
  mandatory: boolean;
  published: boolean;
  targets: AppTarget[];
  rollout_percent: number;
  min_sdk: number | null;
  target_sdk: number | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  published_at: number | null;
  downloads: number;
  installed_devices?: number;
  files: AppReleaseFile[];
}

export interface AppReleasesOverview {
  items: AppRelease[];
  devices_by_version: { version: string; distribution: string | null; devices: number }[];
  targets: AppTarget[];
}

export interface AppUploadResult {
  release: AppRelease;
  file: AppReleaseFile;
  replaced: boolean;
  warnings: string[];
  apk: { package: string; versionCode: number; versionName: string; minSdk: number | null; targetSdk: number | null; abis: string[]; abi: string };
}

export type AppReleaseInput = Partial<Pick<AppRelease, 'notes' | 'channel' | 'mandatory' | 'targets' | 'rollout_percent' | 'published'>>;

// ---------- Copias de seguridad ----------

export type BackupTrigger = 'manual' | 'scheduled' | 'pre_restore' | 'upload' | 'drive' | string;
export type BackupDriveStatus = 'none' | 'pending' | 'uploading' | 'ok' | 'error' | string;

export interface Backup {
  id: number;
  filename: string;
  size: number;
  sha256: string | null;
  status: 'running' | 'ok' | 'error' | string;
  error: string | null;
  trigger: BackupTrigger;
  note: string | null;
  encrypted: boolean;
  pinned: boolean;
  app_version: string | null;
  server_name: string | null;
  backup_created_at: number | null;
  tables: Record<string, number> | null;
  total_rows: number | null;
  options: { include_logs?: boolean; include_epg?: boolean } | null;
  created_by: string | null;
  created_at: number;
  finished_at: number | null;
  local: boolean;
  drive: { status: BackupDriveStatus; file_id: string | null; error: string | null; uploaded_at: number | null; attempts: number };
  restored_at: number | null;
}

export type BackupFrequency = 'daily' | 'weekly' | 'hours';

export interface BackupSettings {
  schedule_enabled: boolean;
  frequency: BackupFrequency;
  time: string;
  weekdays: number[];
  every_hours: number;
  keep_local: number;
  include_logs: boolean;
  include_epg: boolean;
  encrypt: boolean;
  password_set: boolean;
  last_scheduled_at: number | null;
  google_drive: {
    auto_upload: boolean;
    keep: number;
    folder_name: string;
    folder_id: string;
    client_id: string;
    client_secret_set: boolean;
    account_email: string;
    connected_at: number | null;
    connected: boolean;
  };
}

export type BackupSettingsInput = Partial<Omit<BackupSettings, 'password_set' | 'last_scheduled_at' | 'google_drive'>> & {
  password?: string;
  clear_password?: boolean;
  google_drive?: Partial<{ auto_upload: boolean; keep: number; folder_name: string; client_id: string; client_secret: string }>;
};

export interface DriveConnectState {
  status: 'idle' | 'pending' | 'connected' | 'denied' | 'expired' | 'error' | string;
  user_code?: string;
  verification_url?: string;
  expires_at?: number;
  interval?: number;
  error?: string | null;
  account_email?: string | null;
  connected?: boolean;
}

export interface BackupsOverview {
  items: Backup[];
  last_status: string | null;
  last_at: number | null;
  last_error: string | null;
  last_ok_at: number | null;
  next_run_at: number | null;
  schedule_enabled: boolean;
  drive_connected: boolean;
  running: { kind: 'backup' | 'restore' | string; id: number | null; started_at: number } | null;
  settings: BackupSettings;
  timezone: string;
  drive: { connected: boolean; account_email: string | null; folder_name: string; connection: DriveConnectState };
  storage: { dir: string; used_bytes: number; free_bytes: number };
}

export interface BackupRestoreResult {
  ok: boolean;
  backup: Backup;
  safety_backup: Backup | null;
  tables: Record<string, number>;
  total_rows: number;
  warnings: string[];
  relogin_required: boolean;
}

export interface DriveFile {
  id: string;
  name: string;
  size: number;
  created_at: number | null;
  encrypted: boolean;
  server_name: string | null;
  backup_id: number | null;
  local_backup_id: number | null;
  local: boolean;
  pinned: boolean;
}

export interface DashboardBackups {
  last_status: string | null;
  last_at: number | null;
  last_error: string | null;
  last_ok_at: number | null;
  next_run_at: number | null;
  schedule_enabled: boolean;
  drive_connected: boolean;
  running: unknown;
}

// ---------- Registro ----------

export interface LogEntry {
  id: number;
  admin_id: number | null;
  admin_username: string | null;
  action: string;
  entity: string | null;
  entity_id: number | string | null;
  details: unknown;
  created_at: number;
}

// ---------- Panel ----------

export interface Dashboard {
  users: {
    total: number;
    active: number;
    expired: number;
    suspended: number;
    disabled: number;
    trial: number;
    expiring_7d: number;
  };
  content: {
    live: number;
    movie: number;
    series: number;
    episodes: number;
    categories: number;
    packages: number;
  };
  active_connections: number;
  devices?: { online: number; total: number; open_alerts: number };
  content_health?: { live: HealthCounts; movie: HealthCounts };
  stream_check?: { running: boolean; last_result: StreamCheckRun | null };
  offline_streams?: OfflineStream[];
  active_outages: number;
  backups?: DashboardBackups | null;
  updates?: DashboardUpdates | null;
  expiring_soon: User[];
  recent_logs: LogEntry[];
}

// ---------- Dispositivos ----------

export type DeviceType = 'tvbox' | 'smart_tv' | 'mobile' | 'tablet' | 'pc' | 'stb' | 'unknown';
export type DeviceOwnership = 'company' | 'client' | 'unknown';
export type DeviceInventoryStatus = 'available' | 'assigned' | 'review' | 'retired';
export type DeviceActivity = 'xtream_api' | 'm3u' | 'stream' | 'app';
export type DeviceSource = 'auto' | 'manual';

export interface Device {
  id: number;
  name: string;
  display_name: string;
  type: DeviceType;
  type_label: string;
  type_locked: boolean;
  brand: string;
  model: string;
  os: string;
  app: string;
  mac: string;
  serial: string;
  device_id: string;
  user_agent: string;
  ownership: DeviceOwnership;
  inventory_status: DeviceInventoryStatus;
  user_id: number | null;
  username: string | null;
  client_name: string | null;
  last_user_id: number | null;
  last_username: string | null;
  source: DeviceSource;
  notes: string;
  last_ip: string | null;
  last_activity: DeviceActivity | null;
  first_seen_at: number | null;
  last_seen_at: number | null;
  online: boolean;
  inactive: boolean;
  open_alerts: number;
  created_at: number;
}

/** Filtros del listado de dispositivos (sin paginación ni orden); se usan también para las acciones en lote. */
export type DeviceFilterParams = Omit<DeviceListParams, 'sort' | 'order' | 'page' | 'limit'>;

export type DeviceBulkAction = 'delete' | 'set_ownership' | 'set_inventory' | 'set_type' | 'unassign' | 'resolve_alerts';

export type DeviceBulkInput = { action: DeviceBulkAction; value?: string } & ({ ids: number[] } | { filter: DeviceFilterParams });

export interface DeviceBulkResult {
  affected: number;
  selected?: number;
}

export interface DeviceIdsResult {
  ids: number[];
  total: number;
  truncated: boolean;
}

export type DeviceDuplicateReason = 'same_signature' | 'same_session' | 'mixed';

export interface DeviceDuplicateGroup {
  key: string;
  reason: DeviceDuplicateReason | string;
  /** Registro sugerido para conservar. */
  target_id: number;
  device_ids: number[];
  devices: Device[];
}

export interface DeviceDuplicates {
  groups: DeviceDuplicateGroup[];
  /** Dispositivos que sobran (se eliminarían al fusionar). */
  duplicate_devices: number;
  orphans: number;
}

export interface DeviceMergeResult {
  merged: number;
  device: Device;
}

export interface DeviceDedupeResult {
  dry_run: boolean;
  groups: number;
  merged: number;
}

export interface DeviceCleanupResult {
  dry_run: boolean;
  orphans: number;
  deleted: number;
}

export interface DeviceInput {
  name: string;
  type: DeviceType;
  brand: string;
  model: string;
  os: string;
  mac: string;
  serial: string;
  device_id: string;
  ownership: DeviceOwnership;
  inventory_status: DeviceInventoryStatus;
  user_id: number | null;
  notes: string;
}

export interface DeviceListParams {
  search?: string;
  type?: DeviceType | '';
  ownership?: DeviceOwnership | '';
  inventory_status?: DeviceInventoryStatus | '';
  user_id?: number | '';
  unassigned?: boolean;
  source?: DeviceSource | '';
  online?: boolean;
  inactive?: boolean;
  with_alerts?: boolean;
  sort?: 'last_seen_at' | 'created_at' | 'type';
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface DeviceStats {
  total: number;
  online: number;
  inactive: number;
  company_tvbox: number;
  in_stock: number;
  unassigned: number;
  open_alerts: number;
  by_type: Partial<Record<DeviceType, number>>;
  last_check_at: number | null;
  settings?: {
    device_online_minutes?: number;
    device_inactive_days?: number;
    device_check_interval_minutes?: number;
  };
}

export type DeviceAlertType = 'inactive' | 'new_tvbox' | 'foreign_user';
export type DeviceAlertStatus = 'open' | 'resolved';

export interface DeviceAlert {
  id: number;
  device_id: number;
  device_name: string;
  device_type: DeviceType;
  user_id: number | null;
  username: string | null;
  type: DeviceAlertType;
  message: string;
  status: DeviceAlertStatus;
  resolution: string | null;
  created_at: number;
  resolved_at: number | null;
}

export interface DeviceCheckResult {
  checked_at: number;
  inactive_found: number;
  alerts_created: number;
}

// ---------- Streaming: servidores, perfiles y Astra ----------

export type DeliveryMode = 'default' | 'direct' | 'restream' | 'transcode';
export type ServerStatus = 'pending' | 'online' | 'offline' | 'disabled';

export interface DeliveryValue {
  delivery_mode: DeliveryMode;
  transcode_profile_id: number | null;
  server_ids: number[];
  always_on: boolean;
}

export interface StreamingServer {
  id: number;
  name: string;
  public_url: string;
  enabled: boolean;
  max_clients: number;
  weight: number;
  status: ServerStatus;
  last_heartbeat_at: number | null;
  last_ip: string | null;
  version: string | null;
  hardware: {
    ffmpeg?: string | null;
    encoders?: string[];
    nvidia?: boolean;
    intel_gpu?: boolean;
    cpu_model?: string | null;
    cores?: number | null;
    platform?: string | null;
  } | null;
  metrics: {
    cpu?: number | null;
    cores?: number | null;
    load_avg?: number[] | null;
    mem_total?: number | null;
    mem_percent?: number | null;
    rx_bps?: number | null;
    tx_bps?: number | null;
    uptime?: number | null;
    clients_total?: number | null;
  } | null;
  streams_running: number;
  streams_error: number;
  clients: number;
  assigned_streams: number;
  notes: string;
  install_command: string;
  token: string;
  created_at: number;
  /** Interfaces de red que informa el nodo (null si aún no las informó). */
  network?: ServerNetwork | null;
  url_suggestions?: ServerUrlSuggestion[];
  /** La URL pública sigue a su interfaz si cambia la IP del nodo. */
  public_url_auto?: boolean;
  public_url_interface?: string | null;
}

export interface ServerNetwork {
  hostname: string | null;
  listen_port: number | null;
  reported_at: number | null;
  ports: NetworkPort[];
}

export interface ServerUrlSuggestion {
  url: string;
  ip: string;
  port: number;
  interface: string;
  interface_type: string;
  scope: string;
  default_route: boolean;
  in_use: boolean;
}

export interface ServerInput {
  name: string;
  public_url: string;
  public_url_auto: boolean;
  max_clients: number;
  weight: number;
  enabled: boolean;
  notes: string;
}

export type ServerStreamState = 'idle' | 'starting' | 'running' | 'error';

export interface ServerStream {
  stream_id: number;
  name: string;
  delivery_mode: DeliveryMode;
  assigned: boolean;
  priority: number | null;
  always_on: boolean;
  state: ServerStreamState;
  uptime: number | null;
  bitrate_kbps: number | null;
  clients: number;
  restarts: number;
  last_error: string | null;
}

export type TranscodeHw = 'cpu' | 'nvenc' | 'qsv' | 'vaapi';

export interface TranscodeProfile {
  id: number;
  name: string;
  hw: TranscodeHw;
  video_codec: 'h264' | 'hevc';
  preset: string;
  resolution: 'source' | '2160' | '1080' | '720' | '576' | '480' | '360';
  video_bitrate_kbps: number;
  max_bitrate_kbps: number | null;
  fps: number | null;
  gop: number;
  deinterlace: boolean;
  audio_codec: 'copy' | 'aac';
  audio_bitrate_kbps: number;
  audio_channels: number | null;
  extra_args: string;
  stream_count: number;
  created_at: number;
}

export type TranscodeProfileInput = Omit<TranscodeProfile, 'id' | 'stream_count' | 'created_at'>;

export interface AstraImportDefaults {
  category_mode: 'group' | 'fixed';
  category_id: number | null;
  delivery_mode: DeliveryMode;
  transcode_profile_id: number | null;
  server_ids: number[];
  package_id: number | null;
  always_on: boolean;
}

export interface AstraSource {
  id: number;
  name: string;
  api_url: string;
  username: string;
  password_set: boolean;
  play_url: string;
  url_mode: 'play' | 'output';
  play_path: string;
  enabled: boolean;
  sync_interval_minutes: number;
  status_poll: boolean;
  status_interval_minutes: number;
  auto_import_new: boolean;
  disable_removed: boolean;
  sync_names: boolean;
  import_defaults: Partial<AstraImportDefaults>;
  last_sync_at: number | null;
  last_status_at: number | null;
  last_error: string | null;
  counts: { channels: number; imported: number; not_imported: number; removed: number; onair: number; offair: number };
  created_at: number;
}

export type AstraSourceInput = Partial<
  Omit<AstraSource, 'id' | 'password_set' | 'last_sync_at' | 'last_status_at' | 'last_error' | 'counts' | 'created_at'>
> & { password?: string };

export interface AstraTestResult {
  ok: boolean;
  total: number;
  enabled: number;
  groups: string[];
  sample: { astra_id: string; name: string; enabled: boolean; group: string; play_url: string; outputs: string[] }[];
}

export interface AstraSyncResult {
  total: number;
  new: number;
  updated: number;
  removed: number;
  restored: number;
  streams_updated: number;
  streams_disabled: number;
  imported: number;
}

export interface AstraChannel {
  id: number;
  astra_id: string;
  name: string;
  enabled: boolean;
  group: string;
  inputs: unknown[];
  outputs: unknown[];
  play_url: string;
  removed: boolean;
  stream_id: number | null;
  stream_name: string | null;
  stream_enabled: boolean | null;
  stream_delivery_mode: DeliveryMode | null;
  onair: boolean | null;
  bitrate_kbps: number | null;
  cc_errors: number | null;
  sessions: number | null;
  status_checked_at: number | null;
  synced_at: number;
}

// ---------- Modos de corte / facturación externa ----------

export type CutMode = 'manual' | 'external' | 'both';
export type SuspensionSource = 'manual' | 'external';
export type BillingMatchBy = 'document' | 'email' | 'phone' | 'username';
export type BillingFieldKey = 'id' | 'status' | 'document' | 'username' | 'name' | 'email' | 'phone' | 'plan';
export type MappedStatus = 'free' | 'active' | 'suspended' | 'disabled' | 'unknown' | null;

export interface ExternalService {
  external_id: string;
  status: string;
  plan: string;
}

export interface BillingConfig {
  enabled: boolean;
  provider: 'wisphub' | 'custom';
  base_url: string;
  list_path: string;
  auth_header: string;
  auth_prefix: string;
  page_size: number;
  results_path: string;
  fields: Record<BillingFieldKey, string>;
  status_map: { free?: string[]; active: string[]; suspended: string[]; disabled: string[] };
  match_by: BillingMatchBy[];
  auto_link: boolean;
  reactivate: boolean;
  interval_minutes: number;
  suspension_reason: string;
  webhook_token?: string;
  api_key_set?: boolean;
  /** Últimos caracteres de la API Key guardada, p. ej. "••••a1b2". */
  api_key_hint?: string | null;
}

export type BillingConfigInput = Partial<Omit<BillingConfig, 'api_key_set' | 'api_key_hint' | 'webhook_token'>> & { api_key?: string };

export interface BillingRunStats {
  fetched?: number;
  linked_now?: number;
  linked_total?: number;
  suspended?: number;
  disabled?: number;
  reactivated?: number;
  skipped_manual?: number;
  unknown_status?: number;
  unchanged?: number;
  unlinked_external?: number;
  applied?: boolean;
  /** Cuentas revisadas (revisión de suspendidos). */
  checked?: number;
  scope?: string;
}

export type BillingChangeAction = 'suspend' | 'disable' | 'reactivate' | 'skip_manual' | 'unknown_status';

export interface BillingChange {
  user_id: number | null;
  username: string | null;
  external_id: string;
  external_name: string;
  external_status: string;
  action: BillingChangeAction;
  /** Servicios de la plataforma que tiene la cuenta. */
  services?: number;
}

export interface BillingRun {
  id: number;
  provider?: string;
  trigger: 'auto' | 'manual' | 'dry_run' | 'webhook' | string;
  status: string;
  stats: BillingRunStats;
  changes?: BillingChange[];
  error?: string | null;
  started_at?: number;
  finished_at?: number | null;
}

export interface BillingOverview {
  cut_mode: CutMode;
  config: BillingConfig;
  presets: { wisphub: Partial<BillingConfig> };
  running: boolean;
  counts: {
    external_clients: number;
    linked: number;
    unlinked_external: number;
    iptv_unlinked: number;
    suspended_by_external: number;
    /** Cuentas vinculadas cortadas ahora. */
    cut_linked?: number;
  };
  last_run: BillingRun | null;
  webhook_path: string | null;
  auto_sync?: BillingAutoSync;
}

export interface BillingAutoSync {
  enabled: boolean;
  interval_minutes: number;
  running: boolean;
  last_run_at: number | null;
  last_status: string | null;
  next_run_at: number | null;
}

export interface BillingUserRefresh {
  applied: boolean;
  method: 'detail' | 'list' | string;
  change: { user_id: number; username: string; external_id: string; external_status: string; action: string; services?: number } | null;
  services: { external_id: string; name: string; status: string; status_mapped: MappedStatus; plan: string }[];
  missing: string[];
  user: User | null;
}

export interface BillingTestResult {
  ok: boolean;
  total: number;
  /** URL base que funcionó. */
  base_url?: string;
  /** No nulo si la URL guardada no terminaba en /api y el servidor la corrigió. */
  base_url_corrected?: string | null;
  sample: {
    external_id: string;
    status: string;
    document_id: string;
    username: string;
    name: string;
    email: string;
    phone: string;
    plan: string;
  }[];
  raw_keys: string[];
  status_values: { value: string; maps_to: MappedStatus }[];
  missing_fields: { field: string; path: string }[];
}

export interface ExternalClient {
  id: number;
  external_id: string;
  name: string;
  document_id: string;
  username: string;
  email: string;
  phone: string;
  plan: string;
  status: string;
  status_mapped: MappedStatus;
  user_id: number | null;
  iptv_username: string | null;
  iptv_status: 'active' | 'suspended' | 'disabled' | null;
  iptv_suspension_source: SuspensionSource | null;
  link_method: string | null;
  synced_at: number | null;
}

export interface StatusCounts {
  free?: number;
  active: number;
  suspended: number;
  disabled: number;
  unknown: number;
}

export interface ExternalClientsSummary {
  total: number;
  linked: number;
  by_status: StatusCounts;
  unlinked_by_status: StatusCounts;
  plans: { name: string; count: number }[];
}

export type BulkLinkStatus = 'all' | 'free' | 'active' | 'suspended' | 'disabled' | 'unknown';

export interface BulkLinkInput {
  status: BulkLinkStatus;
  plan_contains?: string;
  search?: string;
  ids?: number[];
  match_by?: BillingMatchBy[];
  create_missing: boolean;
  apply_status: boolean;
  dry_run: boolean;
  create?: {
    username_from: 'usuario' | 'cedula' | 'email' | 'id';
    password_mode: 'random' | 'cedula' | 'fixed';
    password?: string;
    package_ids: number[];
    max_connections: number;
    duration: { amount: number; unit: 'days' | 'months' } | null;
  };
}

export type BulkLinkAction = 'link' | 'create' | 'no_match' | 'ambiguous';

export interface BulkLinkItem {
  external_id: string;
  name: string;
  external_status: string;
  action: BulkLinkAction;
  username?: string | null;
  method?: string | null;
  status_applied?: 'free' | 'active' | 'suspended' | 'disabled' | null;
  status_skipped?: string | null;
}

export interface BulkLinkCredential {
  username: string;
  password: string;
  password_source?: 'cedula' | 'random' | 'fixed';
  name: string;
  external_id: string;
}

export interface BulkLinkResult {
  dry_run: boolean;
  selected: number;
  linked: number;
  created: number;
  /** Servicios extra de una persona unidos a una cuenta creada en la misma ejecución. */
  grouped?: number;
  /** Cuentas IPTV resultantes. */
  accounts?: number;
  no_match: number;
  ambiguous: number;
  status_applied: { free?: number; active: number; suspended: number; disabled: number };
  items: BulkLinkItem[];
  credentials: BulkLinkCredential[];
}

// ---------- Consumo del servidor ----------

export interface MetricsSample {
  t: number;
  cpu: number | null;
  mem: number | null;
  rx_bps: number | null;
  tx_bps: number | null;
}

export interface SystemMetrics {
  sampled_at: number;
  hostname: string;
  platform: string;
  node_version: string;
  cpu: { model: string; cores: number; usage_percent: number | null; load_avg: number[] | null };
  memory: { total: number; used: number; free: number; percent: number; process_rss: number };
  disk: { path: string; total: number; used: number; free: number; percent: number } | null;
  network: { available: boolean; rx_bps: number | null; tx_bps: number | null };
  uptime: { system: number; process: number };
  history: MetricsSample[];
}

// ---------- Migración XtreamUI ----------

export interface XtreamTestInput {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  save: boolean;
}

export interface XtreamCounts {
  users: number;
  resellers: number;
  bouquets: number;
  categories: number;
  live: number;
  movie: number;
  series: number;
  episodes: number;
}

export interface XtreamTestResult {
  ok: boolean;
  counts: XtreamCounts;
}

export interface XtreamOptions {
  categories: boolean;
  packages: boolean;
  streams: boolean;
  series: boolean;
  users: boolean;
  resellers: boolean;
  overwrite: boolean;
}

export interface JobStat {
  created: number;
  updated: number;
  skipped: number;
}

export type JobStatus = 'running' | 'done' | 'error';

export interface XtreamJob {
  id: string;
  status: JobStatus;
  progress: { step: string; current: number; total: number } | null;
  stats: Partial<Record<string, Partial<JobStat>>> | null;
  log?: string[];
  error: string | null;
  reseller_credentials?: { username: string; password: string }[];
  started_at: number;
  finished_at: number | null;
}
