import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellOff, Building2, Combine, Eye, Pencil, Search, SearchCheck, Shapes, Trash2, UserMinus, UserRoundPlus, Archive, X } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useInterval } from '../../hooks/useInterval';
import { ActionMenu } from '../../components/ActionMenu';
import { BulkBar, DataTable, type Column } from '../../components/DataTable';
import { DeviceIcon, notifyDevicesChanged } from '../../components/DeviceIcon';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Badge, ChipGroup, Select, Spinner } from '../../components/ui';
import type { Device, DeviceBulkAction, DeviceFilterParams, DeviceInventoryStatus, DeviceOwnership, DeviceSource, DeviceType } from '../../types';
import { formatNumber, timeAgo, truncate } from '../../utils/format';
import { DEVICE_ACTIVITY_LABEL, DEVICE_INVENTORY, DEVICE_OWNERSHIP, DEVICE_SOURCE_LABEL, DEVICE_TYPE_LABEL } from '../../utils/labels';
import { MergeDevicesModal } from './DuplicatesModal';
import { DeviceBulkModal, type DeviceSelectionTarget } from './DeviceBulkActions';

export interface DeviceFilters {
  search: string;
  type: DeviceType | '';
  ownership: DeviceOwnership | '';
  inventory_status: DeviceInventoryStatus | '';
  source: DeviceSource | '';
  online: boolean;
  inactive: boolean;
  with_alerts: boolean;
  unassigned: boolean;
  user_id: number | null;
}

export const EMPTY_FILTERS: DeviceFilters = {
  search: '',
  type: '',
  ownership: '',
  inventory_status: '',
  source: '',
  online: false,
  inactive: false,
  with_alerts: false,
  unassigned: false,
  user_id: null,
};

const TYPE_CHIPS: { value: DeviceType | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  ...(Object.keys(DEVICE_TYPE_LABEL) as DeviceType[]).map((t) => ({ value: t, label: DEVICE_TYPE_LABEL[t] })),
];

const REFRESH_MS = 30000;

const PAGE_SIZES = [25, 50, 100, 200, 500];
const PAGE_SIZE_KEY = 'iptv_devices_page_size';
/** Máximo de dispositivos para «Fusionar en uno…». */
const MERGE_MAX = 50;
/** Máximo que procesa el servidor en una selección por filtro. */
const MAX_SELECTION = 50000;

function readPageSize(): number {
  try {
    const v = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return PAGE_SIZES.includes(v) ? v : 50;
  } catch {
    return 50;
  }
}

function savePageSize(n: number) {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(n));
  } catch {
    /* sin almacenamiento local: solo dura esta visita */
  }
}

interface Props {
  filters: DeviceFilters;
  setFilters: (updater: (f: DeviceFilters) => DeviceFilters) => void;
  clientLabel: string | null;
  canEdit: boolean;
  paused: boolean;
  refreshKey: number;
  onDetail: (id: number) => void;
  onEdit: (d: Device) => void;
  onAssign: (d: Device) => void;
  /** Tras una acción en lote o una fusión (refresca estadísticas y duplicados). */
  onBulkDone: () => void;
}

export function DevicesTab({ filters, setFilters, clientLabel, canEdit, paused, refreshKey, onDetail, onEdit, onAssign, onBulkDone }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [limit, setLimitState] = useState(readPageSize);
  const [sort, setSort] = useState<{ key: string; order: 'asc' | 'desc' }>({ key: 'last_seen_at', order: 'desc' });
  const search = useDebounce(filters.search);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /** Dispositivos marcados (se conservan aunque cambie la página). */
  const [selectedRows, setSelectedRows] = useState<Map<number, Device>>(new Map());
  const [merging, setMerging] = useState<Device[] | null>(null);
  /** Modo «todos los que coinciden»: se guarda la foto de los filtros y se envía `filter` al servidor. */
  const [allMatching, setAllMatching] = useState<{ filter: DeviceFilterParams; key: string; total: number; truncated: boolean } | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [bulkAction, setBulkAction] = useState<DeviceBulkAction | null>(null);

  const setLimit = (n: number) => {
    setLimitState(n);
    savePageSize(n);
  };

  const { search: _s, ...rest } = filters;
  void _s;
  const filterKey = JSON.stringify(rest);

  useEffect(() => setPage(1), [search, filterKey, limit]);

  /** Filtros vigentes (solo los que tienen valor): los mismos para el listado, /devices/ids y /devices/bulk. */
  const filterSnapshot = useMemo((): DeviceFilterParams => {
    const f: DeviceFilterParams = {};
    if (search.trim()) f.search = search.trim();
    if (filters.type) f.type = filters.type;
    if (filters.ownership) f.ownership = filters.ownership;
    if (filters.inventory_status) f.inventory_status = filters.inventory_status;
    if (filters.source) f.source = filters.source;
    if (filters.user_id !== null) f.user_id = filters.user_id;
    if (filters.online) f.online = true;
    if (filters.inactive) f.inactive = true;
    if (filters.with_alerts) f.with_alerts = true;
    if (filters.unassigned) f.unassigned = true;
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterKey]);
  const snapshotKey = JSON.stringify(filterSnapshot);

  const list = useAsync(
    () =>
      api.devices.list({
        ...filterSnapshot,
        sort: sort.key as 'last_seen_at' | 'created_at' | 'type',
        order: sort.order,
        page,
        limit,
      }),
    [snapshotKey, sort.key, sort.order, page, limit],
  );

  useEffect(() => {
    if (refreshKey > 0) void list.reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useInterval(() => void list.reload(true), paused || merging !== null || bulkAction !== null ? null : REFRESH_MS);

  const changeSelection = (next: Set<number>) => {
    const rows = list.data?.data ?? [];
    // Al desmarcar algo en el modo «todos los que coinciden» se vuelve a la selección de esta página.
    if (allMatching) setAllMatching(null);
    setSelected(next);
    setSelectedRows((prev) => {
      const m = new Map<number, Device>();
      next.forEach((id) => {
        const d = rows.find((r) => r.id === id) ?? prev.get(id);
        if (d) m.set(id, d);
      });
      return m;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setSelectedRows(new Map());
    setAllMatching(null);
  };

  // Si cambian los filtros o la búsqueda en el modo «todos los que coinciden», la selección deja de ser válida.
  useEffect(() => {
    if (allMatching && allMatching.key !== snapshotKey) clearSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotKey]);

  const selectAllMatching = async () => {
    setLoadingAll(true);
    try {
      const res = await api.devices.ids(filterSnapshot);
      setSelected(new Set());
      setSelectedRows(new Map());
      setAllMatching({ filter: filterSnapshot, key: snapshotKey, total: res.total, truncated: res.truncated });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingAll(false);
    }
  };

  const bulkDone = () => {
    setBulkAction(null);
    clearSelection();
    notifyDevicesChanged();
    void list.reload(true);
    onBulkDone();
  };

  const set = <K extends keyof DeviceFilters>(k: K, v: DeviceFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const setInventory = async (d: Device, status: DeviceInventoryStatus, label: string) => {
    if (status === 'retired') {
      const ok = await confirm({
        title: 'Retirar dispositivo',
        message: (
          <>
            ¿Marcar <strong>{d.display_name}</strong> como retirado? Seguirá en el historial pero fuera del inventario activo.
          </>
        ),
        confirmText: 'Retirar',
      });
      if (!ok) return;
    }
    try {
      await api.devices.update(d.id, { inventory_status: status });
      toast.success(label);
      notifyDevicesChanged();
      void list.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (d: Device) => {
    const ok = await confirm({
      title: 'Eliminar dispositivo',
      message: (
        <>
          ¿Eliminar <strong>{d.display_name}</strong> y su historial de alertas? Si vuelve a conectarse se registrará de nuevo como
          detectado.
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.devices.remove(d.id);
      toast.success('Dispositivo eliminado');
      notifyDevicesChanged();
      void list.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<Device>[] = [
    {
      key: 'type',
      header: '',
      className: 'col-device',
      sortKey: 'type',
      render: (d) => <DeviceIcon type={d.type} online={d.online} />,
    },
    {
      key: 'name',
      header: 'Dispositivo',
      render: (d) => (
        <button type="button" className="cell-main cell-button" onClick={() => onDetail(d.id)}>
          <span className="strong">{d.display_name || `#${d.id}`}</span>
          <span className="muted text-xs">
            {[d.type_label || DEVICE_TYPE_LABEL[d.type], d.brand, d.model, d.os].filter(Boolean).join(' · ')}
          </span>
        </button>
      ),
    },
    { key: 'app', header: 'App', hideOnMobile: true, render: (d) => (d.app ? truncate(d.app, 24) : <span className="muted">—</span>) },
    {
      key: 'client',
      header: 'Cliente',
      render: (d) =>
        d.user_id !== null ? (
          <div className="cell-main">
            <Link className="link strong" to={`/clientes?search=${encodeURIComponent(d.username ?? '')}`}>
              {d.username}
            </Link>
            {d.client_name && <span className="muted text-xs">{d.client_name}</span>}
            {d.last_username && d.username && d.last_username !== d.username && (
              <span className="text-red text-xs">Usado por {d.last_username}</span>
            )}
          </div>
        ) : (
          <span className="muted">Sin asignar</span>
        ),
    },
    {
      key: 'status',
      header: 'Propiedad / inventario',
      hideOnMobile: true,
      render: (d) => (
        <div className="badge-stack">
          <Badge tone={DEVICE_OWNERSHIP[d.ownership]?.tone ?? 'gray'}>{DEVICE_OWNERSHIP[d.ownership]?.label ?? d.ownership}</Badge>
          <Badge tone={DEVICE_INVENTORY[d.inventory_status]?.tone ?? 'gray'}>
            {DEVICE_INVENTORY[d.inventory_status]?.label ?? d.inventory_status}
          </Badge>
        </div>
      ),
    },
    {
      key: 'last_seen_at',
      header: 'Última conexión',
      sortKey: 'last_seen_at',
      render: (d) => (
        <div className="cell-main">
          <span className={d.inactive ? 'text-red strong' : d.online ? 'text-green' : ''}>{timeAgo(d.last_seen_at)}</span>
          <span className="muted text-xs">
            {d.last_activity ? DEVICE_ACTIVITY_LABEL[d.last_activity] ?? d.last_activity : '—'}
            {d.last_ip ? ` · ${d.last_ip}` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'alerts',
      header: 'Alertas',
      render: (d) => (d.open_alerts > 0 ? <Badge tone="red">{d.open_alerts}</Badge> : <span className="muted">—</span>),
    },
    {
      key: 'actions',
      header: '',
      className: 'col-actions',
      render: (d) => (
        <div className="row-actions">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Ver detalle" onClick={() => onDetail(d.id)}>
            <Eye size={15} />
          </button>
          {canEdit && (
            <ActionMenu
              items={[
                { label: 'Ver detalle', icon: <Eye size={15} />, onClick: () => onDetail(d.id) },
                { label: 'Editar', icon: <Pencil size={15} />, onClick: () => onEdit(d) },
                { label: 'Asignar a cliente', icon: <UserRoundPlus size={15} />, onClick: () => onAssign(d) },
                {
                  label: 'Marcar en revisión',
                  icon: <SearchCheck size={15} />,
                  onClick: () => void setInventory(d, 'review', 'Marcado en revisión'),
                  hidden: d.inventory_status === 'review',
                  divider: true,
                },
                {
                  label: 'Retirar',
                  icon: <Archive size={15} />,
                  onClick: () => void setInventory(d, 'retired', 'Dispositivo retirado'),
                  hidden: d.inventory_status === 'retired',
                },
                { label: 'Eliminar', icon: <Trash2 size={15} />, onClick: () => void remove(d), danger: true, divider: true },
              ]}
            />
          )}
        </div>
      ),
    },
  ];

  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  const pageRows = list.data?.data ?? [];
  const total = list.data?.total ?? 0;
  const tableSelected = useMemo(() => (allMatching ? new Set(pageRows.map((r) => r.id)) : selected), [allMatching, pageRows, selected]);
  const allCount = allMatching ? Math.min(allMatching.total, MAX_SELECTION) : 0;
  const selectionCount = allMatching ? allCount : selected.size;
  const pageAllSelected = !allMatching && pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const otherPages = pageAllSelected ? selected.size - pageRows.length : 0;
  const target: DeviceSelectionTarget | null = allMatching
    ? { mode: 'filter', filter: allMatching.filter, total: allCount }
    : selected.size > 0
      ? { mode: 'ids', ids: [...selected] }
      : null;
  const mergeTitle = allMatching
    ? 'No disponible al seleccionar todos los que coinciden: marca entre 2 y 50 dispositivos'
    : selectedRows.size < 2
      ? 'Selecciona al menos 2 dispositivos'
      : selectedRows.size > MERGE_MAX
        ? `Máximo ${MERGE_MAX} dispositivos para fusionar`
        : undefined;

  return (
    <>
      <div className="toolbar">
        <div className="input-icon toolbar-search">
          <Search size={16} />
          <input
            className="input"
            placeholder="Buscar por nombre, modelo, MAC, serial o IP…"
            value={filters.search}
            onChange={(e) => set('search', e.target.value)}
          />
        </div>
        <Select
          value={filters.ownership}
          onChange={(v) => set('ownership', v as DeviceOwnership | '')}
          placeholder="Toda propiedad"
          options={(Object.keys(DEVICE_OWNERSHIP) as DeviceOwnership[]).map((o) => ({ value: o, label: DEVICE_OWNERSHIP[o].label }))}
          ariaLabel="Propiedad"
        />
        <Select
          value={filters.inventory_status}
          onChange={(v) => set('inventory_status', v as DeviceInventoryStatus | '')}
          placeholder="Todo inventario"
          options={(Object.keys(DEVICE_INVENTORY) as DeviceInventoryStatus[]).map((s) => ({ value: s, label: DEVICE_INVENTORY[s].label }))}
          ariaLabel="Estado de inventario"
        />
        <Select
          value={filters.source}
          onChange={(v) => set('source', v as DeviceSource | '')}
          placeholder="Todo origen"
          options={(Object.keys(DEVICE_SOURCE_LABEL) as DeviceSource[]).map((s) => ({ value: s, label: DEVICE_SOURCE_LABEL[s] }))}
          ariaLabel="Origen"
        />
      </div>
      <ChipGroup value={filters.type} onChange={(v) => set('type', v)} options={TYPE_CHIPS} />
      <div className="chips">
        {(
          [
            ['online', 'En línea'],
            ['inactive', 'Inactivos'],
            ['with_alerts', 'Con alertas'],
            ['unassigned', 'Sin asignar'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`chip chip-toggle ${filters[key] ? 'chip-active' : ''}`}
            aria-pressed={filters[key]}
            onClick={() => set(key, !filters[key])}
          >
            {label}
          </button>
        ))}
        {filters.user_id !== null && (
          <span className="chip chip-active">
            Cliente: {clientLabel ?? `#${filters.user_id}`}
            <button type="button" className="chip-remove" aria-label="Quitar filtro de cliente" onClick={() => set('user_id', null)}>
              <X size={12} />
            </button>
          </span>
        )}
        {hasFilters && (
          <button type="button" className="btn btn-link btn-sm" onClick={() => setFilters(() => EMPTY_FILTERS)}>
            Limpiar filtros
          </button>
        )}
        <label className="page-size">
          Mostrar
          <select className="input select input-sm" value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Dispositivos por página">
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          por página
        </label>
      </div>

      {canEdit && (
        <BulkBar count={selectionCount} onClear={clearSelection} className="bulk-bar-icons">
          <button type="button" className="btn btn-secondary btn-sm" title="Cambiar propiedad" onClick={() => setBulkAction('set_ownership')}>
            <Building2 size={14} /> <span className="btn-label">Cambiar propiedad</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" title="Estado de inventario" onClick={() => setBulkAction('set_inventory')}>
            <Archive size={14} /> <span className="btn-label">Estado de inventario</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" title="Cambiar tipo" onClick={() => setBulkAction('set_type')}>
            <Shapes size={14} /> <span className="btn-label">Cambiar tipo</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" title="Quitar asignación" onClick={() => setBulkAction('unassign')}>
            <UserMinus size={14} /> <span className="btn-label">Quitar asignación</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" title="Resolver alertas" onClick={() => setBulkAction('resolve_alerts')}>
            <BellOff size={14} /> <span className="btn-label">Resolver alertas</span>
          </button>
          <span className="bulk-tip" title={mergeTitle ?? 'Fusionar en uno…'}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              aria-label="Fusionar en uno…"
              disabled={mergeTitle !== undefined}
              onClick={() => setMerging([...selectedRows.values()])}
            >
              <Combine size={14} /> <span className="btn-label">Fusionar en uno…</span>
            </button>
          </span>
          <button type="button" className="btn btn-danger-ghost btn-sm" title="Eliminar" onClick={() => setBulkAction('delete')}>
            <Trash2 size={14} /> <span className="btn-label">Eliminar</span>
          </button>
        </BulkBar>
      )}
      {canEdit && allMatching && (
        <div className="select-banner" role="status">
          <span>
            {allMatching.truncated ? (
              <>
                Están seleccionados los primeros <strong>{formatNumber(allCount)}</strong> de {formatNumber(allMatching.total)} dispositivos que coinciden
                con los filtros (máximo por operación).
              </>
            ) : (
              <>
                Están seleccionados los <strong>{formatNumber(allCount)}</strong> dispositivos {hasFilters ? 'que coinciden con los filtros' : 'registrados'}.
              </>
            )}
          </span>
          <button type="button" className="btn btn-link btn-sm" onClick={clearSelection}>
            Borrar selección
          </button>
        </div>
      )}
      {canEdit && pageAllSelected && total > pageRows.length && (
        <div className="select-banner" role="status">
          <span>
            Se seleccionaron los <strong>{formatNumber(pageRows.length)}</strong> dispositivos de esta página
            {otherPages > 0 ? ` y ${formatNumber(otherPages)} de otras páginas` : ''}.
          </span>
          <button type="button" className="btn btn-link btn-sm" onClick={() => void selectAllMatching()} disabled={loadingAll}>
            {loadingAll && <Spinner size={13} />} Seleccionar los {formatNumber(total)} {hasFilters ? 'que coinciden con los filtros' : 'dispositivos'}
          </button>
        </div>
      )}
      <DataTable<Device>
        columns={columns}
        selectable={canEdit}
        selected={tableSelected}
        onSelectedChange={changeSelection}
        rows={list.data?.data ?? []}
        rowKey={(d) => d.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        sort={sort}
        onSortChange={(key, order) => setSort({ key, order })}
        rowClassName={(d) => (d.open_alerts > 0 ? 'row-danger' : d.inventory_status === 'retired' ? 'row-muted' : '')}
        emptyTitle={hasFilters ? 'Ningún dispositivo coincide con los filtros' : 'Aún no hay dispositivos'}
        emptyDescription={
          hasFilters ? undefined : 'Los equipos aparecen solos cuando los clientes se conectan. También puedes registrar los TV Box de la empresa.'
        }
        pagination={{ page, limit, total, onPageChange: setPage, onLimitChange: setLimit, limits: PAGE_SIZES }}
      />
      <MergeDevicesModal
        devices={merging}
        onClose={() => setMerging(null)}
        onMerged={() => {
          setMerging(null);
          clearSelection();
          void list.reload(true);
          onBulkDone();
        }}
      />
      <DeviceBulkModal action={bulkAction} target={target} count={selectionCount} onClose={() => setBulkAction(null)} onDone={bulkDone} />
    </>
  );
}
