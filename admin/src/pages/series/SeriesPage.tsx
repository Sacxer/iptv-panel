import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListVideo, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useCategories, usePackages } from '../../hooks/useResources';
import { DataTable } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { PackageChecklist } from '../../components/PackageChecklist';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { SourceBadge } from '../../components/StatusBadge';
import { Alert, FormField, PageHeader, Select, Spinner, Thumb } from '../../components/ui';
import type { Category, Package, Series, SeriesInput } from '../../types';
import { formatNumber, isValidUrl, truncate } from '../../utils/format';

export function SeriesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const debounced = useDebounce(search);
  const { categories } = useCategories('series');
  const { packages } = usePackages();

  useEffect(() => setPage(1), [debounced, categoryId, limit]);

  const list = useAsync(
    () => api.series.list({ search: debounced.trim(), category_id: categoryId ? Number(categoryId) : '', page, limit }),
    [debounced, categoryId, page, limit],
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Series | null>(null);

  const remove = async (s: Series) => {
    const ok = await confirm({
      title: 'Eliminar serie',
      message: (
        <>
          ¿Eliminar <strong>{s.name}</strong> y sus {formatNumber(s.episode_count)} episodio(s)? Esta acción no se puede deshacer.
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.series.remove(s.id);
      toast.success('Serie eliminada');
      void list.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Series"
        subtitle="Series y sus temporadas"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus size={16} /> Nueva serie
          </button>
        }
      />
      <div className="toolbar">
        <div className="input-icon toolbar-search">
          <Search size={16} />
          <input className="input" placeholder="Buscar serie…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={categoryId} onChange={setCategoryId} placeholder="Todas las categorías" options={categories.map((c) => ({ value: String(c.id), label: c.name }))} ariaLabel="Categoría" />
      </div>

      <DataTable<Series>
        rows={list.data?.data ?? []}
        rowKey={(s) => s.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        emptyTitle={search || categoryId ? 'Ninguna serie coincide' : 'Aún no hay series'}
        pagination={{ page, limit, total: list.data?.total ?? 0, onPageChange: setPage, onLimitChange: setLimit }}
        columns={[
          { key: 'cover', header: '', className: 'col-thumb', render: (s) => <Thumb src={s.cover} alt={s.name} variant="poster" /> },
          {
            key: 'name',
            header: 'Nombre',
            render: (s) => (
              <div className="cell-main">
                <Link to={`/series/${s.id}/episodios`} className="strong link">
                  {s.name}
                </Link>
                <span className="muted text-xs">
                  #{s.id}
                  {s.genre ? ` · ${truncate(s.genre, 30)}` : ''}
                  {s.release_date ? ` · ${s.release_date.slice(0, 4)}` : ''}
                </span>
              </div>
            ),
          },
          { key: 'category', header: 'Categoría', render: (s) => s.category_name ?? <span className="muted">Sin categoría</span> },
          { key: 'episodes', header: 'Episodios', render: (s) => formatNumber(s.episode_count) },
          { key: 'rating', header: 'Calificación', hideOnMobile: true, render: (s) => s.rating || <span className="muted">—</span> },
          { key: 'source', header: 'Origen', hideOnMobile: true, render: (s) => <SourceBadge source={s.source} /> },
          {
            key: 'actions',
            header: '',
            className: 'col-actions',
            render: (s) => (
              <div className="row-actions">
                <Link to={`/series/${s.id}/episodios`} className="btn btn-ghost btn-sm" title="Episodios">
                  <ListVideo size={15} /> <span className="hide-mobile">Episodios</span>
                </Link>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => { setEditing(s); setFormOpen(true); }}>
                  <Pencil size={15} />
                </button>
                <button type="button" className="btn btn-ghost btn-icon btn-sm text-red" title="Eliminar" onClick={() => void remove(s)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />

      <SeriesFormModal
        open={formOpen}
        series={editing}
        categories={categories}
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

function emptySeries(): SeriesInput {
  return {
    name: '',
    category_id: null,
    cover: '',
    plot: '',
    cast: '',
    director: '',
    genre: '',
    release_date: '',
    rating: '',
    backdrop: '',
    youtube_trailer: '',
    package_ids: [],
  };
}

export function SeriesFormModal({
  open,
  series,
  categories,
  packages,
  onClose,
  onSaved,
}: {
  open: boolean;
  series: Series | null;
  categories: Category[];
  packages: Package[];
  onClose: () => void;
  onSaved: (s: Series) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<SeriesInput>(emptySeries);
  const [errors, setErrors] = useState<Partial<Record<'name' | 'cover' | 'backdrop', string>>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setServerError(null);
    if (series) {
      setForm({
        name: series.name ?? '',
        category_id: series.category_id ?? null,
        cover: series.cover ?? '',
        plot: series.plot ?? '',
        cast: series.cast ?? '',
        director: series.director ?? '',
        genre: series.genre ?? '',
        release_date: series.release_date ?? '',
        rating: series.rating ?? '',
        backdrop: series.backdrop ?? '',
        youtube_trailer: series.youtube_trailer ?? '',
        package_ids: series.package_ids ?? [],
      });
    } else setForm(emptySeries());
  }, [open, series]);

  const set = <K extends keyof SeriesInput>(k: K, v: SeriesInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = 'El nombre es obligatorio';
    if (form.cover.trim() && !isValidUrl(form.cover.trim())) e.cover = 'URL no válida';
    if (form.backdrop.trim() && !isValidUrl(form.backdrop.trim())) e.backdrop = 'URL no válida';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    try {
      const body = { ...form, name: form.name.trim(), cover: form.cover.trim(), backdrop: form.backdrop.trim() };
      const saved = series ? await api.series.update(series.id, body) : await api.series.create(body);
      toast.success(series ? 'Serie actualizada' : 'Serie creada');
      onSaved(saved);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={series ? `Editar serie` : 'Nueva serie'}
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
          <div className="movie-info-top">
            <Thumb src={form.cover.trim() || null} alt="Portada" variant="poster" />
            <div className="stack grow">
              <FormField label="Nombre" required error={errors.name}>
                <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </FormField>
              <FormField label="Categoría">
                <Select
                  value={form.category_id === null ? '' : String(form.category_id)}
                  onChange={(v) => set('category_id', v ? Number(v) : null)}
                  placeholder="Sin categoría"
                  options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
                />
              </FormField>
            </div>
          </div>
          <FormField label="Portada (URL)" error={errors.cover}>
            <input className="input" value={form.cover} onChange={(e) => set('cover', e.target.value)} />
          </FormField>
          <FormField label="Fondo / backdrop (URL)" error={errors.backdrop}>
            <input className="input" value={form.backdrop} onChange={(e) => set('backdrop', e.target.value)} />
          </FormField>
          <FormField label="Sinopsis">
            <textarea className="input textarea" rows={4} value={form.plot} onChange={(e) => set('plot', e.target.value)} />
          </FormField>
          <div className="grid-2">
            <FormField label="Género">
              <input className="input" value={form.genre} onChange={(e) => set('genre', e.target.value)} />
            </FormField>
            <FormField label="Fecha de estreno">
              <input className="input" value={form.release_date} onChange={(e) => set('release_date', e.target.value)} placeholder="2024-01-31" />
            </FormField>
            <FormField label="Calificación">
              <input className="input" value={form.rating} onChange={(e) => set('rating', e.target.value)} placeholder="8.1" />
            </FormField>
            <FormField label="Tráiler de YouTube (ID)">
              <input className="input" value={form.youtube_trailer} onChange={(e) => set('youtube_trailer', e.target.value)} />
            </FormField>
          </div>
          <FormField label="Reparto">
            <input className="input" value={form.cast} onChange={(e) => set('cast', e.target.value)} />
          </FormField>
          <FormField label="Director">
            <input className="input" value={form.director} onChange={(e) => set('director', e.target.value)} />
          </FormField>
        </div>
        <div className="subcard">
          <h3 className="form-section-title no-margin">Paquetes</h3>
          <PackageChecklist packages={packages} value={form.package_ids} onChange={(ids) => set('package_ids', ids)} />
        </div>
      </div>
    </Modal>
  );
}
