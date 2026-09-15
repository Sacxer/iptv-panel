import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Globe, Pencil, RefreshCw, Satellite, Search, Signal, Trash2, Waypoints } from 'lucide-react';
import { DeleteImportedModal, type DeleteScope } from './AstraDeleteModals';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useCategories, usePackages } from '../../hooks/useResources';
import { useProfiles, useServers } from '../../hooks/useStreaming';
import { BulkBar, DataTable } from '../../components/DataTable';
import { DeliveryBadge, validateDelivery } from '../../components/DeliverySelector';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Checkbox, ChipGroup, ErrorState, PageHeader, PageLoader, Spinner } from '../../components/ui';
import type { AstraChannel, AstraSource, DeliveryValue } from '../../types';
import { formatDateTime, formatNumber, timeAgo } from '../../utils/format';
import { syncSummary } from './AstraPage';
import { AstraSourceWizard, ImportOptionsFields } from './AstraSourceWizard';

function describeInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const k of ['url', 'address', 'source']) if (typeof o[k] === 'string') return o[k] as string;
    return JSON.stringify(input);
  }
  return String(input ?? '');
}

function InputSummary({ inputs }: { inputs: unknown[] }) {
  if (!inputs || inputs.length === 0) return <span className="muted">—</span>;
  const first = describeInput(inputs[0]);
  const scheme = (first.match(/^([a-z0-9+]+):\/\//i)?.[1] ?? '').toLowerCase();
  const icon = scheme.startsWith('dvb') ? <Satellite size={13} /> : scheme === 'udp' || scheme === 'rtp' ? <Waypoints size={13} /> : <Globe size={13} />;
  const label = scheme ? scheme.toUpperCase() : 'Entrada';
  return (
    <span className="input-summary" title={inputs.map(describeInput).join('\n')}>
      {icon} {label}
      {inputs.length > 1 && <span className="muted"> +{inputs.length - 1}</span>}
    </span>
  );
}

export function AstraSourcePage() {
  const { id } = useParams();
  const sourceId = Number(id);
  const toast = useToast();
  const [params] = useSearchParams();
  const source = useAsync(() => api.astra.get(sourceId), [sourceId]);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [imported, setImported] = useState<'' | 'true' | 'false' | 'removed'>(
    params.get('imported') === 'true' ? 'true' : params.get('imported') === 'false' ? 'false' : '',
  );
  const [onair, setOnair] = useState<'' | 'true' | 'false'>(params.get('onair') === 'true' ? 'true' : params.get('onair') === 'false' ? 'false' : '');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importTarget, setImportTarget] = useState<{ ids: number[] } | { group: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState<'sync' | 'status' | null>(null);
  const [deleteScope, setDeleteScope] = useState<DeleteScope | null>(null);
  const debounced = useDebounce(search);

  useEffect(() => setPage(1), [debounced, group, imported, onair, limit]);

  const channels = useAsync(
    () =>
      api.astra.channels(sourceId, {
        search: debounced.trim(),
        group,
        imported: imported === 'removed' ? '' : imported,
        removed: imported === 'removed' ? 'true' : '',
        onair,
        page,
        limit,
      }),
    [sourceId, debounced, group, imported, onair, page, limit],
  );
  const rows = channels.data?.data ?? [];
  const groups = channels.data?.groups ?? [];

  const refreshAll = () => {
    void channels.reload(true);
    void source.reload(true);
  };

  // Canales importados del grupo activo (para el alcance «Solo el grupo seleccionado»).
  const groupImported = useAsync(
    async () => (group ? (await api.astra.channels(sourceId, { group, imported: 'true', limit: 1 })).total : null),
    [sourceId, group, source.data?.counts.imported],
  );

  // Filas seleccionadas (de la página actual) que ya están importadas.
  const selectedImported = useMemo(() => rows.filter((r) => selected.has(r.id) && r.stream_id !== null).map((r) => r.id), [selected, rows]);

  const selectedNotImported = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    return [...selected].filter((cid) => {
      const r = byId.get(cid);
      return !r || (r.stream_id === null && !r.removed);
    });
  }, [selected, rows]);

  const runSync = async () => {
    setBusy('sync');
    try {
      toast.success(syncSummary(await api.astra.sync(sourceId)));
      refreshAll();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const runStatus = async () => {
    setBusy('status');
    try {
      const r = await api.astra.status(sourceId);
      toast.success(`Señal consultada: ${formatNumber(r.online)} al aire, ${formatNumber(r.offline)} sin señal`);
      refreshAll();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const s = source.data;
  if (source.loading && !s) return <PageLoader />;
  if (source.error && !s) return <ErrorState message={source.error} onRetry={() => void source.reload()} />;
  if (!s) return null;

  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={
          <>
            <span className="mono">{s.api_url}</span> ·{' '}
            <span title={formatDateTime(s.last_sync_at)}>{s.last_sync_at ? `sincronizado ${timeAgo(s.last_sync_at)}` : 'sin sincronizar'}</span>
            {s.last_status_at ? ` · señal ${timeAgo(s.last_status_at)}` : ''}
          </>
        }
        actions={
          <>
            <Link to="/astra" className="btn btn-ghost">
              <ArrowLeft size={16} /> Astra
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => void runSync()} disabled={busy !== null}>
              {busy === 'sync' ? <Spinner size={14} /> : <RefreshCw size={16} />} Sincronizar
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void runStatus()} disabled={busy !== null}>
              {busy === 'status' ? <Spinner size={14} /> : <Signal size={16} />} Consultar señal
            </button>
            <button type="button" className="btn btn-ghost btn-icon" title="Editar fuente" onClick={() => setEditOpen(true)}>
              <Pencil size={16} />
            </button>
            {s.counts.imported > 0 && (
              <button type="button" className="btn btn-danger-ghost" onClick={() => setDeleteScope(selectedImported.length ? 'selected' : group ? 'group' : 'all')}>
                <Trash2 size={16} /> Eliminar canales importados
              </button>
            )}
          </>
        }
      />
      {s.last_error && <Alert tone="red" title="Último error">{s.last_error}</Alert>}

      <div className="summary-strip">
        <span className="summary-item">
          <span className="summary-value">{formatNumber(s.counts.channels)}</span> <span className="summary-label">canales</span>
        </span>
        <span className="summary-item">
          <span className="summary-value text-blue">{formatNumber(s.counts.imported)}</span> <span className="summary-label">importados</span>
        </span>
        <span className="summary-item">
          <span className="summary-value text-amber">{formatNumber(s.counts.not_imported)}</span> <span className="summary-label">sin importar</span>
        </span>
        <span className="summary-item">
          <span className="status-dot dot-green" /> <span className="summary-value">{formatNumber(s.counts.onair)}</span> <span className="summary-label">al aire</span>
        </span>
        <span className="summary-item">
          <span className="status-dot dot-red" /> <span className="summary-value">{formatNumber(s.counts.offair)}</span> <span className="summary-label">sin señal</span>
        </span>
        <span className="summary-item">
          <span className="summary-label">Importa como</span> <DeliveryBadge mode={s.import_defaults.delivery_mode ?? 'default'} />
        </span>
      </div>

      <div className="toolbar">
        <div className="input-icon toolbar-search">
          <Search size={16} />
          <input className="input" placeholder="Buscar por nombre, ID o grupo…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {group && s.counts.not_imported > 0 && (
          <button type="button" className="btn btn-secondary" onClick={() => setImportTarget({ group })}>
            <Download size={16} /> Importar los no importados de «{group}»
          </button>
        )}
        {!group && s.counts.not_imported > 0 && (
          <button type="button" className="btn btn-secondary" onClick={() => setImportTarget({ group: '' })}>
            <Download size={16} /> Importar todos los no importados
          </button>
        )}
      </div>
      <ChipGroup value={group} onChange={setGroup} options={[{ value: '', label: 'Todos los grupos' }, ...groups.map((g) => ({ value: g, label: g }))]} />
      <div className="chips-row">
        <ChipGroup
          value={imported}
          onChange={setImported}
          options={[
            { value: '', label: 'Todos' },
            { value: 'true', label: 'Importados' },
            { value: 'false', label: 'Sin importar' },
            { value: 'removed', label: 'Eliminados en Astra' },
          ]}
        />
        <ChipGroup
          value={onair}
          onChange={setOnair}
          options={[
            { value: '', label: 'Cualquier señal' },
            { value: 'true', label: 'Al aire', tone: 'green' },
            { value: 'false', label: 'Sin señal', tone: 'red' },
          ]}
        />
      </div>

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <button type="button" className="btn btn-primary btn-sm" disabled={selectedNotImported.length === 0} onClick={() => setImportTarget({ ids: selectedNotImported })}>
          <Download size={14} /> Importar {formatNumber(selectedNotImported.length)} canal{selectedNotImported.length === 1 ? '' : 'es'}
        </button>
        {selectedImported.length > 0 && (
          <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setDeleteScope('selected')}>
            <Trash2 size={14} /> Eliminar del portal ({formatNumber(selectedImported.length)})
          </button>
        )}
      </BulkBar>

      <DataTable<AstraChannel>
        rows={rows}
        rowKey={(c) => c.id}
        loading={channels.loading}
        error={channels.error}
        onRetry={() => void channels.reload()}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        emptyTitle={search || group || imported || onair ? 'Ningún canal coincide' : 'No hay canales. Pulsa «Sincronizar».'}
        rowClassName={(c) => (c.removed ? 'row-muted' : !c.enabled ? 'row-muted' : '')}
        pagination={{ page, limit, total: channels.data?.total ?? 0, onPageChange: setPage, onLimitChange: setLimit }}
        columns={[
          {
            key: 'name',
            header: 'Canal',
            render: (c) => (
              <div className="cell-main">
                <span className="strong">{c.name}</span>
                <span className="muted text-xs">
                  <span className="mono">{c.astra_id}</span>
                  {!c.enabled && ' · deshabilitado en Astra'}
                  {c.removed && ' · eliminado en Astra'}
                </span>
              </div>
            ),
          },
          { key: 'group', header: 'Grupo', hideOnMobile: true, render: (c) => c.group || <span className="muted">—</span> },
          { key: 'input', header: 'Entrada', hideOnMobile: true, render: (c) => <InputSummary inputs={c.inputs} /> },
          {
            key: 'signal',
            header: 'Señal',
            render: (c) =>
              c.onair === null ? (
                <span className="muted text-sm">Sin consultar</span>
              ) : (
                <div className="cell-main">
                  <span className="row-inline nowrap">
                    <span className={`status-dot dot-${c.onair ? 'green' : 'red'}`} />
                    {c.onair ? 'Al aire' : 'Sin señal'}
                  </span>
                  <span className="muted text-xs nowrap" title={c.status_checked_at ? formatDateTime(c.status_checked_at) : undefined}>
                    {c.bitrate_kbps ? `${formatNumber(c.bitrate_kbps)} kbps` : '—'}
                    {c.cc_errors ? <span className="text-amber"> · CC {formatNumber(c.cc_errors)}</span> : ''}
                  </span>
                </div>
              ),
          },
          {
            key: 'imported',
            header: 'En el portal',
            render: (c) =>
              c.stream_id !== null ? (
                <div className="cell-main">
                  <Link to={`/canales?search=${encodeURIComponent(c.stream_name ?? c.name)}`} className="link strong">
                    {c.stream_name ?? `#${c.stream_id}`}
                  </Link>
                  <span className="row-inline">
                    <DeliveryBadge mode={c.stream_delivery_mode} />
                    {c.stream_enabled === false && <Badge tone="gray">Deshabilitado</Badge>}
                  </span>
                </div>
              ) : (
                <span className="muted">Sin importar</span>
              ),
          },
        ]}
      />

      <ImportModal
        source={s}
        target={importTarget}
        onClose={() => setImportTarget(null)}
        onImported={() => {
          setImportTarget(null);
          setSelected(new Set());
          refreshAll();
        }}
      />
      <DeleteImportedModal
        open={deleteScope !== null}
        source={s}
        defaultScope={deleteScope ?? 'all'}
        group={group}
        groupImported={groupImported.data ?? null}
        selectedIds={selectedImported}
        onClose={() => setDeleteScope(null)}
        onDeleted={() => {
          setDeleteScope(null);
          setSelected(new Set());
          refreshAll();
          void groupImported.reload(true);
        }}
      />
      <AstraSourceWizard
        open={editOpen}
        source={s}
        onClose={() => setEditOpen(false)}
        onSaved={(saved) => {
          setEditOpen(false);
          source.setData(saved);
          void channels.reload(true);
        }}
      />
    </>
  );
}

function ImportModal({
  source,
  target,
  onClose,
  onImported,
}: {
  source: AstraSource;
  target: { ids: number[] } | { group: string } | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const { categories } = useCategories('live');
  const { packages } = usePackages();
  const open = target !== null;
  const { servers } = useServers(open);
  const { profiles } = useProfiles(open);
  const [categoryMode, setCategoryMode] = useState<'group' | 'fixed'>('group');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [packageId, setPackageId] = useState<number | null>(null);
  const [delivery, setDelivery] = useState<DeliveryValue>({ delivery_mode: 'restream', transcode_profile_id: null, server_ids: [], always_on: false });
  const [saveDefault, setSaveDefault] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const d = source.import_defaults ?? {};
    setCategoryMode(d.category_mode ?? 'group');
    setCategoryId(d.category_id ?? null);
    setPackageId(d.package_id ?? null);
    setDelivery({
      delivery_mode: d.delivery_mode ?? 'restream',
      transcode_profile_id: d.transcode_profile_id ?? null,
      server_ids: d.server_ids ?? [],
      always_on: d.always_on ?? false,
    });
    setSaveDefault(false);
    setErrors({});
  }, [open, source]);

  const count = target && 'ids' in target ? target.ids.length : null;
  const title = count !== null ? `Importar ${formatNumber(count)} canal${count === 1 ? '' : 'es'}` : target && 'group' in target && target.group ? `Importar los no importados de «${target.group}»` : 'Importar todos los no importados';

  const submit = async () => {
    const e: Record<string, string | undefined> = {};
    const d = validateDelivery(delivery);
    if (d) e.delivery = d;
    if (categoryMode === 'fixed' && categoryId === null) e.category_id = 'Elige la categoría';
    setErrors(e);
    if (Object.values(e).some(Boolean) || !target) return;
    setBusy(true);
    try {
      const options = { category_mode: categoryMode, category_id: categoryMode === 'fixed' ? categoryId : null, package_id: packageId, ...delivery };
      const res = await api.astra.import(source.id, {
        ...('ids' in target ? { channel_ids: target.ids } : { all_not_imported: true, ...(target.group ? { group: target.group } : {}) }),
        options,
        save_as_default: saveDefault,
      });
      toast.success(
        `Importados ${formatNumber(res.created)} canal${res.created === 1 ? '' : 'es'}${res.categories_created ? ` · ${formatNumber(res.categories_created)} categorías nuevas` : ''}`,
      );
      onImported();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="lg"
      dismissible={!busy}
      onSubmit={() => void submit()}
      footer={
        <>
          <Checkbox checked={saveDefault} onChange={setSaveDefault} label="Guardar como predeterminado" />
          <div className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner size={14} /> : <Download size={15} />} Importar
          </button>
        </>
      }
    >
      <ImportOptionsFields
        categoryMode={categoryMode}
        categoryId={categoryId}
        packageId={packageId}
        delivery={delivery}
        categories={categories}
        packages={packages}
        servers={servers}
        profiles={profiles}
        errors={errors}
        onChange={(patch) => {
          if (patch.category_mode !== undefined) setCategoryMode(patch.category_mode);
          if (patch.category_id !== undefined) setCategoryId(patch.category_id);
          if (patch.package_id !== undefined) setPackageId(patch.package_id);
          if (patch.delivery !== undefined) setDelivery(patch.delivery);
          setErrors({});
        }}
      />
    </Modal>
  );
}
