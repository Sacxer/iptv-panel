import { Navigate, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { ErrorState, PageHeader, Spinner, Tabs } from '../../components/ui';
import type { BillingOverview } from '../../types';
import { CutModeTab } from './CutModeTab';
import { ScheduledOutagesTab } from './ScheduledOutagesTab';

type TabKey = 'programados' | 'modo';

/** Pestañas antiguas de Cortes que ahora viven en Migración WispHub. */
const MOVED: Record<string, string> = {
  integracion: '/migracion-wisphub?tab=conexion',
  clientes: '/migracion-wisphub',
  historial: '/migracion-wisphub?tab=historial',
};

export function OutagesPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabKey = raw === 'modo' ? 'modo' : 'programados';
  const billing = useAsync(async () => (tab === 'modo' ? api.billing.get() : null), [tab]);
  const o = billing.data;

  if (raw && MOVED[raw]) return <Navigate to={MOVED[raw]} replace />;

  const setTab = (t: TabKey) => {
    const next = new URLSearchParams(params);
    if (t === 'programados') next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true });
  };

  const setOverview = (next: BillingOverview) => billing.setData(next);

  return (
    <>
      <PageHeader
        title="Cortes"
        subtitle="Cortes programados del servicio y modo de cortes por falta de pago"
        actions={
          tab === 'modo' ? (
            <button type="button" className="btn btn-ghost" onClick={() => void billing.reload(true)} title="Actualizar">
              <RefreshCw size={16} />
            </button>
          ) : undefined
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'programados', label: 'Cortes programados' },
          { value: 'modo', label: 'Modo de cortes' },
        ]}
      />
      <div className="mt">
        {tab === 'programados' ? (
          <ScheduledOutagesTab />
        ) : !o ? (
          billing.error ? <ErrorState message={billing.error} onRetry={() => void billing.reload()} /> : <Spinner label="Cargando…" />
        ) : (
          <CutModeTab overview={o} onChanged={setOverview} />
        )}
      </div>
    </>
  );
}
