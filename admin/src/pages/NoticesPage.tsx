import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ArrowDown, ArrowUp, CircleAlert, Info, Megaphone, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { NoticesCarouselCard } from './NoticesCarousel';
import { api, asList, errorMessage } from '../api';
import { useAsync } from '../hooks/useAsync';
import { usePackages } from '../hooks/useResources';
import { DataTable } from '../components/DataTable';
import { DateTimeInput } from '../components/DateTimeInput';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { Alert, Badge, FormField, PageHeader, Select, Spinner, Switch } from '../components/ui';
import type { Notice, NoticeDisplay, NoticeInput, NoticeLevel, Package } from '../types';
import { formatDateTime, nowUnix, truncate } from '../utils/format';
import { NOTICE_DISPLAY, NOTICE_LEVEL } from '../utils/labels';

function noticeState(n: Notice): { label: string; tone: 'green' | 'gray' | 'amber' | 'blue' } {
  const now = nowUnix();
  if (!n.active) return { label: 'Inactivo', tone: 'gray' };
  if (n.starts_at !== null && n.starts_at > now) return { label: 'Programado', tone: 'blue' };
  if (n.ends_at !== null && n.ends_at < now) return { label: 'Finalizado', tone: 'amber' };
  return { label: 'Visible ahora', tone: 'green' };
}

export function NoticesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const list = useAsync(async () => {
    const rows = asList(await api.notices.list());
    return [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
  }, []);
  const [reordering, setReordering] = useState(false);

  const move = async (index: number, dir: -1 | 1) => {
    const rows = list.data ?? [];
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const reordered = [...rows];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);
    const updates = reordered.map((n, i) => ({ n, sort: i + 1 })).filter(({ n, sort }) => (n.sort_order ?? 0) !== sort);
    list.setData(reordered.map((n, i) => ({ ...n, sort_order: i + 1 })));
    setReordering(true);
    try {
      await Promise.all(updates.map(({ n, sort }) => api.notices.update(n.id, { sort_order: sort })));
    } catch (e) {
      toast.error(errorMessage(e));
      void list.reload(true);
    } finally {
      setReordering(false);
    }
  };
  const { packages, byId } = usePackages();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Notice | null>(null);

  const toggleActive = async (n: Notice) => {
    try {
      await api.notices.update(n.id, { active: !n.active });
      list.setData((prev) => prev?.map((x) => (x.id === n.id ? { ...x, active: !n.active } : x)) ?? prev);
      toast.success(n.active ? 'Aviso desactivado' : 'Aviso activado');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (n: Notice) => {
    const ok = await confirm({ title: 'Eliminar aviso', message: <>¿Eliminar el aviso <strong>{n.title}</strong>?</>, confirmText: 'Eliminar', danger: true });
    if (!ok) return;
    try {
      await api.notices.remove(n.id);
      toast.success('Aviso eliminado');
      void list.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Avisos"
        subtitle="Banners, ventanas emergentes y cintas que se muestran en las apps"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus size={16} /> Nuevo aviso
          </button>
        }
      />
      <NoticesCarouselCard notices={list.data ?? []} />
      <DataTable<Notice>
        rows={list.data ?? []}
        rowKey={(n) => n.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        emptyTitle="No hay avisos"
        rowClassName={(n) => (n.active ? '' : 'row-muted')}
        columns={[
          {
            key: 'order',
            header: 'Orden',
            className: 'col-order',
            render: (n) => {
              const rows = list.data ?? [];
              const index = rows.findIndex((x) => x.id === n.id);
              return (
                <div className="row-actions">
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Subir" disabled={index <= 0 || reordering} onClick={() => void move(index, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Bajar" disabled={index === rows.length - 1 || reordering} onClick={() => void move(index, 1)}>
                    <ArrowDown size={14} />
                  </button>
                </div>
              );
            },
          },
          { key: 'level', header: 'Nivel', render: (n) => <Badge tone={NOTICE_LEVEL[n.level]?.tone ?? 'gray'} dot>{NOTICE_LEVEL[n.level]?.label ?? n.level}</Badge> },
          {
            key: 'title',
            header: 'Aviso',
            render: (n) => (
              <div className="cell-main">
                <span className="strong">{n.title}</span>
                <span className="muted text-sm">{truncate(n.body, 90)}</span>
              </div>
            ),
          },
          { key: 'display', header: 'Formato', hideOnMobile: true, render: (n) => NOTICE_DISPLAY[n.display]?.label ?? n.display },
          {
            key: 'target',
            header: 'Destino',
            hideOnMobile: true,
            render: (n) => (n.target === 'package' ? `Paquete: ${n.package_id !== null ? byId.get(n.package_id)?.name ?? `#${n.package_id}` : '—'}` : 'Todos'),
          },
          {
            key: 'window',
            header: 'Ventana',
            hideOnMobile: true,
            render: (n) => (
              <div className="cell-main text-sm">
                <span>Desde: {n.starts_at === null ? 'inmediato' : formatDateTime(n.starts_at)}</span>
                <span className="muted">Hasta: {n.ends_at === null ? 'sin fin' : formatDateTime(n.ends_at)}</span>
              </div>
            ),
          },
          {
            key: 'state',
            header: 'Estado',
            render: (n) => {
              const s = noticeState(n);
              return (
                <div className="row-inline">
                  <Switch checked={n.active} onChange={() => void toggleActive(n)} />
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>
              );
            },
          },
          {
            key: 'actions',
            header: '',
            className: 'col-actions',
            render: (n) => (
              <div className="row-actions">
                <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => { setEditing(n); setFormOpen(true); }}>
                  <Pencil size={15} />
                </button>
                <button type="button" className="btn btn-ghost btn-icon btn-sm text-red" title="Eliminar" onClick={() => void remove(n)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />
      <NoticeFormModal
        open={formOpen}
        notice={editing}
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

const LEVEL_ICON: Record<NoticeLevel, ReactElement> = {
  info: <Info size={16} />,
  warning: <TriangleAlert size={16} />,
  critical: <CircleAlert size={16} />,
};

function emptyNotice(): NoticeInput {
  return {
    title: '',
    body: '',
    level: 'info',
    display: 'banner',
    target: 'all',
    package_id: null,
    starts_at: nowUnix(),
    ends_at: null,
    sort_order: 0,
    duration_seconds: null,
    active: true,
  };
}

function NoticeFormModal({
  open,
  notice,
  packages,
  onClose,
  onSaved,
}: {
  open: boolean;
  notice: Notice | null;
  packages: Package[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<NoticeInput>(emptyNotice);
  const [errors, setErrors] = useState<Partial<Record<'title' | 'body' | 'package' | 'ends', string>>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setServerError(null);
    if (notice) {
      const { id: _id, created_at: _c, ...rest } = notice;
      void _id;
      void _c;
      setForm(rest);
    } else setForm(emptyNotice());
  }, [open, notice]);

  const set = <K extends keyof NoticeInput>(k: K, v: NoticeInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const e: typeof errors = {};
    if (!form.title.trim()) e.title = 'El título es obligatorio';
    if (!form.body.trim()) e.body = 'El texto es obligatorio';
    if (form.target === 'package' && form.package_id === null) e.package = 'Selecciona un paquete';
    if (form.starts_at !== null && form.ends_at !== null && form.ends_at <= form.starts_at) e.ends = 'El fin debe ser posterior al inicio';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    const body: NoticeInput = {
      ...form,
      title: form.title.trim(),
      body: form.body.trim(),
      package_id: form.target === 'package' ? form.package_id : null,
    };
    try {
      if (notice) await api.notices.update(notice.id, body);
      else await api.notices.create(body);
      toast.success(notice ? 'Aviso actualizado' : 'Aviso creado');
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
      title={notice ? 'Editar aviso' : 'Nuevo aviso'}
      onClose={onClose}
      size="xl"
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
      <div className="grid-2">
        <div className="stack">
          <FormField label="Título" required error={errors.title}>
            <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} />
          </FormField>
          <FormField label="Texto" required error={errors.body}>
            <textarea className="input textarea" rows={3} value={form.body} onChange={(e) => set('body', e.target.value)} />
          </FormField>
          <FormField label="Nivel">
            <div className="level-picker">
              {(['info', 'warning', 'critical'] as const).map((lvl) => (
                <button key={lvl} type="button" className={`level-option level-${lvl} ${form.level === lvl ? 'is-active' : ''}`} onClick={() => set('level', lvl)}>
                  {LEVEL_ICON[lvl]} {NOTICE_LEVEL[lvl].label}
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Formato de visualización">
            <div className="radio-cards radio-cards-3">
              {(Object.keys(NOTICE_DISPLAY) as NoticeDisplay[]).map((d) => (
                <button key={d} type="button" className={`radio-card ${form.display === d ? 'is-active' : ''}`} onClick={() => set('display', d)}>
                  <span className="radio-card-title">{NOTICE_DISPLAY[d].label}</span>
                  <span className="radio-card-desc">{NOTICE_DISPLAY[d].description}</span>
                </button>
              ))}
            </div>
          </FormField>
          <div className="grid-2">
            <FormField label="Destino">
              <Select
                value={form.target}
                onChange={(v) => set('target', v as NoticeInput['target'])}
                options={[
                  { value: 'all', label: 'Todos los clientes' },
                  { value: 'package', label: 'Clientes de un paquete' },
                ]}
              />
            </FormField>
            {form.target === 'package' && (
              <FormField label="Paquete" required error={errors.package}>
                <Select
                  value={form.package_id === null ? '' : String(form.package_id)}
                  onChange={(v) => set('package_id', v ? Number(v) : null)}
                  placeholder="Selecciona…"
                  options={packages.map((p) => ({ value: String(p.id), label: p.name }))}
                />
              </FormField>
            )}
          </div>
          <div className="grid-2">
            <FormField label="Mostrar desde" hint="Vacío = inmediatamente">
              <DateTimeInput value={form.starts_at} onChange={(v) => set('starts_at', v)} clearable />
            </FormField>
            <FormField label="Mostrar hasta" hint="Vacío = sin fecha de fin" error={errors.ends}>
              <DateTimeInput value={form.ends_at} onChange={(v) => set('ends_at', v)} clearable />
            </FormField>
          </div>
          <div className="grid-2">
            <FormField label="Orden en el carrusel" hint="Menor = antes (dentro del mismo nivel).">
              <input
                className="input input-narrow"
                type="number"
                value={form.sort_order ?? 0}
                onChange={(e) => set('sort_order', Math.floor(Number(e.target.value) || 0))}
              />
            </FormField>
            <FormField label="Tiempo en pantalla (segundos)" hint="Vacío = el tiempo general del carrusel.">
              <input
                className="input input-narrow"
                type="number"
                min={2}
                max={300}
                value={form.duration_seconds ?? ''}
                placeholder="General"
                onChange={(e) => set('duration_seconds', e.target.value === '' ? null : Math.max(2, Math.min(300, Math.floor(Number(e.target.value)))))}
              />
            </FormField>
          </div>
          <Switch checked={form.active} onChange={(v) => set('active', v)} label="Activo" description="Solo los avisos activos y dentro de su ventana se envían a las apps." />
        </div>
        <div>
          <div className="field-label">Vista previa</div>
          <NoticePreview title={form.title} body={form.body} level={form.level} display={form.display} />
        </div>
      </div>
    </Modal>
  );
}

export function NoticePreview({ title, body, level, display }: { title: string; body: string; level: NoticeLevel; display: NoticeDisplay }) {
  const t = title.trim() || 'Título del aviso';
  const b = body.trim() || 'Aquí aparecerá el texto del aviso.';
  const tickerText = useMemo(() => `${t} — ${b}`, [t, b]);
  return (
    <div className="tv-preview">
      <div className="tv-screen">
        <div className="tv-fake-ui">
          <div className="tv-fake-sidebar">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} />
            ))}
          </div>
          <div className="tv-fake-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <span key={i} />
            ))}
          </div>
        </div>
        {display === 'banner' && (
          <div className={`pv-banner pv-${level}`}>
            {LEVEL_ICON[level]}
            <div>
              <strong>{t}</strong> <span>{b}</span>
            </div>
          </div>
        )}
        {display === 'popup' && (
          <div className="pv-popup-backdrop">
            <div className={`pv-popup pv-border-${level}`}>
              <div className={`pv-popup-head pv-${level}`}>
                {LEVEL_ICON[level]} <strong>{t}</strong>
                <X size={14} className="pv-close" />
              </div>
              <div className="pv-popup-body">{b}</div>
              <div className="pv-popup-foot">
                <span className="pv-btn">Entendido</span>
              </div>
            </div>
          </div>
        )}
        {display === 'ticker' && (
          <div className={`pv-ticker pv-${level}`}>
            <span className="pv-ticker-label">
              <Megaphone size={13} />
            </span>
            <div className="pv-ticker-track">
              <span className="pv-ticker-text">{tickerText}</span>
            </div>
          </div>
        )}
      </div>
      <div className="muted text-xs mt-sm">Simulación aproximada de cómo se verá en la app.</div>
    </div>
  );
}
