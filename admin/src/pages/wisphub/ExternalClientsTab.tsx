import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Link2Off, ListChecks, RefreshCw, Search, UsersRound } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { BulkBar, DataTable } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { ExternalStatusBadge } from '../../components/ExternalStatus';
import { UserSearchSelect } from '../../components/UserSearchSelect';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, ChipGroup, FormField, Select, Spinner } from '../../components/ui';
import type { BillingOverview, ExternalClient, ExternalClientsSummary } from '../../types';
import { formatDateTime, formatNumber } from '../../utils/format';
import { LINK_METHOD, MAPPED_STATUS } from '../../utils/labels';
import { BulkLinkWizard, SyncAllDialog } from './BulkLinkWizard';

type MappedFilter = '' | 'free' | 'active' | 'suspended' | 'disabled';

const UNLINKED_CHIPS: { value: Exclude<MappedFilter, ''>; label: string; tone: 'teal' | 'green' | 'red' | 'gray'; title?: string }[] = [
  { value: 'free', label: 'Gratis sin vincular', tone: 'teal', title: 'Servicios Gratis: no les afecta el corte' },
  { value: 'active', label: 'Activos sin vincular', tone: 'green' },
  { value: 'suspended', label: 'Suspendidos sin vincular', tone: 'red' },
  { value: 'disabled', label: 'Cancelados sin vincular', tone: 'gray' },
];

export function ExternalClientsTab({ overview, onChanged }: { overview: BillingOverview; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [linked, setLinked] = useState<'' | 'true' | 'false'>('');
  const [status, setStatus] = useState('');
  const [mappedStatus, setMappedStatus] = useState<MappedFilter>('');
  const [plan, setPlan] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [linking, setLinking] = useState<ExternalClient | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /** id → ya vinculado, para saber cuántos marcados se pueden procesar aunque cambie la página. */
  const [selectedLinked, setSelectedLinked] = useState<Map<number, boolean>>(new Map());
  const [dialog, setDialog] = useState<null | 'sync' | 'wizard'>(null);
  const debounced = useDebounce(search);

  useEffect(() => setPage(1), [debounced, linked, status, mappedStatus, plan, limit]);

  const list = useAsync(
    () => api.billing.externalClients({ search: debounced.trim(), linked, status, mapped_status: mappedStatus, plan, page, limit }),
    [debounced, linked, status, mappedStatus, plan, page, limit],
  );
  const summary = useAsync(() => api.billing.externalSummary(), []);

  const rows = useMemo(() => list.data?.data ?? [], [list.data]);
  /** Servicios por cuenta IPTV dentro de la página (una cuenta por persona). */
  const servicesByUser = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r) => {
      if (r.user_id !== null) m.set(r.user_id, (m.get(r.user_id) ?? 0) + 1);
    });
    return m;
  }, [rows]);

  const statusOptions = useMemo(() => {
    const m = overview.config.status_map;
    return [...new Set([...(m?.free ?? []), ...(m?.active ?? []), ...(m?.suspended ?? []), ...(m?.disabled ?? [])])].map((v) => ({ value: v, label: v }));
  }, [overview.config.status_map]);

  const planOptions = useMemo(
    () => (summary.data?.plans ?? []).map((p) => ({ value: p.name, label: `${p.name || '(sin plan)'} (${formatNumber(p.count)})` })),
    [summary.data],
  );

  const selectedUnlinkedIds = useMemo(() => [...selectedLinked].filter(([, l]) => !l).map(([id]) => id), [selectedLinked]);

  const changeSelection = (next: Set<number>) => {
    setSelected(next);
    setSelectedLinked((prev) => {
      const m = new Map<number, boolean>();
      next.forEach((id) => {
        const row = rows.find((r) => r.id === id);
        m.set(id, row ? row.user_id !== null : (prev.get(id) ?? false));
      });
      return m;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setSelectedLinked(new Map());
  };

  const refreshAll = () => {
    void list.reload(true);
    void summary.reload(true);
    onChanged();
  };

  const toggleMapped = (value: Exclude<MappedFilter, ''>) => {
    if (mappedStatus === value && linked === 'false') {
      setMappedStatus('');
      setLinked('');
    } else {
      setMappedStatus(value);
      setLinked('false');
      setStatus('');
    }
  };

  const unlink = async (c: ExternalClient) => {
    const ok = await confirm({
      title: 'Desvincular cliente',
      message: (
        <>
          ¿Desvincular <strong>{c.name}</strong> del cliente IPTV <strong>{c.iptv_username}</strong>? Dejará de cortarse y reactivarse
          según la plataforma{c.iptv_suspension_source === 'external' ? '; su corte actual pasará a considerarse manual' : ''}.
        </>
      ),
      confirmText: 'Desvincular',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.billing.unlink(c.id);
      toast.success('Cliente desvinculado');
      refreshAll();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const filtered = Boolean(search || linked || status || mappedStatus || plan);

  return (
    <>
      {overview.counts.external_clients === 0 && (
        <Alert tone="blue">Aún no hay clientes importados. Configura la integración y ejecuta una sincronización (o una simulación) para verlos aquí.</Alert>
      )}

      <LinkSummary
        summary={summary.data}
        loading={summary.loading}
        error={summary.error}
        mappedStatus={linked === 'false' ? mappedStatus : ''}
        onToggle={toggleMapped}
        onSyncAll={() => setDialog('sync')}
        onWizard={() => setDialog('wizard')}
      />

      <div className="toolbar">
        <div className="input-icon toolbar-search">
          <Search size={16} />
          <input className="input" placeholder="Buscar por nombre, cédula, usuario, email, teléfono o ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onChange={setStatus} placeholder="Todos los estados" options={statusOptions} ariaLabel="Estado en la plataforma" />
        <Select value={plan} onChange={setPlan} placeholder="Todos los planes" options={planOptions} ariaLabel="Plan" />
      </div>
      <div className="row row-between">
        <ChipGroup
          value={linked}
          onChange={setLinked}
          options={[
            { value: '', label: 'Todos' },
            { value: 'true', label: 'Vinculados' },
            { value: 'false', label: 'Sin vincular' },
          ]}
        />
        {mappedStatus && (
          <button type="button" className="chip chip-active chip-removable" onClick={() => setMappedStatus('')} title="Quitar filtro">
            Estado: {MAPPED_STATUS[mappedStatus]?.label ?? mappedStatus} ×
          </button>
        )}
      </div>

      <BulkBar count={selected.size} onClear={clearSelection}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={selectedUnlinkedIds.length === 0}
          title={selectedUnlinkedIds.length === 0 ? 'Los marcados ya están vinculados' : undefined}
          onClick={() => setDialog('wizard')}
        >
          <ListChecks size={14} /> Vincular seleccionados ({formatNumber(selectedUnlinkedIds.length)})
        </button>
      </BulkBar>

      <DataTable<ExternalClient>
        rows={rows}
        rowKey={(c) => c.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        emptyTitle={filtered ? 'Ningún cliente coincide' : 'No hay clientes de la plataforma'}
        pagination={{ page, limit, total: list.data?.total ?? 0, onPageChange: setPage, onLimitChange: setLimit }}
        rowClassName={(c) => (c.user_id === null ? 'row-warning' : '')}
        selectable
        selected={selected}
        onSelectedChange={changeSelection}
        columns={[
          {
            key: 'name',
            header: 'Cliente en la plataforma',
            render: (c) => (
              <div className="cell-main">
                <span className="strong">{c.name || '—'}</span>
                <span className="muted text-xs">
                  ID {c.external_id}
                  {c.plan ? ` · ${c.plan}` : ''}
                </span>
              </div>
            ),
          },
          { key: 'doc', header: 'Cédula', render: (c) => <span className="mono text-sm">{c.document_id || '—'}</span> },
          { key: 'user', header: 'Usuario', hideOnMobile: true, render: (c) => c.username || <span className="muted">—</span> },
          {
            key: 'status',
            header: 'Estado externo',
            render: (c) => <ExternalStatusBadge status={c.status} mapped={c.status_mapped ?? 'unknown'} />,
          },
          {
            key: 'iptv',
            header: 'Cliente IPTV',
            render: (c) =>
              c.user_id !== null ? (
                <div className="cell-main">
                  <Link className="link strong" to={`/clientes?search=${encodeURIComponent(c.iptv_username ?? '')}`}>
                    {c.iptv_username}
                  </Link>
                  <span className="row-inline">
                    {c.iptv_status && <StatusBadge status={c.iptv_status} />}
                    {(servicesByUser.get(c.user_id) ?? 0) > 1 && (
                      <span className="shared-account" title="Varios servicios de esta página (misma cédula) comparten esta cuenta IPTV">
                        <UsersRound size={12} /> cuenta compartida ({servicesByUser.get(c.user_id)})
                      </span>
                    )}
                    {c.iptv_status === 'suspended' && (
                      <span className="muted text-xs">{c.iptv_suspension_source === 'external' ? 'por la plataforma' : 'manual'}</span>
                    )}
                  </span>
                </div>
              ) : (
                <span className="muted">Sin vincular</span>
              ),
          },
          {
            key: 'method',
            header: 'Vínculo',
            hideOnMobile: true,
            render: (c) =>
              c.link_method ? (
                <span className="text-sm" title={c.synced_at ? `Sincronizado ${formatDateTime(c.synced_at)}` : undefined}>
                  {LINK_METHOD[c.link_method] ?? c.link_method}
                </span>
              ) : (
                <span className="muted">—</span>
              ),
          },
          {
            key: 'actions',
            header: '',
            className: 'col-actions',
            render: (c) => (
              <div className="row-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinking(c)}>
                  <Link2 size={14} /> {c.user_id === null ? 'Vincular' : 'Cambiar'}
                </button>
                {c.user_id !== null && (
                  <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => void unlink(c)} title="Desvincular">
                    <Link2Off size={14} />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />
      <LinkModal
        client={linking}
        onClose={() => setLinking(null)}
        onSaved={() => {
          setLinking(null);
          refreshAll();
        }}
      />
      {dialog === 'sync' && (
        <SyncAllDialog
          overview={overview}
          summary={summary.data}
          initialStatus={linked === 'false' ? mappedStatus : ''}
          onClose={() => setDialog(null)}
          onApplied={() => {
            clearSelection();
            refreshAll();
          }}
        />
      )}
      {dialog === 'wizard' && (
        <BulkLinkWizard
          overview={overview}
          summary={summary.data}
          selectedIds={selectedUnlinkedIds}
          selectedLinkedCount={selected.size - selectedUnlinkedIds.length}
          initialStatus={mappedStatus}
          initialPlan={plan}
          initialSearch={debounced.trim()}
          onClose={() => setDialog(null)}
          onApplied={() => {
            clearSelection();
            refreshAll();
          }}
        />
      )}
    </>
  );
}

function LinkSummary({
  summary,
  loading,
  error,
  mappedStatus,
  onToggle,
  onSyncAll,
  onWizard,
}: {
  summary: ExternalClientsSummary | null;
  loading: boolean;
  error: string | null;
  mappedStatus: MappedFilter;
  onToggle: (v: Exclude<MappedFilter, ''>) => void;
  onSyncAll: () => void;
  onWizard: () => void;
}) {
  const u = summary?.unlinked_by_status;
  const unlinked = u ? (u.free ?? 0) + u.active + u.suspended + u.disabled + u.unknown : 0;
  const pct = summary && summary.total > 0 ? Math.round((summary.linked / summary.total) * 100) : 0;
  const noneLeft = !summary || unlinked === 0;

  return (
    <section className="card link-summary">
      <div className="link-summary-top">
        <div className="link-summary-counts">
          {loading && !summary ? (
            <Spinner size={16} label="Cargando resumen…" />
          ) : error && !summary ? (
            <span className="text-red text-sm">{error}</span>
          ) : summary ? (
            <>
              <div className="link-summary-figures">
                <span>
                  <strong>{formatNumber(summary.total)}</strong> en WispHub
                </span>
                <span>
                  <strong className="text-green">{formatNumber(summary.linked)}</strong> vinculados
                </span>
                <span>
                  <strong className={unlinked > 0 ? 'text-amber' : ''}>{formatNumber(unlinked)}</strong> faltan por sincronizar
                </span>
              </div>
              <div className="progress link-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Clientes vinculados">
                <div className="progress-bar" style={{ width: `${pct}%` }} />
              </div>
            </>
          ) : null}
        </div>
        <div className="link-summary-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg-soft"
            onClick={onSyncAll}
            disabled={noneLeft}
            title={summary && unlinked === 0 ? 'Todos los clientes ya están vinculados' : undefined}
          >
            <RefreshCw size={16} /> Sincronizar todos
          </button>
          <button type="button" className="btn btn-secondary" onClick={onWizard} disabled={noneLeft}>
            <ListChecks size={16} /> Vincular en lote…
          </button>
        </div>
      </div>
      {summary && (
        <div className="chips link-summary-chips" aria-label="Filtrar sin vincular por estado">
          {UNLINKED_CHIPS.map((c) => {
            const n = u?.[c.value] ?? 0;
            const active = mappedStatus === c.value;
            return (
              <button
                key={c.value}
                type="button"
                className={`chip chip-status chip-status-${c.tone} ${active ? 'chip-active' : ''}`}
                aria-pressed={active}
                title={c.title}
                onClick={() => onToggle(c.value)}
              >
                <span className="dot" /> {c.label} <span className="chip-count">{formatNumber(n)}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LinkModal({ client, onClose, onSaved }: { client: ExternalClient | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [userId, setUserId] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUserId(client?.user_id ?? null);
    setLabel(client?.iptv_username ?? '');
    setError(null);
  }, [client]);

  const save = async () => {
    if (!client || userId === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.billing.link(client.id, userId);
      toast.success(`${client.name} vinculado a ${label || 'el cliente'}`);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={client !== null}
      title={`Vincular: ${client?.name ?? ''}`}
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || userId === null || userId === client?.user_id}>
            {busy && <Spinner size={14} />} Vincular
          </button>
        </>
      }
    >
      {error && <Alert tone="red">{error}</Alert>}
      {client && (
        <p className="muted text-sm">
          Cédula {client.document_id || '—'} · Usuario {client.username || '—'} · Estado <strong>{client.status}</strong>
        </p>
      )}
      <FormField label="Cliente IPTV" hint="Desde ahora sus cortes y reactivaciones seguirán el estado en la plataforma (según el modo de cortes).">
        <UserSearchSelect
          userId={userId}
          label={label}
          onChange={(u) => {
            setUserId(u?.id ?? null);
            setLabel(u?.username ?? '');
          }}
        />
      </FormField>
    </Modal>
  );
}
