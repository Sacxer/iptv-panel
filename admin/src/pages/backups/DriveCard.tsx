import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Cloud, CloudDownload, ExternalLink, FolderOpen, PlugZap, Save, Unplug } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useInterval } from '../../hooks/useInterval';
import { Modal } from '../../components/Modal';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, CopyButton, EmptyState, ErrorState, FormField, Spinner, Switch } from '../../components/ui';
import type { BackupsOverview, DriveConnectState, DriveFile } from '../../types';
import { formatNumber } from '../../utils/format';
import { formatBytes, formatInZone } from './backupUtils';

export function DriveCard({ overview, onChanged, onReload }: { overview: BackupsOverview; onChanged: (o: BackupsOverview) => void; onReload: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const gd = overview.settings.google_drive;
  const connected = overview.drive.connected;
  const [conn, setConn] = useState<DriveConnectState>(overview.drive.connection ?? { status: 'idle' });
  const [clientId, setClientId] = useState(gd.client_id ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [showHelp, setShowHelp] = useState(!gd.client_id);
  const [busy, setBusy] = useState<string | null>(null);
  const [folder, setFolder] = useState(overview.drive.folder_name ?? gd.folder_name);
  const [test, setTest] = useState<{ free: number | null; limit: number | null; usage: number | null; folder: string; email: string } | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);

  useEffect(() => setFolder(overview.drive.folder_name ?? gd.folder_name), [overview.drive.folder_name, gd.folder_name]);
  useEffect(() => {
    if (conn.status !== 'pending') setConn(overview.drive.connection ?? { status: 'idle' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview.drive.connection?.status]);

  // Mientras se espera la aprobación del código, se consulta cada 2,5 s.
  useInterval(
    async () => {
      try {
        const st = await api.backups.driveStatus();
        setConn(st);
        if (st.status !== 'pending') {
          if (st.status === 'connected') toast.success(`Google Drive conectado${st.account_email ? `: ${st.account_email}` : ''}`);
          onReload();
        }
      } catch (e) {
        setConn({ status: 'error', error: errorMessage(e) });
      }
    },
    conn.status === 'pending' ? 2500 : null,
  );

  const connect = async () => {
    if (!clientId.trim()) {
      toast.error('Pega el ID de cliente de Google');
      return;
    }
    if (!clientSecret.trim() && !gd.client_secret_set) {
      toast.error('Pega el secreto del cliente');
      return;
    }
    setBusy('connect');
    try {
      const st = await api.backups.driveConnect({ client_id: clientId.trim(), ...(clientSecret.trim() ? { client_secret: clientSecret.trim() } : {}) });
      setClientSecret('');
      setConn(st);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    try {
      await api.backups.driveCancel();
      setConn({ status: 'idle' });
      onReload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const saveDrive = async (patch: { folder_name?: string; auto_upload?: boolean }, message: string) => {
    setBusy('save');
    try {
      onChanged(await api.backups.updateSettings({ google_drive: patch }));
      toast.success(message);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy('test');
    setTest(null);
    try {
      const r = await api.backups.driveTest();
      setTest({ free: r.storage?.free ?? null, limit: r.storage?.limit ?? null, usage: r.storage?.usage ?? null, folder: r.folder_name, email: r.account_email });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: 'Desconectar Google Drive',
      message: 'Se revoca el acceso del portal a tu Drive. Las copias que ya están en Drive no se borran; las nuevas solo se guardarán en el servidor.',
      confirmText: 'Desconectar',
      danger: true,
    });
    if (!ok) return;
    setBusy('disconnect');
    try {
      await api.backups.driveDisconnect();
      toast.success('Google Drive desconectado');
      setTest(null);
      onReload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card">
      <div className="section-header">
        <h2 className="card-title no-margin">
          <Cloud size={18} /> Google Drive
        </h2>
        {connected ? <Badge tone="green">Conectado</Badge> : <Badge tone="gray">No conectado</Badge>}
      </div>

      {connected ? (
        <div className="stack">
          <p className="no-margin text-sm">
            Cuenta: <strong>{overview.drive.account_email ?? gd.account_email}</strong>
            {gd.connected_at ? <span className="muted"> · conectada el {formatInZone(gd.connected_at, overview.timezone)}</span> : null}
          </p>
          <FormField label="Carpeta en Drive" htmlFor="drive-folder" hint="El portal solo ve los archivos que él mismo crea.">
            <div className="input-group">
              <input id="drive-folder" className="input" value={folder} onChange={(e) => setFolder(e.target.value)} />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy !== null || !folder.trim() || folder.trim() === (overview.drive.folder_name ?? gd.folder_name)}
                onClick={() => void saveDrive({ folder_name: folder.trim() }, 'Carpeta guardada')}
              >
                <Save size={14} /> Guardar
              </button>
            </div>
          </FormField>
          <Switch
            checked={gd.auto_upload}
            disabled={busy !== null}
            onChange={(v) => void saveDrive({ auto_upload: v }, v ? 'Las copias se subirán a Drive al terminar' : 'Subida automática desactivada')}
            label="Subir cada copia a Drive automáticamente"
          />
          <div className="row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void runTest()} disabled={busy !== null}>
              {busy === 'test' ? <Spinner size={13} /> : <PlugZap size={14} />} Probar
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFilesOpen(true)}>
              <FolderOpen size={14} /> Ver archivos en Drive
            </button>
            <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => void disconnect()} disabled={busy !== null}>
              {busy === 'disconnect' ? <Spinner size={13} /> : <Unplug size={14} />} Desconectar
            </button>
          </div>
          {test && (
            <Alert tone="green" icon={<CheckCircle2 size={18} />} title="Conexión correcta">
              Carpeta «{test.folder}»
              {test.free !== null ? ` · ${formatBytes(test.free)} libres` : ''}
              {test.limit ? ` de ${formatBytes(test.limit)}` : ''}.
            </Alert>
          )}
        </div>
      ) : conn.status === 'pending' ? (
        <div className="stack">
          <p className="no-margin">Abre esta página en tu celular o PC, escribe el código y acepta:</p>
          <a className="link bk-verify-url" href={conn.verification_url} target="_blank" rel="noreferrer">
            {conn.verification_url} <ExternalLink size={13} />
          </a>
          <div className="bk-user-code">
            <span className="mono">{conn.user_code}</span>
            {conn.user_code && <CopyButton text={conn.user_code} label="Copiar código" />}
          </div>
          <p className="muted text-sm no-margin row-inline">
            <Spinner size={13} /> Esperando la aprobación…
            {conn.expires_at ? ` El código vence ${formatInZone(conn.expires_at, overview.timezone)}.` : ''}
          </p>
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cancel()} disabled={busy !== null}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          {conn.status === 'denied' && <Alert tone="amber">Se rechazó el acceso. Vuelve a intentarlo y pulsa «Permitir».</Alert>}
          {conn.status === 'expired' && <Alert tone="amber">El código venció sin aprobarse. Vuelve a conectar para obtener otro.</Alert>}
          {conn.status === 'error' && <Alert tone="red">{conn.error ?? 'No se pudo conectar con Google'}</Alert>}
          <p className="muted text-sm no-margin">
            Guarda las copias fuera del servidor. Funciona aunque el portal no tenga dominio ni IP pública: se conecta con un código.
          </p>
          <button type="button" className="collapse-toggle" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}>
            {showHelp ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Cómo obtener el ID y el secreto (una sola vez)
          </button>
          {showHelp && (
            <ol className="install-steps bk-steps">
              <li>
                <strong>Google Cloud Console → crear un proyecto → activar «Google Drive API».</strong>
              </li>
              <li>
                <strong>Pantalla de consentimiento de OAuth: tipo «Externa» y agrega tu Gmail como usuario de prueba.</strong>
              </li>
              <li>
                <strong>Credenciales → Crear ID de cliente de OAuth de tipo «TV y dispositivos de entrada limitada».</strong>
              </li>
              <li>
                <strong>Pega aquí el ID de cliente y el secreto.</strong>
              </li>
            </ol>
          )}
          <FormField label="ID de cliente" htmlFor="drive-client-id">
            <input id="drive-client-id" className="input mono" value={clientId} autoComplete="off" onChange={(e) => setClientId(e.target.value)} placeholder="1234…apps.googleusercontent.com" />
          </FormField>
          <FormField
            label={
              <span className="row-inline">
                Secreto del cliente {gd.client_secret_set && <Badge tone="green">Guardado</Badge>}
              </span>
            }
            htmlFor="drive-client-secret"
            hint={gd.client_secret_set ? 'Déjalo vacío para usar el guardado.' : undefined}
          >
            <input
              id="drive-client-secret"
              className="input mono"
              type="password"
              autoComplete="new-password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
          </FormField>
          <div>
            <button type="button" className="btn btn-primary" onClick={() => void connect()} disabled={busy !== null}>
              {busy === 'connect' ? <Spinner size={14} /> : <PlugZap size={16} />} Conectar
            </button>
          </div>
        </div>
      )}

      <DriveFilesModal
        open={filesOpen}
        timezone={overview.timezone}
        onClose={() => setFilesOpen(false)}
        onImported={() => {
          onReload();
        }}
      />
    </section>
  );
}

function DriveFilesModal({ open, timezone, onClose, onImported }: { open: boolean; timezone: string; onClose: () => void; onImported: () => void }) {
  const toast = useToast();
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setFiles((await api.backups.driveFiles()).items ?? []);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    if (!open) return;
    setFiles(null);
    void load();
  }, [open]);

  const importFile = async (f: DriveFile) => {
    setImporting(f.id);
    try {
      await api.backups.driveImport(f.id);
      toast.success(`«${f.name}» descargada al servidor`);
      onImported();
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setImporting(null);
    }
  };

  return (
    <Modal open={open} title="Archivos en Google Drive" onClose={onClose} size="lg">
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : files === null ? (
        <Spinner label="Consultando Drive…" />
      ) : files.length === 0 ? (
        <EmptyState title="No hay copias en la carpeta de Drive" />
      ) : (
        <ul className="bk-list">
          {files.map((f) => (
            <li key={f.id} className="bk-row">
              <div className="bk-row-main">
                <div className="bk-row-title">
                  <span className="strong ellipsis">{f.name}</span>
                  {f.encrypted && <Badge tone="purple">Cifrada</Badge>}
                </div>
                <div className="muted text-xs">
                  {formatBytes(f.size)}
                  {f.created_at ? ` · ${formatInZone(f.created_at, timezone)}` : ''}
                  {f.server_name ? ` · ${f.server_name}` : ''}
                </div>
              </div>
              <div className="bk-row-actions">
                {f.local ? (
                  <Badge tone="green">Ya está en el servidor</Badge>
                ) : (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void importFile(f)} disabled={importing !== null}>
                    {importing === f.id ? <Spinner size={13} /> : <CloudDownload size={14} />} Descargar al servidor
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {files && files.length > 0 && <p className="muted text-xs">{formatNumber(files.length)} archivos</p>}
    </Modal>
  );
}
