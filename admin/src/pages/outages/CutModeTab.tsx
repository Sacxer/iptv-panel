import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, CircleAlert, CircleCheck, Gift, Hand, Layers, Link2, ShieldBan } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Spinner } from '../../components/ui';
import { formatDateTime, formatNumber, timeAgo } from '../../utils/format';
import { AutoSyncCard, CheckSuspendedButton } from '../wisphub/AutoSync';
import type { BillingOverview, CutMode } from '../../types';
import { CUT_MODE } from '../../utils/labels';

const MODES: { mode: CutMode; icon: ReactElement; description: string; example: string }[] = [
  {
    mode: 'manual',
    icon: <Hand size={22} />,
    description: 'Solo desde el portal. Tú decides a quién suspender y reactivar desde Clientes.',
    example: 'Ejemplo: un cliente no paga, entras a Clientes → Suspender; cuando paga, pulsas Reactivar.',
  },
  {
    mode: 'external',
    icon: <Link2 size={22} />,
    description:
      'Los clientes vinculados se cortan y reactivan según WispHub; en el portal no se pueden cortar a mano. Los no vinculados siguen siendo manuales. Los servicios Gratis nunca se cortan.',
    example: 'Ejemplo: WispHub corta a María por falta de pago → su TV se suspende; paga y WispHub la activa → la TV vuelve sola.',
  },
  {
    mode: 'both',
    icon: <Layers size={22} />,
    description:
      'WispHub suspende y reactiva, y además puedes cortar a mano; un corte manual nunca se levanta automáticamente. Los servicios Gratis nunca los corta WispHub.',
    example: 'Ejemplo: cortas a Juan a mano por uso indebido; aunque WispHub lo marque Activo, seguirá cortado hasta que lo reactives tú.',
  },
];

export function CutModeTab({ overview, onChanged }: { overview: BillingOverview; onChanged: (o: BillingOverview) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [saving, setSaving] = useState<CutMode | null>(null);
  const current = overview.cut_mode;
  const configured = overview.config.api_key_set && overview.config.base_url;

  const choose = async (mode: CutMode) => {
    if (mode === current) return;
    if (mode !== 'manual' && !configured) {
      const ok = await confirm({
        title: 'Integración sin configurar',
        message: 'Aún no has configurado la conexión con WispHub. Puedes elegir este modo, pero no habrá cambios automáticos hasta que la configures y actives la sincronización.',
        confirmText: 'Elegir de todos modos',
      });
      if (!ok) return;
    }
    setSaving(mode);
    try {
      const o = await api.billing.update({ cut_mode: mode });
      toast.success(`Modo de cortes: ${CUT_MODE[mode].label}`);
      onChanged(o);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="stack">
      <p className="muted no-margin">Elige quién decide los cortes por falta de pago de cada cliente.</p>
      <div className="mode-cards">
        {MODES.map((m) => {
          const active = m.mode === current;
          return (
            <button
              key={m.mode}
              type="button"
              className={`mode-card ${active ? 'is-active' : ''}`}
              aria-pressed={active}
              disabled={saving !== null}
              onClick={() => void choose(m.mode)}
            >
              <span className="mode-card-top">
                <span className="mode-icon">{m.icon}</span>
                {active ? (
                  <span className="badge badge-green">
                    <CircleCheck size={12} /> Activo
                  </span>
                ) : saving === m.mode ? (
                  <Spinner size={14} />
                ) : null}
              </span>
              <span className="mode-title">{CUT_MODE[m.mode].label}</span>
              <span className="mode-desc">{m.description}</span>
              <span className="mode-example">{m.example}</span>
            </button>
          );
        })}
      </div>
      <Alert tone="blue" icon={<Gift size={18} />} title="Clientes Gratis">
        Los clientes con un servicio en estado <strong>Gratis</strong> en WispHub nunca se cortan desde la plataforma: cuentan como activos. Si una
        persona tiene varios servicios con la misma cédula, su única cuenta IPTV queda activa mientras alguno esté Gratis o Activo.
      </Alert>
      {current !== 'manual' && !overview.config.enabled && (
        <Alert tone="amber" title="La sincronización está desactivada">
          El modo elegido depende de WispHub, pero la sincronización automática está apagada. Actívala en{' '}
          <Link className="link" to="/migracion-wisphub?tab=conexion">
            Migración WispHub → Conexión
          </Link>
          .
        </Alert>
      )}
      <IntegrationStatusCard overview={overview} onChanged={onChanged} />
    </div>
  );
}

/** Resumen del estado de la integración con WispHub (la configuración vive en Migración WispHub). */
function IntegrationStatusCard({ overview, onChanged }: { overview: BillingOverview; onChanged: (o: BillingOverview) => void }) {
  const run = overview.last_run;
  const configured = Boolean(overview.config.api_key_set && overview.config.base_url);
  return (
    <section className="card integration-card">
      <div className="integration-card-head">
        <div>
          <h2 className="card-title no-margin">Integración WispHub</h2>
          <p className="muted text-sm no-margin">{configured ? 'Conexión configurada' : 'Aún no se ha configurado la conexión'}</p>
        </div>
        <span className={`badge ${overview.config.enabled ? 'badge-green' : 'badge-gray'}`}>
          {overview.config.enabled ? 'Sincronización automática' : 'Sincronización apagada'}
        </span>
      </div>
      <div className="integration-card-stats">
        <div className="integration-stat">
          <CalendarClock size={16} className="muted" />
          <span className="muted">Última sincronización</span>
          <strong title={run?.finished_at ? formatDateTime(run.finished_at) : undefined}>
            {overview.running ? 'en curso…' : run?.finished_at ? timeAgo(run.finished_at) : 'nunca'}
          </strong>
        </div>
        <div className="integration-stat">
          <Link2 size={16} className="text-green" />
          <span className="muted">Vinculados</span>
          <strong>{formatNumber(overview.counts.linked)}</strong>
        </div>
        <div className="integration-stat">
          <ShieldBan size={16} className="text-red" />
          <span className="muted">Suspendidos por la plataforma</span>
          <strong>{formatNumber(overview.counts.suspended_by_external)}</strong>
        </div>
      </div>
      {run?.status === 'error' && (
        <div className="integration-error" title={run.error ?? undefined}>
          <CircleAlert size={15} /> <span className="ellipsis">Última sincronización con error: {run.error ?? 'error desconocido'}</span>
        </div>
      )}
      {overview.auto_sync && <AutoSyncCard overview={overview} onChanged={onChanged} compact />}
      <div className="row row-end mt-sm">
        <CheckSuspendedButton
          overview={overview}
          className="btn btn-secondary btn-sm"
          onDone={() => void api.billing.get().then(onChanged).catch(() => undefined)}
        />
        <Link to="/migracion-wisphub?tab=conexion" className="btn btn-secondary btn-sm">
          Configurar en Migración WispHub <ArrowRight size={14} />
        </Link>
      </div>
    </section>
  );
}
