import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { api, asList, errorMessage, fetchAllPages } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../components/Toast';
import { Alert, ErrorState, FormField, PageHeader, PageLoader, Spinner, Tabs } from '../../components/ui';
import type { Category, CategoryType } from '../../types';
import { formatNumber } from '../../utils/format';
import { ContentPicker, type PickerItem } from './ContentPicker';

type TabKey = CategoryType;

async function loadCategories(type: CategoryType): Promise<Category[]> {
  const list = asList(await api.categories.list(type));
  return [...list].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

export function PackageEditorPage() {
  const { id } = useParams();
  const packageId = id ? Number(id) : null;
  const isEdit = packageId !== null && Number.isFinite(packageId);
  const navigate = useNavigate();
  const toast = useToast();

  const pkg = useAsync(async () => (isEdit ? api.packages.get(packageId as number) : null), [packageId]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [streamIds, setStreamIds] = useState<Set<number>>(new Set());
  const [seriesIds, setSeriesIds] = useState<Set<number>>(new Set());
  const [tab, setTab] = useState<TabKey>('live');
  const [visited, setVisited] = useState<Set<TabKey>>(new Set(['live']));
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (pkg.data) {
      setName(pkg.data.name ?? '');
      setDescription(pkg.data.description ?? '');
      setStreamIds(new Set(pkg.data.stream_ids ?? []));
      setSeriesIds(new Set(pkg.data.series_ids ?? []));
    }
  }, [pkg.data]);

  const changeTab = (t: TabKey) => {
    setTab(t);
    setVisited((v) => new Set(v).add(t));
  };

  const liveOn = visited.has('live');
  const movieOn = visited.has('movie');
  const seriesOn = visited.has('series');

  const live = useAsync<{ items: PickerItem[]; categories: Category[] } | null>(
    async () => {
      if (!liveOn) return null;
      const [items, categories] = await Promise.all([
        fetchAllPages((page, limit) => api.streams.list({ type: 'live', page, limit })),
        loadCategories('live'),
      ]);
      return { items, categories };
    },
    [liveOn],
  );
  const movie = useAsync<{ items: PickerItem[]; categories: Category[] } | null>(
    async () => {
      if (!movieOn) return null;
      const [items, categories] = await Promise.all([
        fetchAllPages((page, limit) => api.streams.list({ type: 'movie', page, limit })),
        loadCategories('movie'),
      ]);
      return { items, categories };
    },
    [movieOn],
  );
  const series = useAsync<{ items: PickerItem[]; categories: Category[] } | null>(
    async () => {
      if (!seriesOn) return null;
      const [items, categories] = await Promise.all([
        fetchAllPages((page, limit) => api.series.list({ page, limit })),
        loadCategories('series'),
      ]);
      return { items, categories };
    },
    [seriesOn],
  );

  const countIn = (items: PickerItem[] | undefined, set: Set<number>) =>
    items ? items.reduce((n, i) => n + (set.has(i.id) ? 1 : 0), 0) : null;

  const tabs = useMemo(() => {
    const liveCount = countIn(live.data?.items, streamIds);
    const movieCount = countIn(movie.data?.items, streamIds);
    const seriesCount = countIn(series.data?.items, seriesIds) ?? seriesIds.size;
    const fmt = (label: string, n: number | null) => (
      <>
        {label} {n !== null && <span className="tab-count">{formatNumber(n)}</span>}
      </>
    );
    return [
      { value: 'live' as const, label: fmt('Canales en vivo', liveCount) },
      { value: 'movie' as const, label: fmt('Películas', movieCount) },
      { value: 'series' as const, label: fmt('Series', seriesCount) },
    ];
  }, [live.data, movie.data, series.data, streamIds, seriesIds]);

  const save = async () => {
    if (!name.trim()) {
      setNameError('El nombre es obligatorio');
      return;
    }
    setSaving(true);
    setSaveError(null);
    const body = {
      name: name.trim(),
      description: description.trim(),
      stream_ids: [...streamIds],
      series_ids: [...seriesIds],
    };
    try {
      if (isEdit) await api.packages.update(packageId as number, body);
      else await api.packages.create(body);
      toast.success(isEdit ? 'Paquete actualizado' : 'Paquete creado');
      navigate('/paquetes');
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && pkg.loading && !pkg.data) return <PageLoader />;
  if (isEdit && pkg.error && !pkg.data) return <ErrorState message={pkg.error} onRetry={() => void pkg.reload()} />;

  return (
    <>
      <PageHeader
        title={isEdit ? `Editar paquete` : 'Nuevo paquete'}
        subtitle={
          <>
            {formatNumber(streamIds.size)} canales/películas y {formatNumber(seriesIds.size)} series seleccionados
          </>
        }
        actions={
          <>
            <Link to="/paquetes" className="btn btn-ghost">
              <ArrowLeft size={16} /> Volver
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner size={14} /> : <Save size={16} />} Guardar
            </button>
          </>
        }
      />

      {saveError && <Alert tone="red">{saveError}</Alert>}

      <div className="card">
        <div className="grid-2">
          <FormField label="Nombre" required error={nameError} htmlFor="pkg-name">
            <input
              id="pkg-name"
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              placeholder="Ej.: Básico, Deportes, Premium"
            />
          </FormField>
          <FormField label="Descripción" htmlFor="pkg-desc">
            <input id="pkg-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </div>
      </div>

      <div className="card">
        <Tabs value={tab} onChange={changeTab} tabs={tabs} />
        <div className="mt">
          {tab === 'live' && (
            <ContentPicker
              noun="canales"
              items={live.data?.items ?? []}
              categories={live.data?.categories ?? []}
              loading={live.loading && !live.data}
              error={live.error}
              onRetry={() => void live.reload()}
              selected={streamIds}
              onChange={setStreamIds}
            />
          )}
          {tab === 'movie' && (
            <ContentPicker
              noun="películas"
              items={movie.data?.items ?? []}
              categories={movie.data?.categories ?? []}
              loading={movie.loading && !movie.data}
              error={movie.error}
              onRetry={() => void movie.reload()}
              selected={streamIds}
              onChange={setStreamIds}
            />
          )}
          {tab === 'series' && (
            <ContentPicker
              noun="series"
              items={series.data?.items ?? []}
              categories={series.data?.categories ?? []}
              loading={series.loading && !series.data}
              error={series.error}
              onRetry={() => void series.reload()}
              selected={seriesIds}
              onChange={setSeriesIds}
            />
          )}
        </div>
      </div>
    </>
  );
}
