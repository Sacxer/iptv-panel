import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, MonitorSmartphone, Unplug } from 'lucide-react';
import { api, asList, errorMessage } from '../../api';
import { Modal } from '../../components/Modal';
import { PackageChecklist } from '../../components/PackageChecklist';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, CopyButton, CopyField, EmptyState, ErrorState, FormField, PageLoader, Select, Spinner } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import type { Package, TimeUnit, User } from '../../types';
import { DeviceIcon } from '../../components/DeviceIcon';
import { Badge } from '../../components/ui';
import { DEVICE_INVENTORY, DEVICE_OWNERSHIP, DEVICE_TYPE_LABEL } from '../../utils/labels';
import { formatDateTime, formatElapsed, timeAgo, truncate } from '../../utils/format';

// ---------- Suspender ----------

const REASONS = ['Falta de pago', 'Uso indebido', 'Conexiones compartidas', 'Solicitud del cliente'];

export function SuspendModal({
  open,
  title,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('Falta de pago');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('Falta de pago');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!reason.trim()) {
      setError('Indica el motivo de la suspensión');
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy}>
            {busy && <Spinner size={14} />} Suspender
          </button>
        </>
      }
    >
      <p className="muted text-sm">
        El cliente no podrá reproducir contenido y verá este motivo en su aplicación hasta que lo reactives.
      </p>
      <div className="chips">
        {REASONS.map((r) => (
          <button key={r} type="button" className={`chip ${reason === r ? 'chip-active' : ''}`} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <FormField label="Motivo" required error={error}>
        <input
          className="input"
          value={reason}
          autoFocus
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
        />
      </FormField>
    </Modal>
  );
}

// ---------- Extender ----------

const QUICK: { label: string; amount: number; unit: TimeUnit }[] = [
  { label: '+1 mes', amount: 1, unit: 'months' },
  { label: '+3 meses', amount: 3, unit: 'months' },
  { label: '+6 meses', amount: 6, unit: 'months' },
  { label: '+12 meses', amount: 12, unit: 'months' },
];

export function ExtendModal({
  open,
  title,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: (amount: number, unit: TimeUnit) => Promise<void>;
}) {
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState<TimeUnit>('months');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount(1);
      setUnit('months');
      setError(null);
    }
  }, [open]);

  const run = async (a: number, u: TimeUnit) => {
    if (!Number.isInteger(a) || a < 1) {
      setError('Indica una cantidad entera mayor que 0');
      return;
    }
    setBusy(true);
    try {
      await onConfirm(a, u);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      onSubmit={() => void run(amount, unit)}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={14} />} Extender
          </button>
        </>
      }
    >
      <p className="muted text-sm">
        Se suma el tiempo desde la fecha de vencimiento actual, o desde hoy si la línea ya venció.
      </p>
      <div className="quick-grid">
        {QUICK.map((q) => (
          <button key={q.label} type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(q.amount, q.unit)}>
            {q.label}
          </button>
        ))}
      </div>
      <FormField label="Personalizado" error={error}>
        <div className="row">
          <input
            className="input input-narrow"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => {
              setAmount(Math.floor(Number(e.target.value)));
              setError(null);
            }}
          />
          <Select
            className="input-narrow"
            value={unit}
            onChange={(v) => setUnit(v as TimeUnit)}
            options={[
              { value: 'days', label: 'días' },
              { value: 'months', label: 'meses' },
            ]}
          />
        </div>
      </FormField>
    </Modal>
  );
}

// ---------- Asignar paquetes (masivo) ----------

export function AssignPackagesModal({
  open,
  count,
  packages,
  onClose,
  onConfirm,
}: {
  open: boolean;
  count: number;
  packages: Package[];
  onClose: () => void;
  onConfirm: (ids: number[]) => Promise<void>;
}) {
  const [ids, setIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setIds([]);
  }, [open]);

  return (
    <Modal
      open={open}
      title={`Asignar paquetes a ${count} cliente${count === 1 ? '' : 's'}`}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(ids);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner size={14} />} Asignar
          </button>
        </>
      }
    >
      <Alert tone="amber" icon={<Info size={18} />}>
        Los paquetes seleccionados <strong>reemplazan</strong> los que tengan actualmente los clientes.
      </Alert>
      <PackageChecklist packages={packages} value={ids} onChange={setIds} />
    </Modal>
  );
}

// ---------- Datos de acceso ----------

export function UserAccessModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { data, loading, error, reload } = useAsync(
    async () => (user ? api.users.access(user.id) : null),
    [user?.id],
  );

  const m3u = data?.m3u_url ?? '';
  const m3u8 = data?.m3u8_url || (m3u.includes('output=') ? m3u.replace(/output=[^&]*/, 'output=m3u8') : '');
  let epg = data?.epg_url ?? '';
  if (!epg && data && m3u.includes('/get.php')) {
    try {
      const u = new URL(m3u, window.location.origin);
      epg = `${u.origin}/xmltv.php?username=${encodeURIComponent(data.xtream.username)}&password=${encodeURIComponent(data.xtream.password)}`;
    } catch {
      epg = '';
    }
  }

  const summary = data
    ? [
        `Servidor: ${data.xtream.server}`,
        `Usuario: ${data.xtream.username}`,
        `Contraseña: ${data.xtream.password}`,
        `Lista M3U: ${m3u}`,
      ].join('\n')
    : '';

  return (
    <Modal open={user !== null} title={`Datos de acceso: ${user?.username ?? ''}`} onClose={onClose}>
      {loading && !data ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : data ? (
        <div className="stack">
          <p className="muted text-sm">
            Para apps compatibles con Xtream Codes (IPTV Smarters, TiviMate, XCIPTV…) usa servidor, usuario y contraseña.
            Para reproductores genéricos usa la lista M3U.
          </p>
          <CopyField label="Servidor (URL)" value={data.xtream.server} />
          <div className="grid-2">
            <CopyField label="Usuario" value={data.xtream.username} />
            <CopyField label="Contraseña" value={data.xtream.password} />
          </div>
          <CopyField label="Lista M3U" value={m3u} />
          {m3u8 && m3u8 !== m3u && <CopyField label="Lista M3U (HLS / m3u8)" value={m3u8} />}
          {epg && <CopyField label="Guía EPG (XMLTV)" value={epg} />}
          <div className="row row-end">
            <CopyButton text={summary} label="Copiar todo" size="md" />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

// ---------- Conexiones del cliente ----------

export function UserConnectionsModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useAsync(
    async () => (user ? asList(await api.users.connections(user.id)) : []),
    [user?.id],
  );
  const rows = data ?? [];

  const kick = async (id: number) => {
    const ok = await confirm({
      title: 'Expulsar conexión',
      message: 'Se cortará la reproducción de esta conexión. ¿Continuar?',
      confirmText: 'Expulsar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.connections.kick(id);
      toast.success('Conexión expulsada');
      void reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Modal open={user !== null} title={`Conexiones de ${user?.username ?? ''}`} onClose={onClose} size="lg">
      {loading && !data ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Unplug size={28} />} title="Sin conexiones activas" description="Este cliente no está reproduciendo nada ahora mismo." />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Contenido</th>
                <th>IP</th>
                <th className="hide-mobile">Dispositivo</th>
                <th>Inicio</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.stream_name ?? `#${c.stream_id ?? '—'}`}</td>
                  <td className="mono">{c.ip}</td>
                  <td className="hide-mobile" title={c.user_agent}>
                    {truncate(c.user_agent, 40)}
                  </td>
                  <td>
                    <div className="cell-main">
                      <span>{formatDateTime(c.started_at)}</span>
                      <span className="muted text-xs">{formatElapsed(c.started_at)}</span>
                    </div>
                  </td>
                  <td className="col-actions">
                    <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => void kick(c.id)}>
                      Expulsar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row row-end mt">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reload()}>
          Actualizar
        </button>
      </div>
    </Modal>
  );
}

// ---------- Dispositivos del cliente ----------

export function ClientDevicesModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { data, loading, error, reload } = useAsync(
    async () => (user ? api.devices.list({ user_id: user.id, page: 1, limit: 100, sort: 'last_seen_at', order: 'desc' }) : null),
    [user?.id],
  );
  const rows = data?.data ?? [];

  return (
    <Modal
      open={user !== null}
      title={`Dispositivos de ${user?.username ?? ''}`}
      onClose={onClose}
      size="lg"
      footer={
        user ? (
          <Link to={`/dispositivos?user_id=${user.id}`} className="btn btn-secondary" onClick={onClose}>
            <MonitorSmartphone size={15} /> Abrir en Dispositivos
          </Link>
        ) : undefined
      }
    >
      {loading && !data ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<MonitorSmartphone size={28} />}
          title="Sin dispositivos"
          description="Los equipos aparecerán aquí cuando el cliente se conecte o cuando le asignes uno."
        />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Dispositivo</th>
                <th className="hide-mobile">App</th>
                <th className="hide-mobile">Estado</th>
                <th>Última conexión</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="col-device">
                    <DeviceIcon type={d.type} online={d.online} />
                  </td>
                  <td>
                    <div className="cell-main">
                      <span className="strong">{d.display_name}</span>
                      <span className="muted text-xs">{[d.type_label || DEVICE_TYPE_LABEL[d.type], d.brand, d.model, d.os].filter(Boolean).join(' · ')}</span>
                    </div>
                  </td>
                  <td className="hide-mobile">{d.app || '—'}</td>
                  <td className="hide-mobile">
                    <div className="badge-stack">
                      <Badge tone={DEVICE_OWNERSHIP[d.ownership]?.tone ?? 'gray'}>{DEVICE_OWNERSHIP[d.ownership]?.label ?? d.ownership}</Badge>
                      {d.open_alerts > 0 && <Badge tone="red">{d.open_alerts} alerta(s)</Badge>}
                    </div>
                  </td>
                  <td>
                    <div className="cell-main">
                      <span className={d.inactive ? 'text-red strong' : d.online ? 'text-green' : ''}>{timeAgo(d.last_seen_at)}</span>
                      <span className="muted text-xs">{DEVICE_INVENTORY[d.inventory_status]?.label ?? ''}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
