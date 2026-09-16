import { Link } from 'react-router-dom';
import { ArrowRight, Cloud, DatabaseBackup, GitBranch, Network, Radio, RefreshCw, Server, Smartphone, Users, ZapOff } from 'lucide-react';
import { useServers } from '../../hooks/useStreaming';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { useInterval } from '../../hooks/useInterval';
import { useStreamCheck } from '../../hooks/useStreamCheck';
import { ErrorState, PageHeader } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { formatNumber, timeAgo, timeFromNow } from '../../utils/format';
import { ContentHealthPanel } from './ContentHealthPanel';
import { ActivityPanel, ExpiringPanel } from './ListPanels';
import { PanelSkeleton } from './Panel';
import { ServerPanel } from './ServerPanel';
import { ClientsPanel, DevicesPanel } from './SummaryPanels';

export function DashboardPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { servers, data: serversData } = useServers(isAdmin, 15000);
  const dash = useAsync(() => api.dashboard(), []);
  // URL para clientes (solo administradores): se avisa si está vacía o apunta al propio equipo.
  const clientUrl = useAsync(async () => (isAdmin ? api.settings.get().then((s) => s.public_url ?? '').catch(() => null) : null), [isAdmin]);
  const urlWarning = clientUrl.data !== null && clientUrl.data !== undefined && (!clientUrl.data.trim() || /\/\/(localhost|127\.|\[::1\])/i.test(clientUrl.data));
  const deviceStats = useAsync(async () => {
    try {
      return await api.devices.stats();
    } catch {
      return null;
    }
  }, []);

  useInterval(() => {
    void dash.reload(true);
    void deviceStats.reload(true);
  }, 30000);

  const check = useStreamCheck({
    initialRunning: dash.data?.stream_check?.running ?? false,
    onFinished: (h) => {
      const r = h.last_result;
      if (r) toast.success(`Revisión terminada: ${formatNumber(r.online)} en línea, ${formatNumber(r.offline)} con fallas`);
      void dash.reload(true);
    },
  });

  const data = dash.data;

  if (!data && dash.error) {
    return (
      <>
        <PageHeader title="Panel" />
        <ErrorState message={dash.error} onRetry={() => void dash.reload()} />
      </>
    );
  }

  const running = check.running || Boolean(data?.stream_check?.running);
  const progress = check.health?.progress ?? null;
  const lastResult = check.health?.last_result ?? data?.stream_check?.last_result ?? null;
  const health = data?.content_health;

  return (
    <>
      <PageHeader
        title="Panel"
        subtitle="Resumen del estado de la plataforma"
        actions={
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              void dash.reload(true);
              void deviceStats.reload(true);
            }}
            title="Actualizar"
          >
            <RefreshCw size={16} className={dash.loading ? 'spin' : ''} /> <span className="hide-mobile">Actualizar</span>
          </button>
        }
      />

      {isAdmin && urlWarning && (
        <div className="url-warning-strip">
          <Network size={16} />
          <span>
            {clientUrl.data?.trim() ? (
              <>
                La URL para clientes es <strong className="mono">{clientUrl.data}</strong>: solo funciona dentro del servidor.
              </>
            ) : (
              <>La URL para clientes no está configurada: los enlaces M3U y las apps podrían recibir una dirección local.</>
            )}
          </span>
          <Link to="/servidores/principal" className="outage-link">
            Revisar en Servidores → Servidor principal
          </Link>
        </div>
      )}

      {data && data.active_outages > 0 && (
        <div className="outage-strip">
          <ZapOff size={16} />
          <span>
            <strong>
              {formatNumber(data.active_outages)} {data.active_outages === 1 ? 'corte activo' : 'cortes activos'}
            </strong>{' '}
            en este momento. Los clientes afectados pueden ver interrumpido el servicio.
          </span>
          {isAdmin && (
            <Link to="/cortes" className="outage-link">
              Ver cortes
            </Link>
          )}
        </div>
      )}

      {isAdmin && serversData && servers.length > 0 && (
        <Link to="/servidores" className="streaming-strip">
          <span className="streaming-strip-title">
            <Server size={16} /> Servidores de streaming
          </span>
          <span className="summary-item">
            <span className={`status-dot dot-${servers.every((sv) => sv.status === 'online') ? 'green' : servers.some((sv) => sv.status === 'online') ? 'amber' : 'red'}`} />
            <span className="summary-value">{servers.filter((sv) => sv.status === 'online').length}</span>
            <span className="summary-label">/ {servers.length} en línea</span>
          </span>
          <span className="summary-item">
            <Users size={14} className="muted" />
            <span className="summary-value">{formatNumber(servers.reduce((n, sv) => n + (sv.clients ?? 0), 0))}</span>
            <span className="summary-label">clientes</span>
          </span>
          <span className="summary-item">
            <Radio size={14} className="text-green" />
            <span className="summary-value">{formatNumber(servers.reduce((n, sv) => n + (sv.streams_running ?? 0), 0))}</span>
            <span className="summary-label">canales emitiendo</span>
          </span>
          <ArrowRight size={16} className="streaming-strip-arrow" />
        </Link>
      )}

      {isAdmin && data?.updates && (
        <Link
          to="/version"
          className={`streaming-strip updates-strip ${data.updates.panel_update_available || data.updates.app_update_pending ? 'is-pending' : ''}`}
        >
          <span className="streaming-strip-title">
            <GitBranch size={16} /> Versión
          </span>
          <span className="summary-item">
            <span className="summary-value">Panel v{data.updates.version}</span>
            {data.updates.panel_update_available === true ? (
              <span className="badge badge-amber">Actualización disponible</span>
            ) : data.updates.panel_update_available === false ? (
              <span className="summary-label">· al día</span>
            ) : (
              <span className="summary-label">{data.updates.checked_at ? '· versión instalada desconocida' : '· sin revisar'}</span>
            )}
          </span>
          {data.updates.app_update_pending && data.updates.app_latest && (
            <span className="summary-item text-amber">
              <Smartphone size={14} /> App {data.updates.app_latest} en GitHub sin traer
            </span>
          )}
          <ArrowRight size={16} className="streaming-strip-arrow" />
        </Link>
      )}

      {isAdmin && data?.backups && (
        <Link to="/copias-de-seguridad" className={`streaming-strip backup-strip ${data.backups.last_status === 'error' ? 'is-error' : ''}`}>
          <span className="streaming-strip-title">
            <DatabaseBackup size={16} /> Copias de seguridad
          </span>
          <span className="summary-item">
            {data.backups.last_status === 'error' ? (
              <span className="text-red" title={data.backups.last_error ?? undefined}>
                Última copia con error{data.backups.last_at ? ` (${timeAgo(data.backups.last_at)})` : ''}
              </span>
            ) : (
              <>
                <span className="summary-label">Última correcta</span>
                <span className="summary-value">{data.backups.last_ok_at ? timeAgo(data.backups.last_ok_at) : 'nunca'}</span>
              </>
            )}
          </span>
          <span className="summary-item">
            <span className="summary-label">Próxima</span>
            <span className="summary-value">{data.backups.schedule_enabled && data.backups.next_run_at ? timeFromNow(data.backups.next_run_at) : 'sin programar'}</span>
          </span>
          <span className="summary-item">
            <Cloud size={14} className={data.backups.drive_connected ? 'text-green' : 'muted'} />
            <span className="summary-label">{data.backups.drive_connected ? 'Drive conectado' : 'Drive no conectado'}</span>
          </span>
          <ArrowRight size={16} className="streaming-strip-arrow" />
        </Link>
      )}

      <div className="dash-layout">
        {!data ? (
          <>
            <PanelSkeleton className="span-7" />
            <PanelSkeleton className="span-5" chart={false} lines={4} />
            <PanelSkeleton className="span-6" lines={5} />
            <PanelSkeleton className="span-6" lines={5} />
            {isAdmin && <PanelSkeleton className="span-12" lines={3} />}
            <PanelSkeleton className="span-6" chart={false} lines={5} />
            <PanelSkeleton className="span-6" chart={false} lines={6} />
          </>
        ) : (
          <>
            <ClientsPanel data={data} className="span-7" />
            <DevicesPanel data={data} stats={deviceStats.data ?? null} className="span-5" />
            <ContentHealthPanel
              className="span-6"
              type="live"
              counts={health?.live}
              offline={data.offline_streams ?? []}
              running={running}
              progress={progress}
              lastResult={lastResult}
              canCheck={isAdmin}
              starting={check.starting}
              onCheck={() => void check.startAll('live')}
            />
            <ContentHealthPanel
              className="span-6"
              type="movie"
              counts={health?.movie}
              offline={data.offline_streams ?? []}
              running={running}
              progress={progress}
              lastResult={lastResult}
              canCheck={isAdmin}
              starting={check.starting}
              onCheck={() => void check.startAll('movie')}
            />
            {isAdmin && <ServerPanel className="span-12" />}
            <ExpiringPanel className="span-6" users={data.expiring_soon ?? []} total={data.users.expiring_7d} />
            <ActivityPanel className="span-6" logs={data.recent_logs ?? []} isAdmin={isAdmin} />
          </>
        )}
      </div>
    </>
  );
}
