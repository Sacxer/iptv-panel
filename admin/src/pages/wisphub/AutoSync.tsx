import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, RefreshCw, Save, TimerReset } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useInterval } from '../../hooks/useInterval';
import { Modal } from '../../components/Modal';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Spinner } from '../../components/ui';
import type { BillingOverview, BillingRun, User } from '../../types';
import { formatDateTime, formatNumber, timeAgo, timeFromNow } from '../../utils/format';
import { MAPPED_STATUS } from '../../utils/labels';

/** La integración tiene lo mínimo para consultar la plataforma. */
export function billingConfigured(o: BillingOverview | null | undefined): boolean {
  return Boolean(o && o.config.api_key_set && o.config.base_url);
}

function disabledReason(o: BillingOverview): string | null {
  if (!o.config.enabled) return 'la integración está apagada';
  if (!o.config.api_key_set) return 'falta la API Key';
  if (o.cut_mode === 'manual') return 'el modo de cortes es Manual';
  return null;
}

// ---------- Revisión automática ----------

export function AutoSyncCard({ overview, onChanged, compact = false }: { overview: BillingOverview; onChanged: (o: BillingOverview) => void; compact?: boolean }) {
  const toast = useToast();
  const a = overview.auto_sync;
  const [minutes, setMinutes] = useState(String(a?.interval_minutes ?? overview.config.interval_minutes ?? 15));
  const [saving, setSaving] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => setMinutes(String(a?.interval_minutes ?? overview.config.interval_minutes ?? 15)), [a?.interval_minutes, overview.config.interval_minutes]);
  // Refresca el «en X min» cada 30 s.
  useInterval(() => tick((n) => n + 1), 30000);

  if (!a) return null;
  const reason = a.enabled ? null : disabledReason(overview);
  const value = Number(minutes);
  const valid = Number.isInteger(value) && value >= 1 && value <= 1440;
  const changed = valid && value !== a.interval_minutes;

  const save = async () => {
    if (!changed) return;
    setSaving(true);
    try {
      const next = await api.billing.update({ config: { interval_minutes: value } });
      onChanged(next);
      toast.success(`Revisará cada ${value} ${value === 1 ? 'minuto' : 'minutos'}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`autosync ${compact ? 'autosync-compact' : 'card'}`}>
      <div className="autosync-head">
        <span className="row-inline">
          <TimerReset size={16} />
          <strong>Revisión automática</strong>
          {a.enabled ? (
            <Badge tone="green" dot>
              Activa
            </Badge>
          ) : (
            <Badge tone="gray" dot>
              Apagada
            </Badge>
          )}
          {a.running && (
            <Badge tone="blue">
              <Spinner size={10} /> Revisando…
            </Badge>
          )}
        </span>
        <label className="autosync-interval">
          Revisa cada
          <input
            className="input input-sm"
            type="number"
            min={1}
            max={1440}
            value={minutes}
            aria-label="Minutos entre revisiones"
            onChange={(e) => setMinutes(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save();
              }
            }}
          />
          minutos
          {changed && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner size={12} /> : <Save size={13} />} Guardar
            </button>
          )}
        </label>
      </div>
      {!valid && <div className="text-red text-xs">Entre 1 y 1440 minutos.</div>}
      <div className="autosync-meta muted text-sm">
        <span>
          Última revisión:{' '}
          {a.last_run_at ? (
            <span title={formatDateTime(a.last_run_at)}>
              {timeAgo(a.last_run_at)}
              {a.last_status === 'error' ? <span className="text-red"> (con error)</span> : a.last_status === 'done' || a.last_status === 'ok' ? ' (correcta)' : ''}
            </span>
          ) : (
            'nunca'
          )}
        </span>
        {a.enabled && a.next_run_at && <span>Próxima revisión {timeFromNow(a.next_run_at)}</span>}
      </div>
      {reason && (
        <p className="text-sm no-margin text-amber">
          No se revisa sola porque {reason}.{' '}
          {overview.cut_mode === 'manual' ? (
            <Link className="link" to="/cortes?tab=modo">
              Cambiar modo de cortes
            </Link>
          ) : (
            <Link className="link" to="/migracion-wisphub?tab=conexion">
              Revisar la conexión
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

// ---------- Revisar suspendidos ahora ----------

export function CheckSuspendedButton({
  overview,
  onDone,
  className = 'btn btn-secondary',
}: {
  overview: BillingOverview;
  onDone?: () => void;
  className?: string;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BillingRun | null>(null);
  const n = overview.counts.cut_linked ?? 0;

  if (!billingConfigured(overview)) return null;

  const run = async () => {
    const ok = await confirm({
      title: 'Revisar suspendidos ahora',
      message:
        overview.cut_mode === 'manual'
          ? 'Se consultará WispHub para ver quién ya pagó, pero el modo de cortes es Manual: no se reactivará a nadie.'
          : `Se consultará WispHub para las ${formatNumber(n)} cuentas cortadas y se reactivará a quienes ya aparezcan activos o gratis. No se corta a nadie nuevo ni se levantan cortes manuales.`,
      confirmText: 'Revisar',
    });
    if (!ok) return;
    setRunning(true);
    try {
      const res = await api.billing.checkSuspended();
      setResult(res);
      onDone?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <button type="button" className={className} onClick={() => void run()} disabled={running}>
        {running ? <Spinner size={14} /> : <RefreshCw size={16} />} {n > 0 ? `Revisar ${formatNumber(n)} suspendido${n === 1 ? '' : 's'}` : 'Revisar suspendidos ahora'}
      </button>
      <CheckSuspendedResult run={result} onClose={() => setResult(null)} />
    </>
  );
}

function CheckSuspendedResult({ run, onClose }: { run: BillingRun | null; onClose: () => void }) {
  const s = run?.stats ?? {};
  const changes = run?.changes ?? [];
  const reactivated = changes.filter((c) => c.action === 'reactivate');
  const manual = changes.filter((c) => c.action === 'skip_manual');
  const applied = s.applied !== false;
  return (
    <Modal
      open={run !== null}
      title="Revisión de suspendidos"
      onClose={onClose}
      size="md"
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      {run && (
        <div className="stack">
          {run.error ? (
            <Alert tone="red" icon={<CircleAlert size={18} />} title="La revisión falló">
              {run.error}
            </Alert>
          ) : !applied ? (
            <Alert tone="amber" title="Modo de cortes manual: no se aplicó ningún cambio">
              Se consultó WispHub, pero en modo Manual los clientes no se reactivan solos.
            </Alert>
          ) : (
            <Alert tone={reactivated.length > 0 ? 'green' : 'blue'} icon={<CircleCheck size={18} />}>
              {reactivated.length > 0
                ? `Se reactivaron ${formatNumber(reactivated.length)} cliente${reactivated.length === 1 ? '' : 's'}.`
                : 'Nadie más aparece como pagado en WispHub por ahora.'}
            </Alert>
          )}
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="stat-tile-value">{formatNumber(s.checked ?? 0)}</span>
              <span className="stat-tile-label">Cuentas revisadas</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value tile-green">{formatNumber(reactivated.length)}</span>
              <span className="stat-tile-label">{applied ? 'Reactivadas' : 'Se reactivarían'}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value tile-amber">{formatNumber(s.skipped_manual ?? manual.length)}</span>
              <span className="stat-tile-label">Con corte manual</span>
            </div>
          </div>
          {reactivated.length > 0 && (
            <div>
              <div className="field-label">{applied ? 'Reactivados' : 'Se reactivarían (modo manual)'}</div>
              <ul className="check-list">
                {reactivated.map((c) => (
                  <li key={`${c.user_id}-${c.external_id}`}>
                    <strong>{c.username ?? '—'}</strong>
                    <span className="muted text-sm">
                      {c.external_name} · WispHub: {c.external_status}
                      {(c.services ?? 0) > 1 ? ` · ${c.services} servicios` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {manual.length > 0 && (
            <Alert tone="amber" title={`${formatNumber(manual.length)} con corte manual`}>
              WispHub los marca activos, pero se suspendieron a mano en el portal: esos cortes no se levantan automáticamente. Reactívalos desde Clientes
              si corresponde ({manual
                .slice(0, 8)
                .map((c) => c.username)
                .filter(Boolean)
                .join(', ')}
              {manual.length > 8 ? '…' : ''}).
            </Alert>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------- Actualizar un cliente desde WispHub ----------

const ACTION_TEXT: Record<string, string> = {
  reactivate: 'Reactivado',
  suspend: 'Suspendido',
  disable: 'Deshabilitado',
};

/** Consulta WispHub para un cliente y muestra el resultado; devuelve el cliente actualizado. */
export function useUserRefresh() {
  const toast = useToast();
  return async (user: Pick<User, 'id' | 'username'>): Promise<User | null> => {
    try {
      const r = await api.billing.refreshUser(user.id);
      const main = r.services?.[0];
      const status = r.change?.external_status ?? main?.status ?? '—';
      const services = (r.services ?? [])
        .map((s) => `#${s.external_id} ${MAPPED_STATUS[s.status_mapped ?? '']?.label ?? s.status}${s.plan ? ` (${s.plan})` : ''}`)
        .join(' · ');
      const action = r.change?.action ?? '';
      let head: string;
      if (ACTION_TEXT[action]) {
        head = r.applied
          ? `${ACTION_TEXT[action]}: WispHub lo marca ${status}`
          : `Modo de cortes manual: no se aplicó (${ACTION_TEXT[action].toLowerCase()} según WispHub, ${status})`;
      } else {
        head = `Sin cambios (${status})`;
      }
      const missing = r.missing?.length ? ` · sin respuesta: ${r.missing.join(', ')}` : '';
      const text = `${user.username}: ${head}${services ? ` — ${services}` : ''}${missing}`;
      if (ACTION_TEXT[action] && r.applied) toast.success(text);
      else toast.info(text);
      return r.user ?? null;
    } catch (e) {
      toast.error(`${user.username}: ${errorMessage(e)}`);
      return null;
    }
  };
}
