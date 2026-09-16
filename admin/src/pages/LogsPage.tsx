import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useAsync } from '../hooks/useAsync';
import { DataTable } from '../components/DataTable';
import { Badge, PageHeader } from '../components/ui';
import type { LogEntry } from '../types';
import { formatDateTime, logDetails, truncate } from '../utils/format';
import { LOG_ACTION_LABEL } from '../utils/labels';

function actionTone(action: string) {
  const a = action.toLowerCase();
  if (a.includes('delete') || a.includes('elimin') || a.includes('suspend')) return 'red' as const;
  if (a.includes('create') || a.includes('crear') || a.includes('reactivate')) return 'green' as const;
  if (a.includes('login')) return 'blue' as const;
  if (a.endsWith('_follow')) return 'amber' as const;
  if (a.includes('migrat') || a.includes('xtream') || a.includes('import')) return 'purple' as const;
  return 'gray' as const;
}

export function LogsPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const list = useAsync(() => api.logs.list(page, limit), [page, limit]);

  return (
    <>
      <PageHeader
        title="Registro de actividad"
        subtitle="Acciones realizadas por administradores y revendedores"
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => void list.reload()}>
            <RefreshCw size={16} /> Actualizar
          </button>
        }
      />
      <DataTable<LogEntry>
        rows={list.data?.data ?? []}
        rowKey={(l) => l.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        emptyTitle="Sin actividad registrada"
        pagination={{
          page,
          limit,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
          onLimitChange: (l) => {
            setLimit(l);
            setPage(1);
          },
        }}
        columns={[
          { key: 'date', header: 'Fecha', render: (l) => <span className="nowrap">{formatDateTime(l.created_at)}</span> },
          { key: 'admin', header: 'Cuenta', render: (l) => <span className="strong">{l.admin_username ?? 'Sistema'}</span> },
          {
            key: 'action',
            header: 'Acción',
            render: (l) => {
              const label = LOG_ACTION_LABEL[l.action ?? ''];
              return (
                <div className="cell-main">
                  <span>
                    <Badge tone={actionTone(l.action ?? '')}>{l.action}</Badge>
                  </span>
                  {label && <span className="muted text-xs">{label}</span>}
                </div>
              );
            },
          },
          {
            key: 'entity',
            header: 'Entidad',
            render: (l) =>
              l.entity ? (
                <span>
                  {l.entity}
                  {l.entity_id !== null && l.entity_id !== undefined && <span className="muted"> #{l.entity_id}</span>}
                </span>
              ) : (
                <span className="muted">—</span>
              ),
          },
          {
            key: 'details',
            header: 'Detalles',
            hideOnMobile: true,
            render: (l) => {
              const d = logDetails(l.details);
              return d ? (
                <span className="muted text-sm mono-soft" title={d}>
                  {truncate(d, 110)}
                </span>
              ) : (
                <span className="muted">—</span>
              );
            },
          },
        ]}
      />
    </>
  );
}
