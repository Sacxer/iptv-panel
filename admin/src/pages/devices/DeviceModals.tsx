import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, Info, Link2Off, Pencil, UserRoundPlus } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { Modal } from '../../components/Modal';
import { DeviceIcon, notifyDevicesChanged } from '../../components/DeviceIcon';
import { UserSearchSelect } from '../../components/UserSearchSelect';
import { useToast } from '../../components/Toast';
import { Alert, Badge, CopyButton, EmptyState, ErrorState, FormField, PageLoader, Select, Spinner } from '../../components/ui';
import type {
  Device,
  DeviceAlert,
  DeviceInput,
  DeviceInventoryStatus,
  DeviceOwnership,
  DeviceType,
} from '../../types';
import { formatDateTime, isValidMac, timeAgo } from '../../utils/format';
import {
  DEVICE_ACTIVITY_LABEL,
  DEVICE_ALERT,
  DEVICE_INVENTORY,
  DEVICE_OWNERSHIP,
  DEVICE_SOURCE_LABEL,
  DEVICE_TYPE_LABEL,
} from '../../utils/labels';
import { AlertTypeIcon } from './AlertTypeIcon';

const TYPE_OPTIONS = (Object.keys(DEVICE_TYPE_LABEL) as DeviceType[]).map((t) => ({ value: t, label: DEVICE_TYPE_LABEL[t] }));
const OWNERSHIP_OPTIONS = (Object.keys(DEVICE_OWNERSHIP) as DeviceOwnership[]).map((o) => ({ value: o, label: DEVICE_OWNERSHIP[o].label }));
const INVENTORY_OPTIONS = (Object.keys(DEVICE_INVENTORY) as DeviceInventoryStatus[]).map((s) => ({
  value: s,
  label: DEVICE_INVENTORY[s].label,
}));

// ---------- Registrar / editar ----------

function emptyDevice(): DeviceInput {
  return {
    name: '',
    type: 'tvbox',
    brand: '',
    model: '',
    os: '',
    mac: '',
    serial: '',
    device_id: '',
    ownership: 'company',
    inventory_status: 'available',
    user_id: null,
    notes: '',
  };
}

export function DeviceFormModal({
  open,
  device,
  onClose,
  onSaved,
}: {
  open: boolean;
  device: Device | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<DeviceInput>(emptyDevice);
  const [clientLabel, setClientLabel] = useState('');
  const [errors, setErrors] = useState<{ name?: string; mac?: string }>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setServerError(null);
    if (device) {
      setForm({
        name: device.name ?? '',
        type: device.type,
        brand: device.brand ?? '',
        model: device.model ?? '',
        os: device.os ?? '',
        mac: device.mac ?? '',
        serial: device.serial ?? '',
        device_id: device.device_id ?? '',
        ownership: device.ownership,
        inventory_status: device.inventory_status,
        user_id: device.user_id,
        notes: device.notes ?? '',
      });
      setClientLabel(device.username ? `${device.username}${device.client_name ? ` · ${device.client_name}` : ''}` : '');
    } else {
      setForm(emptyDevice());
      setClientLabel('');
    }
  }, [open, device]);

  const set = <K extends keyof DeviceInput>(k: K, v: DeviceInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const e: typeof errors = {};
    const mac = form.mac.trim().toUpperCase().replace(/-/g, ':');
    if (!device && !form.name.trim() && !form.model.trim() && !form.serial.trim() && !form.device_id.trim() && !mac)
      e.name = 'Indica al menos un nombre, modelo, serial, MAC o ID de la app';
    if (mac && !isValidMac(mac)) e.mac = 'MAC no válida. Formato: AA:BB:CC:DD:EE:FF';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    const body: DeviceInput = {
      ...form,
      name: form.name.trim(),
      brand: form.brand.trim(),
      model: form.model.trim(),
      os: form.os.trim(),
      mac,
      serial: form.serial.trim(),
      device_id: form.device_id.trim(),
      notes: form.notes,
    };
    try {
      if (device) await api.devices.update(device.id, body);
      else await api.devices.create(body);
      toast.success(device ? 'Dispositivo actualizado' : 'Dispositivo registrado');
      notifyDevicesChanged();
      onSaved();
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={device ? `Editar dispositivo: ${device.display_name}` : 'Registrar dispositivo'}
      onClose={onClose}
      size="lg"
      dismissible={!busy}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={14} />} {device ? 'Guardar' : 'Registrar'}
          </button>
        </>
      }
    >
      {serverError && <Alert tone="red">{serverError}</Alert>}
      {!device && (
        <Alert tone="blue" icon={<Info size={18} />}>
          Los TV Box de la empresa que usan nuestra app se reconocen automáticamente por su <strong>ID de la app</strong> o su{' '}
          <strong>MAC</strong>: regístralos aquí antes de entregarlos. Los equipos con apps de terceros (IPTV Smarters,
          TiviMate…) se reconocen por cliente + app cuando se conectan.
        </Alert>
      )}
      <div className="grid-2">
        <FormField label="Nombre" error={errors.name} hint="Ej.: Box bodega 001">
          <input
            className="input"
            value={form.name}
            onChange={(e) => {
              set('name', e.target.value);
              setErrors((x) => ({ ...x, name: undefined }));
            }}
          />
        </FormField>
        <FormField label="Tipo" hint={device && !device.type_locked ? 'Si lo cambias, la detección automática ya no lo modificará.' : undefined}>
          <Select value={form.type} onChange={(v) => set('type', v as DeviceType)} options={TYPE_OPTIONS} />
        </FormField>
        <FormField label="Marca">
          <input className="input" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
        </FormField>
        <FormField label="Modelo">
          <input className="input" value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="X96 Mini" />
        </FormField>
        <FormField label="Sistema operativo">
          <input className="input" value={form.os} onChange={(e) => set('os', e.target.value)} placeholder="Android 9" />
        </FormField>
        <FormField label="Serial">
          <input className="input mono" value={form.serial} onChange={(e) => set('serial', e.target.value)} />
        </FormField>
        <FormField label="MAC" error={errors.mac} hint="Formato AA:BB:CC:DD:EE:FF">
          <input
            className="input mono"
            value={form.mac}
            onChange={(e) => {
              set('mac', e.target.value);
              setErrors((x) => ({ ...x, mac: undefined }));
            }}
            placeholder="AA:BB:CC:DD:EE:FF"
          />
        </FormField>
        <FormField label="ID de la app (X-Device-Id)" hint="Identificador que envía nuestra app instalada en el equipo.">
          <input className="input mono" value={form.device_id} onChange={(e) => set('device_id', e.target.value)} />
        </FormField>
        <FormField label="Propiedad">
          <Select value={form.ownership} onChange={(v) => set('ownership', v as DeviceOwnership)} options={OWNERSHIP_OPTIONS} />
        </FormField>
        <FormField label="Estado de inventario">
          <Select value={form.inventory_status} onChange={(v) => set('inventory_status', v as DeviceInventoryStatus)} options={INVENTORY_OPTIONS} />
        </FormField>
      </div>
      <FormField label="Asignar a cliente" hint="Opcional">
        <UserSearchSelect
          userId={form.user_id}
          label={clientLabel}
          onChange={(u) => {
            set('user_id', u?.id ?? null);
            setClientLabel(u?.username ?? '');
            if (u && form.inventory_status === 'available') set('inventory_status', 'assigned');
          }}
        />
      </FormField>
      <FormField label="Notas">
        <textarea className="input textarea" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </FormField>
    </Modal>
  );
}

// ---------- Asignar a cliente ----------

export function AssignDeviceModal({ device, onClose, onSaved }: { device: Device | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [userId, setUserId] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!device) return;
    setUserId(device.user_id);
    setLabel(device.username ? `${device.username}${device.client_name ? ` · ${device.client_name}` : ''}` : '');
    setError(null);
  }, [device]);

  const save = async (target: number | null) => {
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      await api.devices.assign(device.id, target);
      toast.success(target === null ? 'Asignación quitada' : 'Dispositivo asignado');
      notifyDevicesChanged();
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={device !== null}
      title={`Asignar a cliente: ${device?.display_name ?? ''}`}
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          {device?.user_id !== null && device?.user_id !== undefined && (
            <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => void save(null)}>
              <Link2Off size={15} /> Quitar asignación
            </button>
          )}
          <div className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || userId === null || userId === device?.user_id}
            onClick={() => void save(userId)}
          >
            {busy && <Spinner size={14} />} Asignar
          </button>
        </>
      }
    >
      {error && <Alert tone="red">{error}</Alert>}
      <p className="muted text-sm">Asignar el equipo cierra sus alertas de "TV Box nuevo" y "Usado por otro cliente".</p>
      <FormField label="Cliente">
        <UserSearchSelect
          userId={userId}
          label={label}
          onChange={(u) => {
            setUserId(u?.id ?? null);
            setLabel(u?.username ?? '');
          }}
        />
      </FormField>
    </Modal>
  );
}

// ---------- Resolver alerta ----------

export function ResolveAlertModal({ alert, onClose, onSaved }: { alert: DeviceAlert | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setResolution('');
    setError(null);
  }, [alert]);

  const quick = alert?.type === 'inactive'
    ? ['Cliente contactado', 'Equipo recuperado', 'Cliente dio de baja el servicio']
    : alert?.type === 'foreign_user'
      ? ['Uso autorizado', 'Equipo reasignado', 'Cliente advertido']
      : ['Equipo del cliente', 'Registrado en inventario'];

  const submit = async () => {
    if (!alert) return;
    if (!resolution.trim()) {
      setError('Escribe una nota de resolución');
      return;
    }
    setBusy(true);
    try {
      await api.devices.resolveAlert(alert.id, resolution.trim());
      toast.success('Alerta resuelta');
      notifyDevicesChanged();
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={alert !== null}
      title="Resolver alerta"
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner size={14} /> : <CircleCheck size={15} />} Resolver
          </button>
        </>
      }
    >
      {alert && <p className="text-sm">{alert.message}</p>}
      <div className="chips">
        {quick.map((q) => (
          <button key={q} type="button" className={`chip ${resolution === q ? 'chip-active' : ''}`} onClick={() => setResolution(q)}>
            {q}
          </button>
        ))}
      </div>
      <FormField label="Nota de resolución" required error={error}>
        <textarea
          className="input textarea"
          rows={3}
          autoFocus
          value={resolution}
          onChange={(e) => {
            setResolution(e.target.value);
            setError(null);
          }}
        />
      </FormField>
    </Modal>
  );
}

// ---------- Detalle ----------

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function DeviceDetailModal({
  deviceId,
  canEdit,
  onClose,
  onEdit,
  onAssign,
}: {
  deviceId: number | null;
  canEdit: boolean;
  onClose: () => void;
  onEdit: (d: Device) => void;
  onAssign: (d: Device) => void;
}) {
  const device = useAsync(async () => (deviceId === null ? null : api.devices.get(deviceId)), [deviceId]);
  const alerts = useAsync(
    async () => (deviceId === null ? null : api.devices.alerts({ device_id: deviceId, status: 'all', page: 1, limit: 50 })),
    [deviceId],
  );
  const d = device.data;
  const foreign = d && d.last_username && d.username && d.last_username !== d.username;

  return (
    <Modal
      open={deviceId !== null}
      title={d ? d.display_name || `Dispositivo #${d.id}` : 'Dispositivo'}
      onClose={onClose}
      size="lg"
      footer={
        d && canEdit ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => onAssign(d)}>
              <UserRoundPlus size={15} /> Asignar a cliente
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onEdit(d)}>
              <Pencil size={15} /> Editar
            </button>
          </>
        ) : undefined
      }
    >
      {device.loading && !d ? (
        <PageLoader />
      ) : device.error ? (
        <ErrorState message={device.error} onRetry={() => void device.reload()} />
      ) : d ? (
        <div className="stack">
          <div className="device-hero">
            <DeviceIcon type={d.type} online={d.online} size={26} />
            <div className="cell-main">
              <span className="strong">{d.display_name}</span>
              <span className="muted text-sm">{[d.type_label || DEVICE_TYPE_LABEL[d.type], d.brand, d.model, d.os].filter(Boolean).join(' · ')}</span>
            </div>
            <div className="grow" />
            <div className="badge-stack">
              <Badge tone={d.online ? 'green' : 'gray'} dot>
                {d.online ? 'En línea' : 'Desconectado'}
              </Badge>
              {d.inactive && <Badge tone="red">Inactivo</Badge>}
              <Badge tone={DEVICE_OWNERSHIP[d.ownership]?.tone ?? 'gray'}>{DEVICE_OWNERSHIP[d.ownership]?.label ?? d.ownership}</Badge>
              <Badge tone={DEVICE_INVENTORY[d.inventory_status]?.tone ?? 'gray'}>
                {DEVICE_INVENTORY[d.inventory_status]?.label ?? d.inventory_status}
              </Badge>
            </div>
          </div>

          {foreign && (
            <Alert tone="red" title="Usado con la cuenta de otro cliente">
              Está asignado a <strong>{d.username}</strong>, pero la última conexión fue con <strong>{d.last_username}</strong>.
            </Alert>
          )}

          <dl className="detail-grid">
            <DetailRow label="Cliente asignado">
              {d.user_id !== null ? (
                <Link className="link" to={`/clientes?search=${encodeURIComponent(d.username ?? '')}`} onClick={onClose}>
                  {d.username}
                  {d.client_name ? ` · ${d.client_name}` : ''}
                </Link>
              ) : (
                <span className="muted">Sin asignar</span>
              )}
            </DetailRow>
            <DetailRow label="Última cuenta usada">
              <span className={foreign ? 'text-red strong' : ''}>{d.last_username ?? '—'}</span>
            </DetailRow>
            <DetailRow label="App">{d.app || '—'}</DetailRow>
            <DetailRow label="Última actividad">
              {d.last_activity ? DEVICE_ACTIVITY_LABEL[d.last_activity] ?? d.last_activity : '—'}
            </DetailRow>
            <DetailRow label="Visto por primera vez">{formatDateTime(d.first_seen_at)}</DetailRow>
            <DetailRow label="Visto por última vez">
              <span className={d.inactive ? 'text-red' : ''}>
                {formatDateTime(d.last_seen_at)} ({timeAgo(d.last_seen_at)})
              </span>
            </DetailRow>
            <DetailRow label="Última IP">
              <span className="mono">{d.last_ip ?? '—'}</span>
            </DetailRow>
            <DetailRow label="MAC">
              <span className="mono">{d.mac || '—'}</span>
            </DetailRow>
            <DetailRow label="Serial">
              <span className="mono">{d.serial || '—'}</span>
            </DetailRow>
            <DetailRow label="ID de la app">
              <span className="mono">{d.device_id || '—'}</span>
            </DetailRow>
            <DetailRow label="Origen">
              {DEVICE_SOURCE_LABEL[d.source] ?? d.source}
              {d.type_locked && <span className="muted text-xs"> · tipo fijado manualmente</span>}
            </DetailRow>
            <DetailRow label="Registrado">{formatDateTime(d.created_at)}</DetailRow>
          </dl>

          {d.user_agent && (
            <div>
              <div className="field-label">User-Agent</div>
              <div className="input-group">
                <code className="code-block grow ua-block">{d.user_agent}</code>
                <CopyButton text={d.user_agent} />
              </div>
            </div>
          )}
          {d.notes && (
            <div>
              <div className="field-label">Notas</div>
              <p className="text-sm pre-wrap no-margin">{d.notes}</p>
            </div>
          )}

          <div>
            <div className="field-label">Historial de alertas</div>
            {alerts.loading && !alerts.data ? (
              <Spinner label="Cargando alertas…" />
            ) : alerts.error ? (
              <ErrorState message={alerts.error} onRetry={() => void alerts.reload()} />
            ) : (alerts.data?.data ?? []).length === 0 ? (
              <EmptyState title="Este dispositivo no tiene alertas" />
            ) : (
              <ul className="alert-history">
                {(alerts.data?.data ?? []).map((a) => (
                  <li key={a.id} className={a.status === 'resolved' ? 'is-resolved' : ''}>
                    <AlertTypeIcon type={a.type} />
                    <div className="cell-main grow">
                      <span className="text-sm">{a.message}</span>
                      <span className="muted text-xs">
                        {DEVICE_ALERT[a.type]?.label ?? a.type} · {formatDateTime(a.created_at)}
                        {a.status === 'resolved' &&
                          ` · Resuelta ${formatDateTime(a.resolved_at)}${a.resolution ? `: ${a.resolution}` : ''}`}
                      </span>
                    </div>
                    <Badge tone={a.status === 'open' ? 'red' : 'green'}>{a.status === 'open' ? 'Abierta' : 'Resuelta'}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
