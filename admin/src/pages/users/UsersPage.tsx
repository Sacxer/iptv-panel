import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  MonitorSmartphone,
  Ban,
  CalendarPlus,
  KeyRound,
  MonitorPlay,
  Package as PackageIcon,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useAdmins, usePackages } from '../../hooks/useResources';
import { ActionMenu } from '../../components/ActionMenu';
import { ExternalLinkBadge } from '../../components/ExternalStatus';
import { billingConfigured, CheckSuspendedButton, useUserRefresh } from '../wisphub/AutoSync';
import { BulkBar, DataTable, type Column } from '../../components/DataTable';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { SourceBadge, StatusBadge } from '../../components/StatusBadge';
import { Badge, ChipGroup, PageHeader, Select } from '../../components/ui';
import type { TimeUnit, User, UserBulkInput, UserSource, UserStatusFilter } from '../../types';
import { daysUntil, formatDate, formatDateTime, formatNumber, relativeExpiry } from '../../utils/format';
import { contentSectionsText } from '../../utils/labels';
import {
  AssignPackagesModal,
  ClientDevicesModal,
  ContentSectionsModal,
  ExtendModal,
  SuspendModal,
  UserAccessModal,
  UserConnectionsModal,
} from './UserActionModals';
import { UserFormModal } from './UserFormModal';

type SortKey = 'created_at' | 'exp_date' | 'username';
type StatusChip = UserStatusFilter | '';

const STATUS_CHIPS: { value: StatusChip; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'expiring', label: 'Vencen pronto' },
  { value: 'expired', label: 'Vencidos' },
  { value: 'suspended', label: 'Suspendidos' },
  { value: 'disabled', label: 'Deshabilitados' },
  { value: 'trial', label: 'Prueba' },
];

const VALID_STATUS = new Set<string>(STATUS_CHIPS.map((c) => c.value));

type Target = { kind: 'single'; user: User } | { kind: 'bulk'; ids: number[] };

export function UsersPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();

  const initialStatus = params.get('status') ?? '';
  const [status, setStatus] = useState<StatusChip>(VALID_STATUS.has(initialStatus) ? (initialStatus as StatusChip) : '');
  const [search, setSearch] = useState(() => params.get('search') ?? '');
  const [packageId, setPackageId] = useState('');
  const [source, setSource] = useState<UserSource | ''>('');
  const [ownerId, setOwnerId] = useState('');
  const [external, setExternal] = useState<'' | 'linked' | 'unlinked'>('');
  const [suspensionSource, setSuspensionSource] = useState<'' | 'manual' | 'external'>('');
  const [sort, setSort] = useState<{ key: SortKey; order: 'asc' | 'desc' }>({ key: 'created_at', order: 'desc' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const debouncedSearch = useDebounce(search);

  const { packages, byId: packageById, loading: packagesLoading } = usePackages();
  const { admins } = useAdmins(isAdmin);
  // Modo de cortes y plataforma (solo administradores pueden consultarlo).
  const billing = useAsync(async () => (isAdmin ? api.billing.get().catch(() => null) : null), [isAdmin]);
  const cutMode = billing.data?.cut_mode ?? null;
  const platformName = billing.data?.config.provider === 'custom' ? 'la plataforma' : 'WispHub';
  const lockedByPlatform = (u: User) => cutMode === 'external' && Boolean(u.external_id);
  const lockedTitle = `Modo de cortes «Plataforma externa»: este cliente está vinculado y solo ${platformName} puede suspenderlo o reactivarlo.`;

  // Mantener el filtro de estado en la URL (permite enlazar desde el panel).
  useEffect(() => {
    const current = params.get('status') ?? '';
    if (current !== status) {
      const next = new URLSearchParams(params);
      if (status) next.set('status', status);
      else next.delete('status');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, packageId, source, ownerId, external, suspensionSource, limit]);

  const list = useAsync(
    () =>
      api.users.list({
        search: debouncedSearch.trim(),
        status,
        package_id: packageId ? Number(packageId) : '',
        source,
        owner_id: ownerId ? Number(ownerId) : '',
        external,
        suspension_source: suspensionSource,
        sort: sort.key,
        order: sort.order,
        page,
        limit,
      }),
    [debouncedSearch, status, packageId, source, ownerId, external, suspensionSource, sort.key, sort.order, page, limit],
  );
  const rows = list.data?.data ?? [];
  const total = list.data?.total ?? 0;

  // Modales
  const [formUser, setFormUser] = useState<User | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [accessUser, setAccessUser] = useState<User | null>(null);
  const [connUser, setConnUser] = useState<User | null>(null);
  const [devicesUser, setDevicesUser] = useState<User | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<Target | null>(null);
  const [extendTarget, setExtendTarget] = useState<Target | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [contentOpen, setContentOpen] = useState(false);

  const refresh = () => void list.reload(true);

  const canRefreshExternal = isAdmin && billingConfigured(billing.data);
  const refreshFromPlatform = useUserRefresh();
  const refreshUser = async (u: User) => {
    const next = await refreshFromPlatform(u);
    if (next) replaceRow(next);
  };

  const replaceRow = (u: User | null | undefined) => {
    if (!u || typeof u !== 'object' || !('id' in u)) {
      refresh();
      return;
    }
    list.setData((prev) => (prev ? { ...prev, data: prev.data.map((r) => (r.id === u.id ? u : r)) } : prev));
  };

  const runBulk = async (input: Omit<UserBulkInput, 'ids'>, ids: number[], success: string) => {
    try {
      const res = await api.users.bulk({ ...input, ids });
      const skipped = res?.skipped ?? 0;
      toast.success(
        `${success} (${formatNumber(res?.affected ?? ids.length)} afectados${skipped ? `, ${formatNumber(skipped)} omitidos por estar vinculados a ${platformName}` : ''})`,
      );
      setSelected(new Set());
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const selectedIds = useMemo(() => [...selected], [selected]);

  const deleteUser = async (u: User) => {
    const ok = await confirm({
      title: 'Eliminar cliente',
      message: (
        <>
          Se eliminará la línea <strong>{u.username}</strong> de forma permanente. Esta acción no se puede deshacer.
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.users.remove(u.id);
      toast.success('Cliente eliminado');
      setSelected((s) => {
        const n = new Set(s);
        n.delete(u.id);
        return n;
      });
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const reactivate = async (u: User) => {
    try {
      const updated = await api.users.reactivate(u.id);
      toast.success(`Cliente ${u.username} reactivado`);
      replaceRow(updated);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const toggleEnabled = async (u: User) => {
    try {
      const updated = await api.users.update(u.id, { enabled: !u.enabled });
      toast.success(u.enabled ? 'Cliente deshabilitado' : 'Cliente habilitado');
      replaceRow(updated);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const doSuspend = async (reason: string) => {
    if (!suspendTarget) return;
    if (suspendTarget.kind === 'single') {
      try {
        const updated = await api.users.suspend(suspendTarget.user.id, reason);
        toast.success(`Cliente ${suspendTarget.user.username} suspendido`);
        replaceRow(updated);
        setSuspendTarget(null);
      } catch (e) {
        toast.error(errorMessage(e));
      }
    } else {
      await runBulk({ action: 'suspend', reason }, suspendTarget.ids, 'Clientes suspendidos');
      setSuspendTarget(null);
    }
  };

  const doExtend = async (amount: number, unit: TimeUnit) => {
    if (!extendTarget) return;
    const label = `${amount} ${unit === 'months' ? (amount === 1 ? 'mes' : 'meses') : amount === 1 ? 'día' : 'días'}`;
    if (extendTarget.kind === 'single') {
      try {
        const updated = await api.users.extend(extendTarget.user.id, amount, unit);
        toast.success(
          updated?.exp_date
            ? `Extendido ${label}. Nuevo vencimiento: ${formatDateTime(updated.exp_date)}`
            : `Extendido ${label}`,
        );
        replaceRow(updated);
        setExtendTarget(null);
      } catch (e) {
        toast.error(errorMessage(e));
      }
    } else {
      await runBulk({ action: 'extend', amount, unit }, extendTarget.ids, `Extendidos ${label}`);
      setExtendTarget(null);
    }
  };

  const bulkConfirm = async (action: 'enable' | 'disable' | 'reactivate' | 'delete') => {
    const n = selectedIds.length;
    const texts = {
      enable: { title: 'Habilitar clientes', msg: `¿Habilitar ${n} cliente(s)?`, ok: 'Habilitar', done: 'Clientes habilitados', danger: false },
      disable: { title: 'Deshabilitar clientes', msg: `¿Deshabilitar ${n} cliente(s)? No podrán reproducir contenido.`, ok: 'Deshabilitar', done: 'Clientes deshabilitados', danger: true },
      reactivate: { title: 'Reactivar clientes', msg: `¿Quitar la suspensión a ${n} cliente(s)?`, ok: 'Reactivar', done: 'Clientes reactivados', danger: false },
      delete: { title: 'Eliminar clientes', msg: `Se eliminarán ${n} cliente(s) de forma permanente. Esta acción no se puede deshacer.`, ok: 'Eliminar', done: 'Clientes eliminados', danger: true },
    }[action];
    const ok = await confirm({ title: texts.title, message: texts.msg, confirmText: texts.ok, danger: texts.danger });
    if (ok) await runBulk({ action }, selectedIds, texts.done);
  };

  const columns: Column<User>[] = [
    {
      key: 'username',
      header: 'Cliente',
      sortKey: 'username',
      render: (u) => (
        <div className="cell-main">
          <span className="strong">{u.username}</span>
          {u.full_name && <span className="muted text-sm">{u.full_name}</span>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (u) => (
        <div className="badge-stack">
          {u.status === 'suspended' ? (
            <Badge tone="red" dot>
              {u.suspension_source === 'external' ? `Suspendido por ${platformName}` : 'Suspendido (manual)'}
            </Badge>
          ) : (
            <StatusBadge status={u.status} />
          )}
          {u.is_trial && <Badge tone="purple">Prueba</Badge>}
          {u.source === 'xtreamui' && <SourceBadge source="xtreamui" />}
          {u.external_id && (
            <ExternalLinkBadge
              platformName={platformName === 'WispHub' ? 'WispHub' : 'Plataforma'}
              externalId={u.external_id}
              externalStatus={u.external_status}
              services={u.external_services}
              statusMap={billing.data?.config.status_map}
              title={`Vinculado · ID ${u.external_id}${u.external_synced_at ? ` · sincronizado ${formatDateTime(u.external_synced_at)}` : ''}`}
            />
          )}
          {u.suspended && u.suspension_reason && <span className="muted text-xs">{u.suspension_reason}</span>}
        </div>
      ),
    },
    {
      key: 'exp_date',
      header: 'Vence',
      sortKey: 'exp_date',
      render: (u) => {
        const d = daysUntil(u.exp_date);
        const tone = d === null ? '' : d < 0 ? 'text-red' : d <= 7 ? 'text-amber' : '';
        return (
          <div className="cell-main">
            <span>{u.exp_date === null ? 'Sin vencimiento' : formatDate(u.exp_date)}</span>
            {u.exp_date !== null && <span className={`text-xs ${tone || 'muted'}`}>{relativeExpiry(u.exp_date)}</span>}
          </div>
        );
      },
    },
    {
      key: 'devices',
      header: 'Dispositivos',
      hideOnMobile: true,
      render: (u) => {
        const n = u.device_count ?? 0;
        return n > 0 ? (
          <Link to={`/dispositivos?user_id=${u.id}`} className="link row-inline" title="Ver dispositivos del cliente">
            <MonitorSmartphone size={14} /> {formatNumber(n)}
          </Link>
        ) : (
          <span className="muted">0</span>
        );
      },
    },
    {
      key: 'connections',
      header: 'Conex.',
      render: (u) => (
        <span className={u.active_connections > 0 ? 'text-green strong' : 'muted'}>
          {u.active_connections ?? 0}/{u.max_connections}
        </span>
      ),
    },
    {
      key: 'packages',
      header: 'Paquetes',
      hideOnMobile: true,
      render: (u) => {
        const names = (u.package_ids ?? []).map((id) => packageById.get(id)?.name ?? `#${id}`);
        const packagesCell =
          names.length === 0 ? (
            <span className="muted">—</span>
          ) : (
            <span title={names.join(', ')}>
              {names.slice(0, 2).join(', ')}
              {names.length > 2 && <span className="muted"> +{names.length - 2}</span>}
            </span>
          );
        // Secciones elegidas a mano: se indican debajo; si es automático no se muestra nada.
        const sections = contentSectionsText(u.content_sections);
        if (!sections) return packagesCell;
        return (
          <div className="cell-main">
            {packagesCell}
            <span className="text-xs text-blue" title={`Contenido elegido a mano: solo ve ${contentSectionsText(u.content_sections, true)}`}>
              Solo {sections}
            </span>
          </div>
        );
      },
    },
    ...(isAdmin
      ? [{ key: 'owner', header: 'Revendedor', hideOnMobile: true, render: (u: User) => u.owner_username ?? '—' }]
      : []),
    {
      key: 'created_at',
      header: 'Creado',
      sortKey: 'created_at',
      hideOnMobile: true,
      render: (u) => <span className="muted">{formatDate(u.created_at)}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'col-actions',
      render: (u) => (
        <div className="row-actions">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => { setFormUser(u); setFormOpen(true); }}>
            <Pencil size={15} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Datos de acceso / M3U" onClick={() => setAccessUser(u)}>
            <KeyRound size={15} />
          </button>
          <ActionMenu
            items={[
              { label: 'Editar', icon: <Pencil size={15} />, onClick: () => { setFormUser(u); setFormOpen(true); } },
              { label: 'Datos de acceso / M3U', icon: <KeyRound size={15} />, onClick: () => setAccessUser(u) },
              { label: 'Ver conexiones', icon: <Activity size={15} />, onClick: () => setConnUser(u) },
              { label: 'Ver dispositivos', icon: <MonitorSmartphone size={15} />, onClick: () => setDevicesUser(u) },
              {
                label: `Actualizar desde ${platformName}`,
                icon: <RefreshCw size={15} />,
                onClick: () => void refreshUser(u),
                hidden: !canRefreshExternal || !u.external_id,
              },
              { label: 'Extender', icon: <CalendarPlus size={15} />, onClick: () => setExtendTarget({ kind: 'single', user: u }), divider: true, hidden: u.exp_date === null },
              {
                label: 'Suspender',
                icon: <Ban size={15} />,
                onClick: () => setSuspendTarget({ kind: 'single', user: u }),
                hidden: u.suspended,
                danger: true,
                disabled: lockedByPlatform(u),
                title: lockedByPlatform(u) ? lockedTitle : undefined,
              },
              {
                label: 'Reactivar',
                icon: <Play size={15} />,
                onClick: () => void reactivate(u),
                hidden: !u.suspended,
                disabled: lockedByPlatform(u),
                title: lockedByPlatform(u) ? lockedTitle : undefined,
              },
              { label: u.enabled ? 'Deshabilitar' : 'Habilitar', icon: u.enabled ? <PowerOff size={15} /> : <Power size={15} />, onClick: () => void toggleEnabled(u) },
              { label: 'Eliminar', icon: <Trash2 size={15} />, onClick: () => void deleteUser(u), danger: true, divider: true },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Líneas de los clientes: credenciales, vencimientos, suspensiones, paquetes y dispositivos"
        actions={
          <>
            {canRefreshExternal && billing.data && <CheckSuspendedButton overview={billing.data} onDone={() => { refresh(); void billing.reload(true); }} />}
            <button type="button" className="btn btn-primary" onClick={() => { setFormUser(null); setFormOpen(true); }}>
              <Plus size={16} /> Nuevo cliente
            </button>
          </>
        }
      />

      <div className="toolbar">
        <div className="input-icon toolbar-search">
          <Search size={16} />
          <input
            className="input"
            placeholder="Buscar por usuario, nombre, email o teléfono…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={packageId}
          onChange={setPackageId}
          placeholder="Todos los paquetes"
          options={packages.map((p) => ({ value: String(p.id), label: p.name }))}
          ariaLabel="Filtrar por paquete"
        />
        <Select
          value={source}
          onChange={(v) => setSource(v as UserSource | '')}
          placeholder="Todos los orígenes"
          options={[
            { value: 'local', label: 'Local' },
            { value: 'xtreamui', label: 'XtreamUI' },
          ]}
          ariaLabel="Filtrar por origen"
        />
        <Select
          value={external}
          onChange={(v) => setExternal(v as '' | 'linked' | 'unlinked')}
          placeholder="Vinculación: todos"
          options={[
            { value: 'linked', label: `Vinculados a ${platformName}` },
            { value: 'unlinked', label: 'Sin vincular' },
          ]}
          ariaLabel="Filtrar por vinculación"
        />
        <Select
          value={suspensionSource}
          onChange={(v) => setSuspensionSource(v as '' | 'manual' | 'external')}
          placeholder="Origen del corte: todos"
          options={[
            { value: 'manual', label: 'Corte manual' },
            { value: 'external', label: `Corte de ${platformName}` },
          ]}
          ariaLabel="Filtrar por origen del corte"
        />
        {isAdmin && admins.length > 0 && (
          <Select
            value={ownerId}
            onChange={setOwnerId}
            placeholder="Todos los propietarios"
            options={admins.map((a) => ({ value: String(a.id), label: a.username }))}
            ariaLabel="Filtrar por propietario"
          />
        )}
      </div>
      <ChipGroup value={status} onChange={setStatus} options={STATUS_CHIPS} />

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void bulkConfirm('enable')}>
          <Power size={14} /> Habilitar
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void bulkConfirm('disable')}>
          <PowerOff size={14} /> Deshabilitar
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSuspendTarget({ kind: 'bulk', ids: selectedIds })}>
          <Ban size={14} /> Suspender
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void bulkConfirm('reactivate')}>
          <Play size={14} /> Reactivar
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExtendTarget({ kind: 'bulk', ids: selectedIds })}>
          <CalendarPlus size={14} /> Extender
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAssignOpen(true)}>
          <PackageIcon size={14} /> Asignar paquetes
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setContentOpen(true)}>
          <MonitorPlay size={14} /> Contenido…
        </button>
        <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => void bulkConfirm('delete')}>
          <Trash2 size={14} /> Eliminar
        </button>
      </BulkBar>

      <DataTable<User>
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        sort={sort}
        onSortChange={(key, order) => setSort({ key: key as SortKey, order })}
        rowClassName={(u) => (u.status === 'suspended' ? 'row-danger' : u.status === 'expired' ? 'row-warning' : '')}
        emptyTitle={search || status || packageId || source || ownerId || external || suspensionSource ? 'Ningún cliente coincide con los filtros' : 'Aún no hay clientes'}
        emptyAction={
          !search && !status ? (
            <button type="button" className="btn btn-primary" onClick={() => { setFormUser(null); setFormOpen(true); }}>
              <Plus size={16} /> Crear el primero
            </button>
          ) : undefined
        }
        pagination={{ page, limit, total, onPageChange: setPage, onLimitChange: setLimit }}
      />

      <UserFormModal
        open={formOpen}
        user={formUser}
        packages={packages}
        packagesLoading={packagesLoading}
        admins={admins}
        isAdmin={isAdmin}
        platformName={canRefreshExternal ? platformName : null}
        onRefreshExternal={async (u) => {
          const next = await refreshFromPlatform(u);
          if (next) {
            replaceRow(next);
            setFormUser(next);
          }
        }}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          refresh();
        }}
      />
      <UserAccessModal user={accessUser} onClose={() => setAccessUser(null)} />
      <UserConnectionsModal user={connUser} onClose={() => setConnUser(null)} />
      <ClientDevicesModal user={devicesUser} onClose={() => setDevicesUser(null)} />
      <SuspendModal
        open={suspendTarget !== null}
        title={
          suspendTarget?.kind === 'single'
            ? `Suspender a ${suspendTarget.user.username}`
            : `Suspender ${suspendTarget?.kind === 'bulk' ? suspendTarget.ids.length : 0} cliente(s)`
        }
        onClose={() => setSuspendTarget(null)}
        onConfirm={doSuspend}
      />
      <ExtendModal
        open={extendTarget !== null}
        title={
          extendTarget?.kind === 'single'
            ? `Extender a ${extendTarget.user.username}`
            : `Extender ${extendTarget?.kind === 'bulk' ? extendTarget.ids.length : 0} cliente(s)`
        }
        onClose={() => setExtendTarget(null)}
        onConfirm={doExtend}
      />
      <AssignPackagesModal
        open={assignOpen}
        count={selected.size}
        packages={packages}
        onClose={() => setAssignOpen(false)}
        onConfirm={async (ids) => {
          await runBulk({ action: 'set_packages', package_ids: ids }, selectedIds, 'Paquetes asignados');
          setAssignOpen(false);
        }}
      />
      <ContentSectionsModal
        open={contentOpen}
        count={selected.size}
        onClose={() => setContentOpen(false)}
        onConfirm={async (sections) => {
          const text = contentSectionsText(sections, true);
          await runBulk(
            { action: 'set_content', content_sections: sections },
            selectedIds,
            text ? `Contenido actualizado: solo ${text}` : 'Contenido en automático, según sus paquetes',
          );
          setContentOpen(false);
        }}
      />
    </>
  );
}
