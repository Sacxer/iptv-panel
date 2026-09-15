import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, BellRing, Box, CircleOff, Clock, CopyCheck, Plus, RefreshCw, ScanSearch, Wifi, Layers } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { useInterval } from '../../hooks/useInterval';
import { DEVICES_CHANGED_EVENT, notifyDevicesChanged } from '../../components/DeviceIcon';
import { useToast } from '../../components/Toast';
import { PageHeader, Spinner, StatCard, Tabs } from '../../components/ui';
import type { Device } from '../../types';
import { formatDateTime, formatNumber, timeAgo } from '../../utils/format';
import { AlertsTab } from './AlertsTab';
import { AssignDeviceModal, DeviceDetailModal, DeviceFormModal } from './DeviceModals';
import { DevicesTab, EMPTY_FILTERS, type DeviceFilters } from './DevicesTab';
import { DuplicatesModal } from './DuplicatesModal';

type TabKey = 'dispositivos' | 'alertas';

export function DevicesPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab: TabKey = params.get('tab') === 'alertas' ? 'alertas' : 'dispositivos';
  const urlUserId = Number(params.get('user_id')) || null;

  const [filters, setFiltersState] = useState<DeviceFilters>(() => ({
    ...EMPTY_FILTERS,
    user_id: urlUserId,
    online: params.get('online') === '1',
  }));
  const [refreshKey, setRefreshKey] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [assigning, setAssigning] = useState<Device | null>(null);
  const [checking, setChecking] = useState(false);
  const [dupsOpen, setDupsOpen] = useState(false);

  const stats = useAsync(() => api.devices.stats(), []);
  // Duplicados y huérfanos (solo administradores): se refrescan junto con las estadísticas.
  const dups = useAsync(async () => (isAdmin ? api.devices.duplicates() : null), [isAdmin]);
  useInterval(() => {
    void stats.reload(true);
    if (isAdmin) void dups.reload(true);
  }, 60000);

  useEffect(() => {
    const handler = () => {
      void stats.reload(true);
      if (isAdmin) void dups.reload(true);
    };
    window.addEventListener(DEVICES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DEVICES_CHANGED_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Si cambia ?user_id= en la URL (p. ej. desde Clientes), se aplica el filtro.
  useEffect(() => {
    setFiltersState((f) => (f.user_id === urlUserId ? f : { ...f, user_id: urlUserId }));
  }, [urlUserId]);

  const clientName = useAsync(async () => {
    if (filters.user_id === null) return null;
    try {
      const u = await api.users.get(filters.user_id);
      return u.full_name ? `${u.username} · ${u.full_name}` : u.username;
    } catch {
      return null;
    }
  }, [filters.user_id]);

  const syncUrl = useCallback(
    (userId: number | null, nextTab: TabKey) => {
      const p = new URLSearchParams(params);
      if (userId === null) p.delete('user_id');
      else p.set('user_id', String(userId));
      p.delete('online');
      if (nextTab === 'alertas') p.set('tab', 'alertas');
      else p.delete('tab');
      if (p.toString() !== params.toString()) setParams(p, { replace: true });
    },
    [params, setParams],
  );

  const setFilters = (updater: (f: DeviceFilters) => DeviceFilters) => {
    const next = updater(filters);
    setFiltersState(next);
    if (next.user_id !== filters.user_id) syncUrl(next.user_id, tab);
  };

  const setTab = (t: TabKey) => syncUrl(filters.user_id, t);

  const quickFilter = (patch: Partial<DeviceFilters>) => {
    const next = { ...EMPTY_FILTERS, ...patch };
    setFiltersState(next);
    syncUrl(next.user_id, 'dispositivos');
  };

  const changed = () => {
    setRefreshKey((k) => k + 1);
    void stats.reload(true);
    if (isAdmin) void dups.reload(true);
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      const res = await api.devices.check();
      toast.success(
        `Revisión completada: ${formatNumber(res.inactive_found)} inactivo(s), ${formatNumber(res.alerts_created)} alerta(s) nueva(s).`,
      );
      notifyDevicesChanged();
      changed();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const s = stats.data;
  const inactiveDays = s?.settings?.device_inactive_days;
  const modalOpen = detailId !== null || formOpen || assigning !== null || dupsOpen;
  const dupCount = dups.data ? dups.data.duplicate_devices + dups.data.orphans : 0;

  return (
    <>
      <PageHeader
        title="Dispositivos"
        subtitle={
          <>
            Equipos de los clientes y TV Box de la empresa.{' '}
            {s && <span title={formatDateTime(s.last_check_at)}>Última revisión: {s.last_check_at ? timeAgo(s.last_check_at) : 'nunca'}.</span>}
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={changed} title="Actualizar">
              <RefreshCw size={16} />
            </button>
            {isAdmin && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-with-count"
                  onClick={() => setDupsOpen(true)}
                  title={dups.data ? `${formatNumber(dups.data.duplicate_devices)} repetidos · ${formatNumber(dups.data.orphans)} huérfanos` : undefined}
                >
                  <CopyCheck size={16} /> Revisar duplicados
                  {dupCount > 0 && <span className="btn-count">{formatNumber(dupCount)}</span>}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => void runCheck()} disabled={checking}>
                  {checking ? <Spinner size={14} /> : <ScanSearch size={16} />} Revisar ahora
                </button>
                <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
                  <Plus size={16} /> Registrar dispositivo
                </button>
              </>
            )}
          </>
        }
      />

      <div className="stat-grid stat-grid-compact">
        <StatCard label="En línea" value={formatNumber(s?.online)} icon={<Wifi size={20} />} tone="green" onClick={() => quickFilter({ online: true })} />
        <StatCard label="Total" value={formatNumber(s?.total)} icon={<Layers size={20} />} tone="blue" onClick={() => quickFilter({})} />
        <StatCard label="TV Box de la empresa" value={formatNumber(s?.company_tvbox)} icon={<Box size={20} />} tone="purple" onClick={() => quickFilter({ type: 'tvbox', ownership: 'company' })} />
        <StatCard label="En bodega" value={formatNumber(s?.in_stock)} icon={<Archive size={20} />} tone="orange" onClick={() => quickFilter({ inventory_status: 'available' })} />
        <StatCard label="Sin asignar" value={formatNumber(s?.unassigned)} icon={<CircleOff size={20} />} tone="gray" onClick={() => quickFilter({ unassigned: true })} />
        <StatCard
          label="Inactivos"
          value={formatNumber(s?.inactive)}
          hint={inactiveDays ? `+${inactiveDays} días sin conectarse` : undefined}
          icon={<Clock size={20} />}
          tone={s && s.inactive > 0 ? 'red' : 'gray'}
          onClick={() => quickFilter({ inactive: true })}
        />
        <StatCard
          label="Alertas abiertas"
          value={formatNumber(s?.open_alerts)}
          icon={<BellRing size={20} />}
          tone={s && s.open_alerts > 0 ? 'amber' : 'gray'}
          onClick={() => setTab('alertas')}
        />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'dispositivos', label: 'Dispositivos' },
          {
            value: 'alertas',
            label: (
              <>
                Alertas {s && <span className={`tab-count ${s.open_alerts > 0 ? 'tab-count-alert' : ''}`}>{formatNumber(s.open_alerts)}</span>}
              </>
            ),
          },
        ]}
      />
      <div className="mt">
        {tab === 'dispositivos' ? (
          <DevicesTab
            filters={filters}
            setFilters={setFilters}
            clientLabel={clientName.data ?? null}
            canEdit={isAdmin}
            paused={modalOpen}
            refreshKey={refreshKey}
            onDetail={setDetailId}
            onEdit={(d) => {
              setEditing(d);
              setFormOpen(true);
            }}
            onAssign={setAssigning}
            onBulkDone={changed}
          />
        ) : (
          <AlertsTab canEdit={isAdmin} refreshKey={refreshKey} onDetail={setDetailId} onChanged={changed} />
        )}
      </div>

      <DeviceDetailModal
        key={`${detailId ?? 'none'}-${refreshKey}`}
        deviceId={detailId}
        canEdit={isAdmin}
        onClose={() => setDetailId(null)}
        onEdit={(d) => {
          setDetailId(null);
          setEditing(d);
          setFormOpen(true);
        }}
        onAssign={(d) => {
          setDetailId(null);
          setAssigning(d);
        }}
      />
      <DeviceFormModal
        open={formOpen}
        device={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          changed();
        }}
      />
      {isAdmin && (
        <DuplicatesModal
          open={dupsOpen}
          data={dups.data}
          loading={dups.loading}
          error={dups.error}
          onReload={() => void dups.reload(true)}
          onClose={() => setDupsOpen(false)}
          onChanged={changed}
        />
      )}
      <AssignDeviceModal
        device={assigning}
        onClose={() => setAssigning(null)}
        onSaved={() => {
          setAssigning(null);
          changed();
        }}
      />
    </>
  );
}
