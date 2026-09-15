import { useMemo } from 'react';
import { ArrowDown, ArrowUp, Clock, Cpu, Server } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useInterval } from '../../hooks/useInterval';
import { usePageVisible } from '../../hooks/usePageVisible';
import { AreaChart, RingGauge, Skeleton } from '../../components/charts';
import { ErrorState } from '../../components/ui';
import { formatClock, formatGB, formatMB, formatMbps, formatUptime } from '../../utils/format';
import { Panel } from './Panel';

const pctFormat = (v: number) => `${v.toFixed(1)} %`;

export function ServerPanel({ className = '' }: { className?: string }) {
  const visible = usePageVisible();
  const metrics = useAsync(() => api.system.metrics(), []);
  useInterval(() => void metrics.reload(true), visible ? 5000 : null);

  const m = metrics.data;
  const history = useMemo(() => m?.history ?? [], [m]);
  const times = useMemo(() => history.map((h) => h.t), [history]);

  if (!m) {
    return (
      <Panel className={className} title="Servidor" icon={<Server size={18} />} tone="primary" subtitle="Consumo físico del servidor">
        {metrics.error ? (
          <ErrorState message={metrics.error} onRetry={() => void metrics.reload()} />
        ) : (
          <div className="server-skeleton" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="gauge">
                <Skeleton width={104} height={104} radius={999} />
                <Skeleton width={60} height={12} />
              </div>
            ))}
            <div className="skeleton-lines grow">
              <Skeleton width="80%" height={14} />
              <Skeleton width="60%" height={14} />
              <Skeleton width="100%" height={70} radius={10} />
            </div>
          </div>
        )}
      </Panel>
    );
  }

  const net = m.network;
  const load = m.cpu.load_avg;
  const infoParts = [
    m.hostname,
    m.platform,
    m.cpu.model ? `${m.cpu.model}` : null,
    m.cpu.cores ? `${m.cpu.cores} núcleos` : null,
    load ? `carga ${load.map((l) => l.toFixed(2)).join(' / ')}` : null,
    m.node_version ? `Node ${m.node_version}` : null,
  ].filter(Boolean);

  return (
    <Panel
      className={className}
      title="Servidor"
      icon={<Server size={18} />}
      tone="primary"
      subtitle={
        <span className="check-status">
          <span className={`live-dot ${visible && !metrics.error ? 'is-live' : ''}`} />
          {metrics.error ? 'Sin conexión con las métricas' : visible ? 'En vivo · cada 5 s' : 'En pausa (pestaña oculta)'}
        </span>
      }
    >
      <div className="server-top">
        <div className="gauges">
          <RingGauge percent={m.cpu.usage_percent} label="CPU" sub={`${m.cpu.cores} núcleos`} />
          <RingGauge percent={m.memory.percent} label="RAM" sub={`${formatGB(m.memory.used)} / ${formatGB(m.memory.total)}`} />
          <RingGauge
            percent={m.disk?.percent ?? null}
            label="Disco"
            sub={m.disk ? `${formatGB(m.disk.used)} / ${formatGB(m.disk.total)}` : 'No disponible'}
          />
        </div>
        <div className="server-side">
          <div className="server-tile">
            <div className="section-label">Red</div>
            {net.available ? (
              <div className="net-values">
                <span className="net-value net-rx" title="Descarga">
                  <ArrowDown size={15} /> {formatMbps(net.rx_bps)}
                </span>
                <span className="net-value net-tx" title="Subida">
                  <ArrowUp size={15} /> {formatMbps(net.tx_bps)}
                </span>
              </div>
            ) : (
              <div className="muted text-sm">No disponible en este sistema</div>
            )}
          </div>
          <div className="server-tile server-uptime">
            <div>
              <div className="section-label">
                <Clock size={12} /> Servidor encendido
              </div>
              <div className="uptime-value">{formatUptime(m.uptime.system)}</div>
            </div>
            <div>
              <div className="section-label">Portal activo</div>
              <div className="uptime-value">{formatUptime(m.uptime.process)}</div>
              <div className="muted text-xs">Memoria del portal: {formatMB(m.memory.process_rss)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="server-info" title={infoParts.join(' · ')}>
        <Cpu size={14} />
        <span>{infoParts.join(' · ')}</span>
      </div>

      <div className={`server-charts ${net.available ? 'has-net' : ''}`}>
        <div className="chart-card">
          <div className="chart-head">
            <span className="chart-title">CPU</span>
            <span className="chart-now">{m.cpu.usage_percent !== null ? pctFormat(m.cpu.usage_percent) : '—'}</span>
          </div>
          <AreaChart
            times={times}
            max={100}
            formatTime={formatClock}
            series={[{ key: 'cpu', label: 'CPU', tone: 'primary', values: history.map((h) => h.cpu), format: pctFormat }]}
          />
        </div>
        <div className="chart-card">
          <div className="chart-head">
            <span className="chart-title">RAM</span>
            <span className="chart-now">{pctFormat(m.memory.percent)}</span>
          </div>
          <AreaChart
            times={times}
            max={100}
            formatTime={formatClock}
            series={[{ key: 'mem', label: 'RAM', tone: 'purple', values: history.map((h) => h.mem), format: pctFormat }]}
          />
        </div>
        {net.available && (
          <div className="chart-card">
            <div className="chart-head">
              <span className="chart-title">Red</span>
              <span className="chart-legend">
                <span className="legend-dot dot-green" /> ↓ <span className="legend-dot dot-blue" /> ↑
              </span>
            </div>
            <AreaChart
              times={times}
              formatTime={formatClock}
              series={[
                { key: 'rx', label: 'Descarga', tone: 'green', values: history.map((h) => h.rx_bps), format: formatMbps },
                { key: 'tx', label: 'Subida', tone: 'blue', values: history.map((h) => h.tx_bps), format: formatMbps },
              ]}
            />
          </div>
        )}
      </div>
      <div className="muted text-xs chart-caption">Últimos 10 minutos</div>
    </Panel>
  );
}
