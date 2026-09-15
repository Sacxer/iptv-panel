import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Trash2, Clapperboard } from 'lucide-react';
import { api, asList, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useCategories, usePackages } from '../../hooks/useResources';
import { Modal } from '../../components/Modal';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { EnabledBadge } from '../../components/StatusBadge';
import { Alert, EmptyState, ErrorState, FormField, PageHeader, PageLoader, Spinner, Switch, Thumb } from '../../components/ui';
import type { Episode, EpisodeInput } from '../../types';
import { formatNumber, isValidUrl, truncate } from '../../utils/format';
import { SeriesFormModal } from './SeriesPage';

export function EpisodesPage() {
  const { id } = useParams();
  const seriesId = Number(id);
  const toast = useToast();
  const confirm = useConfirm();

  const series = useAsync(() => api.series.get(seriesId), [seriesId]);
  const episodes = useAsync(async () => asList(await api.series.episodes(seriesId)), [seriesId]);
  const { categories } = useCategories('series');
  const { packages } = usePackages();

  const [editing, setEditing] = useState<Episode | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [presetSeason, setPresetSeason] = useState(1);
  const [seriesFormOpen, setSeriesFormOpen] = useState(false);

  const seasons = useMemo(() => {
    const map = new Map<number, Episode[]>();
    for (const ep of episodes.data ?? []) {
      const s = ep.season ?? 1;
      if (!map.has(s)) map.set(s, []);
      map.get(s)?.push(ep);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([season, eps]) => ({ season, episodes: [...eps].sort((a, b) => a.episode_num - b.episode_num) }));
  }, [episodes.data]);

  const nextSeason = seasons.length ? seasons[seasons.length - 1].season : 1;

  const openNew = (season: number) => {
    setEditing(null);
    setPresetSeason(season);
    setFormOpen(true);
  };

  const remove = async (ep: Episode) => {
    const ok = await confirm({
      title: 'Eliminar episodio',
      message: (
        <>
          ¿Eliminar T{ep.season}E{ep.episode_num} <strong>{ep.name}</strong>?
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.episodes.remove(ep.id);
      toast.success('Episodio eliminado');
      void episodes.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (series.loading && !series.data) return <PageLoader />;
  if (series.error && !series.data) return <ErrorState message={series.error} onRetry={() => void series.reload()} />;
  const s = series.data;
  if (!s) return null;

  return (
    <>
      <PageHeader
        title={
          <span className="title-with-thumb">
            <Thumb src={s.cover} alt={s.name} variant="poster" />
            <span>{s.name}</span>
          </span>
        }
        subtitle={`${s.category_name ?? 'Sin categoría'} · ${formatNumber((episodes.data ?? []).length)} episodios en ${seasons.length} temporada(s)`}
        actions={
          <>
            <Link to="/series" className="btn btn-ghost">
              <ArrowLeft size={16} /> Series
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => setSeriesFormOpen(true)}>
              <Pencil size={16} /> Editar serie
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openNew(nextSeason)}>
              <Plus size={16} /> Añadir episodio
            </button>
          </>
        }
      />

      {s.plot && <p className="muted series-plot">{truncate(s.plot, 400)}</p>}

      {episodes.loading && !episodes.data ? (
        <PageLoader />
      ) : episodes.error ? (
        <ErrorState message={episodes.error} onRetry={() => void episodes.reload()} />
      ) : seasons.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Clapperboard size={30} />}
            title="Esta serie aún no tiene episodios"
            action={
              <button type="button" className="btn btn-primary" onClick={() => openNew(1)}>
                <Plus size={16} /> Añadir el primero
              </button>
            }
          />
        </div>
      ) : (
        <div className="stack">
          {seasons.map(({ season, episodes: eps }) => (
            <section key={season} className="table-card">
              <div className="season-header">
                <h2 className="section-title">Temporada {season}</h2>
                <span className="muted text-sm">{eps.length} episodio(s)</span>
                <div className="grow" />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openNew(season)}>
                  <Plus size={14} /> Añadir a esta temporada
                </button>
              </div>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="col-num">#</th>
                      <th>Título</th>
                      <th className="hide-mobile">Formato</th>
                      <th className="hide-mobile">Duración</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {eps.map((ep) => (
                      <tr key={ep.id} className={ep.enabled ? '' : 'row-muted'}>
                        <td className="col-num strong">{ep.episode_num}</td>
                        <td>
                          <div className="cell-main">
                            <span>{ep.name}</span>
                            {ep.info?.plot && <span className="muted text-xs">{truncate(ep.info.plot, 90)}</span>}
                          </div>
                        </td>
                        <td className="hide-mobile mono text-sm">{ep.container_extension || '—'}</td>
                        <td className="hide-mobile">{ep.info?.duration || '—'}</td>
                        <td>
                          <EnabledBadge enabled={ep.enabled} />
                        </td>
                        <td className="col-actions">
                          <div className="row-actions">
                            <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => { setEditing(ep); setFormOpen(true); }}>
                              <Pencil size={15} />
                            </button>
                            <button type="button" className="btn btn-ghost btn-icon btn-sm text-red" title="Eliminar" onClick={() => void remove(ep)}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      <EpisodeFormModal
        open={formOpen}
        seriesId={seriesId}
        episode={editing}
        presetSeason={presetSeason}
        nextNumber={(season) => {
          const list = seasons.find((x) => x.season === season)?.episodes ?? [];
          return list.reduce((m, e) => Math.max(m, e.episode_num), 0) + 1;
        }}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void episodes.reload(true);
        }}
      />
      <SeriesFormModal
        open={seriesFormOpen}
        series={s}
        categories={categories}
        packages={packages}
        onClose={() => setSeriesFormOpen(false)}
        onSaved={() => {
          setSeriesFormOpen(false);
          void series.reload(true);
        }}
      />
    </>
  );
}

function EpisodeFormModal({
  open,
  seriesId,
  episode,
  presetSeason,
  nextNumber,
  onClose,
  onSaved,
}: {
  open: boolean;
  seriesId: number;
  episode: Episode | null;
  presetSeason: number;
  nextNumber: (season: number) => number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<EpisodeInput>({
    season: 1,
    episode_num: 1,
    name: '',
    source_url: '',
    container_extension: 'mp4',
    info: { plot: '', duration: '' },
    enabled: true,
  });
  const [errors, setErrors] = useState<Partial<Record<'season' | 'episode_num' | 'name' | 'source_url', string>>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setServerError(null);
    if (episode) {
      setForm({
        season: episode.season,
        episode_num: episode.episode_num,
        name: episode.name ?? '',
        source_url: episode.source_url ?? '',
        container_extension: episode.container_extension ?? '',
        info: { plot: episode.info?.plot ?? '', duration: episode.info?.duration ?? '' },
        enabled: episode.enabled,
      });
    } else {
      const num = nextNumber(presetSeason);
      setForm({
        season: presetSeason,
        episode_num: num,
        name: `Episodio ${num}`,
        source_url: '',
        container_extension: 'mp4',
        info: { plot: '', duration: '' },
        enabled: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, episode, presetSeason]);

  const set = <K extends keyof EpisodeInput>(k: K, v: EpisodeInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const e: typeof errors = {};
    if (!Number.isInteger(form.season) || form.season < 0) e.season = 'Temporada no válida';
    if (!Number.isInteger(form.episode_num) || form.episode_num < 0) e.episode_num = 'Número no válido';
    if (!form.name.trim()) e.name = 'El título es obligatorio';
    if (!form.source_url.trim()) e.source_url = 'La URL de origen es obligatoria';
    else if (!isValidUrl(form.source_url.trim())) e.source_url = 'URL no válida';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    const body = { ...form, name: form.name.trim(), source_url: form.source_url.trim() };
    try {
      if (episode) await api.episodes.update(episode.id, body);
      else await api.series.createEpisode(seriesId, body);
      toast.success(episode ? 'Episodio actualizado' : 'Episodio creado');
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
      title={episode ? 'Editar episodio' : 'Nuevo episodio'}
      onClose={onClose}
      size="md"
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
      <div className="grid-3">
        <FormField label="Temporada" required error={errors.season}>
          <input className="input" type="number" min={0} value={form.season} onChange={(e) => set('season', Math.floor(Number(e.target.value)))} />
        </FormField>
        <FormField label="Nº episodio" required error={errors.episode_num}>
          <input className="input" type="number" min={0} value={form.episode_num} onChange={(e) => set('episode_num', Math.floor(Number(e.target.value)))} />
        </FormField>
        <FormField label="Formato">
          <input className="input" list="ep-ext" value={form.container_extension} onChange={(e) => set('container_extension', e.target.value)} />
          <datalist id="ep-ext">
            {['mp4', 'mkv', 'avi', 'mov', 'm3u8', 'ts'].map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </FormField>
      </div>
      <FormField label="Título" required error={errors.name}>
        <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
      </FormField>
      <FormField label="URL de origen" required error={errors.source_url}>
        <input className="input mono" value={form.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="http://origen/serie/s01e01.mp4" />
      </FormField>
      <FormField label="Duración">
        <input className="input" value={form.info.duration} onChange={(e) => set('info', { ...form.info, duration: e.target.value })} placeholder="00:45:00" />
      </FormField>
      <FormField label="Sinopsis">
        <textarea className="input textarea" rows={3} value={form.info.plot} onChange={(e) => set('info', { ...form.info, plot: e.target.value })} />
      </FormField>
      <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label="Habilitado" />
    </Modal>
  );
}
