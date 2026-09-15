import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Skeleton } from '../../components/charts';
import type { Tone } from '../../utils/labels';

/** Contenedor temático del panel: cabecera con icono, título, estado y enlace "Ver todo". */
export function Panel({
  title,
  icon,
  tone = 'blue',
  subtitle,
  actions,
  link,
  linkLabel = 'Ver todo',
  className = '',
  children,
}: {
  title: string;
  icon: ReactNode;
  tone?: Tone | 'primary';
  subtitle?: ReactNode;
  actions?: ReactNode;
  link?: string;
  linkLabel?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel panel-tone-${tone} ${className}`}>
      <header className="panel-header">
        <span className="panel-icon">{icon}</span>
        <div className="panel-heading">
          <h2 className="panel-title">{title}</h2>
          {subtitle && <div className="panel-subtitle">{subtitle}</div>}
        </div>
        <div className="panel-actions">
          {actions}
          {link && (
            <Link to={link} className="panel-link">
              {linkLabel} <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

/** Esqueleto de un contenedor mientras carga por primera vez. */
export function PanelSkeleton({ className = '', lines = 3, chart = true }: { className?: string; lines?: number; chart?: boolean }) {
  return (
    <section className={`panel ${className}`} aria-busy="true">
      <header className="panel-header">
        <Skeleton width={34} height={34} radius={10} />
        <div className="panel-heading">
          <Skeleton width={120} height={16} />
          <Skeleton width={180} height={11} className="mt-xs" />
        </div>
      </header>
      <div className="panel-body skeleton-body">
        {chart && <Skeleton width={120} height={120} radius={999} />}
        <div className="skeleton-lines">
          {Array.from({ length: lines }).map((_, i) => (
            <Skeleton key={i} width={`${90 - i * 12}%`} height={14} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Métrica compacta con valor grande y etiqueta. */
export function MiniMetric({
  label,
  value,
  tone = 'gray',
  icon,
  hint,
  to,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  hint?: ReactNode;
  to?: string;
}) {
  const content = (
    <>
      {icon && <span className={`mini-icon stat-${tone}`}>{icon}</span>}
      <span className="mini-text">
        <span className={`mini-value mini-${tone}`}>{value}</span>
        <span className="mini-label">{label}</span>
        {hint && <span className="mini-hint">{hint}</span>}
      </span>
    </>
  );
  return to ? (
    <Link to={to} className="mini-metric mini-clickable">
      {content}
    </Link>
  ) : (
    <div className="mini-metric">{content}</div>
  );
}
