import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, ListChecks, Loader } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useInterval } from '../../hooks/useInterval';
import { Alert, Badge, CopyButton, ErrorState, PageLoader } from '../../components/ui';
import type { XtreamJob } from '../../types';
import { formatDateTime, formatElapsed, formatNumber, nowUnix } from '../../utils/format';
import { JOB_STATUS, MIGRATION_STEP_LABEL } from '../../utils/labels';

const STAT_ROWS: { key: string; label: string }[] = [
  { key: 'categories', label: 'Categorías' },
  { key: 'packages', label: 'Paquetes' },
  { key: 'streams', label: 'Canales y películas' },
  { key: 'series', label: 'Series' },
  { key: 'episodes', label: 'Episodios' },
  { key: 'users', label: 'Clientes' },
  { key: 'resellers', label: 'Revendedores' },
];

export function JobView({ jobId, onFinished }: { jobId: string; onFinished?: (job: XtreamJob) => void }) {
  const [job, setJob] = useState<XtreamJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const notified = useRef<string | null>(null);

  const load = async () => {
    try {
      const j = await api.xtream.job(jobId);
      setJob(j);
      setError(null);
      if (j.status !== 'running' && notified.current !== j.id) {
        notified.current = j.id;
        onFinished?.(j);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    setJob(null);
    setError(null);
    stickToBottom.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useInterval(() => void load(), job === null || job.status === 'running' ? 1500 : null);

  useEffect(() => {
    const el = logRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [job?.log?.length]);

  if (!job && error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!job) return <PageLoader label="Cargando trabajo…" />;

  const running = job.status === 'running';
  const progress = job.progress;
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : running ? null : 100;
  const status = JOB_STATUS[job.status] ?? { label: job.status, tone: 'gray' as const };
  const creds = job.reseller_credentials ?? [];
  const credsText = creds.map((c) => `${c.username}\t${c.password}`).join('\n');

  return (
    <div className="stack">
      <div className="job-header">
        <div className="row-inline">
          {running ? <Loader size={18} className="spin text-blue" /> : job.status === 'done' ? <CircleCheck size={18} className="text-green" /> : <CircleAlert size={18} className="text-red" />}
          <span className="strong">Trabajo {job.id}</span>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </div>
        <span className="muted text-sm">
          Inicio: {formatDateTime(job.started_at)}
          {job.finished_at ? ` · Fin: ${formatDateTime(job.finished_at)} · Duración: ${formatElapsed(job.started_at, job.finished_at)}` : ` · ${formatElapsed(job.started_at, nowUnix())}`}
        </span>
      </div>

      {error && <Alert tone="amber">Error al actualizar el progreso: {error}</Alert>}

      <div>
        <div className="progress-label">
          <span>
            {progress ? MIGRATION_STEP_LABEL[progress.step] ?? progress.step : running ? 'Preparando…' : 'Finalizado'}
            {progress && progress.total > 0 && (
              <span className="muted">
                {' '}
                · {formatNumber(progress.current)} / {formatNumber(progress.total)}
              </span>
            )}
          </span>
          {pct !== null && <span className="strong">{pct}%</span>}
        </div>
        <div className={`progress ${job.status === 'error' ? 'progress-error' : job.status === 'done' ? 'progress-done' : ''}`}>
          <div className={`progress-bar ${pct === null ? 'progress-indeterminate' : ''}`} style={{ width: pct === null ? undefined : `${pct}%` }} />
        </div>
      </div>

      {job.error && (
        <Alert tone="red" icon={<CircleAlert size={18} />} title="La migración terminó con error">
          {job.error}
        </Alert>
      )}

      <div className="grid-2 align-start">
        <div className="table-card">
          <div className="table-scroll">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Elemento</th>
                  <th className="num">Creados</th>
                  <th className="num">Actualizados</th>
                  <th className="num">Omitidos</th>
                </tr>
              </thead>
              <tbody>
                {STAT_ROWS.map((r) => {
                  const s = job.stats?.[r.key];
                  return (
                    <tr key={r.key} className={s ? '' : 'row-muted'}>
                      <td>{r.label}</td>
                      <td className="num text-green">{s ? formatNumber(s.created ?? 0) : '—'}</td>
                      <td className="num text-blue">{s ? formatNumber(s.updated ?? 0) : '—'}</td>
                      <td className="num muted">{s ? formatNumber(s.skipped ?? 0) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="field-label">Registro</div>
          <div
            ref={logRef}
            className="log-box"
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {(job.log ?? []).length === 0 ? (
              <span className="muted">Sin mensajes todavía…</span>
            ) : (
              (job.log ?? []).map((line, i) => (
                <div key={i} className={/error|fall[oó]|failed/i.test(line) ? 'log-error' : ''}>
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {!running && creds.length > 0 && (
        <section className="card card-accent">
          <div className="section-header">
            <h3 className="card-title no-margin">Credenciales generadas para revendedores</h3>
            <CopyButton text={credsText} label="Copiar todas" size="md" />
          </div>
          <p className="muted text-sm">
            Las contraseñas de revendedores de XtreamUI están cifradas y no se pueden migrar. Se generaron estas nuevas:
            guárdalas ahora y envíaselas a cada revendedor.
          </p>
          <div className="table-scroll">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Contraseña</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {creds.map((c) => (
                  <tr key={c.username}>
                    <td className="strong">{c.username}</td>
                    <td className="mono">{c.password}</td>
                    <td className="col-actions">
                      <CopyButton text={`Usuario: ${c.username}\nContraseña: ${c.password}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {job.status === 'done' && <AfterMigrationChecklist />}
    </div>
  );
}

const CHECKLIST: { title: string; detail: string }[] = [
  {
    title: 'Revisa los datos migrados',
    detail: 'Comprueba en Clientes, Paquetes y Canales que los conteos coinciden con los de XtreamUI y prueba algunas líneas.',
  },
  {
    title: 'Configura la URL pública y el modo de reproducción',
    detail:
      'En Ajustes, pon la URL pública con el mismo dominio y puerto que usaba XtreamUI. Durante la transición usa el modo "xtream_upstream" apuntando a la IP antigua, para que la reproducción siga funcionando mientras verificas las fuentes.',
  },
  {
    title: 'Abre los puertos en el nuevo servidor',
    detail: 'Permite en el firewall el puerto 25461 (el de XtreamUI por defecto) y los demás que usaban tus clientes (80/443, etc.).',
  },
  {
    title: 'Apunta el DNS del dominio de XtreamUI al nuevo servidor',
    detail:
      'Cambia el registro A del dominio que tienen configurado los clientes hacia la IP del nuevo servidor. Así siguen entrando con la misma URL, usuario y contraseña sin tocar nada en sus apps. Baja el TTL con antelación para que el cambio sea rápido.',
  },
  {
    title: 'Entrega las nuevas credenciales a los revendedores',
    detail: 'Sus contraseñas se regeneraron; envíaselas y pídeles que las cambien al entrar.',
  },
  {
    title: 'Cambia a "redirect" o "proxy" cuando todo funcione',
    detail: 'Cuando verifiques que las fuentes responden desde el nuevo servidor, cambia el modo de reproducción y apaga el XtreamUI antiguo.',
  },
];

function AfterMigrationChecklist() {
  const [done, setDone] = useState<Set<number>>(new Set());
  return (
    <section className="card">
      <h3 className="card-title">
        <ListChecks size={18} /> Qué hacer después
      </h3>
      <ol className="checklist-steps">
        {CHECKLIST.map((item, i) => (
          <li key={i} className={done.has(i) ? 'is-done' : ''}>
            <label>
              <input
                type="checkbox"
                className="checkbox"
                checked={done.has(i)}
                onChange={() =>
                  setDone((s) => {
                    const n = new Set(s);
                    if (n.has(i)) n.delete(i);
                    else n.add(i);
                    return n;
                  })
                }
              />
              <span>
                <span className="strong">{item.title}</span>
                <span className="muted text-sm block">{item.detail}</span>
              </span>
            </label>
          </li>
        ))}
      </ol>
    </section>
  );
}
