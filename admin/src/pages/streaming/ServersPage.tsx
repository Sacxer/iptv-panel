import { useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Cpu, MemoryStick, Plus, Server, Terminal, Users, Radio, TriangleAlert } from 'lucide-react';
import { useServers } from '../../hooks/useStreaming';
import { Badge, EmptyState, ErrorState, PageHeader } from '../../components/ui';
import { isLocalUrl } from '../settings/NetworkPanel';
import { Skeleton } from '../../components/charts';
import type { StreamingServer } from '../../types';
import { formatMbps, formatNumber, timeAgo } from '../../utils/format';
import { SERVER_STATUS, encoderLabel } from '../../utils/labels';
import { InstallModal, ServerFormModal } from './ServerModals';
import { MainServerCard } from './MainServerCard';

export function meterTone(p: number | null | undefined) {
  if (p === null || p === undefined) return 'gray';
  if (p >= 90) return 'red';
  if (p >= 70) return 'amber';
  return 'green';
}

export function Meter({ label, value, icon }: { label: string; value: number | null | undefined; icon: ReactElement }) {
  const v = value === null || value === undefined ? null : Math.max(0, Math.min(100, value));
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label">
          {icon} {label}
        </span>
        <span className={`meter-value text-${meterTone(v) === 'gray' ? '' : meterTone(v)}`}>{v === null ? '—' : `${Math.round(v)}%`}</span>
      </div>
      <div className="meter-track">
        <div className={`meter-fill fill-${meterTone(v)}`} style={{ width: `${v ?? 0}%` }} />
      </div>
    </div>
  );
}

export function EncoderChips({ server }: { server: StreamingServer }) {
  const enc = server.hardware?.encoders ?? [];
  if (!server.hardware?.ffmpeg && enc.length === 0) return <span className="muted text-xs">Sin datos de hardware</span>;
  return (
    <div className="hw-chips">
      {server.hardware?.ffmpeg && <span className="hw-chip">FFmpeg {server.hardware.ffmpeg}</span>}
      {enc.map((e) => (
        <span key={e} className={`hw-chip ${/nvenc|qsv|vaapi/i.test(e) ? 'is-gpu' : ''}`}>
          {encoderLabel(e)}
        </span>
      ))}
    </div>
  );
}

export function ServersPage() {
  const { servers, loading, error, reload, data } = useServers(true, 5000);
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [installFor, setInstallFor] = useState<StreamingServer | null>(null);

  const online = servers.filter((s) => s.status === 'online').length;
  const clients = servers.reduce((n, s) => n + (s.clients ?? 0), 0);
  const running = servers.reduce((n, s) => n + (s.streams_running ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Servidores de streaming"
        subtitle="Este portal y los nodos que reenvían o transcodifican canales y reparten la señal a los clientes"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setFormOpen(true)}>
            <Plus size={16} /> Agregar servidor
          </button>
        }
      />

      <MainServerCard />

      <h2 className="section-title servers-nodes-title">Nodos de streaming</h2>

      {data && servers.length > 0 && (
        <div className="summary-strip">
          <span className="summary-item">
            <span className="status-dot dot-green" /> <span className="summary-value">{online}</span>
            <span className="summary-label">de {servers.length} en línea</span>
          </span>
          <span className="summary-item">
            <Users size={15} className="muted" /> <span className="summary-value">{formatNumber(clients)}</span>
            <span className="summary-label">clientes</span>
          </span>
          <span className="summary-item">
            <Radio size={15} className="text-green" /> <span className="summary-value">{formatNumber(running)}</span>
            <span className="summary-label">canales emitiendo</span>
          </span>
          <span className="summary-item muted text-xs">Se actualiza cada 5 s</span>
        </div>
      )}

      {!data && loading ? (
        <div className="server-cards">
          {[0, 1].map((i) => (
            <div key={i} className="server-card">
              <Skeleton width="60%" height={18} />
              <Skeleton width="40%" height={12} />
              <Skeleton width="100%" height={60} radius={10} />
            </div>
          ))}
        </div>
      ) : error && !data ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : servers.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Server size={30} />}
            title="Aún no hay servidores de streaming"
            description="Agrega un servidor para reenviar canales (por ejemplo desde Astra) o transcodificarlos, y ver las conexiones exactas."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setFormOpen(true)}>
                <Plus size={16} /> Agregar servidor
              </button>
            }
          />
        </div>
      ) : (
        <div className="server-cards">
          {servers.map((s) => {
            const st = SERVER_STATUS[s.status] ?? SERVER_STATUS.offline;
            const m = s.metrics ?? {};
            return (
              <article key={s.id} className={`server-card status-${s.status}`}>
                <header className="server-card-head">
                  <span className={`status-dot dot-${st.tone} ${s.status === 'online' ? 'is-pulse' : ''}`} />
                  <div className="grow cell-main">
                    <Link to={`/servidores/${s.id}`} className="server-card-name">
                      {s.name}
                    </Link>
                    {s.public_url ? (
                      <span className="muted text-xs mono ellipsis">{s.public_url}</span>
                    ) : (
                      <span className="muted text-xs">URL: se detectará al conectar el nodo</span>
                    )}
                    {(!s.public_url || isLocalUrl(s.public_url)) && (
                      <span className="server-url-warn" title={s.public_url ? 'La URL apunta al propio equipo (127.0.0.1 / localhost)' : 'Aún no tiene URL pública'}>
                        <Badge tone="amber">Los clientes no podrán conectarse</Badge>
                      </span>
                    )}
                  </div>
                  <span className={`badge badge-${st.tone}`}>{st.label}</span>
                </header>
                <div className="server-card-meta">
                  <span title="Último latido">{s.last_heartbeat_at ? `Latido ${timeAgo(s.last_heartbeat_at)}` : 'Sin latidos'}</span>
                  {s.version && <span>v{s.version}</span>}
                  {s.last_ip && <span className="mono">{s.last_ip}</span>}
                </div>

                <div className="server-card-stats">
                  <div className="scs">
                    <span className="scs-value">
                      {formatNumber(s.clients)}
                      {s.max_clients ? <span className="muted">/{formatNumber(s.max_clients)}</span> : null}
                    </span>
                    <span className="scs-label">Clientes</span>
                  </div>
                  <div className="scs">
                    <span className="scs-value text-green">{formatNumber(s.streams_running)}</span>
                    <span className="scs-label">Emitiendo</span>
                  </div>
                  <div className="scs">
                    <span className={`scs-value ${s.streams_error ? 'text-red' : ''}`}>{formatNumber(s.streams_error)}</span>
                    <span className="scs-label">Con error</span>
                  </div>
                  <div className="scs">
                    <span className="scs-value">{formatNumber(s.assigned_streams)}</span>
                    <span className="scs-label">Asignados</span>
                  </div>
                </div>

                {s.status === 'online' || m.cpu !== undefined ? (
                  <div className="server-card-meters">
                    <Meter label="CPU" value={m.cpu} icon={<Cpu size={12} />} />
                    <Meter label="RAM" value={m.mem_percent} icon={<MemoryStick size={12} />} />
                    <div className="net-mini">
                      <span className="text-green">
                        <ArrowDown size={12} /> {formatMbps(m.rx_bps)}
                      </span>
                      <span className="text-blue">
                        <ArrowUp size={12} /> {formatMbps(m.tx_bps)}
                      </span>
                    </div>
                  </div>
                ) : null}

                <EncoderChips server={s} />

                {s.status === 'pending' && (
                  <div className="server-pending">
                    <TriangleAlert size={14} /> Falta instalar el agente en el servidor.
                  </div>
                )}

                <footer className="server-card-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInstallFor(s)}>
                    <Terminal size={14} /> Instalar
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/servidores/${s.id}`)}>
                    Ver detalle
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <ServerFormModal
        open={formOpen}
        server={null}
        onClose={() => setFormOpen(false)}
        onSaved={(s, created) => {
          setFormOpen(false);
          void reload(true);
          if (created) setInstallFor(s);
        }}
      />
      <InstallModal server={installFor} onClose={() => setInstallFor(null)} />
    </>
  );
}
