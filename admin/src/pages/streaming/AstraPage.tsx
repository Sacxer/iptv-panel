import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Antenna, CircleAlert, Pencil, Plus, RefreshCw, Signal, Trash2 } from 'lucide-react';
import { api, asList, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { DeliveryBadge } from '../../components/DeliverySelector';
import { useToast } from '../../components/Toast';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../../components/ui';
import { Skeleton } from '../../components/charts';
import type { AstraSource, AstraSyncResult } from '../../types';
import { formatDateTime, formatNumber, timeAgo } from '../../utils/format';
import { AstraSourceWizard } from './AstraSourceWizard';
import { DeleteSourceModal } from './AstraDeleteModals';

export function syncSummary(r: AstraSyncResult): string {
  const parts = [`${formatNumber(r.total)} canales`];
  if (r.new) parts.push(`${formatNumber(r.new)} nuevos`);
  if (r.updated) parts.push(`${formatNumber(r.updated)} actualizados`);
  if (r.removed) parts.push(`${formatNumber(r.removed)} eliminados`);
  if (r.restored) parts.push(`${formatNumber(r.restored)} restaurados`);
  if (r.streams_updated) parts.push(`${formatNumber(r.streams_updated)} canales IPTV actualizados`);
  if (r.streams_disabled) parts.push(`${formatNumber(r.streams_disabled)} deshabilitados`);
  if (r.imported) parts.push(`${formatNumber(r.imported)} importados`);
  return `Sincronizado: ${parts.join(' · ')}`;
}

export function AstraPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const list = useAsync(async () => asList(await api.astra.sources()), []);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<AstraSource | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AstraSource | null>(null);

  const sync = async (s: AstraSource) => {
    setBusy(`sync-${s.id}`);
    try {
      toast.success(syncSummary(await api.astra.sync(s.id)));
      void list.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const status = async (s: AstraSource) => {
    setBusy(`status-${s.id}`);
    try {
      const r = await api.astra.status(s.id);
      toast.success(`Señal consultada: ${formatNumber(r.online)} al aire, ${formatNumber(r.offline)} sin señal (${formatNumber(r.checked)} revisados)`);
      void list.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = (s: AstraSource) => setDeleting(s);

  const rows = list.data ?? [];

  return (
    <>
      <PageHeader
        title="Astra"
        subtitle="Importa y mantiene sincronizados los canales de Cesbo Astra, en este u otro servidor"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setWizardOpen(true); }}>
            <Plus size={16} /> Agregar fuente
          </button>
        }
      />
      {list.loading && !list.data ? (
        <div className="astra-cards">
          {[0, 1].map((i) => (
            <div key={i} className="astra-card">
              <Skeleton width="50%" height={18} />
              <Skeleton width="80%" height={12} />
              <Skeleton width="100%" height={54} radius={10} />
            </div>
          ))}
        </div>
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.reload()} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Antenna size={30} />}
            title="Aún no hay fuentes Astra"
            description="Conecta tu Astra para ver sus canales, importarlos en bloque con el modo de entrega que elijas y mantenerlos sincronizados."
            action={
              <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setWizardOpen(true); }}>
                <Plus size={16} /> Agregar fuente
              </button>
            }
          />
        </div>
      ) : (
        <div className="astra-cards">
          {rows.map((s) => (
            <article key={s.id} className={`astra-card ${s.enabled ? '' : 'is-disabled'}`}>
              <header className="server-card-head">
                <span className="panel-icon astra-icon">
                  <Antenna size={18} />
                </span>
                <div className="grow cell-main">
                  <Link to={`/astra/${s.id}`} className="server-card-name">
                    {s.name}
                  </Link>
                  <span className="muted text-xs mono ellipsis">{s.api_url}</span>
                </div>
                {!s.enabled && <span className="badge badge-gray">Deshabilitada</span>}
              </header>
              <div className="astra-counts">
                <Link to={`/astra/${s.id}`} className="scs">
                  <span className="scs-value">{formatNumber(s.counts.channels)}</span>
                  <span className="scs-label">Canales</span>
                </Link>
                <Link to={`/astra/${s.id}?imported=true`} className="scs">
                  <span className="scs-value text-blue">{formatNumber(s.counts.imported)}</span>
                  <span className="scs-label">Importados</span>
                </Link>
                <Link to={`/astra/${s.id}?imported=false`} className="scs">
                  <span className={`scs-value ${s.counts.not_imported ? 'text-amber' : ''}`}>{formatNumber(s.counts.not_imported)}</span>
                  <span className="scs-label">Sin importar</span>
                </Link>
                <Link to={`/astra/${s.id}?onair=true`} className="scs">
                  <span className="scs-value text-green">{formatNumber(s.counts.onair)}</span>
                  <span className="scs-label">Al aire</span>
                </Link>
                <Link to={`/astra/${s.id}?onair=false`} className="scs">
                  <span className={`scs-value ${s.counts.offair ? 'text-red' : ''}`}>{formatNumber(s.counts.offair)}</span>
                  <span className="scs-label">Sin señal</span>
                </Link>
              </div>
              <div className="server-card-meta">
                <span title={formatDateTime(s.last_sync_at)}>{s.last_sync_at ? `Sincronizado ${timeAgo(s.last_sync_at)}` : 'Nunca sincronizado'}</span>
                <span>Importa como</span>
                <DeliveryBadge mode={s.import_defaults.delivery_mode ?? 'default'} />
              </div>
              {s.last_error && (
                <div className="server-pending is-error" title={s.last_error}>
                  <CircleAlert size={14} /> {s.last_error}
                </div>
              )}
              <footer className="server-card-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void sync(s)} disabled={busy !== null}>
                  {busy === `sync-${s.id}` ? <Spinner size={13} /> : <RefreshCw size={14} />} Sincronizar
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void status(s)} disabled={busy !== null}>
                  {busy === `status-${s.id}` ? <Spinner size={13} /> : <Signal size={14} />} Consultar señal
                </button>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => { setEditing(s); setWizardOpen(true); }}>
                  <Pencil size={14} />
                </button>
                <button type="button" className="btn btn-ghost btn-icon btn-sm text-red" title="Eliminar" onClick={() => remove(s)}>
                  <Trash2 size={14} />
                </button>
                <div className="grow" />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/astra/${s.id}`)}>
                  Ver canales
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
      <DeleteSourceModal
        source={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          void list.reload(true);
        }}
      />
      <AstraSourceWizard
        open={wizardOpen}
        source={editing}
        onClose={() => setWizardOpen(false)}
        onSaved={(s, created) => {
          setWizardOpen(false);
          void list.reload(true);
          if (created) navigate(`/astra/${s.id}`);
        }}
      />
    </>
  );
}
