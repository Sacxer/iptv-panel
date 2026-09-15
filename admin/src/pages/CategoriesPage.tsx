import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useCategories } from '../hooks/useResources';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { Alert, FormField, PageHeader, Spinner, Tabs } from '../components/ui';
import type { Category, CategoryType } from '../types';
import { CATEGORY_TYPE_LABEL } from '../utils/labels';
import { formatNumber } from '../utils/format';

export function CategoriesPage() {
  const [type, setType] = useState<CategoryType>('live');
  const { categories, loading, error, reload, setData } = useCategories(type);
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Category | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [reordering, setReordering] = useState(false);

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= categories.length) return;
    const reordered = [...categories];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);
    const updates = reordered
      .map((c, i) => ({ c, sort: i + 1 }))
      .filter(({ c, sort }) => c.sort_order !== sort);
    setData(reordered.map((c, i) => ({ ...c, sort_order: i + 1 })));
    setReordering(true);
    try {
      await Promise.all(updates.map(({ c, sort }) => api.categories.update(c.id, { sort_order: sort })));
    } catch (e) {
      toast.error(errorMessage(e));
      void reload(true);
    } finally {
      setReordering(false);
    }
  };

  const remove = async (c: Category) => {
    const ok = await confirm({
      title: 'Eliminar categoría',
      message: (
        <>
          ¿Eliminar la categoría <strong>{c.name}</strong>?
          {c.item_count > 0 && <> Contiene {formatNumber(c.item_count)} elemento(s), que quedarán sin categoría.</>}
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.categories.remove(c.id);
      toast.success('Categoría eliminada');
      void reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Categorías"
        subtitle="Organiza canales, películas y series. El orden se respeta en las apps."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus size={16} /> Nueva categoría
          </button>
        }
      />
      <Tabs
        value={type}
        onChange={setType}
        tabs={(['live', 'movie', 'series'] as const).map((t) => ({ value: t, label: CATEGORY_TYPE_LABEL[t] }))}
      />
      <div className="mt">
        <DataTable<Category>
          rows={categories}
          rowKey={(c) => c.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          emptyTitle={`No hay categorías de ${CATEGORY_TYPE_LABEL[type].toLowerCase()}`}
          columns={[
            {
              key: 'order',
              header: 'Orden',
              className: 'col-order',
              render: (c) => {
                const index = categories.findIndex((x) => x.id === c.id);
                return (
                  <div className="row-actions">
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Subir" disabled={index === 0 || reordering} onClick={() => void move(index, -1)}>
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Bajar" disabled={index === categories.length - 1 || reordering} onClick={() => void move(index, 1)}>
                      <ArrowDown size={14} />
                    </button>
                    <span className="muted text-sm">{c.sort_order}</span>
                  </div>
                );
              },
            },
            { key: 'name', header: 'Nombre', render: (c) => <span className="strong">{c.name}</span> },
            { key: 'items', header: 'Elementos', render: (c) => formatNumber(c.item_count) },
            {
              key: 'actions',
              header: '',
              className: 'col-actions',
              render: (c) => (
                <div className="row-actions">
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => { setEditing(c); setFormOpen(true); }}>
                    <Pencil size={15} />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm text-red" title="Eliminar" onClick={() => void remove(c)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ),
            },
          ]}
        />
      </div>

      <CategoryFormModal
        open={formOpen}
        category={editing}
        type={type}
        nextOrder={categories.reduce((m, c) => Math.max(m, c.sort_order), 0) + 1}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void reload(true);
        }}
      />
    </>
  );
}

function CategoryFormModal({
  open,
  category,
  type,
  nextOrder,
  onClose,
  onSaved,
}: {
  open: boolean;
  category: Category | null;
  type: CategoryType;
  nextOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [catType, setCatType] = useState<CategoryType>(type);
  const [errors, setErrors] = useState<{ name?: string; sort?: string }>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setSortOrder(String(category?.sort_order ?? nextOrder));
    setCatType(category?.type ?? type);
    setErrors({});
    setServerError(null);
  }, [open, category, type, nextOrder]);

  const submit = async () => {
    const e: typeof errors = {};
    if (!name.trim()) e.name = 'El nombre es obligatorio';
    if (!Number.isInteger(Number(sortOrder))) e.sort = 'Debe ser un número entero';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    try {
      const body = { name: name.trim(), type: catType, sort_order: Number(sortOrder) };
      if (category) await api.categories.update(category.id, body);
      else await api.categories.create(body);
      toast.success(category ? 'Categoría actualizada' : 'Categoría creada');
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
      title={category ? 'Editar categoría' : 'Nueva categoría'}
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
            {busy && <Spinner size={14} />} Guardar
          </button>
        </>
      }
    >
      {serverError && <Alert tone="red">{serverError}</Alert>}
      <FormField label="Nombre" required error={errors.name} htmlFor="cat-name">
        <input id="cat-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <div className="grid-2">
        <FormField label="Tipo" htmlFor="cat-type">
          <select id="cat-type" className="input select" value={catType} onChange={(e) => setCatType(e.target.value as CategoryType)} disabled={Boolean(category)}>
            {(['live', 'movie', 'series'] as const).map((t) => (
              <option key={t} value={t}>
                {CATEGORY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Orden" error={errors.sort} htmlFor="cat-order">
          <input id="cat-order" className="input" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}
