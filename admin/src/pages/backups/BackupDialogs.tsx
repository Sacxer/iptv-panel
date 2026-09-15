import { useEffect, useState } from 'react';
import { CircleCheck, KeyRound, Lock, RotateCcw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Checkbox, FormField, Spinner } from '../../components/ui';
import type { Backup, BackupRestoreResult } from '../../types';
import { formatNumber } from '../../utils/format';
import { BACKUP_TRIGGER } from '../../utils/labels';
import { backupDate, formatBytes, formatInZone, TABLE_LABELS } from './backupUtils';

const CONFIRM_WORD = 'RESTAURAR';

// ---------- Crear copia ----------

export function CreateBackupModal({
  open,
  driveConnected,
  autoUpload,
  onClose,
  onCreated,
}: {
  open: boolean;
  driveConnected: boolean;
  autoUpload: boolean;
  onClose: () => void;
  onCreated: (b: Backup) => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [uploadDrive, setUploadDrive] = useState(autoUpload);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote('');
    setUploadDrive(autoUpload);
    setError(null);
  }, [open, autoUpload]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const b = await api.backups.create({ note: note.trim() || undefined, ...(driveConnected ? { upload_drive: uploadDrive } : {}) });
      toast.success('Creando la copia de seguridad…');
      onCreated(b);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Crear copia ahora"
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={14} />} Crear copia
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted text-sm no-margin">Guarda todos los datos del portal: clientes, canales, paquetes, dispositivos, WispHub y ajustes.</p>
        <FormField label="Nota (opcional)" htmlFor="bk-note" hint="Para reconocerla después, p. ej. «Antes de migrar clientes».">
          <input id="bk-note" className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} autoFocus />
        </FormField>
        {driveConnected && <Checkbox checked={uploadDrive} onChange={setUploadDrive} label="Subirla también a Google Drive al terminar" />}
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}

// ---------- Nota ----------

export function NoteModal({ backup, onClose, onSaved }: { backup: Backup | null; onClose: () => void; onSaved: (b: Backup) => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setNote(backup?.note ?? ''), [backup]);

  const save = async () => {
    if (!backup) return;
    setBusy(true);
    try {
      const b = await api.backups.update(backup.id, { note: note.trim() });
      toast.success('Nota guardada');
      onSaved(b);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={backup !== null}
      title="Nota de la copia"
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={14} />} Guardar
          </button>
        </>
      }
    >
      <FormField label="Nota" htmlFor="bk-note-edit">
        <input id="bk-note-edit" className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} autoFocus />
      </FormField>
    </Modal>
  );
}

// ---------- Eliminar ----------

type DeleteFrom = 'server' | 'drive' | 'all';

export function DeleteBackupModal({
  backup,
  timezone,
  onClose,
  onDeleted,
}: {
  backup: Backup | null;
  timezone: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [from, setFrom] = useState<DeleteFrom>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inDrive = backup?.drive.status === 'ok' || Boolean(backup?.drive.file_id);
  const local = Boolean(backup?.local);

  const options: { value: DeleteFrom; label: string; desc: string; available: boolean }[] = [
    { value: 'server', label: 'Solo del servidor', desc: 'Libera espacio aquí; la copia de Google Drive se conserva.', available: local },
    { value: 'drive', label: 'Solo de Google Drive', desc: 'Va a la papelera de Drive; el archivo del servidor se conserva.', available: inDrive },
    { value: 'all', label: 'De ambos', desc: 'Se borra del servidor y de Google Drive.', available: local || inDrive },
  ];

  useEffect(() => {
    if (!backup) return;
    setError(null);
    setFrom(local && inDrive ? 'server' : local ? 'server' : inDrive ? 'drive' : 'all');
  }, [backup, local, inDrive]);

  const submit = async () => {
    if (!backup) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.backups.remove(backup.id, from);
      toast.success(res.deleted ? 'Copia eliminada' : from === 'server' ? 'Eliminada del servidor (sigue en Drive)' : 'Eliminada de Google Drive');
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const both = local && inDrive;

  return (
    <Modal
      open={backup !== null}
      title="Eliminar copia de seguridad"
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void submit()} disabled={busy}>
            {busy && <Spinner size={14} />} Eliminar
          </button>
        </>
      }
    >
      {backup && (
        <div className="stack">
          <p className="no-margin text-sm">
            Copia del <strong>{formatInZone(backupDate(backup), timezone)}</strong>
            {backup.note ? ` · ${backup.note}` : ''}
          </p>
          {both ? (
            <div className="radio-cards">
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`radio-card ${from === o.value ? 'is-active' : ''}`}
                  onClick={() => setFrom(o.value)}
                  aria-pressed={from === o.value}
                >
                  <span className="radio-card-head">
                    <span className="radio-dot" />
                    <span className="radio-card-title">{o.label}</span>
                  </span>
                  <span className="radio-card-desc">{o.desc}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted text-sm no-margin">
              {local ? 'Se borrará el archivo del servidor.' : 'Se enviará a la papelera de Google Drive.'} Esta acción no se puede deshacer.
            </p>
          )}
          {backup.pinned && <Alert tone="amber">Esta copia está fijada (la limpieza automática no la borra).</Alert>}
          {error && <Alert tone="red">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}

// ---------- Restaurar ----------

export function RestoreModal({
  backup,
  timezone,
  onClose,
  onRestored,
}: {
  backup: Backup | null;
  timezone: string;
  onClose: () => void;
  /** Tras restaurar (para refrescar la lista). */
  onRestored: () => void;
}) {
  const toast = useToast();
  const { logout } = useAuth();
  const [target, setTarget] = useState<Backup | null>(backup);
  const [safety, setSafety] = useState(true);
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BackupRestoreResult | null>(null);

  useEffect(() => {
    setTarget(backup);
    reset();
  }, [backup]);

  const reset = () => {
    setSafety(true);
    setPassword('');
    setTyped('');
    setCheckResult(null);
    setError(null);
    setResult(null);
  };

  const checkPassword = async () => {
    if (!target) return;
    setChecking(true);
    setCheckResult(null);
    try {
      await api.backups.checkPassword(target.id, password);
      setCheckResult({ ok: true, message: 'La contraseña es correcta' });
    } catch (e) {
      setCheckResult({ ok: false, message: errorMessage(e) });
    } finally {
      setChecking(false);
    }
  };

  const restore = async () => {
    if (!target || typed.trim().toUpperCase() !== CONFIRM_WORD) return;
    setRunning(true);
    setError(null);
    try {
      const res = await api.backups.restore(target.id, { safety_backup: safety, ...(password ? { password } : {}) });
      setResult(res);
      onRestored();
      toast.success('Datos restaurados');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const open = backup !== null;
  const close = () => {
    if (running) return;
    onClose();
  };

  if (!target) return null;

  // Resultado
  if (result) {
    const tables = Object.entries(result.tables ?? {}).filter(([, n]) => n > 0);
    return (
      <Modal
        open={open}
        title="Restauración completada"
        onClose={close}
        size="lg"
        footer={
          result.relogin_required ? (
            <button type="button" className="btn btn-primary" onClick={() => logout()}>
              Ir a iniciar sesión
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={close}>
              Cerrar
            </button>
          )
        }
      >
        <div className="stack">
          <Alert tone="green" icon={<CircleCheck size={18} />} title="Los datos se restauraron">
            Se cargaron {formatNumber(result.total_rows)} filas de la copia del {formatInZone(backupDate(result.backup), timezone)}.
          </Alert>
          {result.relogin_required && (
            <Alert tone="amber" icon={<KeyRound size={18} />} title="Vuelve a iniciar sesión">
              Los usuarios del panel cambiaron con la restauración: tu sesión actual ya no es válida.
            </Alert>
          )}
          {result.warnings?.length > 0 && (
            <Alert tone="amber" icon={<TriangleAlert size={18} />} title="Avisos">
              <ul className="plain-list">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
          {tables.length > 0 && (
            <details className="bulk-details">
              <summary>Filas restauradas por tabla ({formatNumber(tables.length)})</summary>
              <div className="bk-tables">
                {tables.map(([name, n]) => (
                  <span key={name}>
                    <span className="muted">{TABLE_LABELS[name] ?? name}</span> <strong>{formatNumber(n)}</strong>
                  </span>
                ))}
              </div>
            </details>
          )}
          {result.safety_backup ? (
            <div className="bk-safety">
              <div>
                <strong>Copia previa guardada</strong>
                <div className="muted text-sm">
                  Estado de antes de restaurar ({formatInZone(backupDate(result.safety_backup), timezone)}, {formatBytes(result.safety_backup.size)}).
                </div>
              </div>
              {!result.relogin_required && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setTarget(result.safety_backup);
                    reset();
                  }}
                >
                  <RotateCcw size={14} /> Deshacer (restaurar la copia previa)
                </button>
              )}
            </div>
          ) : (
            <p className="muted text-sm no-margin">No se guardó copia previa.</p>
          )}
        </div>
      </Modal>
    );
  }

  const canRestore = !running && typed.trim().toUpperCase() === CONFIRM_WORD;
  const tr = BACKUP_TRIGGER[target.trigger];

  return (
    <Modal
      open={open}
      title="Restaurar copia de seguridad"
      onClose={close}
      size="md"
      dismissible={!running}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={close} disabled={running}>
            Cancelar
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void restore()} disabled={!canRestore}>
            {running && <Spinner size={14} />} Restaurar
          </button>
        </>
      }
    >
      {running ? (
        <div className="bk-running" role="status" aria-live="polite">
          <Spinner size={28} />
          <strong>Restaurando los datos…</strong>
          <span className="muted text-sm">No cierres esta ventana. Si algo falla no se cambia nada.</span>
        </div>
      ) : (
        <div className="stack">
          <div className="bk-restore-target">
            <span className="strong">{formatInZone(backupDate(target), timezone)}</span>
            {tr && <Badge tone={tr.tone}>{tr.label}</Badge>}
            {target.encrypted && (
              <Badge tone="purple">
                <Lock size={11} /> Cifrada
              </Badge>
            )}
            <span className="muted text-sm">
              {formatBytes(target.size)} · {formatNumber(target.total_rows ?? 0)} filas
              {target.server_name ? ` · ${target.server_name}` : ''}
              {target.note ? ` · ${target.note}` : ''}
            </span>
          </div>
          <Alert tone="red" icon={<ShieldAlert size={18} />} title="Se reemplazarán TODOS los datos actuales">
            Clientes, canales, paquetes, dispositivos, vínculos de WispHub, mensajes y ajustes pasarán a ser los de esta copia. Lo creado o cambiado
            después de la copia se perderá.
          </Alert>
          <Checkbox
            checked={safety}
            onChange={setSafety}
            label="Guardar antes una copia del estado actual (recomendado)"
            description="Permite deshacer la restauración. La conexión de Google Drive, la programación y la contraseña de las copias se conservan."
          />
          {target.encrypted && (
            <FormField label="Contraseña de la copia" htmlFor="bk-restore-pass" hint="Déjala vacía para usar la contraseña guardada en este servidor.">
              <div className="input-group">
                <input
                  id="bk-restore-pass"
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setCheckResult(null);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm nowrap"
                  onClick={() => void checkPassword()}
                  disabled={checking || !password}
                  title={password ? undefined : 'Escribe la contraseña para comprobarla'}
                >
                  {checking ? <Spinner size={13} /> : <KeyRound size={14} />} Comprobar contraseña
                </button>
              </div>
              {checkResult && <div className={`text-sm ${checkResult.ok ? 'text-green' : 'text-red'}`}>{checkResult.message}</div>}
            </FormField>
          )}
          <FormField label={`Para confirmar, escribe ${CONFIRM_WORD}`} htmlFor="bk-restore-word">
            <input
              id="bk-restore-word"
              className="input mono"
              autoComplete="off"
              value={typed}
              placeholder={CONFIRM_WORD}
              onChange={(e) => setTyped(e.target.value)}
            />
          </FormField>
          {error && <Alert tone="red">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}
