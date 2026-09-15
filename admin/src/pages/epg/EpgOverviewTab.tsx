import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CircleAlert,
  FileStack,
  Hand,
  Link2,
  Link2Off,
  ListVideo,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Tv,
  Wand2,
} from 'lucide-react';
import { api, errorMessage } from '../../api';
import type { AsyncState } from '../../hooks/useAsync';
import { Modal } from '../../components/Modal';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, CopyButton, EmptyState, ErrorState, FormField, PageLoader, Select, Spinner, StatCard, Switch } from '../../components/ui';
import type { EpgSource, EpgStatus, Settings } from '../../types';
import { formatDate, formatDateTime, formatNumber, timeAgo, truncate } from '../../utils/format';
import { formatSize } from './EpgShared';

const COUNTRIES = [
  { value: '', label: 'Ninguno' },
  { value: 'co', label: 'Colombia' },
  { value: 'mx', label: 'México' },
  { value: 'ar', label: 'Argentina' },
  { value: 'pe', label: 'Perú' },
  { value: 'cl', label: 'Chile' },
  { value: 'ec', label: 'Ecuador' },
  { value: 've', label: 'Venezuela' },
  { value: 'es', label: 'España' },
  { value: 'us', label: 'Estados Unidos' },
];

const EXAMPLE_URL = 'https://raw.githubusercontent.com/globetvapp/epg/main/Colombia/colombia1.xml.gz';

/** Vigencia de la programación de una guía ya descargada. */
function ProgrammeRange({ source }: { source: EpgSource }) {
  if (source.status === 'refreshing' || source.status === 'pending' || !source.last_programme_at) return null;
  if (source.outdated) {
    return (
      <span
        className="has-tip"
        title={`La guía termina el ${formatDate(source.last_programme_at)}; sirve para emparejar canales pero los clientes no verán la programación de hoy`}
      >
        <Badge tone="amber" dot>
          Programación vencida
        </Badge>
      </span>
    );
  }
  return (
    <span className="muted text-xs">
      Hasta {formatDate(source.last_programme_at)}
      {source.current_programmes !== undefined && source.current_programmes !== null ? ` · ${formatNumber(source.current_programmes)} en emisión ahora` : ''}
    </span>
  );
}

function SourceStatusBadge({ source }: { source: EpgSource }) {
  switch (source.status) {
    case 'refreshing':
      return (
        <Badge tone="blue">
          <Spinner size={11} /> Actualizando…
        </Badge>
      );
    case 'ok':
      return (
        <Badge tone="green" dot>
          OK
        </Badge>
      );
    case 'error':
      return (
        <span title={source.last_error ?? undefined}>
          <Badge tone="red" dot>
            Error
          </Badge>
        </span>
      );
    default:
      return <Badge tone="gray">Pendiente</Badge>;
  }
}

export function EpgOverviewTab({ status, settings }: { status: AsyncState<EpgStatus>; settings: AsyncState<Settings> }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<EpgSource | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const s = status.data;

  if (!s) return status.error ? <ErrorState message={status.error} onRetry={() => void status.reload()} /> : <PageLoader />;

  const sources = [...s.sources].sort((a, b) => a.priority - b.priority || a.id - b.id);
  const anyRefreshing = sources.some((x) => x.status === 'refreshing');
  const enabledWithData = sources.filter((x) => x.enabled && x.last_programme_at);
  const allOutdated = enabledWithData.length > 0 && enabledWithData.every((x) => x.outdated);
  const origin = (settings.data?.public_url || window.location.origin).replace(/\/+$/, '');
  const guideUrl = `${origin}/xmltv.php?username=USUARIO&password=CLAVE`;

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await status.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  /** Reordena: asigna prioridades consecutivas según el nuevo orden (solo guarda las que cambian). */
  const move = (index: number, dir: -1 | 1) => {
    const order = [...sources];
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    void run(
      'priority',
      async () => {
        for (let i = 0; i < order.length; i++) {
          if (order[i].priority !== i) await api.epg.updateSource(order[i].id, { priority: i });
        }
      },
      'Prioridad actualizada',
    );
  };

  const toggle = (src: EpgSource, enabled: boolean) =>
    void run(`toggle-${src.id}`, () => api.epg.updateSource(src.id, { enabled }), enabled ? 'Guía habilitada' : 'Guía deshabilitada');

  const remove = async (src: EpgSource) => {
    const ok = await confirm({
      title: 'Eliminar guía',
      message: (
        <>
          ¿Eliminar <strong>{src.name}</strong>? Sus {formatNumber(src.channel_count)} canales dejarán de estar disponibles para emparejar. Los IDs
          EPG ya asignados a tus canales se conservan.
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    void run(`remove-${src.id}`, () => api.epg.removeSource(src.id), 'Guía eliminada');
  };

  return (
    <div className="stack">
      {allOutdated && (
        <Alert tone="amber" icon={<CircleAlert size={18} />} title="La programación de tus guías está vencida">
          Las guías habilitadas ya terminaron: sirven para emparejar los canales, pero los clientes no verán la programación de hoy. Agrega una guía
          actualizada (lo ideal es la de tu proveedor) y déjala con mayor prioridad.
        </Alert>
      )}
      <div className="stat-grid stat-grid-compact">
        <StatCard label="Canales en vivo" value={formatNumber(s.streams.live)} icon={<Tv size={20} />} tone="blue" />
        <StatCard label="Con EPG" value={formatNumber(s.streams.with_epg)} icon={<Link2 size={20} />} tone="green" />
        <StatCard label="Sin EPG" value={formatNumber(s.streams.without_epg)} icon={<Link2Off size={20} />} tone={s.streams.without_epg > 0 ? 'amber' : 'gray'} />
        <StatCard label="Asignados a mano" value={formatNumber(s.streams.locked)} icon={<Hand size={20} />} tone="purple" />
        <StatCard label="Canales en las guías" value={formatNumber(s.epg_channels)} icon={<ListVideo size={20} />} tone="orange" />
      </div>

      <section className="card">
        <div className="section-header">
          <div>
            <h2 className="card-title no-margin">
              <FileStack size={18} /> Guía combinada
            </h2>
            <p className="muted text-sm no-margin">
              Solo con los canales que usas; es la que reciben las apps de los clientes. Las apps muestran «ahora / siguiente» desde esta guía.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={s.guide.building || busy !== null}
            onClick={() => void run('build', () => api.epg.buildGuide(), 'Generando la guía…')}
          >
            {s.guide.building || busy === 'build' ? <Spinner size={13} /> : <Wand2 size={14} />} Generar guía ahora
          </button>
        </div>
        <div className="guide-state">
          {s.guide.building ? (
            <span className="row-inline">
              <Spinner size={14} /> Generando la guía combinada…
            </span>
          ) : s.guide.exists && s.guide.built_at ? (
            <span>
              Generada <strong title={formatDateTime(s.guide.built_at)}>{timeAgo(s.guide.built_at)}</strong> · {formatNumber(s.guide.channels)} canales ·{' '}
              {formatNumber(s.guide.programmes)} programas · {formatSize(s.guide.size)}
            </span>
          ) : (
            <span className="muted">Aún no se ha generado. Se genera sola tras actualizar las guías, o con «Generar guía ahora».</span>
          )}
        </div>
        {s.guide.error && (
          <Alert tone="red" icon={<CircleAlert size={18} />} title="Error al generar la guía">
            {s.guide.error}
          </Alert>
        )}
        <FormField label="URL de la guía para los clientes" hint="Las apps la usan automáticamente a través de la API Xtream; solo hace falta pegarla en reproductores que la pidan aparte.">
          <div className="input-group">
            <input className="input mono" readOnly value={guideUrl} onFocus={(e) => e.target.select()} />
            <CopyButton text={guideUrl} />
          </div>
        </FormField>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2 className="card-title no-margin">
              <CalendarClock size={18} /> Fuentes de guía
            </h2>
            <p className="muted text-sm no-margin">Si varias guías tienen el mismo canal, se usa la de mayor prioridad (la de arriba).</p>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={sources.length === 0 || anyRefreshing || busy !== null}
              onClick={() => void run('refresh-all', () => api.epg.refreshAll(), 'Actualizando todas las guías…')}
            >
              {anyRefreshing ? <Spinner size={13} /> : <RefreshCw size={14} />} Actualizar todas
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus size={14} /> Agregar guía
            </button>
          </div>
        </div>
        {sources.length === 0 ? (
          <EmptyState
            title="Aún no hay guías"
            description="Agrega la guía XMLTV de tu proveedor o una pública para poder emparejar los canales."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setFormOpen(true)}>
                <Plus size={16} /> Agregar guía
              </button>
            }
          />
        ) : (
          <ul className="epg-sources">
            {sources.map((src, i) => (
              <li key={src.id} className={`epg-source ${src.enabled ? '' : 'is-disabled'}`}>
                <div className="epg-source-priority">
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={i === 0 || busy !== null} title="Subir prioridad" onClick={() => move(i, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <span className="epg-source-rank" title="Prioridad (1 = preferida)">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    disabled={i === sources.length - 1 || busy !== null}
                    title="Bajar prioridad"
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
                <div className="epg-source-main">
                  <div className="row-inline">
                    <span className="strong">{src.name}</span>
                    <SourceStatusBadge source={src} />
                    <ProgrammeRange source={src} />
                  </div>
                  <div className="epg-source-url">
                    <span className="mono text-xs" title={src.url}>
                      {truncate(src.url, 70)}
                    </span>
                    <CopyButton text={src.url} />
                  </div>
                  <div className="muted text-xs">
                    {formatNumber(src.channel_count)} canales · {formatNumber(src.programme_count)} programas · Actualizada{' '}
                    <span title={formatDateTime(src.last_fetch_at)}>{src.last_fetch_at ? timeAgo(src.last_fetch_at) : 'nunca'}</span>
                  </div>
                  {src.status === 'error' && src.last_error && <div className="text-red text-xs pre-wrap">{src.last_error}</div>}
                </div>
                <div className="epg-source-actions">
                  <Switch checked={src.enabled} onChange={(v) => toggle(src, v)} label="Habilitada" disabled={busy !== null} />
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={src.status === 'refreshing' || busy !== null}
                      onClick={() => void run(`refresh-${src.id}`, () => api.epg.refreshSource(src.id), `Actualizando «${src.name}»…`)}
                    >
                      {src.status === 'refreshing' ? <Spinner size={13} /> : <RefreshCw size={14} />} Actualizar
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      title="Editar"
                      onClick={() => {
                        setEditing(src);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button type="button" className="btn btn-danger-ghost btn-icon btn-sm" title="Eliminar" onClick={() => void remove(src)} disabled={busy !== null}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <EpgSettingsCard settings={settings} />

      <SourceFormModal
        open={formOpen}
        source={editing}
        nextPriority={sources.length}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void status.reload(true);
        }}
      />
    </div>
  );
}

function SourceFormModal({
  open,
  source,
  nextPriority,
  onClose,
  onSaved,
}: {
  open: boolean;
  source: EpgSource | null;
  nextPriority: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(source?.name ?? '');
    setUrl(source?.url ?? '');
    setError(null);
  }, [open, source]);

  const save = async () => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      setError('La URL debe empezar por http:// o https://');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (source) {
        await api.epg.updateSource(source.id, { name: name.trim(), url: u });
        toast.success('Guía actualizada');
      } else {
        await api.epg.createSource({ name: name.trim() || undefined, url: u, priority: nextPriority });
        toast.success('Guía agregada: se está descargando');
      }
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={source ? 'Editar guía' : 'Agregar guía'}
      onClose={onClose}
      size="md"
      dismissible={!busy}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>
            {busy && <Spinner size={14} />} {source ? 'Guardar' : 'Agregar'}
          </button>
        </>
      }
    >
      <div className="stack">
        <FormField label="URL de la guía" required htmlFor="epg-url" hint="Archivo XMLTV .xml o .xml.gz.">
          <input id="epg-url" className="input mono" value={url} placeholder={EXAMPLE_URL} onChange={(e) => setUrl(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Nombre (opcional)" htmlFor="epg-name" hint="Si lo dejas vacío se usa el dominio de la URL.">
          <input id="epg-name" className="input" value={name} placeholder="Guía Colombia" onChange={(e) => setName(e.target.value)} />
        </FormField>
        <Alert tone="blue">
          Puede ser la guía de tu proveedor o una pública; si varias guías tienen el mismo canal, se usa la de mayor prioridad.
        </Alert>
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}

interface EpgSettingsForm {
  epg_country: string;
  epg_min_score: number;
  epg_fill_logos: boolean;
  epg_auto_match: boolean;
  epg_refresh_hours: number;
}

function toForm(s: Settings | null): EpgSettingsForm {
  return {
    epg_country: s?.epg_country ?? '',
    epg_min_score: s?.epg_min_score ?? 85,
    epg_fill_logos: s?.epg_fill_logos ?? true,
    epg_auto_match: s?.epg_auto_match ?? false,
    epg_refresh_hours: s?.epg_refresh_hours ?? 12,
  };
}

function EpgSettingsCard({ settings }: { settings: AsyncState<Settings> }) {
  const toast = useToast();
  const [form, setForm] = useState<EpgSettingsForm>(() => toForm(settings.data));
  const [busy, setBusy] = useState(false);
  const saved = JSON.stringify(toForm(settings.data));

  useEffect(() => setForm(toForm(settings.data)), [saved]);

  const set = <K extends keyof EpgSettingsForm>(k: K, v: EpgSettingsForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== saved;
  const hoursOk = Number.isInteger(form.epg_refresh_hours) && form.epg_refresh_hours >= 1;

  const save = async () => {
    if (!hoursOk) return;
    setBusy(true);
    try {
      const next = await api.settings.update(form);
      settings.setData(next);
      toast.success('Ajustes de EPG guardados');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 className="card-title">Ajustes del emparejamiento</h2>
      {!settings.data && settings.loading ? (
        <Spinner label="Cargando…" />
      ) : (
        <>
          <div className="grid-2 align-start">
            <FormField label="País preferido" htmlFor="epg-country" hint="Da ventaja a los canales de ese país (IDs como CanalRCN.co).">
              <Select id="epg-country" value={form.epg_country} onChange={(v) => set('epg_country', v)} options={COUNTRIES} />
            </FormField>
            <FormField label="Actualizar las guías cada (horas)" htmlFor="epg-hours" error={hoursOk ? null : 'Mínimo 1 hora'}>
              <input
                id="epg-hours"
                className="input input-narrow"
                type="number"
                min={1}
                value={form.epg_refresh_hours}
                onChange={(e) => set('epg_refresh_hours', Math.floor(Number(e.target.value)))}
              />
            </FormField>
          </div>
          <FormField label={`Puntuación mínima para asignar: ${form.epg_min_score}`} htmlFor="epg-min" hint="Por debajo (desde 60) se muestran como sugerencias y no se aplican solas.">
            <input
              id="epg-min"
              className="range"
              type="range"
              min={50}
              max={100}
              step={1}
              value={form.epg_min_score}
              onChange={(e) => set('epg_min_score', Number(e.target.value))}
            />
          </FormField>
          <div className="stack-sm">
            <Switch checked={form.epg_fill_logos} onChange={(v) => set('epg_fill_logos', v)} label="Usar el logo de la guía si el canal no tiene" />
            <Switch
              checked={form.epg_auto_match}
              onChange={(v) => set('epg_auto_match', v)}
              label="Emparejar automáticamente"
              description="Empareja los canales nuevos sin EPG cada vez que se actualicen las guías."
            />
          </div>
          <div className="row row-end mt">
            {dirty && <span className="muted text-sm">Hay cambios sin guardar</span>}
            <button type="button" className="btn btn-primary" disabled={!dirty || busy || !hoursOk} onClick={() => void save()}>
              {busy ? <Spinner size={14} /> : <Save size={16} />} Guardar ajustes
            </button>
          </div>
        </>
      )}
    </section>
  );
}
