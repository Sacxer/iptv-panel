import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, CircleAlert, Link2, Link2Off, RefreshCw, ShieldBan } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { ErrorState, PageHeader, Spinner, Tabs } from '../../components/ui';
import { Skeleton } from '../../components/charts';
import { formatDateTime, formatNumber, timeAgo } from '../../utils/format';
import { CUT_MODE } from '../../utils/labels';
import type { BillingOverview } from '../../types';
import { BillingIntegrationTab, RunsHistory } from './BillingIntegrationTab';
import { ExternalClientsTab } from './ExternalClientsTab';
import { AutoSyncCard, CheckSuspendedButton } from './AutoSync';

type TabKey = 'clientes' | 'conexion' | 'historial';
const TABS: TabKey[] = ['clientes', 'conexion', 'historial'];

export function WisphubMigrationPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as TabKey | null;
  const tab: TabKey = raw && TABS.includes(raw) ? raw : 'clientes';
  const billing = useAsync(() => api.billing.get(), []);
  const o = billing.data;

  const setTab = (t: TabKey) => {
    const next = new URLSearchParams(params);
    if (t === 'clientes') next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true });
  };

  const setOverview = (next: BillingOverview) => billing.setData(next);

  return (
    <>
      <PageHeader
        title="Migración WispHub"
        subtitle="Clientes de WispHub, vinculación con las cuentas IPTV, conexión con la API e historial de sincronizaciones"
        actions={
          <>
            {o && <CheckSuspendedButton overview={o} onDone={() => void billing.reload(true)} />}
            <button type="button" className="btn btn-ghost" onClick={() => void billing.reload(true)} title="Actualizar">
              <RefreshCw size={16} />
            </button>
          </>
        }
      />

      <div className="summary-strip">
        {o ? (
          <>
            <div className="summary-item">
              <span className="summary-label">Modo de cortes</span>
              <Link to="/cortes?tab=modo" className="summary-value link">
                {CUT_MODE[o.cut_mode].label}
              </Link>
            </div>
            <div className="summary-item">
              <Link2 size={16} className="text-green" />
              <span className="summary-value">{formatNumber(o.counts.linked)}</span>
              <span className="summary-label">vinculados</span>
            </div>
            <div className="summary-item">
              <Link2Off size={16} className="text-amber" />
              <span className="summary-value">{formatNumber(o.counts.unlinked_external)}</span>
              <span className="summary-label">sin vincular</span>
            </div>
            <div className="summary-item">
              <ShieldBan size={16} className="text-red" />
              <span className="summary-value">{formatNumber(o.counts.suspended_by_external)}</span>
              <span className="summary-label">suspendidos por la plataforma</span>
            </div>
            <div className="summary-item">
              {o.running ? <Spinner size={14} /> : <CalendarClock size={16} className="muted" />}
              <span className="summary-label">{o.running ? 'Sincronizando…' : o.last_run?.finished_at ? 'Última sincronización' : 'Sin sincronizaciones'}</span>
              {!o.running && o.last_run?.finished_at && (
                <span className="summary-value" title={formatDateTime(o.last_run.finished_at)}>
                  {timeAgo(o.last_run.finished_at)}
                </span>
              )}
              <span className={`badge ${o.config.enabled ? 'badge-green' : 'badge-gray'}`}>{o.config.enabled ? 'Automática' : 'Apagada'}</span>
            </div>
            {o.last_run?.status === 'error' && (
              <div className="summary-item summary-error" title={o.last_run.error ?? undefined}>
                <CircleAlert size={15} />
                <span className="ellipsis">Última sincronización con error: {o.last_run.error ?? 'error desconocido'}</span>
              </div>
            )}
          </>
        ) : billing.error ? (
          <span className="text-red text-sm">{billing.error}</span>
        ) : (
          <>
            <Skeleton width={140} height={18} />
            <Skeleton width={110} height={18} />
            <Skeleton width={110} height={18} />
            <Skeleton width={180} height={18} />
          </>
        )}
      </div>

      {o?.auto_sync && <AutoSyncCard overview={o} onChanged={setOverview} />}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: 'clientes',
            label: (
              <>
                Clientes {o && o.counts.external_clients > 0 && <span className="tab-count">{formatNumber(o.counts.external_clients)}</span>}
              </>
            ),
          },
          { value: 'conexion', label: 'Conexión' },
          { value: 'historial', label: 'Historial' },
        ]}
      />
      <div className="mt">
        {tab === 'historial' ? (
          <RunsHistory />
        ) : !o ? (
          billing.error ? <ErrorState message={billing.error} onRetry={() => void billing.reload()} /> : <Spinner label="Cargando…" />
        ) : tab === 'conexion' ? (
          <BillingIntegrationTab overview={o} onChanged={setOverview} />
        ) : (
          <ExternalClientsTab overview={o} onChanged={() => void billing.reload(true)} />
        )}
      </div>
    </>
  );
}
