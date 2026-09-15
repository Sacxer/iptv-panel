import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, FolderInput, ListOrdered, Lock, PackageMinus, PackagePlus, Pencil, Plus, Power, PowerOff, Radio, ScanSearch, Search, Shuffle, Trash2, Upload } from 'lucide-react';
import { ActionMenu } from '../../components/ActionMenu';
import { DeliveryBadge, DeliverySelector, emptyDelivery, validateDelivery } from '../../components/DeliverySelector';
import { useInterval } from '../../hooks/useInterval';
import { usePageVisible } from '../../hooks/usePageVisible';
import { useProfiles, useServers } from '../../hooks/useStreaming';
import { StreamConnectionsDrawer } from './StreamConnectionsDrawer';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useCategories, usePackages } from '../../hooks/useResources';
import { checkSummary, useStreamCheck } from '../../hooks/useStreamCheck';
import { BulkBar, DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { EnabledBadge, SourceBadge } from '../../components/StatusBadge';
import { Badge, ChipGroup, FormField, PageHeader, Select, Spinner, Thumb } from '../../components/ui';
import type { ContentSource, DeliveryMode, DeliveryValue, HealthStatus, Stream, StreamBulkInput, StreamType } from '../../types';
import { DELIVERY_MODE, SOURCE_LABEL } from '../../utils/labels';
import { formatDateTime, formatNumber, timeAgo, truncate } from '../../utils/format';
import { ImportM3UModal } from './ImportM3UModal';
import { StreamFormModal } from './StreamFormModal';

type PickAction = 'set_category' | 'add_to_package' | 'remove_from_package';

export function StreamsPage({ type }: { type: StreamType }) {
  const isMovie = type === 'movie';
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [enabled, setEnabled] = useState<'' | 'true' | 'false'>('');
  const [params, setParams] = useSearchParams();
  const urlHealth = params.get('health');
  const [health, setHealthState] = useState<HealthStatus | ''>(
    urlHealth === 'online' || urlHealth === 'offline' || urlHealth === 'unknown' ? urlHealth : '',
  );
  const [checkingRows, setCheckingRows] = useState<Set<number>>(new Set());
  const [checkingBulk, setCheckingBulk] = useState(false);
  const [packageId, setPackageId] = useState('');
  const [watching, setWatching] = useState(params.get('watching') === 'true');
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryMode | ''>('');
  const [serverFilter, setServerFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState<ContentSource | ''>('');
  const [noEpg, setNoEpg] = useState(false);
  const [liveStream, setLiveStream] = useState<Stream | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const debounced = useDebounce(search);

  const { categories } = useCategories(type);
  const { packages, byId: packageById, reload: reloadPackages } = usePackages();
  const { servers } = useServers();
  const { profiles } = useProfiles();
  const visible = usePageVisible();

  useEffect(() => setPage(1), [debounced, categoryId, enabled, health, packageId, watching, deliveryFilter, serverFilter, sourceFilter, limit]);

  const setHealth = (value: HealthStatus | '') => {
    setHealthState(value);
    const next = new URLSearchParams(params);
    if (value) next.set('health', value);
    else next.delete('health');
    setParams(next, { replace: true });
  };

  const list = useAsync(
    () =>
      api.streams.list({
        type,
        search: debounced.trim(),
        category_id: categoryId ? Number(categoryId) : '',
        enabled,
        health,
        package_id: packageId ? Number(packageId) : '',
        watching: watching || undefined,
        delivery_mode: deliveryFilter,
        server_id: serverFilter ? Number(serverFilter) : '',
        source: sourceFilter,
        page,
        limit,
      }),
    [type, debounced, categoryId, enabled, health, packageId, watching, deliveryFilter, serverFilter, sourceFilter, page, limit],
  );
  const loadedRows = list.data?.data ?? [];
  // «Sin EPG» filtra solo la página cargada (la API del listado no tiene ese filtro).
  const rows = !isMovie && noEpg ? loadedRows.filter((s) => !s.epg_channel_id) : loadedRows;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Stream | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pick, setPick] = useState<PickAction | null>(null);

  const refresh = () => void list.reload(true);

  // «Viendo ahora» en tiempo real: refresco silencioso cada 8 s si no hay ventanas abiertas.
  useInterval(() => void list.reload(true), visible && !formOpen && !importOpen && !pick && !deliveryOpen ? 8000 : null);

  const check = useStreamCheck({
    onFinished: (h) => {
      const c = isMovie ? h.movie : h.live;
      toast.success(`Revisión terminada: ${formatNumber(c.online)} en línea, ${formatNumber(c.offline)} caído(s)`);
      void list.reload(true);
    },
  });

  // Si al entrar ya hay una revisión en curso, se muestra su progreso.
  useEffect(() => {
    void check.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkRows = async (ids: number[], bulkMode: boolean) => {
    if (bulkMode) setCheckingBulk(true);
    else setCheckingRows((s) => new Set([...s, ...ids]));
    try {
      const res = await check.checkIds(ids);
      if (res) {
        const offline = res.results?.filter((r) => r.status === 'offline').length ?? 0;
        if (offline > 0 && ids.length === 1) toast.error(checkSummary(res));
        else toast.success(checkSummary(res));
        void list.reload(true);
      }
    } finally {
      if (bulkMode) setCheckingBulk(false);
      else
        setCheckingRows((s) => {
          const n = new Set(s);
          ids.forEach((id) => n.delete(id));
          return n;
        });
    }
  };

  const bulk = async (input: Omit<StreamBulkInput, 'ids'>, message: string) => {
    try {
      const res = await api.streams.bulk({ ...input, ids: [...selected] });
      toast.success(`${message} (${formatNumber(res?.affected ?? selected.size)} afectados)`);
      setSelected(new Set());
      refresh();
      if (input.action === 'add_to_package' || input.action === 'remove_from_package') void reloadPackages(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const toggle = async (s: Stream) => {
    try {
      await api.streams.update(s.id, { enabled: !s.enabled });
      list.setData((prev) => (prev ? { ...prev, data: prev.data.map((r) => (r.id === s.id ? { ...r, enabled: !s.enabled } : r)) } : prev));
      toast.success(s.enabled ? 'Deshabilitado' : 'Habilitado');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (s: Stream) => {
    const ok = await confirm({
      title: isMovie ? 'Eliminar película' : 'Eliminar canal',
      message: (
        <>
          ¿Eliminar <strong>{s.name}</strong>? Se quitará de todos los paquetes. Esta acción no se puede deshacer.
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.streams.remove(s.id);
      toast.success('Eliminado');
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<Stream>[] = [
    {
      key: 'logo',
      header: '',
      className: 'col-thumb',
      render: (s) => <Thumb src={isMovie ? s.info?.cover || s.logo : s.logo} alt={s.name} variant={isMovie ? 'poster' : 'logo'} />,
    },
    {
      key: 'name',
      header: 'Nombre',
      render: (s) => (
        <div className="cell-main">
          <span className="strong">{s.name}</span>
          <span className="muted text-xs">
            #{s.id}
            {isMovie && s.info?.genre ? ` · ${truncate(s.info.genre, 30)}` : ''}
            {isMovie && s.info?.releasedate ? ` · ${s.info.releasedate.slice(0, 4)}` : ''}
          </span>
        </div>
      ),
    },
    { key: 'category', header: 'Categoría', render: (s) => s.category_name ?? <span className="muted">Sin categoría</span> },
    {
      key: 'packages',
      header: 'Paquetes',
      hideOnMobile: true,
      render: (s) => {
        const names = (s.package_ids ?? []).map((id) => packageById.get(id)?.name ?? `#${id}`);
        return names.length ? <span title={names.join(', ')}>{truncate(names.join(', '), 40)}</span> : <span className="muted">—</span>;
      },
    },
    { key: 'ext', header: 'Formato', hideOnMobile: true, render: (s) => <span className="mono text-sm">{s.container_extension || '—'}</span> },
    { key: 'source', header: 'Origen', hideOnMobile: true, render: (s) => <SourceBadge source={s.source} /> },
    ...(isMovie
      ? []
      : [
          {
            key: 'epg',
            header: 'EPG',
            render: (s: Stream) =>
              s.epg_channel_id ? (
                <span
                  className="epg-cell"
                  title={`${s.epg_channel_id}${s.epg_locked ? ' · asignado a mano' : s.epg_match_score ? ` · puntuación ${s.epg_match_score}` : ''}`}
                >
                  <Badge tone="green">EPG</Badge>
                  {s.epg_locked && <Lock size={11} className="muted" />}
                </span>
              ) : (
                <Badge tone="gray">Sin EPG</Badge>
              ),
          } as Column<Stream>,
        ]),
    {
      key: 'health',
      header: 'Fuente',
      render: (s) => <HealthCell stream={s} checking={checkingRows.has(s.id)} />,
    },
    {
      key: 'delivery',
      header: 'Entrega',
      hideOnMobile: true,
      render: (s) => <DeliveryBadge mode={s.delivery_mode} profileName={s.transcode_profile_name} servers={s.servers} />,
    },
    {
      key: 'watching',
      header: 'Viendo ahora',
      render: (s) => {
        const n = s.active_connections ?? 0;
        return (
          <button
            type="button"
            className={`watching-btn ${n > 0 ? 'is-live' : ''}`}
            onClick={() => setLiveStream(s)}
            title="Ver conexiones en vivo"
          >
            {n > 0 && <span className="live-dot is-live" />}
            {formatNumber(n)}
          </button>
        );
      },
    },
    { key: 'enabled', header: 'Estado', hideOnMobile: true, render: (s) => <EnabledBadge enabled={s.enabled} /> },
    {
      key: 'actions',
      header: '',
      className: 'col-actions',
      render: (s) => (
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="Revisar ahora"
            disabled={checkingRows.has(s.id)}
            onClick={() => void checkRows([s.id], false)}
          >
            {checkingRows.has(s.id) ? <Spinner size={13} /> : <ScanSearch size={15} />}
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => { setEditing(s); setFormOpen(true); }}>
            <Pencil size={15} />
          </button>
          <ActionMenu
            items={[
              { label: 'Conexiones en vivo', icon: <Radio size={15} />, onClick: () => setLiveStream(s) },
              { label: 'Editar', icon: <Pencil size={15} />, onClick: () => { setEditing(s); setFormOpen(true); } },
              { label: 'Revisar fuente ahora', icon: <ScanSearch size={15} />, onClick: () => void checkRows([s.id], false) },
              {
                label: s.enabled ? 'Deshabilitar' : 'Habilitar',
                icon: s.enabled ? <PowerOff size={15} /> : <Power size={15} />,
                onClick: () => void toggle(s),
                divider: true,
              },
              { label: 'Eliminar', icon: <Trash2 size={15} />, onClick: () => void remove(s), danger: true },
            ]}
          />
        </div>
      ),
    },
  ];

  const hasFilters = Boolean(search || categoryId || enabled || health || packageId || watching || deliveryFilter || serverFilter || sourceFilter || (!isMovie && noEpg));
  const progress = check.health?.progress;

  return (
    <>
      <PageHeader
        title={isMovie ? 'Películas' : 'Canales'}
        subtitle={isMovie ? 'Catálogo de video bajo demanda' : 'Canales de televisión en vivo'}
        actions={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void check.startAll(type)}
              disabled={check.running || check.starting}
              title={isMovie ? 'Revisar todas las películas' : 'Revisar todos los canales'}
            >
              {check.running || check.starting ? <Spinner size={14} /> : <ScanSearch size={16} />} Revisar todo
            </button>
            {sourceFilter === 'astra' && (
              <Link to="/astra" className="btn btn-danger-ghost">
                <Trash2 size={16} /> Eliminar canales de Astra…
              </Link>
            )}
            <Link to={isMovie ? '/ordenar-canales?type=movie' : '/ordenar-canales'} className="btn btn-secondary" title={isMovie ? 'Ordenar películas y categorías' : 'Ordenar canales y categorías'}>
              <ListOrdered size={16} /> Ordenar
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Importar M3U
            </button>
            <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus size={16} /> {isMovie ? 'Nueva película' : 'Nuevo canal'}
            </button>
          </>
        }
      />

      <div className="toolbar">
        <div className="input-icon toolbar-search">
          <Search size={16} />
          <input className="input" placeholder={isMovie ? 'Buscar película…' : 'Buscar canal…'} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={categoryId} onChange={setCategoryId} placeholder="Todas las categorías" options={categories.map((c) => ({ value: String(c.id), label: c.name }))} ariaLabel="Categoría" />
        <Select
          value={enabled}
          onChange={(v) => setEnabled(v as '' | 'true' | 'false')}
          placeholder="Todos los estados"
          options={[
            { value: 'true', label: 'Habilitados' },
            { value: 'false', label: 'Deshabilitados' },
          ]}
          ariaLabel="Estado"
        />
        <Select value={packageId} onChange={setPackageId} placeholder="Todos los paquetes" options={packages.map((p) => ({ value: String(p.id), label: p.name }))} ariaLabel="Paquete" />
        <Select
          value={deliveryFilter}
          onChange={(v) => setDeliveryFilter(v as DeliveryMode | '')}
          placeholder="Toda entrega"
          options={(Object.keys(DELIVERY_MODE) as DeliveryMode[]).map((m) => ({ value: m, label: DELIVERY_MODE[m].short }))}
          ariaLabel="Modo de entrega"
        />
        {servers.length > 0 && (
          <Select
            value={serverFilter}
            onChange={setServerFilter}
            placeholder="Todos los servidores"
            options={servers.map((sv) => ({ value: String(sv.id), label: sv.name }))}
            ariaLabel="Servidor"
          />
        )}
        <Select
          value={sourceFilter}
          onChange={(v) => setSourceFilter(v as ContentSource | '')}
          placeholder="Todo origen"
          options={(Object.keys(SOURCE_LABEL) as ContentSource[]).map((k) => ({ value: k, label: SOURCE_LABEL[k] }))}
          ariaLabel="Origen"
        />
      </div>
      <div className="chips-row">
        <ChipGroup
          value={health}
          onChange={setHealth}
          options={[
            { value: '', label: 'Todas las fuentes' },
            { value: 'online', label: 'En línea' },
            { value: 'offline', label: 'Caídos' },
            { value: 'unknown', label: 'Sin revisar' },
          ]}
        />
        <button type="button" className={`chip chip-toggle ${watching ? 'chip-active' : ''}`} aria-pressed={watching} onClick={() => setWatching((w) => !w)}>
          <Radio size={12} className="inline-icon" /> Con espectadores
        </button>
        {!isMovie && (
          <>
            <button
              type="button"
              className={`chip chip-toggle ${noEpg ? 'chip-active' : ''}`}
              aria-pressed={noEpg}
              title="Muestra solo los canales sin EPG de la página cargada"
              onClick={() => setNoEpg((v) => !v)}
            >
              Sin EPG{noEpg ? ` (${formatNumber(rows.length)} en esta página)` : ''}
            </button>
            <Link to="/guia-epg?tab=emparejar" className="btn btn-link btn-sm">
              <CalendarClock size={13} /> Emparejar EPG
            </Link>
          </>
        )}
      </div>

      {check.running && (
        <div className="check-progress" role="status">
          <Spinner size={14} />
          <span className="nowrap">
            Revisando fuentes…{' '}
            {progress && progress.total > 0 && (
              <strong>
                {formatNumber(progress.done)} / {formatNumber(progress.total)}
              </strong>
            )}
          </span>
          <div className="progress">
            <div
              className={`progress-bar ${!progress || progress.total === 0 ? 'progress-indeterminate' : ''}`}
              style={{ width: progress && progress.total > 0 ? `${Math.round((progress.done / progress.total) * 100)}%` : undefined }}
            />
          </div>
          {progress && progress.total > 0 && (
            <span className="nowrap hide-mobile">
              {formatNumber(progress.online)} en línea · {formatNumber(progress.offline)} caídos
            </span>
          )}
        </div>
      )}

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={checkingBulk}
          title={selected.size > 50 ? 'Máximo 50 a la vez' : undefined}
          onClick={() => {
            if (selected.size > 50) {
              toast.error('Puedes revisar como máximo 50 contenidos a la vez');
              return;
            }
            void checkRows([...selected], true);
          }}
        >
          {checkingBulk ? <Spinner size={13} /> : <ScanSearch size={14} />} Revisar seleccionados
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeliveryOpen(true)}>
          <Shuffle size={14} /> Cambiar modo de entrega
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void bulk({ action: 'enable' }, 'Habilitados')}>
          <Power size={14} /> Habilitar
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void bulk({ action: 'disable' }, 'Deshabilitados')}>
          <PowerOff size={14} /> Deshabilitar
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPick('set_category')}>
          <FolderInput size={14} /> Cambiar categoría
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPick('add_to_package')}>
          <PackagePlus size={14} /> Añadir a paquete
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPick('remove_from_package')}>
          <PackageMinus size={14} /> Quitar de paquete
        </button>
        <button
          type="button"
          className="btn btn-danger-ghost btn-sm"
          onClick={async () => {
            const ok = await confirm({
              title: 'Eliminar seleccionados',
              message: `Se eliminarán ${selected.size} elemento(s) de forma permanente. ¿Continuar?`,
              confirmText: 'Eliminar',
              danger: true,
            });
            if (ok) await bulk({ action: 'delete' }, 'Eliminados');
          }}
        >
          <Trash2 size={14} /> Eliminar
        </button>
      </BulkBar>

      <DataTable<Stream>
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        rowClassName={(s) => (s.enabled ? '' : 'row-muted')}
        emptyTitle={hasFilters ? 'Nada coincide con los filtros' : isMovie ? 'Aún no hay películas' : 'Aún no hay canales'}
        emptyDescription={hasFilters ? undefined : 'Crea uno manualmente, importa una lista M3U o migra desde XtreamUI.'}
        pagination={{ page, limit, total: list.data?.total ?? 0, onPageChange: setPage, onLimitChange: setLimit }}
      />

      <StreamFormModal
        open={formOpen}
        type={type}
        stream={editing}
        categories={categories}
        packages={packages}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          refresh();
        }}
      />
      <ImportM3UModal
        open={importOpen}
        defaultType={type}
        packages={packages}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          refresh();
          void reloadPackages(true);
        }}
      />
      <StreamConnectionsDrawer stream={liveStream} onClose={() => setLiveStream(null)} onChanged={refresh} />
      <DeliveryBulkModal
        open={deliveryOpen}
        count={selected.size}
        servers={servers}
        profiles={profiles}
        onClose={() => setDeliveryOpen(false)}
        onConfirm={async (v) => {
          await bulk(
            { action: 'set_delivery', delivery_mode: v.delivery_mode, transcode_profile_id: v.transcode_profile_id, server_ids: v.server_ids, always_on: v.always_on },
            `Modo de entrega: ${DELIVERY_MODE[v.delivery_mode].short}`,
          );
          setDeliveryOpen(false);
        }}
      />
      <BulkPickModal
        action={pick}
        count={selected.size}
        categories={categories.map((c) => ({ value: String(c.id), label: c.name }))}
        packages={packages.map((p) => ({ value: String(p.id), label: p.name }))}
        onClose={() => setPick(null)}
        onConfirm={async (value) => {
          if (!pick) return;
          if (pick === 'set_category') await bulk({ action: pick, category_id: Number(value) }, 'Categoría cambiada');
          else await bulk({ action: pick, package_id: Number(value) }, pick === 'add_to_package' ? 'Añadidos al paquete' : 'Quitados del paquete');
          setPick(null);
        }}
      />
    </>
  );
}

function BulkPickModal({
  action,
  count,
  categories,
  packages,
  onClose,
  onConfirm,
}: {
  action: PickAction | null;
  count: number;
  categories: { value: string; label: string }[];
  packages: { value: string; label: string }[];
  onClose: () => void;
  onConfirm: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setValue('');
    setError(null);
  }, [action]);

  const isCategory = action === 'set_category';
  const title =
    action === 'set_category' ? 'Cambiar categoría' : action === 'add_to_package' ? 'Añadir a paquete' : 'Quitar de paquete';

  return (
    <Modal
      open={action !== null}
      title={`${title} (${count})`}
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      onSubmit={async () => {
        if (!value) {
          setError(isCategory ? 'Selecciona una categoría' : 'Selecciona un paquete');
          return;
        }
        setBusy(true);
        try {
          await onConfirm(value);
        } finally {
          setBusy(false);
        }
      }}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={14} />} Aplicar
          </button>
        </>
      }
    >
      <FormField label={isCategory ? 'Categoría' : 'Paquete'} required error={error}>
        <Select
          value={value}
          onChange={(v) => {
            setValue(v);
            setError(null);
          }}
          placeholder="Selecciona…"
          options={isCategory ? categories : packages}
        />
      </FormField>
    </Modal>
  );
}

function HealthCell({ stream, checking }: { stream: Stream; checking: boolean }) {
  if (checking) {
    return (
      <span className="health-cell">
        <Badge tone="blue">
          <Spinner size={10} /> Revisando
        </Badge>
      </span>
    );
  }
  const status = stream.health_status ?? 'unknown';
  const checked = stream.health_checked_at ? `Revisado ${timeAgo(stream.health_checked_at)} (${formatDateTime(stream.health_checked_at)})` : 'Nunca revisado';
  if (status === 'online') {
    return (
      <span className="health-cell" title={checked}>
        <Badge tone="green" dot>
          En línea
        </Badge>
        {stream.health_ms !== null && stream.health_ms !== undefined && <span className="health-sub">{formatNumber(stream.health_ms)} ms</span>}
      </span>
    );
  }
  if (status === 'offline') {
    return (
      <span className="health-cell" title={`${stream.health_error ?? 'Sin respuesta'}\n${checked}`}>
        <Badge tone="red" dot>
          Caído
        </Badge>
        <span className="health-sub">
          {stream.health_down_since ? `desde ${timeAgo(stream.health_down_since)}` : truncate(stream.health_error ?? '', 22)}
        </span>
      </span>
    );
  }
  return (
    <span className="health-cell" title={checked}>
      <Badge tone="gray">Sin revisar</Badge>
    </span>
  );
}

function DeliveryBulkModal({
  open,
  count,
  servers,
  profiles,
  onClose,
  onConfirm,
}: {
  open: boolean;
  count: number;
  servers: ReturnType<typeof useServers>['servers'];
  profiles: ReturnType<typeof useProfiles>['profiles'];
  onClose: () => void;
  onConfirm: (v: DeliveryValue) => Promise<void>;
}) {
  const [value, setValue] = useState<DeliveryValue>(emptyDelivery('restream'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setValue(emptyDelivery('restream'));
      setError(null);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      title={`Cambiar modo de entrega (${count})`}
      onClose={onClose}
      size="lg"
      dismissible={!busy}
      onSubmit={async () => {
        const err = validateDelivery(value);
        setError(err);
        if (err) return;
        setBusy(true);
        try {
          await onConfirm(value);
        } finally {
          setBusy(false);
        }
      }}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={14} />} Aplicar a {count}
          </button>
        </>
      }
    >
      <DeliverySelector value={value} onChange={(v) => { setValue(v); setError(null); }} servers={servers} profiles={profiles} error={error} />
    </Modal>
  );
}
