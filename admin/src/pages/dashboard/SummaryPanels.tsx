import { Link } from 'react-router-dom';
import { Activity, BellRing, CalendarClock, ContactRound, MonitorSmartphone, Wifi } from 'lucide-react';
import { Donut, SegmentBar, type ChartTone, type DonutSegment } from '../../components/charts';
import type { Dashboard, DeviceStats, DeviceType } from '../../types';
import { formatNumber } from '../../utils/format';
import { DEVICE_TYPE_LABEL } from '../../utils/labels';
import { MiniMetric, Panel } from './Panel';

// ---------- Clientes ----------

export function ClientsPanel({ data, className = '' }: { data: Dashboard; className?: string }) {
  const u = data.users;
  const segments: (DonutSegment & { status: string })[] = [
    { key: 'active', status: 'active', label: 'Activos', value: u.active, tone: 'green' },
    { key: 'expired', status: 'expired', label: 'Vencidos', value: u.expired, tone: 'amber' },
    { key: 'suspended', status: 'suspended', label: 'Suspendidos', value: u.suspended, tone: 'red' },
    { key: 'disabled', status: 'disabled', label: 'Deshabilitados', value: u.disabled, tone: 'gray' },
  ];
  const pctActive = u.total > 0 ? Math.round((u.active / u.total) * 100) : 0;

  return (
    <Panel
      className={className}
      title="Clientes"
      icon={<ContactRound size={18} />}
      tone="green"
      subtitle={`${formatNumber(u.total)} líneas registradas`}
      link="/clientes"
    >
      <div className="clients-layout">
        <div className="clients-chart">
          <Donut segments={segments} size={148} thickness={16} ariaLabel="Distribución de clientes por estado">
            <span className="donut-big">{formatNumber(u.active)}</span>
            <span className="donut-caption">activos · {pctActive}%</span>
          </Donut>
        </div>
        <ul className="legend-list">
          {segments.map((s) => (
            <li key={s.key}>
              <Link to={`/clientes?status=${s.status}`} className="legend-item">
                <span className={`legend-dot dot-${s.tone}`} />
                <span className="legend-label">{s.label}</span>
                <span className="legend-value">{formatNumber(s.value)}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link to="/clientes?status=trial" className="legend-item">
              <span className="legend-dot dot-purple" />
              <span className="legend-label">En prueba</span>
              <span className="legend-value">{formatNumber(u.trial)}</span>
            </Link>
          </li>
        </ul>
        <div className="mini-stack">
          <MiniMetric
            label="Vencen en 7 días"
            value={formatNumber(u.expiring_7d)}
            tone={u.expiring_7d > 0 ? 'orange' : 'gray'}
            icon={<CalendarClock size={17} />}
            to="/clientes?status=expiring"
          />
          <MiniMetric
            label="Conexiones activas"
            value={formatNumber(data.active_connections)}
            tone="blue"
            icon={<Activity size={17} />}
            to="/conexiones"
          />
        </div>
      </div>
    </Panel>
  );
}

// ---------- Dispositivos ----------

const TYPE_TONES: Record<DeviceType, ChartTone> = {
  tvbox: 'purple',
  smart_tv: 'blue',
  mobile: 'green',
  tablet: 'orange',
  pc: 'amber',
  stb: 'red',
  unknown: 'gray',
};

export function DevicesPanel({
  data,
  stats,
  className = '',
}: {
  data: Dashboard;
  stats: DeviceStats | null;
  className?: string;
}) {
  const d = data.devices ?? { online: stats?.online ?? 0, total: stats?.total ?? 0, open_alerts: stats?.open_alerts ?? 0 };
  const byType = stats?.by_type ?? {};
  const types = (Object.keys(DEVICE_TYPE_LABEL) as DeviceType[])
    .map((t) => ({ type: t, value: byType[t] ?? 0 }))
    .filter((t) => t.value > 0)
    .sort((a, b) => b.value - a.value);
  const maxType = types.reduce((m, t) => Math.max(m, t.value), 0);
  const pctOnline = d.total > 0 ? Math.round((d.online / d.total) * 100) : 0;

  return (
    <Panel
      className={className}
      title="Dispositivos"
      icon={<MonitorSmartphone size={18} />}
      tone="purple"
      subtitle={d.total > 0 ? `${pctOnline}% en línea ahora` : 'Sin equipos registrados'}
      link="/dispositivos"
    >
      <div className="metric-row">
        <MiniMetric label="En línea" value={formatNumber(d.online)} tone="green" icon={<Wifi size={17} />} to="/dispositivos?online=1" />
        <MiniMetric label="Total" value={formatNumber(d.total)} tone="blue" icon={<MonitorSmartphone size={17} />} to="/dispositivos" />
        <MiniMetric
          label="Alertas abiertas"
          value={formatNumber(d.open_alerts)}
          tone={d.open_alerts > 0 ? 'amber' : 'gray'}
          icon={<BellRing size={17} />}
          to="/dispositivos?tab=alertas"
        />
      </div>
      {d.total > 0 && (
        <div className="online-bar">
          <SegmentBar
            height={8}
            segments={[
              { key: 'on', label: 'En línea', value: d.online, tone: 'green' },
              { key: 'off', label: 'Desconectados', value: Math.max(0, d.total - d.online), tone: 'gray' },
            ]}
          />
        </div>
      )}
      {types.length > 0 && (
        <div className="type-bars">
          <div className="section-label">Por tipo</div>
          {types.map((t) => (
            <div key={t.type} className="type-bar">
              <span className="type-bar-label">{DEVICE_TYPE_LABEL[t.type]}</span>
              <span className="type-bar-track">
                <span
                  className="type-bar-fill"
                  style={{ width: `${maxType ? (t.value / maxType) * 100 : 0}%`, background: `var(--${TYPE_TONES[t.type]})` }}
                />
              </span>
              <span className="type-bar-value">{formatNumber(t.value)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
