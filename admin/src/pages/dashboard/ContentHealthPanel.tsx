import { Link } from 'react-router-dom';
import { CircleCheck, Film, ScanSearch, Tv } from 'lucide-react';
import { Donut, type DonutSegment } from '../../components/charts';
import { Spinner, Thumb } from '../../components/ui';
import type { HealthCounts, OfflineStream, StreamCheckRun, StreamType } from '../../types';
import { formatDateTime, formatNumber, timeAgo } from '../../utils/format';
import { Panel } from './Panel';

interface Props {
  type: StreamType;
  counts: HealthCounts | undefined;
  offline: OfflineStream[];
  running: boolean;
  progress: { total: number; done: number } | null;
  lastResult: StreamCheckRun | null;
  canCheck: boolean;
  starting: boolean;
  onCheck: () => void;
  className?: string;
}

export function ContentHealthPanel({ type, counts, offline, running, progress, lastResult, canCheck, starting, onCheck, className = '' }: Props) {
  const isLive = type === 'live';
  const base = isLive ? '/canales' : '/peliculas';
  const c = counts ?? { online: 0, offline: 0, unknown: 0, total: 0 };
  const labels = isLive
    ? { online: 'En línea', offline: 'Caídos', unknown: 'Sin revisar' }
    : { online: 'Funcionando', offline: 'Con fallas', unknown: 'Sin revisar' };
  const segments: DonutSegment[] = [
    { key: 'online', label: labels.online, value: c.online, tone: 'green' },
    { key: 'offline', label: labels.offline, value: c.offline, tone: 'red' },
    { key: 'unknown', label: labels.unknown, value: c.unknown, tone: 'gray' },
  ];
  const checked = c.online + c.offline;
  const pct = c.total > 0 ? Math.round((c.online / c.total) * 100) : 0;
  const items = offline.filter((o) => o.type === type).slice(0, 5);
  const finished = lastResult?.finished_at ?? null;

  const status = running ? (
    <span className="check-status is-running">
      <Spinner size={12} /> Revisando…
      {progress && progress.total > 0 && (
        <span className="muted">
          {' '}
          {formatNumber(progress.done)}/{formatNumber(progress.total)}
        </span>
      )}
    </span>
  ) : (
    <span className="check-status" title={finished ? formatDateTime(finished) : undefined}>
      {finished ? `Última revisión ${timeAgo(finished)}` : 'Aún no se ha revisado'}
    </span>
  );

  return (
    <Panel
      className={className}
      title={isLive ? 'Canales' : 'Películas'}
      icon={isLive ? <Tv size={18} /> : <Film size={18} />}
      tone={isLive ? 'blue' : 'orange'}
      subtitle={status}
      link={`${base}?health=offline`}
      linkLabel={isLive ? 'Ver caídos' : 'Ver con fallas'}
      actions={
        canCheck ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCheck} disabled={running || starting} title="Revisar ahora">
            {starting ? <Spinner size={13} /> : <ScanSearch size={14} />}
            <span className="hide-mobile">Revisar ahora</span>
          </button>
        ) : undefined
      }
    >
      <div className="health-layout">
        <Donut segments={segments} size={132} thickness={14} ariaLabel={`${labels.online}: ${c.online} de ${c.total}`}>
          <span className={`donut-big ${c.offline > 0 ? '' : 'text-green'}`}>{c.total > 0 ? `${pct}%` : '—'}</span>
          <span className="donut-caption">{labels.online.toLowerCase()}</span>
        </Donut>
        <ul className="legend-list">
          {segments.map((s) => (
            <li key={s.key}>
              <Link to={`${base}?health=${s.key}`} className="legend-item">
                <span className={`legend-dot dot-${s.tone}`} />
                <span className="legend-label">{s.label}</span>
                <span className="legend-value">{formatNumber(s.value)}</span>
              </Link>
            </li>
          ))}
          <li className="legend-total">
            <span className="legend-label">Total</span>
            <span className="legend-value">
              {formatNumber(c.total)}
              {c.total > 0 && checked < c.total && <span className="muted text-xs"> · {formatNumber(checked)} revisados</span>}
            </span>
          </li>
        </ul>
      </div>

      <div className="section-label">{isLive ? 'Canales caídos' : 'Películas con fallas'}</div>
      {items.length === 0 ? (
        <div className="health-ok">
          <CircleCheck size={18} />
          {c.total === 0
            ? isLive
              ? 'No hay canales todavía'
              : 'No hay películas todavía'
            : c.offline === 0
              ? isLive
                ? 'Todos los canales revisados responden'
                : 'Todas las películas revisadas funcionan'
              : 'Sin detalles disponibles'}
        </div>
      ) : (
        <ul className="down-list">
          {items.map((o) => (
            <li key={o.id}>
              <Link to={`${base}?health=offline`} className="down-item" title={o.health_error ?? undefined}>
                <Thumb src={o.logo} alt={o.name} variant={isLive ? 'logo' : 'poster'} />
                <span className="down-main">
                  <span className="down-name">{o.name}</span>
                  <span className="down-meta">
                    {o.category_name ?? 'Sin categoría'}
                    {o.health_error ? ` · ${o.health_error}` : ''}
                  </span>
                </span>
                <span className="down-since" title={o.down_since ? formatDateTime(o.down_since) : undefined}>
                  {o.down_since ? `caído ${timeAgo(o.down_since)}` : 'caído'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {c.offline > items.length && items.length > 0 && (
        <Link to={`${base}?health=offline`} className="panel-more">
          y {formatNumber(c.offline - items.length)} más…
        </Link>
      )}
    </Panel>
  );
}
