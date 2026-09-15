import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, UserRoundCheck } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { DataTable } from '../../components/DataTable';
import { notifyDevicesChanged } from '../../components/DeviceIcon';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Badge, ChipGroup } from '../../components/ui';
import type { DeviceAlert, DeviceAlertStatus, DeviceAlertType } from '../../types';
import { formatDateTime, timeAgo } from '../../utils/format';
import { DEVICE_ALERT } from '../../utils/labels';
import { AlertTypeIcon } from './AlertTypeIcon';
import { ResolveAlertModal } from './DeviceModals';

interface Props {
  canEdit: boolean;
  refreshKey: number;
  onDetail: (deviceId: number) => void;
  onChanged: () => void;
}

export function AlertsTab({ canEdit, refreshKey, onDetail, onChanged }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<DeviceAlertStatus | 'all'>('open');
  const [type, setType] = useState<DeviceAlertType | ''>('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [resolving, setResolving] = useState<DeviceAlert | null>(null);

  useEffect(() => setPage(1), [status, type, limit]);

  const list = useAsync(() => api.devices.alerts({ status, type, page, limit }), [status, type, page, limit]);

  useEffect(() => {
    if (refreshKey > 0) void list.reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const confirmAssign = async (a: DeviceAlert) => {
    if (a.user_id === null) return;
    const ok = await confirm({
      title: 'Confirmar y asignar',
      message: (
        <>
          Se asignará <strong>{a.device_name}</strong> al cliente <strong>{a.username}</strong> y se cerrará la alerta.
        </>
      ),
      confirmText: 'Asignar',
    });
    if (!ok) return;
    try {
      await api.devices.assign(a.device_id, a.user_id);
      toast.success(`Dispositivo asignado a ${a.username ?? 'el cliente'}`);
      notifyDevicesChanged();
      onChanged();
      void list.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <div className="toolbar toolbar-chips">
        <ChipGroup
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Abiertas' },
            { value: 'resolved', label: 'Resueltas' },
            { value: 'all', label: 'Todas' },
          ]}
        />
        <ChipGroup
          value={type}
          onChange={setType}
          options={[
            { value: '', label: 'Todos los tipos' },
            ...(Object.keys(DEVICE_ALERT) as DeviceAlertType[]).map((t) => ({ value: t, label: DEVICE_ALERT[t].label })),
          ]}
        />
      </div>
      <DataTable<DeviceAlert>
        rows={list.data?.data ?? []}
        rowKey={(a) => a.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        emptyTitle={status === 'open' ? 'No hay alertas abiertas' : 'No hay alertas'}
        rowClassName={(a) => (a.status === 'resolved' ? 'row-muted' : '')}
        pagination={{ page, limit, total: list.data?.total ?? 0, onPageChange: setPage, onLimitChange: setLimit }}
        columns={[
          {
            key: 'type',
            header: 'Tipo',
            render: (a) => (
              <span className="row-inline nowrap">
                <AlertTypeIcon type={a.type} />
                <span className="hide-mobile">{DEVICE_ALERT[a.type]?.label ?? a.type}</span>
              </span>
            ),
          },
          {
            key: 'message',
            header: 'Alerta',
            className: 'col-message',
            render: (a) => (
              <div className="cell-main">
                <span className="text-sm">{a.message}</span>
                {a.status === 'resolved' && (
                  <span className="text-xs text-green">
                    Resuelta {formatDateTime(a.resolved_at)}
                    {a.resolution ? `: ${a.resolution}` : ''}
                  </span>
                )}
              </div>
            ),
          },
          {
            key: 'device',
            header: 'Dispositivo',
            render: (a) => (
              <button type="button" className="btn btn-link btn-sm" onClick={() => onDetail(a.device_id)}>
                {a.device_name || `#${a.device_id}`}
              </button>
            ),
          },
          {
            key: 'client',
            header: 'Cliente',
            hideOnMobile: true,
            render: (a) =>
              a.username ? (
                <Link className="link" to={`/clientes?search=${encodeURIComponent(a.username)}`}>
                  {a.username}
                </Link>
              ) : (
                <span className="muted">—</span>
              ),
          },
          {
            key: 'date',
            header: 'Fecha',
            render: (a) => (
              <div className="cell-main">
                <span className="nowrap">{formatDateTime(a.created_at)}</span>
                <span className="muted text-xs">{timeAgo(a.created_at)}</span>
              </div>
            ),
          },
          {
            key: 'status',
            header: 'Estado',
            hideOnMobile: true,
            render: (a) => <Badge tone={a.status === 'open' ? 'red' : 'green'}>{a.status === 'open' ? 'Abierta' : 'Resuelta'}</Badge>,
          },
          ...(canEdit
            ? [
                {
                  key: 'actions',
                  header: '',
                  className: 'col-actions',
                  render: (a: DeviceAlert) =>
                    a.status === 'open' ? (
                      <div className="row-actions">
                        {a.type === 'new_tvbox' && a.user_id !== null && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void confirmAssign(a)}>
                            <UserRoundCheck size={14} /> Confirmar y asignar
                          </button>
                        )}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResolving(a)}>
                          <CircleCheck size={14} /> Resolver
                        </button>
                      </div>
                    ) : null,
                },
              ]
            : []),
        ]}
      />
      <ResolveAlertModal
        alert={resolving}
        onClose={() => setResolving(null)}
        onSaved={() => {
          setResolving(null);
          onChanged();
          void list.reload(true);
        }}
      />
    </>
  );
}
