import { useRef, useState, type ReactNode } from 'react';
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudDownload,
  CloudUpload,
  DatabaseBackup,
  Download,
  HardDrive,
  Lock,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Server as ServerIcon,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, errorMessage, uploadBackupFile } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useInterval } from '../../hooks/useInterval';
import { ActionMenu } from '../../components/ActionMenu';
import { useToast } from '../../components/Toast';
import { Badge, EmptyState, ErrorState, PageHeader, PageLoader, Spinner } from '../../components/ui';
import type { Backup, BackupsOverview } from '../../types';
import { formatNumber, timeAgo, timeFromNow } from '../../utils/format';
import { BACKUP_TRIGGER } from '../../utils/labels';
import { CreateBackupModal, DeleteBackupModal, NoteModal, RestoreModal } from './BackupDialogs';
import { BackupSettingsCard } from './BackupSettingsCard';
import { backupDate, formatBytes, formatInZone, TABLE_LABELS } from './backupUtils';
import { DriveCard } from './DriveCard';

export function BackupsPage() {
  const toast = useToast();
  const overview = useAsync(() => api.backups.list(), []);
  const [createOpen, setCreateOpen] = useState(false);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [deleting, setDeleting] = useState<Backup | null>(null);
  const [editingNote, setEditingNote] = useState<Backup | null>(null);
  const [upload, setUpload] = useState<{ name: string; progress: number; abort: () => void } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const o = overview.data;

  const busyItems = (o?.items ?? []).some((b) => b.status === 'running' || b.drive.status === 'uploading' || b.drive.status === 'pending');
  // Mientras hay una copia o restauración en curso se consulta cada 2 s; si solo se sube a Drive, cada 4 s.
  useInterval(() => void overview.reload(true), o?.running ? 2000 : busyItems ? 4000 : null);

  const setData = (next: BackupsOverview) => overview.setData(next);
  const reload = () => void overview.reload(true);

  const startUpload = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.iptvbak')) {
      toast.error('Elige un archivo .iptvbak');
      return;
    }
    const job = uploadBackupFile(file, (p) => setUpload((u) => (u ? { ...u, progress: p } : u)));
    setUpload({ name: file.name, progress: 0, abort: job.abort });
    job.promise
      .then(() => {
        toast.success(`Copia «${file.name}» subida al servidor`);
        reload();
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setUpload(null));
  };

  if (!o) return overview.error ? <ErrorState message={overview.error} onRetry={() => void overview.reload()} /> : <PageLoader />;

  const tz = o.timezone;
  const running = o.running;

  return (
    <>
      <PageHeader
        title="Copias de seguridad"
        subtitle="Copia completa de los datos del portal, en el servidor y en Google Drive"
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".iptvbak"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) startUpload(f);
                e.target.value = '';
              }}
            />
            <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={upload !== null}>
              <Upload size={16} /> Subir archivo .iptvbak
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)} disabled={Boolean(running)}>
              {running?.kind === 'backup' ? <Spinner size={14} /> : <Plus size={16} />} Crear copia ahora
            </button>
          </>
        }
      />

      <div className="bk-summary">
        <SummaryTile
          icon={<DatabaseBackup size={20} />}
          tone={o.last_status === 'error' ? 'red' : o.last_status === 'ok' ? 'green' : 'gray'}
          label="Última copia"
          value={
            o.last_at ? (
              <span className="row-inline">
                {o.last_status === 'error' ? <Badge tone="red">Error</Badge> : <Badge tone="green">Correcta</Badge>}
                <span title={formatInZone(o.last_at, tz)}>{timeAgo(o.last_at)}</span>
              </span>
            ) : (
              'Aún no hay copias'
            )
          }
          hint={
            o.last_status === 'error' ? (
              <span className="text-red">{o.last_error ?? 'Error desconocido'}</span>
            ) : o.last_at ? (
              formatInZone(o.last_at, tz)
            ) : undefined
          }
        />
        <SummaryTile
          icon={<CalendarClock size={20} />}
          tone={o.schedule_enabled ? 'blue' : 'gray'}
          label="Próxima copia"
          value={o.schedule_enabled && o.next_run_at ? timeFromNow(o.next_run_at) : 'Programación desactivada'}
          hint={o.schedule_enabled && o.next_run_at ? formatInZone(o.next_run_at, tz, true) : undefined}
        />
        <SummaryTile
          icon={<Cloud size={20} />}
          tone={o.drive.connected ? 'green' : 'gray'}
          label="Google Drive"
          value={o.drive.connected ? 'Conectado' : 'No conectado'}
          hint={o.drive.connected ? o.drive.account_email ?? undefined : undefined}
        />
        <SummaryTile
          icon={<HardDrive size={20} />}
          tone="purple"
          label="Espacio"
          value={`${formatBytes(o.storage.used_bytes)} en copias`}
          hint={`${formatBytes(o.storage.free_bytes)} libres en el disco`}
        />
      </div>

      {running && (
        <div className="bk-banner" role="status">
          <Spinner size={16} />
          <span>
            {running.kind === 'restore' ? 'Restaurando una copia…' : 'Creando la copia de seguridad…'} desde {timeAgo(running.started_at)}
          </span>
        </div>
      )}
      {upload && (
        <div className="bk-banner" role="status">
          <Upload size={16} />
          <span className="bk-upload-name">Subiendo «{upload.name}»</span>
          <div className="progress bk-upload-progress" role="progressbar" aria-valuenow={Math.round(upload.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
          </div>
          <strong>{Math.round(upload.progress * 100)}%</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={upload.abort}>
            Cancelar
          </button>
        </div>
      )}

      <section className="card">
        <div className="section-header">
          <h2 className="card-title no-margin">Copias ({formatNumber(o.items.length)})</h2>
          <span className="muted text-xs">Horas en {tz}</span>
        </div>
        {o.items.length === 0 ? (
          <EmptyState
            icon={<DatabaseBackup size={30} />}
            title="Aún no hay copias de seguridad"
            description="Crea la primera ahora o activa las copias automáticas más abajo."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus size={16} /> Crear copia ahora
              </button>
            }
          />
        ) : (
          <ul className="bk-list">
            {o.items.map((b) => (
              <BackupRow
                key={b.id}
                backup={b}
                timezone={tz}
                driveConnected={o.drive.connected}
                busy={Boolean(running)}
                onChanged={reload}
                onRestore={() => setRestoring(b)}
                onDelete={() => setDeleting(b)}
                onEditNote={() => setEditingNote(b)}
              />
            ))}
          </ul>
        )}
      </section>

      <div className="bk-config-grid">
        <BackupSettingsCard overview={o} onSaved={setData} />
        <DriveCard overview={o} onChanged={setData} onReload={reload} />
      </div>

      <CreateBackupModal
        open={createOpen}
        driveConnected={o.drive.connected}
        autoUpload={o.settings.google_drive.auto_upload}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          reload();
        }}
      />
      <RestoreModal backup={restoring} timezone={tz} onClose={() => setRestoring(null)} onRestored={reload} />
      <DeleteBackupModal
        backup={deleting}
        timezone={tz}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          reload();
        }}
      />
      <NoteModal
        backup={editingNote}
        onClose={() => setEditingNote(null)}
        onSaved={() => {
          setEditingNote(null);
          reload();
        }}
      />
    </>
  );
}

function SummaryTile({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  tone: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="stat-card bk-tile">
      <div className={`stat-icon stat-${tone}`}>{icon}</div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="bk-tile-value">{value}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
    </div>
  );
}

function DriveBadge({ backup, driveConnected }: { backup: Backup; driveConnected: boolean }) {
  const d = backup.drive;
  switch (d.status) {
    case 'ok':
      return (
        <Badge tone="green">
          <Cloud size={11} /> En Drive
        </Badge>
      );
    case 'uploading':
    case 'pending':
      return (
        <Badge tone="blue">
          <Spinner size={10} /> {d.status === 'pending' ? 'En cola para Drive' : 'Subiendo a Drive…'}
        </Badge>
      );
    case 'error':
      return (
        <span title={d.error ?? undefined}>
          <Badge tone="red">Error en Drive{d.attempts ? ` (${d.attempts} intentos)` : ''}</Badge>
        </span>
      );
    default:
      return driveConnected ? <Badge tone="gray">No subida a Drive</Badge> : null;
  }
}

function BackupRow({
  backup,
  timezone,
  driveConnected,
  busy,
  onChanged,
  onRestore,
  onDelete,
  onEditNote,
}: {
  backup: Backup;
  timezone: string;
  driveConnected: boolean;
  busy: boolean;
  onChanged: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onEditNote: () => void;
}) {
  const toast = useToast();
  const [showTables, setShowTables] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const b = backup;
  const tr = BACKUP_TRIGGER[b.trigger] ?? { label: b.trigger, tone: 'gray' as const };
  const inDrive = b.drive.status === 'ok';
  const ok = b.status === 'ok';

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setWorking(key);
    try {
      await fn();
      toast.success(success);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setWorking(null);
    }
  };

  const download = async () => {
    setWorking('download');
    try {
      const link = await api.backups.downloadLink(b.id);
      // El servidor envía el archivo como descarga: el navegador lo guarda sin cargarlo en memoria ni salir del portal.
      const a = document.createElement('a');
      a.href = link.url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setWorking(null);
    }
  };

  const tables = Object.entries(b.tables ?? {})
    .filter(([, n]) => n > 0)
    .sort((x, y) => y[1] - x[1]);

  return (
    <li className={`bk-row ${b.status === 'error' ? 'is-error' : ''}`}>
      <div className="bk-row-main">
        <div className="bk-row-title">
          <span className="strong">{formatInZone(backupDate(b), timezone)}</span>
          <Badge tone={tr.tone}>{tr.label}</Badge>
          {b.encrypted && (
            <span title="Cifrada con contraseña" className="bk-icon">
              <Lock size={14} />
            </span>
          )}
          {b.pinned && (
            <span title="Fijada: la limpieza automática no la borra" className="bk-icon text-amber">
              <Pin size={14} />
            </span>
          )}
          {b.status === 'running' && (
            <Badge tone="blue">
              <Spinner size={10} /> En curso
            </Badge>
          )}
          {b.status === 'error' && <Badge tone="red">Falló</Badge>}
        </div>
        {b.note && <div className="bk-note">{b.note}</div>}
        <div className="muted text-xs bk-meta">
          {formatBytes(b.size)} · {formatNumber(b.total_rows ?? 0)} filas
          {b.server_name ? ` · ${b.server_name}` : ''}
          {b.app_version ? ` · v${b.app_version}` : ''}
          {b.created_by ? ` · por ${b.created_by}` : ''}
          {b.restored_at ? ` · restaurada ${timeAgo(b.restored_at)}` : ''}
        </div>
        {b.status === 'error' && b.error && <div className="text-red text-sm">{b.error}</div>}
        <div className="bk-locations">
          {b.local ? (
            <Badge tone="green">
              <ServerIcon size={11} /> En el servidor
            </Badge>
          ) : (
            <Badge tone="gray">No está en el servidor</Badge>
          )}
          <DriveBadge backup={b} driveConnected={driveConnected} />
          {b.drive.status === 'error' && b.drive.error && <span className="text-red text-xs">{b.drive.error}</span>}
        </div>
        {showTables && tables.length > 0 && (
          <div className="bk-tables">
            {tables.map(([name, n]) => (
              <span key={name}>
                <span className="muted">{TABLE_LABELS[name] ?? name}</span> <strong>{formatNumber(n)}</strong>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="bk-row-actions">
        {ok && b.local && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void download()} disabled={working !== null}>
            {working === 'download' ? <Spinner size={13} /> : <Download size={14} />} <span className="hide-mobile">Descargar</span>
          </button>
        )}
        {ok && !b.local && inDrive && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={working !== null}
            onClick={() => void run('import', () => api.backups.driveImport(b.drive.file_id ?? ''), 'Copia descargada al servidor')}
          >
            {working === 'import' ? <Spinner size={13} /> : <CloudDownload size={14} />} Descargar al servidor
          </button>
        )}
        {ok && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onRestore}
            disabled={busy || !b.local}
            title={b.local ? 'Restaurar esta copia' : 'Primero descárgala al servidor'}
          >
            <RotateCcw size={14} /> Restaurar
          </button>
        )}
        <ActionMenu
          items={[
            {
              label: b.drive.status === 'error' ? 'Reintentar subida a Drive' : 'Subir a Drive',
              icon: <CloudUpload size={15} />,
              onClick: () => void run('drive', () => api.backups.uploadToDrive(b.id), 'Subiendo la copia a Google Drive…'),
              hidden: !ok || !b.local || !driveConnected || inDrive || b.drive.status === 'uploading' || b.drive.status === 'pending',
            },
            {
              label: 'Descargar al servidor',
              icon: <CloudDownload size={15} />,
              onClick: () => void run('import', () => api.backups.driveImport(b.drive.file_id ?? ''), 'Copia descargada al servidor'),
              hidden: b.local || !inDrive,
            },
            {
              label: b.pinned ? 'Quitar fijado' : 'Fijar (no borrar al limpiar)',
              icon: b.pinned ? <PinOff size={15} /> : <Pin size={15} />,
              onClick: () => void run('pin', () => api.backups.update(b.id, { pinned: !b.pinned }), b.pinned ? 'Copia sin fijar' : 'Copia fijada'),
              hidden: b.status === 'running',
            },
            { label: 'Editar nota', icon: <Pencil size={15} />, onClick: onEditNote, hidden: b.status === 'running' },
            {
              label: showTables ? 'Ocultar tablas' : 'Ver tablas',
              icon: showTables ? <ChevronUp size={15} /> : <ChevronDown size={15} />,
              onClick: () => setShowTables((v) => !v),
              hidden: tables.length === 0,
            },
            { label: 'Eliminar', icon: <Trash2 size={15} />, onClick: onDelete, danger: true, divider: true, hidden: b.status === 'running' },
          ]}
        />
      </div>
    </li>
  );
}
