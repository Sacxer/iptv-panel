import type {
  AdminAccount,
  AdminInput,
  AdminMe,
  AffectedResponse,
  AstraChannel,
  AstraImportDefaults,
  AstraSource,
  AstraSourceInput,
  AstraSyncResult,
  AstraTestResult,
  ServerInput,
  ServerStream,
  StreamConnection,
  StreamingServer,
  TranscodeProfile,
  TranscodeProfileInput,
  BillingConfigInput,
  BillingOverview,
  BillingRun,
  BillingTestResult,
  BulkLinkInput,
  BulkLinkResult,
  ExternalClientsSummary,
  CutMode,
  ExternalClient,
  MessageKind,
  Reminder,
  ReminderInput,
  Category,
  CategoryInput,
  CategoryType,
  Connection,
  Dashboard,
  Device,
  DeviceAlert,
  DeviceAlertStatus,
  DeviceAlertType,
  AppImportResult,
  AppRelease,
  UpdatesOverview,
  UpdatesSettings,
  AppReleaseInput,
  AppReleasesOverview,
  AppUploadResult,
  Backup,
  BackupFrequency,
  BackupRestoreResult,
  BackupSettingsInput,
  BackupsOverview,
  BillingUserRefresh,
  DeviceBulkInput,
  DriveConnectState,
  DriveFile,
  EpgAssignResult,
  EpgChannel,
  EpgGuideState,
  EpgMatchInput,
  EpgMatchResult,
  EpgSource,
  EpgStatus,
  NetworkInfo,
  PublicIpInfo,
  DeviceBulkResult,
  DeviceCheckResult,
  DeviceFilterParams,
  DeviceIdsResult,
  DeviceCleanupResult,
  DeviceDedupeResult,
  DeviceDuplicates,
  DeviceMergeResult,
  DeviceInput,
  DeviceListParams,
  DeviceStats,
  Episode,
  EpisodeInput,
  LogEntry,
  LoginResponse,
  M3UImportInput,
  M3UImportResult,
  Message,
  MessageInput,
  Notice,
  NoticeInput,
  OkResponse,
  Outage,
  OutageInput,
  Package,
  PackageInput,
  Paginated,
  Series,
  SeriesInput,
  Settings,
  SettingsInput,
  Stream,
  StreamBulkInput,
  StreamSortMode,
  StreamType,
  StreamCheckResponse,
  StreamHealth,
  SystemMetrics,
  StreamInput,
  StreamListParams,
  TimeUnit,
  User,
  UserAccess,
  UserBulkInput,
  UserInput,
  UserListParams,
  XtreamJob,
  XtreamOptions,
  XtreamTestInput,
  XtreamTestResult,
} from './types';

const BASE = '/api/admin';
const TOKEN_KEY = 'iptv_admin_token';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Registra la acción a ejecutar cuando la API responde 401 (sesión caducada). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

type QueryValue = string | number | boolean | null | undefined;

function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

const HTTP_MESSAGES: Record<number, string> = {
  400: 'Solicitud inválida',
  401: 'Sesión no válida',
  403: 'No tienes permiso para realizar esta acción',
  404: 'No encontrado',
  409: 'Conflicto: el registro ya existe',
  422: 'Datos inválidos',
  429: 'Demasiadas solicitudes, intenta más tarde',
  500: 'Error interno del servidor',
  502: 'El servidor no está disponible',
  503: 'El servidor no está disponible',
};

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; query?: Record<string, QueryValue> } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${buildQuery(options.query)}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor', 0);
  }

  const text = await res.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!res.ok) {
    const serverMsg =
      payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : null;
    const isLogin = path === '/auth/login';
    if (res.status === 401 && !isLogin) {
      setToken(null);
      if (unauthorizedHandler) unauthorizedHandler();
      else window.location.assign(`${import.meta.env.BASE_URL}login`);
    }
    throw new ApiError(serverMsg ?? HTTP_MESSAGES[res.status] ?? `Error ${res.status}`, res.status);
  }

  return payload as T;
}

/** Sube un archivo .iptvbak como cuerpo binario, informando el progreso (0-1). */
export function uploadBackupFile(file: File, onProgress: (fraction: number) => void): { promise: Promise<Backup>; abort: () => void } {
  return uploadRawFile<Backup>(`/backups/upload?name=${encodeURIComponent(file.name)}`, file, onProgress);
}

/** Sube un APK como cuerpo binario, informando el progreso (0-1). */
export function uploadAppApk(file: File, onProgress: (fraction: number) => void): { promise: Promise<AppUploadResult>; abort: () => void } {
  return uploadRawFile<AppUploadResult>(`/app-releases/upload?name=${encodeURIComponent(file.name)}`, file, onProgress);
}

/** Descarga un archivo protegido con la sesión y lo guarda con el nombre indicado. */
export async function downloadWithToken(url: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let msg: string | null = null;
    try {
      const j = (await res.json()) as { error?: string };
      msg = j.error ?? null;
    } catch {
      msg = null;
    }
    throw new ApiError(msg ?? HTTP_MESSAGES[res.status] ?? `Error ${res.status}`, res.status);
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 2000);
}

/** Envía un archivo como cuerpo binario (application/octet-stream) con progreso de subida. */
export function uploadRawFile<T>(path: string, file: File, onProgress: (fraction: number) => void): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('POST', `${BASE}${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload as T);
      else {
        const msg = payload && typeof payload === 'object' && 'error' in payload ? String((payload as { error: unknown }).error) : null;
        if (xhr.status === 401) {
          setToken(null);
          if (unauthorizedHandler) unauthorizedHandler();
        }
        reject(new ApiError(msg ?? HTTP_MESSAGES[xhr.status] ?? `Error ${xhr.status}`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('No se pudo conectar con el servidor', 0));
    xhr.onabort = () => reject(new ApiError('Subida cancelada', 0));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Error desconocido';
}

const get = <T>(path: string, query?: Record<string, QueryValue>) => request<T>('GET', path, { query });
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} });
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, { body });
const del = <T = OkResponse>(path: string) => request<T>('DELETE', path);

/**
 * Descarga todas las páginas de un listado paginado (útil para selectores).
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<Paginated<T>>,
  limit = 500,
  maxPages = 200,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchPage(page, limit);
    const rows = res?.data ?? [];
    out.push(...rows);
    if (rows.length === 0 || out.length >= (res.total ?? 0)) break;
  }
  return out;
}

export const api = {
  auth: {
    login: (username: string, password: string) => post<LoginResponse>('/auth/login', { username, password }),
    me: () => get<AdminMe>('/auth/me'),
    changePassword: (current_password: string, new_password: string) =>
      post<OkResponse>('/auth/password', { current_password, new_password }),
  },

  dashboard: () => get<Dashboard>('/dashboard'),

  users: {
    list: (params: UserListParams) => get<Paginated<User>>('/users', { ...params }),
    get: (id: number) => get<User>(`/users/${id}`),
    create: (input: UserInput) => post<User>('/users', input),
    update: (id: number, input: UserInput) => put<User>(`/users/${id}`, input),
    remove: (id: number) => del(`/users/${id}`),
    suspend: (id: number, reason: string) => post<User>(`/users/${id}/suspend`, { reason }),
    reactivate: (id: number) => post<User>(`/users/${id}/reactivate`),
    extend: (id: number, amount: number, unit: TimeUnit) => post<User>(`/users/${id}/extend`, { amount, unit }),
    bulk: (input: UserBulkInput) => post<AffectedResponse>('/users/bulk', input),
    connections: (id: number) => get<Connection[]>(`/users/${id}/connections`),
    access: (id: number) => get<UserAccess>(`/users/${id}/m3u-url`),
  },

  packages: {
    list: () => get<Package[]>('/packages'),
    get: (id: number) => get<Package>(`/packages/${id}`),
    create: (input: PackageInput) => post<Package>('/packages', input),
    update: (id: number, input: Partial<PackageInput>) => put<Package>(`/packages/${id}`, input),
    remove: (id: number) => del(`/packages/${id}`),
  },

  categories: {
    list: (type?: CategoryType) => get<Category[]>('/categories', { type }),
    create: (input: CategoryInput) => post<Category>('/categories', input),
    update: (id: number, input: Partial<CategoryInput>) => put<Category>(`/categories/${id}`, input),
    remove: (id: number) => del(`/categories/${id}`),
    reorder: (ids: number[]) => post<{ ok: boolean; updated: number }>('/categories/reorder', { ids }),
  },

  streams: {
    list: (params: StreamListParams) => get<Paginated<Stream>>('/streams', { ...params }),
    get: (id: number) => get<Stream>(`/streams/${id}`),
    create: (input: StreamInput) => post<Stream>('/streams', input),
    update: (id: number, input: Partial<StreamInput>) => put<Stream>(`/streams/${id}`, input),
    remove: (id: number) => del(`/streams/${id}`),
    bulk: (input: StreamBulkInput) => post<AffectedResponse>('/streams/bulk', input),
    reorder: (ids: number[]) => post<{ ok: boolean; updated: number }>('/streams/reorder', { ids }),
    sort: (input: { type: StreamType; category_id: number | null; mode: StreamSortMode }) => post<{ ok: boolean; updated: number }>('/streams/sort', input),
    importM3U: (input: M3UImportInput) => post<M3UImportResult>('/streams/import-m3u', input),
    health: () => get<StreamHealth>('/streams/health'),
    connections: (id: number) => get<StreamConnection[]>(`/streams/${id}/connections`),
    check: (input: { ids: number[] } | { type: 'live' | 'movie'; all: true }) =>
      post<StreamCheckResponse>('/streams/check', input),
  },

  series: {
    list: (params: { category_id?: number | ''; search?: string; page?: number; limit?: number }) =>
      get<Paginated<Series>>('/series', { ...params }),
    get: (id: number) => get<Series>(`/series/${id}`),
    create: (input: SeriesInput) => post<Series>('/series', input),
    update: (id: number, input: Partial<SeriesInput>) => put<Series>(`/series/${id}`, input),
    remove: (id: number) => del(`/series/${id}`),
    episodes: (id: number) => get<Episode[]>(`/series/${id}/episodes`),
    createEpisode: (seriesId: number, input: EpisodeInput) => post<Episode>(`/series/${seriesId}/episodes`, input),
  },

  episodes: {
    update: (id: number, input: Partial<EpisodeInput>) => put<Episode>(`/episodes/${id}`, input),
    remove: (id: number) => del(`/episodes/${id}`),
  },

  messages: {
    list: (
      page: number,
      limit: number,
      filters: { kind?: MessageKind | ''; source?: 'reminder' | 'manual' | ''; reminder_id?: number | '' } = {},
    ) => get<Paginated<Message>>('/messages', { page, limit, ...filters }),
    create: (input: MessageInput) => post<Message>('/messages', input),
    update: (id: number, input: Partial<MessageInput>) => put<Message>(`/messages/${id}`, input),
    remove: (id: number) => del(`/messages/${id}`),
  },

  notices: {
    list: () => get<Notice[]>('/notices'),
    create: (input: NoticeInput) => post<Notice>('/notices', input),
    update: (id: number, input: Partial<NoticeInput>) => put<Notice>(`/notices/${id}`, input),
    remove: (id: number) => del(`/notices/${id}`),
  },

  outages: {
    list: () => get<Outage[]>('/outages'),
    create: (input: OutageInput) => post<Outage>('/outages', input),
    update: (id: number, input: Partial<OutageInput>) => put<Outage>(`/outages/${id}`, input),
    remove: (id: number) => del(`/outages/${id}`),
  },

  connections: {
    list: () => get<Connection[]>('/connections'),
    kick: (id: number) => del(`/connections/${id}`),
  },

  admins: {
    list: () => get<AdminAccount[]>('/admins'),
    create: (input: AdminInput) => post<AdminAccount>('/admins', input),
    update: (id: number, input: Partial<AdminInput>) => put<AdminAccount>(`/admins/${id}`, input),
    remove: (id: number) => del(`/admins/${id}`),
  },

  settings: {
    get: () => get<Settings>('/settings'),
    update: (input: SettingsInput) => put<Settings>('/settings', input),
  },

  devices: {
    list: (params: DeviceListParams) => get<Paginated<Device>>('/devices', { ...params }),
    stats: () => get<DeviceStats>('/devices/stats'),
    get: (id: number) => get<Device>(`/devices/${id}`),
    create: (input: Partial<DeviceInput>) => post<Device>('/devices', input),
    update: (id: number, input: Partial<DeviceInput>) => put<Device>(`/devices/${id}`, input),
    remove: (id: number) => del(`/devices/${id}`),
    assign: (id: number, userId: number | null) => post<Device>(`/devices/${id}/assign`, { user_id: userId }),
    check: () => post<DeviceCheckResult>('/devices/check'),
    duplicates: () => get<DeviceDuplicates>('/devices/duplicates'),
    ids: (filter: DeviceFilterParams) => get<DeviceIdsResult>('/devices/ids', { ...filter }),
    bulk: (input: DeviceBulkInput) => post<DeviceBulkResult>('/devices/bulk', input),
    merge: (targetId: number, sourceIds: number[]) => post<DeviceMergeResult>('/devices/merge', { target_id: targetId, source_ids: sourceIds }),
    dedupe: (dryRun: boolean) => post<DeviceDedupeResult>('/devices/dedupe', { dry_run: dryRun }),
    cleanupOrphans: (dryRun: boolean) => post<DeviceCleanupResult>('/devices/cleanup-orphans', { dry_run: dryRun }),
    alerts: (params: {
      status?: DeviceAlertStatus | 'all';
      type?: DeviceAlertType | '';
      device_id?: number | '';
      page?: number;
      limit?: number;
    }) => get<Paginated<DeviceAlert>>('/devices/alerts', { ...params }),
    resolveAlert: (id: number, resolution: string) =>
      post<DeviceAlert | OkResponse>(`/devices/alerts/${id}/resolve`, { resolution }),
  },

  epg: {
    status: () => get<EpgStatus>('/epg/status'),
    createSource: (input: { name?: string; url: string; enabled?: boolean; priority?: number }) => post<EpgSource>('/epg/sources', input),
    updateSource: (id: number, input: Partial<Pick<EpgSource, 'name' | 'url' | 'enabled' | 'priority'>>) => put<EpgSource>(`/epg/sources/${id}`, input),
    removeSource: (id: number) => del(`/epg/sources/${id}`),
    refreshSource: (id: number) => post<EpgSource>(`/epg/sources/${id}/refresh`),
    refreshAll: () => post<OkResponse>('/epg/refresh-all'),
    channels: (params: { search?: string; source_id?: number | ''; page?: number; limit?: number }) =>
      get<Paginated<EpgChannel>>('/epg/channels', { ...params }),
    match: (input: EpgMatchInput) => post<EpgMatchResult>('/epg/match', input),
    assign: (input: { stream_id: number; xmltv_id: string | null; locked?: boolean; fill_logo?: boolean }) => post<EpgAssignResult>('/epg/assign', input),
    buildGuide: () => post<EpgGuideState>('/epg/guide/build'),
  },

  updates: {
    get: () => get<UpdatesOverview>('/updates'),
    check: () => post<UpdatesOverview>('/updates/check'),
    importApp: (input: { tag?: string; publish?: boolean }) => post<AppImportResult>('/updates/app/import', input),
    updateSettings: (input: Partial<UpdatesSettings>) => put<UpdatesOverview>('/updates/settings', input),
  },

  appReleases: {
    list: () => get<AppReleasesOverview>('/app-releases'),
    update: (id: number, input: AppReleaseInput) => request<AppRelease>('PATCH', `/app-releases/${id}`, { body: input }),
    remove: (id: number) => del(`/app-releases/${id}`),
    removeFile: (id: number, fileId: number) => del(`/app-releases/${id}/files/${fileId}`),
    /** URL (con sesión) para descargar un APK; se usa con downloadWithToken. */
    fileUrl: (id: number, fileId: number) => `${BASE}/app-releases/${id}/files/${fileId}/download`,
  },

  backups: {
    list: () => get<BackupsOverview>('/backups'),
    create: (input: { note?: string; upload_drive?: boolean }) => post<Backup>('/backups', input),
    get: (id: number) => get<Backup>(`/backups/${id}`),
    update: (id: number, input: { note?: string; pinned?: boolean }) => request<Backup>('PATCH', `/backups/${id}`, { body: input }),
    remove: (id: number, from: 'server' | 'drive' | 'all') => request<{ deleted: boolean; backup: Backup | null }>('DELETE', `/backups/${id}`, { query: { from } }),
    downloadLink: (id: number) => post<{ url: string; filename: string; size: number; expires_at: number }>(`/backups/${id}/download-link`),
    checkPassword: (id: number, password: string) => post<{ ok: boolean; encrypted: boolean }>(`/backups/${id}/check-password`, { password }),
    restore: (id: number, input: { password?: string; safety_backup: boolean }) =>
      post<BackupRestoreResult>(`/backups/${id}/restore`, { confirm: 'RESTAURAR', ...input }),
    updateSettings: (input: BackupSettingsInput) => put<BackupsOverview>('/backups/settings', input),
    preview: (input: { frequency: BackupFrequency; time: string; weekdays: number[]; every_hours: number }) =>
      post<{ timezone: string; runs: number[] }>('/backups/settings/preview', input),
    uploadToDrive: (id: number) => post<Backup>(`/backups/${id}/drive`),
    driveConnect: (input: { client_id?: string; client_secret?: string }) => post<DriveConnectState>('/backups/drive/connect', input),
    driveStatus: () => get<DriveConnectState>('/backups/drive/connect'),
    driveCancel: () => post<OkResponse>('/backups/drive/cancel'),
    driveDisconnect: () => post<OkResponse>('/backups/drive/disconnect'),
    driveTest: () =>
      post<{ ok: boolean; account_email: string; folder_id: string; folder_name: string; storage: { limit: number | null; usage: number | null; free: number | null } }>(
        '/backups/drive/test',
      ),
    driveFiles: () => get<{ items: DriveFile[] }>('/backups/drive/files'),
    driveImport: (fileId: string) => post<Backup>(`/backups/drive/files/${encodeURIComponent(fileId)}/import`),
  },

  reminders: {
    list: () => get<Reminder[]>('/reminders'),
    get: (id: number) => get<Reminder>(`/reminders/${id}`),
    create: (input: Partial<ReminderInput>) => post<Reminder>('/reminders', input),
    update: (id: number, input: Partial<ReminderInput>) => put<Reminder>(`/reminders/${id}`, input),
    remove: (id: number) => del(`/reminders/${id}`),
    run: (id: number) => post<{ ok: boolean; messages_created: number; reminder: Reminder }>(`/reminders/${id}/run`),
  },

  billing: {
    get: () => get<BillingOverview>('/integrations/billing'),
    update: (input: { cut_mode?: CutMode; config?: BillingConfigInput }) => put<BillingOverview>('/integrations/billing', input),
    /** El borrador de configuración se envía en la raíz del cuerpo (así lo lee el servidor). */
    test: (draft: BillingConfigInput) => post<BillingTestResult>('/integrations/billing/test', draft),
    sync: (dryRun: boolean) => post<BillingRun>('/integrations/billing/sync', { dry_run: dryRun }),
    runs: (page = 1) => get<Paginated<BillingRun>>('/integrations/billing/runs', { page }),
    run: (id: number) => get<BillingRun>(`/integrations/billing/runs/${id}`),
    externalClients: (params: {
      search?: string;
      linked?: 'true' | 'false' | '';
      status?: string;
      mapped_status?: 'free' | 'active' | 'suspended' | 'disabled' | '';
      plan?: string;
      page?: number;
      limit?: number;
    }) => get<Paginated<ExternalClient>>('/integrations/billing/external-clients', { ...params }),
    externalSummary: () => get<ExternalClientsSummary>('/integrations/billing/external-clients/summary'),
    bulkLink: (input: BulkLinkInput) => post<BulkLinkResult>('/integrations/billing/external-clients/bulk-link', input),
    link: (id: number, userId: number) => post<OkResponse>(`/integrations/billing/external-clients/${id}/link`, { user_id: userId }),
    unlink: (id: number) => del(`/integrations/billing/external-clients/${id}/link`),
    regenerateWebhook: () => post<BillingOverview>('/integrations/billing/webhook-token'),
    checkSuspended: () => post<BillingRun>('/integrations/billing/check-suspended'),
    refreshUser: (userId: number) => post<BillingUserRefresh>(`/integrations/billing/users/${userId}/refresh`),
  },

  servers: {
    list: () => get<StreamingServer[]>('/servers'),
    get: (id: number) => get<StreamingServer>(`/servers/${id}`),
    create: (input: Partial<ServerInput>) => post<StreamingServer>('/servers', input),
    update: (id: number, input: Partial<ServerInput>) => put<StreamingServer>(`/servers/${id}`, input),
    remove: (id: number) => del(`/servers/${id}`),
    regenerateToken: (id: number) => post<StreamingServer>(`/servers/${id}/token`),
    streams: (id: number) => get<ServerStream[]>(`/servers/${id}/streams`),
    useIp: (id: number, ip: string, port?: number) => post<StreamingServer>(`/servers/${id}/use-ip`, port ? { ip, port } : { ip }),
  },

  profiles: {
    list: () => get<TranscodeProfile[]>('/transcode-profiles'),
    create: (input: Partial<TranscodeProfileInput>) => post<TranscodeProfile>('/transcode-profiles', input),
    update: (id: number, input: Partial<TranscodeProfileInput>) => put<TranscodeProfile>(`/transcode-profiles/${id}`, input),
    remove: (id: number) => del(`/transcode-profiles/${id}`),
  },

  astra: {
    sources: () => get<AstraSource[]>('/astra/sources'),
    get: (id: number) => get<AstraSource>(`/astra/sources/${id}`),
    test: (input: AstraSourceInput & { id?: number }) => post<AstraTestResult>('/astra/test', input),
    create: (input: AstraSourceInput) =>
      post<{ source: AstraSource; sync: AstraSyncResult | null; error: string | null }>('/astra/sources', input),
    update: (id: number, input: AstraSourceInput) => put<AstraSource>(`/astra/sources/${id}`, input),
    remove: (id: number, opts: { delete_streams?: boolean; remove_empty_categories?: boolean } = {}) =>
      request<{ ok: boolean; deleted?: number; categories_deleted?: number }>('DELETE', `/astra/sources/${id}`, {
        query: { delete_streams: opts.delete_streams || undefined, remove_empty_categories: opts.remove_empty_categories || undefined },
      }),
    deleteImported: (
      id: number,
      input: ({ all: true } | { group: string } | { channel_ids: number[] }) & { remove_empty_categories?: boolean },
    ) => post<{ deleted: number; categories_deleted: number }>(`/astra/sources/${id}/delete-imported`, input),
    sync: (id: number) => post<AstraSyncResult>(`/astra/sources/${id}/sync`),
    status: (id: number) => post<{ checked: number; online: number; offline: number }>(`/astra/sources/${id}/status`),
    channels: (
      id: number,
      params: { search?: string; imported?: 'true' | 'false' | ''; removed?: 'true' | 'all' | ''; group?: string; onair?: 'true' | 'false' | ''; page?: number; limit?: number },
    ) => get<Paginated<AstraChannel> & { groups: string[] }>(`/astra/sources/${id}/channels`, { ...params }),
    import: (
      id: number,
      input: { channel_ids?: number[]; all_not_imported?: boolean; group?: string; options: Partial<AstraImportDefaults>; save_as_default?: boolean },
    ) => post<{ created: number; categories_created: number }>(`/astra/sources/${id}/import`, input),
  },

  system: {
    metrics: () => get<SystemMetrics>('/system/metrics'),
    network: (external = false) => get<NetworkInfo>('/system/network', external ? { external: 'true' } : undefined),
    publicIp: () => get<PublicIpInfo>('/system/public-ip'),
  },

  logs: {
    list: (page: number, limit: number) => get<Paginated<LogEntry>>('/logs', { page, limit }),
  },

  xtream: {
    test: (input: XtreamTestInput) => post<XtreamTestResult>('/xtream/test', input),
    migrate: (options: XtreamOptions) => post<{ job_id: string }>('/xtream/migrate', { options }),
    jobs: () => get<XtreamJob[]>('/xtream/jobs'),
    job: (id: string) => get<XtreamJob>(`/xtream/jobs/${encodeURIComponent(id)}`),
  },
};

/** Normaliza respuestas que deberían ser listas pero podrían venir envueltas en {data}. */
export function asList<T>(value: T[] | { data: T[] } | null | undefined): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Array.isArray(value.data) ? value.data : [];
}
