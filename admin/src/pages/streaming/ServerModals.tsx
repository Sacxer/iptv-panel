import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EthernetPort, Terminal } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Alert, CopyButton, FormField, Spinner, Switch } from '../../components/ui';
import type { StreamingServer } from '../../types';

export function ServerFormModal({
  open,
  server,
  onClose,
  onSaved,
}: {
  open: boolean;
  server: StreamingServer | null;
  onClose: () => void;
  onSaved: (s: StreamingServer, created: boolean) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [maxClients, setMaxClients] = useState('0');
  const [weight, setWeight] = useState('1');
  const [enabled, setEnabled] = useState(true);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<{ name?: string; url?: string; max?: string; weight?: string }>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(server?.name ?? '');
    setPublicUrl(server?.public_url ?? '');
    setMaxClients(String(server?.max_clients ?? 0));
    setWeight(String(server?.weight ?? 1));
    setEnabled(server?.enabled ?? true);
    setNotes(server?.notes ?? '');
    setErrors({});
    setServerError(null);
  }, [open, server]);

  const submit = async () => {
    const e: typeof errors = {};
    if (!name.trim()) e.name = 'El nombre es obligatorio';
    const url = publicUrl.trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\/[^/\s]+$/i.test(url)) e.url = 'Debe ser como http://ip-o-dominio:8090 (sin rutas)';
    if (!Number.isInteger(Number(maxClients)) || Number(maxClients) < 0) e.max = 'Número entero ≥ 0';
    if (!Number.isInteger(Number(weight)) || Number(weight) < 1 || Number(weight) > 100) e.weight = 'Entre 1 y 100';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    const body = {
      name: name.trim(),
      // Al crear, vacía = se completa con la IP de la interfaz principal del nodo en su primer latido.
      ...(url || server ? { public_url: url } : {}),
      max_clients: Number(maxClients),
      weight: Number(weight),
      enabled,
      notes,
    };
    try {
      const saved = server ? await api.servers.update(server.id, body) : await api.servers.create(body);
      toast.success(server ? 'Servidor actualizado' : 'Servidor agregado');
      onSaved(saved, !server);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={server ? `Editar servidor: ${server.name}` : 'Agregar servidor'}
      onClose={onClose}
      dismissible={!busy}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={14} />} {server ? 'Guardar' : 'Agregar servidor'}
          </button>
        </>
      }
    >
      {serverError && <Alert tone="red">{serverError}</Alert>}
      <FormField label="Nombre" required error={errors.name}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nodo Bogotá 1" />
      </FormField>
      <FormField
        label="URL pública"
        error={errors.url}
        hint={
          <>
            {server
              ? 'URL por la que los clientes llegan a este servidor (IP de uno de sus puertos de red y puerto del nodo; nunca 127.0.0.1).'
              : 'Déjala vacía: se completará sola con la IP de la interfaz principal del servidor cuando el nodo se conecte. Luego podrás elegir la IP de otra interfaz.'}
            {server && (
              <>
                {' '}
                <Link to={`/servidores/${server.id}#red-nodo`} className="link inline-link" onClick={onClose}>
                  <EthernetPort size={12} /> Elegir de las interfaces del nodo…
                </Link>
              </>
            )}
          </>
        }
      >
        <input className="input mono" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder={server ? 'http://IP-del-servidor:8090' : 'Vacía = se detecta al conectar el nodo'} />
      </FormField>
      <div className="grid-2">
        <FormField label="Clientes máximos" error={errors.max} hint="0 = sin límite">
          <input className="input input-narrow" type="number" min={0} value={maxClients} onChange={(e) => setMaxClients(e.target.value)} />
        </FormField>
        <FormField label="Peso" error={errors.weight} hint="Mayor = recibe más clientes (1–100)">
          <input className="input input-narrow" type="number" min={1} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} />
        </FormField>
      </div>
      <FormField label="Notas">
        <textarea className="input textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
      <Switch checked={enabled} onChange={setEnabled} label="Habilitado" description="Un servidor deshabilitado no recibe clientes nuevos." />
    </Modal>
  );
}

export function InstallModal({ server, onClose }: { server: StreamingServer | null; onClose: () => void }) {
  return (
    <Modal open={server !== null} title={`Instalar: ${server?.name ?? ''}`} onClose={onClose} size="lg" footer={<button type="button" className="btn btn-primary" onClick={onClose}>Listo</button>}>
      {server && (
        <div className="stack">
          <ol className="install-steps">
            <li>
              <strong>Entra por SSH al servidor como root</strong>
              <span className="muted text-sm">Por ejemplo: ssh root@IP-del-servidor</span>
            </li>
            <li>
              <strong>Pega el comando</strong>
              <span className="muted text-sm">Instala Node.js, FFmpeg y el servicio iptv-node.</span>
            </li>
            <li>
              <strong>En unos segundos aparecerá «En línea»</strong>
              <span className="muted text-sm">Esta página se actualiza sola cada 5 s.</span>
            </li>
          </ol>
          <div>
            <div className="field-label">
              <Terminal size={13} className="inline-icon" /> Comando de instalación
            </div>
            <div className="input-group align-start">
              <pre className="code-block grow install-command">{server.install_command}</pre>
              <CopyButton text={server.install_command} label="Copiar" size="md" />
            </div>
          </div>
          <Alert tone="amber" title="Antes de instalar">
            Abre en el firewall el puerto de la URL pública (<code>{server.public_url}</code>) y comprueba que esa URL sea la que usarán los
            clientes para llegar al servidor. El comando contiene el token del servidor: no lo compartas.
          </Alert>
        </div>
      )}
    </Modal>
  );
}
