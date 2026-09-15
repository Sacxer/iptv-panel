import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, asList, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useInterval } from '../../hooks/useInterval';
import { usePackages } from '../../hooks/useResources';
import { DataTable } from '../../components/DataTable';
import { DateTimeInput } from '../../components/DateTimeInput';
import { Modal } from '../../components/Modal';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, FormField, Select, Spinner, Switch } from '../../components/ui';
import type { Outage, OutageInput, Package } from '../../types';
import { formatDateTime, nowUnix, truncate } from '../../utils/format';

export function ScheduledOutagesTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const list = useAsync(async () => {
    const rows = asList(await api.outages.list());
    return [...rows].sort((a, b) => Number(b.active_now) - Number(a.active_now) || b.starts_at - a.starts_at);
  }, []);
  const { packages, byId } = usePackages();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Outage | null>(null);

  useInterval(() => void list.reload(true), 60000);

  const remove = async (o: Outage) => {
    const ok = await confirm({
      title: o.active_now ? 'Finalizar y eliminar corte' : 'Eliminar corte',
      message: (
        <>
          ¿Eliminar el corte <strong>{o.title}</strong>?
          {o.active_now && ' Está activo ahora: los clientes afectados recuperarán el servicio de inmediato.'}
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.outages.remove(o.id);
      toast.success('Corte eliminado');
      void list.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <div className="tab-toolbar">
        <p className="muted text-sm no-margin">Interrupciones y mantenimientos que afectan a todos o a un paquete completo.</p>
        <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus size={16} /> Nuevo corte programado
        </button>
      </div>
      <Alert tone="blue" icon={<Info size={18} />}>
        Los cortes individuales por falta de pago se hacen desde{' '}
        <Link to="/clientes" className="link strong">
          Clientes → Suspender
        </Link>
        , o automáticamente según WispHub (pestaña «Modo de cortes» y{' '}
        <Link to="/migracion-wisphub?tab=conexion" className="link strong">
          Migración WispHub
        </Link>
        ). Los servicios Gratis nunca se cortan.
      </Alert>
      <DataTable<Outage>
        rows={list.data ?? []}
        rowKey={(o) => o.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        emptyTitle="No hay cortes programados"
        rowClassName={(o) => (o.active_now ? 'row-active-outage' : o.ends_at !== null && o.ends_at < nowUnix() ? 'row-muted' : '')}
        columns={[
          {
            key: 'title',
            header: 'Corte',
            render: (o) => (
              <div className="cell-main">
                <span className="row-inline">
                  {o.active_now && (
                    <Badge tone="red" dot>
                      ACTIVO AHORA
                    </Badge>
                  )}
                  <span className="strong">{o.title}</span>
                </span>
                {o.reason && <span className="muted text-sm">{truncate(o.reason, 100)}</span>}
              </div>
            ),
          },
          {
            key: 'scope',
            header: 'Alcance',
            render: (o) =>
              o.scope === 'global' ? (
                <Badge tone="purple">Global</Badge>
              ) : (
                <Badge tone="orange">Paquete: {o.package_id !== null ? byId.get(o.package_id)?.name ?? `#${o.package_id}` : '—'}</Badge>
              ),
          },
          { key: 'start', header: 'Inicio', render: (o) => formatDateTime(o.starts_at) },
          { key: 'end', header: 'Fin', render: (o) => (o.ends_at === null ? <span className="muted">Hasta que se elimine</span> : formatDateTime(o.ends_at)) },
          {
            key: 'block',
            header: 'Reproducción',
            hideOnMobile: true,
            render: (o) => (o.block_playback ? <Badge tone="red">Bloqueada</Badge> : <Badge tone="gray">Solo aviso</Badge>),
          },
          {
            key: 'actions',
            header: '',
            className: 'col-actions',
            render: (o) => (
              <div className="row-actions">
                <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => { setEditing(o); setFormOpen(true); }}>
                  <Pencil size={15} />
                </button>
                <button type="button" className="btn btn-ghost btn-icon btn-sm text-red" title="Eliminar" onClick={() => void remove(o)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />
      <OutageFormModal
        open={formOpen}
        outage={editing}
        packages={packages}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void list.reload(true);
        }}
      />
    </>
  );
}

function emptyOutage(): OutageInput {
  return { title: '', reason: '', scope: 'global', package_id: null, starts_at: nowUnix(), ends_at: null, block_playback: true };
}

function OutageFormModal({
  open,
  outage,
  packages,
  onClose,
  onSaved,
}: {
  open: boolean;
  outage: Outage | null;
  packages: Package[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<OutageInput>(emptyOutage);
  const [errors, setErrors] = useState<Partial<Record<'title' | 'package' | 'starts' | 'ends', string>>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setServerError(null);
    setForm(
      outage
        ? {
            title: outage.title,
            reason: outage.reason ?? '',
            scope: outage.scope,
            package_id: outage.package_id,
            starts_at: outage.starts_at,
            ends_at: outage.ends_at,
            block_playback: outage.block_playback,
          }
        : emptyOutage(),
    );
  }, [open, outage]);

  const set = <K extends keyof OutageInput>(k: K, v: OutageInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const e: typeof errors = {};
    if (!form.title.trim()) e.title = 'El título es obligatorio';
    if (form.scope === 'package' && form.package_id === null) e.package = 'Selecciona un paquete';
    if (!form.starts_at) e.starts = 'Indica la fecha de inicio';
    if (form.ends_at !== null && form.starts_at && form.ends_at <= form.starts_at) e.ends = 'El fin debe ser posterior al inicio';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    const body: OutageInput = {
      ...form,
      title: form.title.trim(),
      reason: form.reason.trim(),
      package_id: form.scope === 'package' ? form.package_id : null,
    };
    try {
      if (outage) await api.outages.update(outage.id, body);
      else await api.outages.create(body);
      toast.success(outage ? 'Corte actualizado' : 'Corte programado');
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
      title={outage ? 'Editar corte' : 'Nuevo corte'}
      onClose={onClose}
      dismissible={!busy}
      onSubmit={() => void submit()}
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
      {serverError && <Alert tone="red">{serverError}</Alert>}
      <FormField label="Título" required error={errors.title}>
        <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Mantenimiento programado" />
      </FormField>
      <FormField label="Motivo" hint="Se muestra a los clientes en la app.">
        <textarea className="input textarea" rows={3} value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Estamos cambiando de servidor, volvemos en 2 horas." />
      </FormField>
      <FormField label="Alcance">
        <div className="segmented">
          <button type="button" className={`segment ${form.scope === 'global' ? 'is-active' : ''}`} onClick={() => set('scope', 'global')}>
            Global (todos)
          </button>
          <button type="button" className={`segment ${form.scope === 'package' ? 'is-active' : ''}`} onClick={() => set('scope', 'package')}>
            Un paquete
          </button>
        </div>
      </FormField>
      {form.scope === 'package' && (
        <FormField label="Paquete" required error={errors.package}>
          <Select
            value={form.package_id === null ? '' : String(form.package_id)}
            onChange={(v) => set('package_id', v ? Number(v) : null)}
            placeholder="Selecciona…"
            options={packages.map((p) => ({ value: String(p.id), label: p.name }))}
          />
        </FormField>
      )}
      <div className="grid-2">
        <FormField label="Inicio" required error={errors.starts}>
          <DateTimeInput value={form.starts_at} onChange={(v) => set('starts_at', v ?? nowUnix())} />
        </FormField>
        <FormField label="Fin" hint="Vacío = hasta que se elimine" error={errors.ends}>
          <DateTimeInput value={form.ends_at} onChange={(v) => set('ends_at', v)} clearable />
        </FormField>
      </div>
      <div className="subcard">
        <Switch
          checked={form.block_playback}
          onChange={(v) => set('block_playback', v)}
          label="Bloquear la reproducción"
          description={
            form.block_playback
              ? 'Durante el corte los clientes afectados NO podrán reproducir contenido; las apps propias mostrarán el motivo y las de terceros recibirán "Banned".'
              : 'Solo se mostrará el aviso del corte en las apps propias; la reproducción seguirá funcionando con normalidad.'
          }
        />
      </div>
    </Modal>
  );
}
