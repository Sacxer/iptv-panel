import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, Combine, Info, RefreshCw, Trash2, UserX } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { DeviceIcon, notifyDevicesChanged } from '../../components/DeviceIcon';
import { Modal } from '../../components/Modal';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, ErrorState, Spinner } from '../../components/ui';
import type { Device, DeviceDuplicateGroup, DeviceDuplicates } from '../../types';
import { formatDateTime, formatNumber, timeAgo } from '../../utils/format';
import { DEVICE_TYPE_LABEL } from '../../utils/labels';

export const DUPLICATE_REASON: Record<string, string> = {
  same_signature: 'Misma app/equipo con el mismo cliente',
  same_session: 'Firma genérica de la app junto al equipo real, misma red',
  mixed: 'Varios motivos',
};

const RECOGNITION_NOTE =
  'Los dispositivos se reconocen sin repetir: la app propia por su ID; las apps de terceros por cliente + app sin versión, uniendo las firmas genéricas al equipo real de la misma red.';

const MERGE_NOTE = 'El dispositivo que conserves recibe la información combinada, las alertas y las firmas de los demás; los otros se eliminan.';

function plural(n: number, one: string, many: string) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

// ---------- Tarjeta comparativa de un dispositivo ----------

export function DeviceCompareCard({
  device,
  keep,
  onKeep,
  name,
  suggested = false,
  disabled = false,
}: {
  device: Device;
  keep: boolean;
  onKeep: () => void;
  /** Nombre del grupo de radios. */
  name: string;
  suggested?: boolean;
  disabled?: boolean;
}) {
  const d = device;
  const rows: [string, ReactNode][] = [
    ['Tipo', d.type_label || DEVICE_TYPE_LABEL[d.type] || d.type],
    ['App', d.app || '—'],
    ['Modelo', [d.brand, d.model].filter(Boolean).join(' ') || '—'],
    ['Sistema', d.os || '—'],
    [
      'Cliente',
      d.user_id !== null ? (
        <Link className="link" to={`/clientes?search=${encodeURIComponent(d.username ?? '')}`}>
          {d.username}
        </Link>
      ) : (
        <span className="muted">Sin asignar</span>
      ),
    ],
    ['Última IP', d.last_ip ? <span className="mono">{d.last_ip}</span> : '—'],
    ['Última conexión', d.last_seen_at ? <span title={formatDateTime(d.last_seen_at)}>{timeAgo(d.last_seen_at)}</span> : '—'],
    ['Creado', formatDateTime(d.created_at)],
    ['Alertas abiertas', d.open_alerts > 0 ? <Badge tone="red">{d.open_alerts}</Badge> : '0'],
  ];
  return (
    <label className={`dup-device ${keep ? 'is-keep' : 'is-drop'} ${disabled ? 'is-disabled' : ''}`}>
      <span className="dup-device-head">
        <input type="radio" className="radio" name={name} checked={keep} onChange={onKeep} disabled={disabled} />
        <DeviceIcon type={d.type} online={d.online} />
        <span className="dup-device-title">
          <span className="strong">{d.display_name || `#${d.id}`}</span>
          <span className="muted text-xs">
            #{d.id} · {d.source === 'manual' ? 'Manual' : 'Detectado'}
          </span>
        </span>
      </span>
      <span className="dup-device-tags">
        {keep ? <Badge tone="green">Conservar</Badge> : <Badge tone="gray">Se eliminará</Badge>}
        {suggested && <Badge tone="blue">Sugerido</Badge>}
      </span>
      <dl className="dup-device-fields">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </label>
  );
}

// ---------- Panel de duplicados y huérfanos ----------

export function DuplicatesModal({
  open,
  data,
  loading,
  error,
  onReload,
  onClose,
  onChanged,
}: {
  open: boolean;
  data: DeviceDuplicates | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onClose: () => void;
  /** Tras fusionar o limpiar: refresca duplicados, estadísticas y tabla. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const groups = data?.groups ?? [];

  useEffect(() => {
    if (open) onReload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const after = () => {
    notifyDevicesChanged();
    onChanged();
  };

  const mergeAll = async () => {
    setBusy('all');
    try {
      const sim = await api.devices.dedupe(true);
      if (sim.groups === 0) {
        toast.info('No hay duplicados que fusionar');
        after();
        return;
      }
      const ok = await confirm({
        title: 'Fusionar todos los duplicados',
        message: (
          <>
            Se {sim.groups === 1 ? 'fusionará' : 'fusionarán'} <strong>{plural(sim.groups, 'grupo', 'grupos')}</strong> y se{' '}
            {sim.merged === 1 ? 'eliminará' : 'eliminarán'}{' '}
            <strong>{plural(sim.merged, 'dispositivo repetido', 'dispositivos repetidos')}</strong>, conservando en cada grupo el registro más
            completo (no necesariamente el que marcaste aquí). {MERGE_NOTE}
          </>
        ),
        confirmText: `Fusionar ${formatNumber(sim.groups)}`,
        danger: true,
      });
      if (!ok) return;
      const res = await api.devices.dedupe(false);
      toast.success(`Se fusionaron ${plural(res.groups, 'grupo', 'grupos')} (${plural(res.merged, 'dispositivo eliminado', 'dispositivos eliminados')})`);
      after();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const cleanOrphans = async () => {
    setBusy('orphans');
    try {
      const sim = await api.devices.cleanupOrphans(true);
      if (sim.orphans === 0) {
        toast.info('No hay equipos huérfanos');
        after();
        return;
      }
      const ok = await confirm({
        title: 'Limpiar equipos huérfanos',
        message: (
          <>
            Se {sim.orphans === 1 ? 'eliminará' : 'eliminarán'} <strong>{plural(sim.orphans, 'equipo detectado', 'equipos detectados')}</strong> de clientes que ya no existen. Los TV
            Box de la empresa y los dispositivos registrados a mano no se tocan.
          </>
        ),
        confirmText: 'Limpiar huérfanos',
        danger: true,
      });
      if (!ok) return;
      const res = await api.devices.cleanupOrphans(false);
      toast.success(`Se eliminaron ${plural(res.deleted, 'equipo huérfano', 'equipos huérfanos')}`);
      after();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} title="Revisar duplicados" onClose={onClose} size="xl" dismissible={busy === null}>
      <div className="stack">
        <Alert tone="blue" icon={<Info size={18} />}>
          {RECOGNITION_NOTE}
        </Alert>

        {error && !data ? (
          <ErrorState message={error} onRetry={onReload} />
        ) : !data ? (
          <div className="bulk-loading">
            <Spinner label="Buscando duplicados…" />
          </div>
        ) : (
          <>
            <section className="dup-section">
              <div className="dup-section-head">
                <div>
                  <h3 className="dup-section-title">
                    Posibles duplicados{' '}
                    <span className={`tab-count ${groups.length > 0 ? 'tab-count-alert' : ''}`}>{formatNumber(groups.length)}</span>
                  </h3>
                  <p className="muted text-sm no-margin">
                    {groups.length > 0
                      ? `${plural(groups.length, 'grupo', 'grupos')} · ${plural(data.duplicate_devices, 'dispositivo sobra', 'dispositivos sobran')}. ${MERGE_NOTE}`
                      : 'No se encontraron dispositivos repetidos.'}
                  </p>
                </div>
                <div className="row">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onReload} disabled={loading || busy !== null} title="Volver a buscar">
                    {loading ? <Spinner size={13} /> : <RefreshCw size={14} />} Actualizar
                  </button>
                  {groups.length > 0 && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void mergeAll()} disabled={busy !== null}>
                      {busy === 'all' ? <Spinner size={13} /> : <Combine size={14} />} Fusionar todos ({formatNumber(groups.length)})
                    </button>
                  )}
                </div>
              </div>
              {groups.length === 0 ? (
                <div className="health-ok">
                  <CircleCheck size={16} /> Todo en orden: cada equipo aparece una sola vez.
                </div>
              ) : (
                <div className="stack">
                  {groups.map((g) => (
                    <DuplicateGroupCard key={g.key} group={g} disabled={busy !== null} onBusy={setBusy} onMerged={after} />
                  ))}
                </div>
              )}
            </section>

            <section className="dup-section">
              <div className="dup-section-head">
                <div>
                  <h3 className="dup-section-title">
                    Equipos huérfanos <span className={`tab-count ${data.orphans > 0 ? 'tab-count-alert' : ''}`}>{formatNumber(data.orphans)}</span>
                  </h3>
                  <p className="muted text-sm no-margin">
                    Equipos detectados automáticamente de clientes que ya no existen. Los de la empresa y los registrados a mano nunca se tocan.
                  </p>
                </div>
                {data.orphans > 0 && (
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => void cleanOrphans()} disabled={busy !== null}>
                    {busy === 'orphans' ? <Spinner size={13} /> : <Trash2 size={14} />} Limpiar huérfanos
                  </button>
                )}
              </div>
              {data.orphans === 0 && (
                <div className="health-ok">
                  <UserX size={16} /> No hay equipos huérfanos.
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function DuplicateGroupCard({
  group,
  disabled,
  onBusy,
  onMerged,
}: {
  group: DeviceDuplicateGroup;
  disabled: boolean;
  onBusy: (v: string | null) => void;
  onMerged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [keepId, setKeepId] = useState(group.target_id);
  const [merging, setMerging] = useState(false);

  useEffect(() => setKeepId(group.target_id), [group.target_id, group.key]);

  const keep = group.devices.find((d) => d.id === keepId);
  const sources = useMemo(() => group.devices.filter((d) => d.id !== keepId).map((d) => d.id), [group.devices, keepId]);

  const merge = async () => {
    if (!keep || sources.length === 0) return;
    const ok = await confirm({
      title: 'Fusionar dispositivos',
      message: (
        <>
          Se conservará <strong>{keep.display_name || `#${keep.id}`}</strong> (#{keep.id}) y se eliminará{sources.length === 1 ? '' : 'n'}{' '}
          {sources.map((id) => `#${id}`).join(', ')}. {MERGE_NOTE}
        </>
      ),
      confirmText: 'Fusionar',
      danger: true,
    });
    if (!ok) return;
    setMerging(true);
    onBusy(group.key);
    try {
      const res = await api.devices.merge(keep.id, sources);
      toast.success(`Fusionado en «${res.device?.display_name || keep.display_name || `#${keep.id}`}» (${plural(res.merged ?? sources.length, 'eliminado', 'eliminados')})`);
      onMerged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setMerging(false);
      onBusy(null);
    }
  };

  return (
    <article className="dup-group">
      <header className="dup-group-head">
        <div className="dup-group-reason">
          <Badge tone={group.reason === 'mixed' ? 'purple' : group.reason === 'same_session' ? 'amber' : 'blue'}>
            {DUPLICATE_REASON[group.reason] ?? group.reason}
          </Badge>
          <span className="muted text-xs">{plural(group.devices.length, 'dispositivo', 'dispositivos')}</span>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void merge()} disabled={disabled || merging || !keep || sources.length === 0}>
          {merging ? <Spinner size={13} /> : <Combine size={14} />} Fusionar
        </button>
      </header>
      <div className="dup-devices">
        {group.devices.map((d) => (
          <DeviceCompareCard
            key={d.id}
            device={d}
            name={`dup-${group.key}`}
            keep={d.id === keepId}
            suggested={d.id === group.target_id}
            onKeep={() => setKeepId(d.id)}
            disabled={disabled || merging}
          />
        ))}
      </div>
    </article>
  );
}

// ---------- Fusión manual desde la selección de la tabla ----------

/** Registro sugerido: el manual/de la empresa, luego el más completo y, a igualdad, el visto más recientemente. */
function suggestTarget(devices: Device[]): number | null {
  if (devices.length === 0) return null;
  const score = (d: Device) =>
    (d.source === 'manual' ? 100 : 0) +
    (d.ownership === 'company' ? 50 : 0) +
    (d.user_id !== null ? 10 : 0) +
    [d.name, d.brand, d.model, d.os, d.app, d.mac, d.serial, d.device_id].filter(Boolean).length;
  return [...devices].sort((a, b) => score(b) - score(a) || (b.last_seen_at ?? 0) - (a.last_seen_at ?? 0))[0].id;
}

export function MergeDevicesModal({ devices, onClose, onMerged }: { devices: Device[] | null; onClose: () => void; onMerged: () => void }) {
  const toast = useToast();
  const [keepId, setKeepId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = devices ?? [];
  const suggested = useMemo(() => suggestTarget(list), [list]);

  useEffect(() => {
    setKeepId(suggested);
    setError(null);
  }, [suggested]);

  const mixedClients = new Set(list.map((d) => d.user_id ?? 0)).size > 1;
  const mixedTypes = new Set(list.map((d) => d.type)).size > 1;

  const save = async () => {
    if (keepId === null) return;
    setBusy(true);
    setError(null);
    try {
      const sources = list.filter((d) => d.id !== keepId).map((d) => d.id);
      const res = await api.devices.merge(keepId, sources);
      toast.success(`${plural(list.length, 'dispositivo fusionado', 'dispositivos fusionados')} en «${res.device?.display_name ?? `#${keepId}`}»`);
      notifyDevicesChanged();
      onMerged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={devices !== null}
      title={`Fusionar ${formatNumber(list.length)} dispositivos en uno`}
      onClose={onClose}
      size="lg"
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || keepId === null || list.length < 2}>
            {busy ? <Spinner size={14} /> : <Combine size={15} />} Fusionar
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted text-sm no-margin">Elige cuál conservar. {MERGE_NOTE}</p>
        {(mixedClients || mixedTypes) && (
          <Alert tone="amber">
            Los dispositivos seleccionados tienen {mixedClients && mixedTypes ? 'clientes y tipos' : mixedClients ? 'clientes' : 'tipos'} distintos.
            Fusiónalos solo si de verdad son el mismo equipo.
          </Alert>
        )}
        <div className="dup-devices">
          {list.map((d) => (
            <DeviceCompareCard
              key={d.id}
              device={d}
              name="merge-selected"
              keep={d.id === keepId}
              suggested={d.id === suggested}
              onKeep={() => setKeepId(d.id)}
              disabled={busy}
            />
          ))}
        </div>
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}
