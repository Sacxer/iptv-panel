import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Cpu, EthernetPort, KeyRound, MemoryStick, Pencil, Terminal, Trash2, TriangleAlert } from 'lucide-react';
import { api, asList, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useInterval } from '../../hooks/useInterval';
import { usePageVisible } from '../../hooks/usePageVisible';
import { DataTable } from '../../components/DataTable';
import { DeliveryBadge } from '../../components/DeliverySelector';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, CopyButton, ErrorState, PageHeader, PageLoader, Spinner } from '../../components/ui';
import { isLocalUrl, NetworkPortsList } from '../settings/NetworkPanel';
import type { ServerStream, StreamingServer } from '../../types';
import { formatMbps, formatNumber, formatUptime, timeAgo, truncate } from '../../utils/format';
import { SERVER_STATUS, STREAM_STATE } from '../../utils/labels';
import { InstallModal, ServerFormModal } from './ServerModals';
import { EncoderChips, Meter } from './ServersPage';

export function ServerDetailPage() {
  const { id } = useParams();
  const serverId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const visible = usePageVisible();
  const server = useAsync(() => api.servers.get(serverId), [serverId]);
  const streams = useAsync(async () => asList(await api.servers.streams(serverId)), [serverId]);
  const [editOpen, setEditOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const location = useLocation();

  // «Elegir de las interfaces del nodo…» lleva a #red-nodo.
  useEffect(() => {
    if (location.hash !== '#red-nodo' || !server.data) return;
    // Se espera a que se cierre el formulario (al cerrarse restaura el scroll de la página).
    const t = window.setTimeout(() => document.getElementById('red-nodo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    return () => window.clearTimeout(t);
  }, [location.key, location.hash, server.data !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useInterval(() => {
    void server.reload(true);
    void streams.reload(true);
  }, visible && !editOpen && !installOpen ? 5000 : null);

  const s = server.data;

  const regenerate = async () => {
    const ok = await confirm({
      title: 'Regenerar token',
      message: 'El token actual dejará de funcionar y el servidor se desconectará. Tendrás que reinstalar el agente con el nuevo comando (o editar /etc/iptv-node.env). ¿Continuar?',
      confirmText: 'Regenerar',
      danger: true,
    });
    if (!ok) return;
    try {
      server.setData(await api.servers.regenerateToken(serverId));
      toast.success('Token regenerado');
      setInstallOpen(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async () => {
    if (!s) return;
    const ok = await confirm({
      title: 'Eliminar servidor',
      message: (
        <>
          ¿Eliminar <strong>{s.name}</strong>? Los canales asignados a este servidor pasarán a usar otros servidores disponibles.
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.servers.remove(serverId);
      toast.success('Servidor eliminado');
      navigate('/servidores');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (server.loading && !s) return <PageLoader />;
  if (server.error && !s) return <ErrorState message={server.error} onRetry={() => void server.reload()} />;
  if (!s) return null;

  const st = SERVER_STATUS[s.status] ?? SERVER_STATUS.offline;
  const m = s.metrics ?? {};
  const rows = streams.data ?? [];

  return (
    <>
      <PageHeader
        title={
          <span className="row-inline">
            <span className={`status-dot dot-${st.tone} ${s.status === 'online' ? 'is-pulse' : ''}`} /> {s.name}
          </span>
        }
        subtitle={
          <>
            {s.public_url ? <span className="mono">{s.public_url}</span> : <span>URL: se detectará al conectar el nodo</span>} · {st.label}
            {s.last_heartbeat_at ? ` · latido ${timeAgo(s.last_heartbeat_at)}` : ''}
          </>
        }
        actions={
          <>
            <Link to="/servidores" className="btn btn-ghost">
              <ArrowLeft size={16} /> Servidores
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => setInstallOpen(true)}>
              <Terminal size={16} /> Instalar
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(true)}>
              <Pencil size={16} /> Editar
            </button>
          </>
        }
      />

      <div className="server-detail-grid">
        <section className="card">
          <h2 className="card-title">Consumo</h2>
          <div className="stack-sm">
            <Meter label="CPU" value={m.cpu} icon={<Cpu size={12} />} />
            <Meter label="RAM" value={m.mem_percent} icon={<MemoryStick size={12} />} />
          </div>
          <div className="detail-kv">
            <span>Red</span>
            <span>
              <ArrowDown size={12} className="text-green" /> {formatMbps(m.rx_bps)} · <ArrowUp size={12} className="text-blue" /> {formatMbps(m.tx_bps)}
            </span>
            <span>Clientes</span>
            <span>
              {formatNumber(s.clients)}
              {s.max_clients ? ` / ${formatNumber(s.max_clients)}` : ' (sin límite)'}
            </span>
            <span>Canales</span>
            <span>
              {formatNumber(s.streams_running)} emitiendo · {formatNumber(s.streams_error)} con error · {formatNumber(s.assigned_streams)} asignados
            </span>
            <span>Encendido</span>
            <span>{formatUptime(m.uptime)}</span>
            {m.load_avg && m.load_avg.some((l) => l > 0) && (
              <>
                <span>Carga</span>
                <span>{m.load_avg.map((l) => l.toFixed(2)).join(' / ')}</span>
              </>
            )}
          </div>
        </section>
        <section className="card">
          <h2 className="card-title">Hardware</h2>
          <EncoderChips server={s} />
          <div className="detail-kv mt">
            <span>CPU</span>
            <span>
              {s.hardware?.cpu_model ?? '—'}
              {s.hardware?.cores ? ` · ${s.hardware.cores} núcleos` : ''}
            </span>
            <span>Sistema</span>
            <span>{s.hardware?.platform ?? '—'}</span>
            <span>Agente</span>
            <span>{s.version ? `v${s.version}` : '—'}</span>
            <span>IP</span>
            <span className="mono">{s.last_ip ?? '—'}</span>
            <span>Peso</span>
            <span>{s.weight}</span>
          </div>
          <div className="row mt">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void regenerate()}>
              <KeyRound size={14} /> Regenerar token
            </button>
            <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => void remove()}>
              <Trash2 size={14} /> Eliminar
            </button>
          </div>
          {s.notes && <p className="muted text-sm pre-wrap">{s.notes}</p>}
        </section>
      </div>

      <NodeNetworkCard server={s} onChanged={(next) => server.setData(next)} />

      <div className="section-header mt">
        <h2 className="section-title">Canales en este servidor</h2>
        <span className="muted text-xs">Se actualiza cada 5 s</span>
      </div>
      <DataTable<ServerStream>
        rows={rows}
        rowKey={(r) => r.stream_id}
        loading={streams.loading}
        error={streams.error}
        onRetry={() => void streams.reload()}
        emptyTitle="Ningún canal asignado ni emitiendo en este servidor"
        emptyDescription="Asigna canales con modo Reenvío o Transcodificar desde Canales o al importar desde Astra."
        rowClassName={(r) => (r.state === 'error' ? 'row-danger' : r.state === 'idle' ? 'row-muted' : '')}
        columns={[
          {
            key: 'name',
            header: 'Canal',
            render: (r) => (
              <div className="cell-main">
                <span className="strong">{r.name}</span>
                <span className="muted text-xs">
                  #{r.stream_id}
                  {r.assigned ? ` · prioridad ${(r.priority ?? 0) + 1}` : ' · sin asignar (en uso)'}
                  {r.always_on ? ' · siempre encendido' : ''}
                </span>
              </div>
            ),
          },
          { key: 'mode', header: 'Modo', hideOnMobile: true, render: (r) => <DeliveryBadge mode={r.delivery_mode} /> },
          {
            key: 'state',
            header: 'Estado',
            render: (r) => {
              const meta = STREAM_STATE[r.state] ?? STREAM_STATE.idle;
              return (
                <Badge tone={meta.tone} dot>
                  {meta.label}
                </Badge>
              );
            },
          },
          { key: 'uptime', header: 'Activo', hideOnMobile: true, render: (r) => (r.uptime ? formatUptime(r.uptime) : <span className="muted">—</span>) },
          {
            key: 'bitrate',
            header: 'Bitrate',
            hideOnMobile: true,
            render: (r) => (r.bitrate_kbps ? `${formatNumber(r.bitrate_kbps)} kbps` : <span className="muted">—</span>),
          },
          { key: 'clients', header: 'Clientes', render: (r) => <span className={r.clients > 0 ? 'text-green strong' : 'muted'}>{formatNumber(r.clients)}</span> },
          { key: 'restarts', header: 'Reinicios', hideOnMobile: true, render: (r) => <span className={r.restarts > 0 ? 'text-amber' : 'muted'}>{formatNumber(r.restarts)}</span> },
          {
            key: 'error',
            header: 'Último error',
            hideOnMobile: true,
            render: (r) => (r.last_error ? <span className="text-red text-sm" title={r.last_error}>{truncate(r.last_error, 40)}</span> : <span className="muted">—</span>),
          },
        ]}
      />

      <ServerFormModal
        open={editOpen}
        server={s}
        onClose={() => setEditOpen(false)}
        onSaved={(saved) => {
          setEditOpen(false);
          server.setData(saved);
        }}
      />
      <InstallModal server={installOpen ? s : null} onClose={() => setInstallOpen(false)} />
    </>
  );
}

/** Puertos de red que informa el nodo y elección de la IP pública del servidor. */
function NodeNetworkCard({ server, onChanged }: { server: StreamingServer; onChanged: (s: StreamingServer) => void }) {
  const toast = useToast();
  const [busyIp, setBusyIp] = useState<string | null>(null);
  const net = server.network ?? null;
  const suggestions = server.url_suggestions ?? [];

  const useIp = async (ip: string, port?: number) => {
    setBusyIp(ip);
    try {
      const next = await api.servers.useIp(server.id, ip, port);
      onChanged(next);
      toast.success(`URL pública del servidor: ${next.public_url}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyIp(null);
    }
  };

  return (
    <section className="card mt" id="red-nodo">
      <div className="section-header">
        <div>
          <h2 className="card-title no-margin">
            <EthernetPort size={18} /> Puertos de red del nodo
          </h2>
          {net && (
            <p className="muted text-sm no-margin">
              {net.hostname ? (
                <>
                  Equipo <strong>{net.hostname}</strong> ·{' '}
                </>
              ) : null}
              escucha en el puerto <strong className="mono">{net.listen_port ?? '—'}</strong>
              {net.reported_at ? ` · informado ${timeAgo(net.reported_at)}` : ''}
            </p>
          )}
        </div>
        {busyIp && <Spinner size={16} label="Guardando…" />}
      </div>

      <div className="net-url-current">
        <span className="muted text-sm">URL pública:</span>
        {server.public_url ? (
          <>
            <span className="net-url-value mono">{server.public_url}</span>
            <CopyButton text={server.public_url} />
          </>
        ) : (
          <span className="text-sm">se detectará al conectar el nodo</span>
        )}
      </div>
      {(!server.public_url || isLocalUrl(server.public_url)) && (
        <Alert tone="amber" icon={<TriangleAlert size={18} />}>
          {server.public_url
            ? 'La URL apunta al propio equipo (127.0.0.1 / localhost): los clientes de otros equipos no podrán conectarse. Elige la IP de una interfaz.'
            : 'Los clientes no podrán conectarse hasta que el servidor tenga una URL pública.'}
        </Alert>
      )}

      {!net ? (
        <p className="muted text-sm">
          El nodo aún no informó sus interfaces (se actualiza al conectarse; instala la última versión del nodo).
        </p>
      ) : (
        <>
          {suggestions.length > 0 && (
            <ul className="net-suggestions net-suggestions-compact">
              {suggestions.map((sg) => (
                <li key={sg.url} className={sg.in_use ? 'is-current' : ''}>
                  <div className="net-suggestion-main">
                    <span className="row-inline">
                      <span className="mono strong">{sg.url}</span>
                      {sg.in_use && <Badge tone="green">En uso</Badge>}
                    </span>
                    <span className="muted text-xs">
                      {sg.interface}
                      {sg.default_route ? ' · principal' : ''}
                    </span>
                  </div>
                  <div className="row-actions">
                    <CopyButton text={sg.url} />
                    <button type="button" className="btn btn-secondary btn-sm" disabled={sg.in_use || busyIp !== null} onClick={() => void useIp(sg.ip, sg.port)}>
                      {sg.in_use ? 'En uso' : 'Usar esta'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt">
            <NetworkPortsList
              ports={net.ports ?? []}
              current={server.public_url}
              disabled={busyIp !== null}
              useLabel="Usar para este servidor"
              onUse={(ip) => void useIp(ip)}
            />
          </div>
        </>
      )}
    </section>
  );
}
