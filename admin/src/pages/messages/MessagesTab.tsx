import { useEffect, useState } from 'react';
import { BellRing, MailOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { usePackages } from '../../hooks/useResources';
import { DataTable } from '../../components/DataTable';
import { DateTimeInput } from '../../components/DateTimeInput';
import { Modal } from '../../components/Modal';
import { UserSearchSelect } from '../../components/UserSearchSelect';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, FormField, Select, Spinner } from '../../components/ui';
import { KindBadge } from '../../components/KindBadge';
import type { Message, MessageDisplay, MessageInput, MessageKind, MessageTarget, Package } from '../../types';
import { MESSAGE_DISPLAY, MESSAGE_KIND } from '../../utils/labels';
import { formatDateTime, formatNumber, nowUnix, truncate } from '../../utils/format';

const TARGET_LABEL: Record<MessageTarget, string> = {
  all: 'Todos los clientes',
  user: 'Cliente',
  package: 'Paquete',
};

export function MessagesTab({ reminderFilter, onClearReminder }: { reminderFilter: { id: number; title: string } | null; onClearReminder: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [kind, setKind] = useState<MessageKind | ''>('');
  const [origin, setOrigin] = useState<'' | 'manual' | 'reminder'>('');
  useEffect(() => setPage(1), [kind, origin, reminderFilter?.id]);
  const list = useAsync(
    () =>
      api.messages.list(page, limit, {
        kind,
        source: reminderFilter ? '' : origin,
        reminder_id: reminderFilter?.id ?? '',
      }),
    [page, limit, kind, origin, reminderFilter?.id],
  );
  const { packages, byId } = usePackages();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Message | null>(null);

  const remove = async (m: Message) => {
    const ok = await confirm({
      title: 'Eliminar mensaje',
      message: (
        <>
          ¿Eliminar el mensaje <strong>{m.title}</strong>? Desaparecerá de la bandeja de los clientes.
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.messages.remove(m.id);
      toast.success('Mensaje eliminado');
      void list.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const targetText = (m: Message) => {
    if (m.target_label) return m.target_label;
    if (m.target === 'package' && m.package_id !== null) return `Paquete: ${byId.get(m.package_id)?.name ?? `#${m.package_id}`}`;
    if (m.target === 'user' && m.user_id !== null) return `Cliente #${m.user_id}`;
    return TARGET_LABEL[m.target];
  };

  return (
    <>
      <div className="toolbar">
        <Select
          value={kind}
          onChange={(v) => setKind(v as MessageKind | '')}
          placeholder="Todos los tipos"
          options={(Object.keys(MESSAGE_KIND) as MessageKind[]).map((k) => ({ value: k, label: MESSAGE_KIND[k].label }))}
          ariaLabel="Filtrar por tipo"
        />
        {!reminderFilter && (
          <Select
            value={origin}
            onChange={(v) => setOrigin(v as '' | 'manual' | 'reminder')}
            placeholder="Todos los orígenes"
            options={[
              { value: 'manual', label: 'Manuales' },
              { value: 'reminder', label: 'Enviados por recordatorios' },
            ]}
            ariaLabel="Filtrar por origen"
          />
        )}
        {reminderFilter && (
          <span className="chip chip-active">
            Recordatorio: {reminderFilter.title}
            <button type="button" className="chip-remove" aria-label="Quitar filtro" onClick={onClearReminder}>
              ×
            </button>
          </span>
        )}
        <div className="grow" />
        <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus size={16} /> Nuevo mensaje
        </button>
      </div>
      <DataTable<Message>
        rows={list.data?.data ?? []}
        rowKey={(m) => m.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        emptyTitle="No has enviado mensajes"
        emptyDescription="Útil para recordatorios de pago, novedades o avisos personales."
        pagination={{ page, limit, total: list.data?.total ?? 0, onPageChange: setPage, onLimitChange: setLimit }}
        rowClassName={(m) => (m.expires_at !== null && m.expires_at < nowUnix() ? 'row-muted' : '')}
        columns={[
          {
            key: 'title',
            header: 'Mensaje',
            render: (m) => (
              <div className="cell-main">
                <span className="row-inline">
                  <KindBadge kind={m.kind} compact />
                  <span className="strong">{m.title}</span>
                  {m.display === 'popup' && <Badge tone="blue">Emergente</Badge>}
                  {m.reminder_id && (
                    <span className="muted text-xs row-inline" title="Enviado por un recordatorio">
                      <BellRing size={12} /> recordatorio
                    </span>
                  )}
                </span>
                <span className="muted text-sm">{truncate(m.body, 100)}</span>
              </div>
            ),
          },
          {
            key: 'target',
            header: 'Destino',
            render: (m) => <Badge tone={m.target === 'all' ? 'blue' : m.target === 'user' ? 'purple' : 'orange'}>{targetText(m)}</Badge>,
          },
          {
            key: 'reads',
            header: 'Leídos',
            render: (m) => (
              <span className="row-inline">
                <MailOpen size={14} className="muted" /> {formatNumber(m.read_count)}
              </span>
            ),
          },
          {
            key: 'expires',
            header: 'Vence',
            hideOnMobile: true,
            render: (m) =>
              m.expires_at === null ? (
                <span className="muted">Nunca</span>
              ) : (
                <span className={m.expires_at < nowUnix() ? 'text-amber' : ''}>{formatDateTime(m.expires_at)}</span>
              ),
          },
          { key: 'created', header: 'Creado', hideOnMobile: true, render: (m) => <span className="muted">{formatDateTime(m.created_at)}</span> },
          {
            key: 'actions',
            header: '',
            className: 'col-actions',
            render: (m) => (
              <div className="row-actions">
                <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => { setEditing(m); setFormOpen(true); }}>
                  <Pencil size={15} />
                </button>
                <button type="button" className="btn btn-ghost btn-icon btn-sm text-red" title="Eliminar" onClick={() => void remove(m)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />
      <MessageFormModal
        open={formOpen}
        message={editing}
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

function MessageFormModal({
  open,
  message,
  packages,
  onClose,
  onSaved,
}: {
  open: boolean;
  message: Message | null;
  packages: Package[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<MessageInput>({ title: '', body: '', target: 'all', user_id: null, package_id: null, expires_at: null, kind: 'general', display: 'inbox' });
  const [userLabel, setUserLabel] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'title' | 'body' | 'user' | 'package' | 'expires', string>>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setServerError(null);
    if (message) {
      setForm({
        title: message.title,
        body: message.body,
        target: message.target,
        user_id: message.user_id,
        package_id: message.package_id,
        expires_at: message.expires_at,
        kind: message.kind ?? 'general',
        display: message.display ?? 'inbox',
      });
      setUserLabel(message.target === 'user' ? message.target_label : '');
    } else {
      setForm({ title: '', body: '', target: 'all', user_id: null, package_id: null, expires_at: null, kind: 'general', display: 'inbox' });
      setUserLabel('');
    }
  }, [open, message]);

  const set = <K extends keyof MessageInput>(k: K, v: MessageInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const e: typeof errors = {};
    if (!form.title.trim()) e.title = 'El título es obligatorio';
    if (!form.body.trim()) e.body = 'El contenido es obligatorio';
    if (form.target === 'user' && form.user_id === null) e.user = 'Selecciona un cliente';
    if (form.target === 'package' && form.package_id === null) e.package = 'Selecciona un paquete';
    if (form.expires_at !== null && !message && form.expires_at < nowUnix()) e.expires = 'La fecha de vencimiento ya pasó';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    const body: MessageInput = {
      ...form,
      title: form.title.trim(),
      body: form.body.trim(),
      user_id: form.target === 'user' ? form.user_id : null,
      package_id: form.target === 'package' ? form.package_id : null,
    };
    try {
      if (message) await api.messages.update(message.id, body);
      else await api.messages.create(body);
      toast.success(message ? 'Mensaje actualizado' : 'Mensaje enviado');
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
      title={message ? 'Editar mensaje' : 'Nuevo mensaje'}
      onClose={onClose}
      dismissible={!busy}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={14} />} {message ? 'Guardar' : 'Enviar'}
          </button>
        </>
      }
    >
      {serverError && <Alert tone="red">{serverError}</Alert>}
      <FormField label="Título" required error={errors.title}>
        <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Recordatorio de pago" />
      </FormField>
      <FormField label="Contenido" required error={errors.body}>
        <textarea className="input textarea" rows={5} value={form.body} onChange={(e) => set('body', e.target.value)} />
      </FormField>
      <div className="grid-2">
        <FormField label="Tipo">
          <Select
            value={form.kind}
            onChange={(v) => set('kind', v as MessageKind)}
            options={(Object.keys(MESSAGE_KIND) as MessageKind[]).map((k) => ({ value: k, label: MESSAGE_KIND[k].label }))}
          />
        </FormField>
        <FormField label="Mostrar como">
          <Select
            value={form.display}
            onChange={(v) => set('display', v as MessageDisplay)}
            options={(Object.keys(MESSAGE_DISPLAY) as MessageDisplay[]).map((d) => ({ value: d, label: MESSAGE_DISPLAY[d] }))}
          />
        </FormField>
      </div>
      <FormField label="Destinatarios">
        <div className="segmented">
          {(['all', 'user', 'package'] as const).map((t) => (
            <button key={t} type="button" className={`segment ${form.target === t ? 'is-active' : ''}`} onClick={() => set('target', t)}>
              {TARGET_LABEL[t]}
            </button>
          ))}
        </div>
      </FormField>
      {form.target === 'user' && (
        <FormField label="Cliente" required error={errors.user}>
          <UserSearchSelect
            userId={form.user_id}
            label={userLabel}
            invalid={Boolean(errors.user)}
            onChange={(u) => {
              set('user_id', u?.id ?? null);
              setUserLabel(u?.username ?? '');
              setErrors((x) => ({ ...x, user: undefined }));
            }}
          />
        </FormField>
      )}
      {form.target === 'package' && (
        <FormField label="Paquete" required error={errors.package}>
          <Select
            value={form.package_id === null ? '' : String(form.package_id)}
            onChange={(v) => set('package_id', v ? Number(v) : null)}
            placeholder="Selecciona un paquete…"
            options={packages.map((p) => ({ value: String(p.id), label: p.name }))}
          />
        </FormField>
      )}
      <FormField label="Vence" hint="Vacío = el mensaje no vence" error={errors.expires}>
        <DateTimeInput value={form.expires_at} onChange={(v) => set('expires_at', v)} clearable />
      </FormField>
    </Modal>
  );
}
