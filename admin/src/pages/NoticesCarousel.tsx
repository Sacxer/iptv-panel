import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Save } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../components/Toast';
import { FormField, Spinner, Switch } from '../components/ui';
import type { Notice, NoticeLevel } from '../types';
import { nowUnix } from '../utils/format';
import { NOTICE_LEVEL } from '../utils/labels';
import { NoticePreview } from './NoticesPage';

const LEVEL_RANK: Record<NoticeLevel, number> = { critical: 0, warning: 1, info: 2 };

/** Avisos visibles ahora, en el orden en que los muestran las apps. */
export function visibleNotices(notices: Notice[]): Notice[] {
  const now = nowUnix();
  return notices
    .filter((n) => n.active && (n.starts_at === null || n.starts_at <= now) && (n.ends_at === null || n.ends_at > now))
    .sort((a, b) => (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9) || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
}

export function NoticesCarouselCard({ notices }: { notices: Notice[] }) {
  const toast = useToast();
  const settings = useAsync(() => api.settings.get(), []);
  const [enabled, setEnabled] = useState(true);
  const [seconds, setSeconds] = useState('8');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.notices_carousel_enabled ?? true);
    setSeconds(String(settings.data.notices_carousel_seconds ?? 8));
  }, [settings.data]);

  const savedEnabled = settings.data?.notices_carousel_enabled ?? true;
  const savedSeconds = String(settings.data?.notices_carousel_seconds ?? 8);
  const dirty = enabled !== savedEnabled || seconds !== savedSeconds;

  const save = async () => {
    const n = Number(seconds);
    if (!Number.isInteger(n) || n < 2 || n > 300) {
      setError('Entre 2 y 300 segundos');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const updated = await api.settings.update({ notices_carousel_enabled: enabled, notices_carousel_seconds: n });
      if (updated && typeof updated === 'object' && 'server_name' in updated) settings.setData(updated);
      else void settings.reload(true);
      toast.success('Carrusel guardado');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const visible = useMemo(() => visibleNotices(notices), [notices]);
  const interval = Math.max(2, Number(seconds) || 8);

  return (
    <section className="card carousel-card">
      <div className="carousel-settings">
        <h2 className="card-title">Carrusel de avisos</h2>
        <p className="muted text-sm">Cuando hay varios avisos visibles a la vez, las apps los muestran uno tras otro.</p>
        <Switch checked={enabled} onChange={setEnabled} label="Rotar avisos en carrusel" description="Si se desactiva, las apps muestran los avisos sin rotarlos." />
        <FormField label="Tiempo en pantalla por aviso (segundos)" error={error} hint="Cada aviso puede tener su propio tiempo.">
          <input className="input input-narrow" type="number" min={2} max={300} value={seconds} disabled={!enabled} onChange={(e) => setSeconds(e.target.value)} />
        </FormField>
        <button type="button" className="btn btn-primary btn-sm self-start" onClick={() => void save()} disabled={saving || !dirty || settings.loading}>
          {saving ? <Spinner size={13} /> : <Save size={14} />} Guardar
        </button>
        <div className="carousel-order">
          <div className="field-label">Orden actual ({visible.length} visible{visible.length === 1 ? '' : 's'})</div>
          {visible.length === 0 ? (
            <span className="muted text-sm">No hay avisos visibles en este momento.</span>
          ) : (
            <ol className="carousel-order-list">
              {visible.map((n) => (
                <li key={n.id}>
                  <span className={`legend-dot dot-${NOTICE_LEVEL[n.level]?.tone ?? 'gray'}`} />
                  <span className="grow ellipsis">{n.title}</span>
                  <span className="muted text-xs">{n.duration_seconds ? `${n.duration_seconds} s` : `${interval} s`}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <CarouselPreview notices={visible} enabled={enabled} interval={interval} />
    </section>
  );
}

function CarouselPreview({ notices, enabled, interval }: { notices: Notice[]; enabled: boolean; interval: number }) {
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [paused, setPaused] = useState(false);
  const count = notices.length;
  const shownIndex = enabled ? Math.min(index, Math.max(0, count - 1)) : 0;
  const current = count > 0 ? notices[shownIndex] : null;
  const duration = current?.duration_seconds ?? interval;
  const running = enabled && count > 1 && !hover && !paused;

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % count), duration * 1000);
    return () => window.clearTimeout(t);
  }, [running, index, count, duration]);

  return (
    <div className="carousel-preview" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="carousel-head">
        <span className="field-label no-margin">Vista previa en vivo</span>
        {count > 1 && enabled && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPaused((p) => !p)}>
            {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? 'Reanudar' : 'Pausar'}
          </button>
        )}
      </div>
      {current ? (
        <>
          <div key={`${current.id}-${shownIndex}`} className="carousel-slide">
            <NoticePreview title={current.title} body={current.body} level={current.level} display={current.display} />
          </div>
          {running && <div key={`p-${current.id}-${shownIndex}`} className="carousel-progress" style={{ animationDuration: `${duration}s` }} />}
          <div className="carousel-dots">
            {notices.map((n, i) => (
              <button
                key={n.id}
                type="button"
                className={`carousel-dot ${i === shownIndex ? 'is-active' : ''} dot-${NOTICE_LEVEL[n.level]?.tone ?? 'gray'}`}
                aria-label={`Ver aviso ${i + 1}: ${n.title}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <p className="muted text-xs carousel-note">
            {!enabled
              ? 'Carrusel desactivado: se muestra solo el primero en la vista previa.'
              : count === 1
                ? 'Solo hay un aviso visible: no hay rotación.'
                : hover
                  ? 'En pausa mientras el cursor está encima.'
                  : paused
                    ? 'En pausa.'
                    : `Aviso ${shownIndex + 1} de ${count} · ${duration} s en pantalla`}
          </p>
        </>
      ) : (
        <div className="carousel-empty muted text-sm">Activa algún aviso (dentro de su ventana de fechas) para verlo aquí.</div>
      )}
    </div>
  );
}
