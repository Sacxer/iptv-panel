import { useState } from 'react';
import { BellRing, Inbox, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { api, asList, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { usePackages } from '../../hooks/useResources';
import { ActionMenu } from '../../components/ActionMenu';
import { DataTable } from '../../components/DataTable';
import { KindBadge } from '../../components/KindBadge';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Badge, Spinner, Switch } from '../../components/ui';
import type { Reminder } from '../../types';
import { formatDateTime, formatNumber, timeAgo, timeFromNow, truncate } from '../../utils/format';
import { recurrenceText } from '../../utils/recurrence';
import { ReminderEditor } from './ReminderEditor';

export function RemindersTab({ onViewSent }: { onViewSent: (r: Reminder) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const list = useAsync(async () => asList(await api.reminders.list()), []);
  const { packages } = usePackages();
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);

  const replace = (r: Reminder) => list.setData((prev) => prev?.map((x) => (x.id === r.id ? r : x)) ?? prev);

  const toggle = async (r: Reminder) => {
    try {
      const updated = await api.reminders.update(r.id, { active: !r.active });
      replace(updated);
      toast.success(updated.active ? 'Recordatorio activado' : 'Recordatorio pausado');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const runNow = async (r: Reminder) => {
    const ok = await confirm({
      title: 'Enviar ahora',
      message: (
        <>
          Se enviará <strong>{r.title}</strong> a {r.target_label.toLowerCase()} en este momento, sin esperar a la próxima fecha programada.
        </>
      ),
      confirmText: 'Enviar',
    });
    if (!ok) return;
    setRunningId(r.id);
    try {
      const res = await api.reminders.run(r.id);
      if (res.reminder) replace(res.reminder);
      toast.success(
        res.messages_created === 0
          ? 'No se generó ningún mensaje (ningún cliente cumple las condiciones ahora)'
          : `Enviado: ${formatNumber(res.messages_created)} mensaje${res.messages_created === 1 ? '' : 's'} creado${res.messages_created === 1 ? '' : 's'}`,
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunningId(null);
    }
  };

  const remove = async (r: Reminder) => {
    const ok = await confirm({
      title: 'Eliminar recordatorio',
      message: (
        <>
          ¿Eliminar <strong>{r.title}</strong>? Dejará de enviarse; los mensajes ya enviados se conservan.
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.reminders.remove(r.id);
      toast.success('Recordatorio eliminado');
      void list.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <div className="tab-toolbar">
        <p className="muted text-sm no-margin">Mensajes que se envían solos: pagos, vencimientos, mantenimientos, promociones…</p>
        <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus size={16} /> Nuevo recordatorio
        </button>
      </div>
      <DataTable<Reminder>
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        emptyTitle="No hay recordatorios"
        emptyDescription="Crea recordatorios repetitivos, por ejemplo un aviso de pago cada mes o un mensaje 3 días antes del vencimiento."
        rowClassName={(r) => (r.active ? '' : 'row-muted')}
        columns={[
          {
            key: 'title',
            header: 'Recordatorio',
            render: (r) => (
              <div className="cell-main">
                <span className="row-inline">
                  <KindBadge kind={r.kind} />
                  <span className="strong">{r.title}</span>
                  {r.display === 'popup' && <Badge tone="blue">Emergente</Badge>}
                </span>
                <span className="muted text-sm">{truncate(r.body, 90)}</span>
              </div>
            ),
          },
          { key: 'target', header: 'Destino', hideOnMobile: true, render: (r) => <span className="text-sm">{r.target_label}</span> },
          {
            key: 'recurrence',
            header: 'Repetición',
            render: (r) => <span className="text-sm">{recurrenceText(r.recurrence, r.config ?? {}, r.starts_at)}</span>,
          },
          {
            key: 'next',
            header: 'Próximo envío',
            render: (r) =>
              !r.active ? (
                <span className="muted">Pausado</span>
              ) : r.next_run_at ? (
                <div className="cell-main">
                  <span className="strong nowrap">{timeFromNow(r.next_run_at)}</span>
                  <span className="muted text-xs nowrap">{formatDateTime(r.next_run_at)}</span>
                </div>
              ) : (
                <span className="muted">Sin envíos pendientes</span>
              ),
          },
          {
            key: 'sent',
            header: 'Enviados',
            hideOnMobile: true,
            render: (r) => (
              <div className="cell-main">
                <span>{formatNumber(r.sent_count)}</span>
                {r.last_run_at && <span className="muted text-xs nowrap">último {timeAgo(r.last_run_at)}</span>}
              </div>
            ),
          },
          { key: 'active', header: 'Activo', render: (r) => <Switch checked={r.active} onChange={() => void toggle(r)} /> },
          {
            key: 'actions',
            header: '',
            className: 'col-actions',
            render: (r) => (
              <div className="row-actions">
                <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Enviar ahora" disabled={runningId === r.id} onClick={() => void runNow(r)}>
                  {runningId === r.id ? <Spinner size={13} /> : <Send size={15} />}
                </button>
                <ActionMenu
                  items={[
                    { label: 'Editar', icon: <Pencil size={15} />, onClick: () => { setEditing(r); setFormOpen(true); } },
                    { label: 'Enviar ahora', icon: <BellRing size={15} />, onClick: () => void runNow(r) },
                    { label: 'Ver enviados', icon: <Inbox size={15} />, onClick: () => onViewSent(r) },
                    { label: 'Eliminar', icon: <Trash2 size={15} />, onClick: () => void remove(r), danger: true, divider: true },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />
      <ReminderEditor
        open={formOpen}
        reminder={editing}
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
