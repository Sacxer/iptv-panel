import { useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';

// Gráficos SVG ligeros propios (sin librerías).

export type ChartTone = 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'purple' | 'orange' | 'primary';

const toneVar = (tone: ChartTone) => (tone === 'primary' ? 'var(--primary)' : `var(--${tone})`);

// ---------- Donut ----------

export interface DonutSegment {
  key: string;
  value: number;
  tone: ChartTone;
  label: string;
}

/** Anillo segmentado con contenido central. */
export function Donut({
  segments,
  size = 132,
  thickness = 14,
  children,
  ariaLabel,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  children?: ReactNode;
  ariaLabel?: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((n, s) => n + Math.max(0, s.value), 0);
  const visible = segments.filter((s) => s.value > 0);
  const gap = visible.length > 1 ? Math.min(4, c * 0.01) : 0;
  let offset = 0;
  return (
    <div className="donut" style={{ width: size, height: size }} role="img" aria-label={ariaLabel}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={thickness} />
        {total > 0 &&
          visible.map((s) => {
            const len = (s.value / total) * c;
            const dash = Math.max(0, len - gap);
            const el = (
              <circle
                key={s.key}
                className="donut-seg"
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={toneVar(s.tone)}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap={visible.length === 1 ? 'butt' : 'butt'}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              >
                <title>
                  {s.label}: {s.value}
                </title>
              </circle>
            );
            offset += len;
            return el;
          })}
      </svg>
      {children && <div className="donut-center">{children}</div>}
    </div>
  );
}

// ---------- Anillo de porcentaje ----------

export function gaugeTone(percent: number | null | undefined): ChartTone {
  if (percent === null || percent === undefined) return 'gray';
  if (percent >= 90) return 'red';
  if (percent >= 70) return 'amber';
  return 'primary';
}

export function RingGauge({
  percent,
  size = 104,
  thickness = 10,
  label,
  sub,
}: {
  percent: number | null | undefined;
  size?: number;
  thickness?: number;
  label: string;
  sub?: ReactNode;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const p = percent === null || percent === undefined ? null : Math.max(0, Math.min(100, percent));
  const tone = gaugeTone(p);
  return (
    <div className={`gauge gauge-${tone}`}>
      <div className="gauge-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={thickness} />
          {p !== null && (
            <circle
              className="gauge-arc"
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={toneVar(tone)}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${(p / 100) * c} ${c}`}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )}
        </svg>
        <div className="gauge-value">
          {p === null ? '—' : `${p < 10 ? p.toFixed(1) : Math.round(p)}`}
          {p !== null && <span className="gauge-unit">%</span>}
        </div>
      </div>
      <div className="gauge-label">{label}</div>
      {sub && <div className="gauge-sub">{sub}</div>}
    </div>
  );
}

// ---------- Barra segmentada ----------

export function SegmentBar({ segments, height = 10 }: { segments: DonutSegment[]; height?: number }) {
  const total = segments.reduce((n, s) => n + Math.max(0, s.value), 0);
  return (
    <div className="segbar" style={{ height }} role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}>
      {total > 0 &&
        segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span
              key={s.key}
              className="segbar-part"
              style={{ width: `${(s.value / total) * 100}%`, background: toneVar(s.tone) }}
              title={`${s.label}: ${s.value}`}
            />
          ))}
    </div>
  );
}

// ---------- Gráfico de área (historial) ----------

export interface AreaSeries {
  key: string;
  label: string;
  tone: ChartTone;
  values: (number | null)[];
  format: (v: number) => string;
}

export function AreaChart({
  series,
  times,
  height = 90,
  max,
  formatTime,
}: {
  series: AreaSeries[];
  times: number[];
  height?: number;
  /** Máximo del eje Y; si no se indica se calcula automáticamente. */
  max?: number;
  formatTime: (t: number) => string;
}) {
  const W = 300;
  const H = 100;
  const gradId = useId().replace(/:/g, '');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = times.length;

  const yMax = useMemo(() => {
    if (max !== undefined) return max;
    let m = 0;
    for (const s of series) for (const v of s.values) if (v !== null && v > m) m = v;
    return m > 0 ? m * 1.15 : 1;
  }, [series, max]);

  const x = (i: number) => (n <= 1 ? W : (i / (n - 1)) * W);
  const y = (v: number) => H - (Math.max(0, Math.min(v, yMax)) / yMax) * (H - 4) - 2;

  const paths = series.map((s) => {
    let line = '';
    let started = false;
    let firstX = 0;
    let lastX = 0;
    s.values.forEach((v, i) => {
      if (v === null) return;
      const px = x(i);
      const py = y(v);
      if (!started) {
        line += `M${px.toFixed(1)},${py.toFixed(1)}`;
        firstX = px;
        started = true;
      } else line += ` L${px.toFixed(1)},${py.toFixed(1)}`;
      lastX = px;
    });
    const area = started ? `${line} L${lastX.toFixed(1)},${H} L${firstX.toFixed(1)},${H} Z` : '';
    return { key: s.key, tone: s.tone, line, area };
  });

  const onMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (n - 1)));
  };

  if (n < 2) {
    return (
      <div className="area-chart area-chart-empty" style={{ height }}>
        <span className="muted text-xs">Recopilando datos…</span>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="area-chart"
      style={{ height }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${gradId}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={toneVar(s.tone)} stopOpacity="0.32" />
              <stop offset="100%" stopColor={toneVar(s.tone)} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} className="area-grid" vectorEffect="non-scaling-stroke" />
        ))}
        {paths.map((p) => (
          <g key={p.key}>
            {p.area && <path d={p.area} fill={`url(#${gradId}-${p.key})`} />}
            {p.line && (
              <path d={p.line} fill="none" stroke={toneVar(p.tone)} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            )}
          </g>
        ))}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} className="area-cursor" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hover !== null && (
        <div className={`area-tip ${hover > n * 0.6 ? 'area-tip-left' : ''}`} style={{ left: `${(hover / (n - 1)) * 100}%` }}>
          <div className="area-tip-time">{formatTime(times[hover])}</div>
          {series.map((s) => {
            const v = s.values[hover];
            return (
              <div key={s.key} className="area-tip-row">
                <span className="legend-dot" style={{ background: toneVar(s.tone) }} />
                {s.label}: <strong>{v === null || v === undefined ? '—' : s.format(v)}</strong>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Skeleton ----------

export function Skeleton({ width, height = 14, radius, className = '' }: { width?: number | string; height?: number | string; radius?: number; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}
