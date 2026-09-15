import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleCheck, DatabaseZap, Eye, EyeOff, HelpCircle, History, Play, PlugZap, RefreshCw, TriangleAlert } from 'lucide-react';
import { api, asList, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { DataTable } from '../../components/DataTable';
import { Alert, Badge, Checkbox, FormField, PageHeader, Spinner } from '../../components/ui';
import type { XtreamCounts, XtreamJob, XtreamOptions } from '../../types';
import { formatDateTime, formatElapsed, formatNumber } from '../../utils/format';
import { JOB_STATUS } from '../../utils/labels';
import { JobView } from './JobView';

type Step = 1 | 2 | 3;

interface ConnForm {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

const COUNT_LABELS: { key: keyof XtreamCounts; label: string }[] = [
  { key: 'users', label: 'Clientes' },
  { key: 'resellers', label: 'Revendedores' },
  { key: 'bouquets', label: 'Paquetes (bouquets)' },
  { key: 'categories', label: 'Categorías' },
  { key: 'live', label: 'Canales' },
  { key: 'movie', label: 'Películas' },
  { key: 'series', label: 'Series' },
  { key: 'episodes', label: 'Episodios' },
];

const OPTION_INFO: { key: keyof XtreamOptions; label: string; description: string }[] = [
  { key: 'categories', label: 'Categorías', description: 'Categorías de canales, películas y series.' },
  { key: 'streams', label: 'Canales y películas', description: 'Se conservan los IDs, así las apps y favoritos de los clientes siguen funcionando.' },
  { key: 'series', label: 'Series y episodios', description: 'Series con sus temporadas y episodios, conservando IDs.' },
  { key: 'packages', label: 'Paquetes (bouquets)', description: 'Los bouquets de XtreamUI con su contenido. Requiere haber migrado (o migrar a la vez) canales y series.' },
  { key: 'users', label: 'Clientes (líneas)', description: 'Usuario, contraseña, vencimiento, conexiones, prueba, notas y paquetes. Los clientes podrán entrar con las mismas credenciales.' },
  { key: 'resellers', label: 'Revendedores', description: 'Crea las cuentas de revendedor y les asigna sus clientes. Sus contraseñas se regeneran (en XtreamUI están cifradas).' },
  { key: 'overwrite', label: 'Sobrescribir existentes', description: 'Si un registro ya existe (mismo ID de XtreamUI o mismo usuario) se actualiza. Desactivado: se omite.' },
];

export function MigrationPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [step, setStep] = useState<Step>(1);
  const [conn, setConn] = useState<ConnForm>({ host: '', port: '3306', user: '', password: '', database: 'xtream_iptvpro' });
  const [passwordSet, setPasswordSet] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof ConnForm, string>>>({});
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [counts, setCounts] = useState<XtreamCounts | null>(null);
  const [options, setOptions] = useState<XtreamOptions>({
    categories: true,
    packages: true,
    streams: true,
    series: true,
    users: true,
    resellers: false,
    overwrite: false,
  });
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const settings = useAsync(() => api.settings.get(), []);
  const jobs = useAsync(async () => {
    const list = asList(await api.xtream.jobs());
    return [...list].sort((a, b) => b.started_at - a.started_at);
  }, []);

  useEffect(() => {
    const db = settings.data?.xtream_db;
    if (!db) return;
    setConn((c) => ({
      host: db.host || c.host,
      port: db.port ? String(db.port) : c.port,
      user: db.user || c.user,
      password: '',
      database: db.database || c.database,
    }));
    setPasswordSet(Boolean(db.password_set));
  }, [settings.data]);

  const runningJob = (jobs.data ?? []).find((j) => j.status === 'running');

  const setField = (k: keyof ConnForm, v: string) => {
    setConn((c) => ({ ...c, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
    setCounts(null);
  };

  const test = async () => {
    const e: typeof errors = {};
    if (!conn.host.trim()) e.host = 'Indica la IP o el dominio del servidor XtreamUI';
    const port = Number(conn.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) e.port = 'Puerto no válido';
    if (!conn.user.trim()) e.user = 'Indica el usuario de MySQL';
    if (!conn.database.trim()) e.database = 'Indica la base de datos';
    setErrors(e);
    if (Object.keys(e).length) return;
    setTesting(true);
    setTestError(null);
    setCounts(null);
    try {
      const res = await api.xtream.test({
        host: conn.host.trim(),
        port,
        user: conn.user.trim(),
        ...(conn.password ? { password: conn.password } : {}),
        database: conn.database.trim(),
        save: true,
      });
      if (res?.ok === false) {
        setTestError('No se pudo conectar con la base de datos');
      } else {
        setCounts(res.counts);
        if (conn.password) setPasswordSet(true);
        toast.success('Conexión correcta. Datos guardados.');
      }
    } catch (err) {
      setTestError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  const start = async () => {
    const selected = OPTION_INFO.filter((o) => o.key !== 'overwrite' && options[o.key]);
    if (selected.length === 0) {
      toast.error('Selecciona al menos un elemento a migrar');
      return;
    }
    const ok = await confirm({
      title: 'Iniciar migración',
      message: (
        <>
          Se importarán: <strong>{selected.map((o) => o.label.toLowerCase()).join(', ')}</strong>.
          {options.overwrite ? ' Los registros existentes se sobrescribirán.' : ' Los registros existentes se omitirán.'} La base de datos de XtreamUI solo se lee, no se modifica. ¿Continuar?
        </>
      ),
      confirmText: 'Iniciar migración',
      danger: options.overwrite,
    });
    if (!ok) return;
    setStarting(true);
    try {
      const res = await api.xtream.migrate(options);
      setJobId(res.job_id);
      setStep(3);
      void jobs.reload(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const viewJob = (id: string) => {
    setJobId(id);
    setStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const warnings: string[] = [];
  if (options.packages && !options.streams && !options.series) warnings.push('Los paquetes se crearán sin contenido si canales y series no existen ya en esta plataforma.');
  if (options.users && !options.packages) warnings.push('Los clientes solo conservarán sus paquetes si estos ya existen (migra también los paquetes).');
  if (options.streams && !options.categories) warnings.push('Sin categorías, el contenido quedará sin categoría si estas no existen ya.');
  if (options.users && !options.resellers) warnings.push('Sin revendedores, los clientes de revendedores quedarán asignados a tu cuenta.');

  return (
    <>
      <PageHeader
        title="Migración desde XtreamUI"
        subtitle="Importa clientes, contenido y revendedores directamente desde la base de datos MySQL de XtreamUI"
      />

      {runningJob && step !== 3 && (
        <Alert tone="blue" icon={<Spinner size={16} />} title="Hay una migración en curso">
          <button type="button" className="btn btn-link btn-sm" onClick={() => viewJob(runningJob.id)}>
            Ver progreso
          </button>
        </Alert>
      )}

      <ol className="steps">
        {(['Conexión', 'Opciones', 'Migración'] as const).map((label, i) => {
          const n = (i + 1) as Step;
          return (
            <li key={label} className={`step ${step === n ? 'is-current' : ''} ${step > n ? 'is-done' : ''}`}>
              <span className="step-num">{step > n ? <CircleCheck size={16} /> : n}</span>
              <span className="step-label">{label}</span>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <div className="migration-grid">
          <section className="card">
            <h2 className="card-title">
              <PlugZap size={18} /> Conexión a MySQL de XtreamUI
            </h2>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void test();
              }}
            >
              <div className="grid-3-1">
                <FormField label="Servidor (IP o dominio)" required error={errors.host}>
                  <input className="input" value={conn.host} onChange={(e) => setField('host', e.target.value)} placeholder="203.0.113.10" />
                </FormField>
                <FormField label="Puerto" required error={errors.port}>
                  <input className="input" type="number" value={conn.port} onChange={(e) => setField('port', e.target.value)} />
                </FormField>
              </div>
              <div className="grid-2">
                <FormField label="Usuario MySQL" required error={errors.user}>
                  <input className="input" autoComplete="off" value={conn.user} onChange={(e) => setField('user', e.target.value)} />
                </FormField>
                <FormField label="Contraseña MySQL" error={errors.password} hint={passwordSet ? 'Hay una contraseña guardada; déjala vacía para usarla.' : undefined}>
                  <div className="input-group">
                    <input
                      className="input"
                      type={showPass ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={conn.password}
                      placeholder={passwordSet ? '•••••••• (guardada)' : ''}
                      onChange={(e) => setField('password', e.target.value)}
                    />
                    <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowPass((s) => !s)} title={showPass ? 'Ocultar' : 'Mostrar'}>
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </FormField>
              </div>
              <FormField label="Base de datos" required error={errors.database}>
                <input className="input" value={conn.database} onChange={(e) => setField('database', e.target.value)} />
              </FormField>

              {testError && (
                <Alert tone="red" icon={<TriangleAlert size={18} />} title="No se pudo conectar">
                  {testError}
                </Alert>
              )}

              {counts && (
                <div className="counts-box">
                  <div className="row-inline text-green strong">
                    <CircleCheck size={18} /> Conexión correcta. Contenido encontrado:
                  </div>
                  <div className="counts-grid">
                    {COUNT_LABELS.map((c) => (
                      <div key={c.key} className="count-item">
                        <span className="count-value">{formatNumber(counts[c.key] ?? 0)}</span>
                        <span className="muted text-xs">{c.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="row row-end mt">
                <button type="submit" className="btn btn-secondary" disabled={testing}>
                  {testing ? <Spinner size={14} /> : <PlugZap size={16} />} Probar conexión
                </button>
                <button type="button" className="btn btn-primary" disabled={!counts} onClick={() => setStep(2)}>
                  Siguiente <ArrowRight size={16} />
                </button>
              </div>
            </form>
          </section>

          <aside className="card help-card">
            <h3 className="card-title">
              <HelpCircle size={18} /> Cómo permitir la conexión
            </h3>
            <p className="text-sm">
              Este servidor necesita leer la base de datos MySQL/MariaDB del XtreamUI antiguo. Por defecto XtreamUI solo acepta
              conexiones locales, así que tienes dos opciones:
            </p>
            <h4 className="help-subtitle">Opción A · Acceso remoto a MySQL</h4>
            <ol className="help-list text-sm">
              <li>
                En el servidor XtreamUI, edita la configuración de MySQL (<code>my.cnf</code>) y cambia{' '}
                <code>bind-address</code> a <code>0.0.0.0</code>. Reinicia MySQL.
              </li>
              <li>
                Crea un usuario de solo lectura para la IP de este servidor:
                <pre className="code-block">
                  {`GRANT SELECT ON xtream_iptvpro.* TO 'migra'@'IP_NUEVO_SERVIDOR'\n  IDENTIFIED BY 'clave_segura';\nFLUSH PRIVILEGES;`}
                </pre>
              </li>
              <li>Abre el puerto de MySQL en el firewall solo para la IP de este servidor.</li>
              <li>Algunas instalaciones de XtreamUI usan un puerto distinto a 3306 (p. ej. 7999); revisa la configuración.</li>
            </ol>
            <h4 className="help-subtitle">Opción B · Túnel SSH (recomendado)</h4>
            <p className="text-sm">Sin exponer MySQL a internet. En este servidor ejecuta:</p>
            <pre className="code-block">{`ssh -N -L 3307:127.0.0.1:3306 root@IP_XTREAMUI`}</pre>
            <p className="text-sm">
              Y usa aquí servidor <code>127.0.0.1</code> y puerto <code>3307</code> con el usuario de MySQL de XtreamUI.
            </p>
          </aside>
        </div>
      )}

      {step === 2 && (
        <section className="card">
          <h2 className="card-title">¿Qué quieres migrar?</h2>
          <div className="options-grid">
            {OPTION_INFO.map((o) => (
              <div key={o.key} className={`option-card ${options[o.key] ? 'is-checked' : ''} ${o.key === 'overwrite' ? 'option-danger' : ''}`}>
                <Checkbox
                  checked={options[o.key]}
                  onChange={(v) => setOptions((opt) => ({ ...opt, [o.key]: v }))}
                  label={
                    <>
                      {o.label}
                      {counts && o.key !== 'overwrite' && (
                        <span className="muted text-xs">
                          {' '}
                          ·{' '}
                          {o.key === 'streams'
                            ? `${formatNumber(counts.live)} canales, ${formatNumber(counts.movie)} películas`
                            : o.key === 'series'
                              ? `${formatNumber(counts.series)} series, ${formatNumber(counts.episodes)} episodios`
                              : o.key === 'packages'
                                ? formatNumber(counts.bouquets)
                                : formatNumber(counts[o.key as keyof XtreamCounts] ?? 0)}
                        </span>
                      )}
                    </>
                  }
                  description={o.description}
                />
              </div>
            ))}
          </div>
          {warnings.length > 0 && (
            <Alert tone="amber" icon={<TriangleAlert size={18} />} title="Ten en cuenta">
              <ul className="plain-list">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
          <Alert tone="blue">
            Puedes repetir la migración las veces que necesites: sin "Sobrescribir", solo se añaden los registros nuevos.
          </Alert>
          <div className="row row-between mt">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
              <ArrowLeft size={16} /> Atrás
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={starting}>
              {starting ? <Spinner size={14} /> : <Play size={16} />} Iniciar migración
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="card">
          <div className="section-header">
            <h2 className="card-title no-margin">
              <DatabaseZap size={18} /> Progreso de la migración
            </h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setJobId(null); setStep(1); }}>
              <ArrowLeft size={14} /> Nueva migración
            </button>
          </div>
          {jobId ? (
            <JobView
              jobId={jobId}
              onFinished={(j: XtreamJob) => {
                void jobs.reload(true);
                if (j.status === 'done') toast.success('Migración completada');
                else if (j.status === 'error') toast.error('La migración terminó con errores');
              }}
            />
          ) : (
            <p className="muted">Selecciona un trabajo del historial.</p>
          )}
        </section>
      )}

      <section className="section mt-lg">
        <div className="section-header">
          <h2 className="section-title">
            <History size={18} /> Historial de migraciones
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void jobs.reload()}>
            <RefreshCw size={14} /> Actualizar
          </button>
        </div>
        <DataTable<XtreamJob, string>
          rows={jobs.data ?? []}
          rowKey={(j) => j.id}
          loading={jobs.loading}
          error={jobs.error}
          onRetry={() => void jobs.reload()}
          emptyTitle="Aún no se ha ejecutado ninguna migración"
          rowClassName={(j) => (j.id === jobId ? 'is-selected' : '')}
          columns={[
            { key: 'id', header: 'Trabajo', render: (j) => <span className="mono text-sm">{j.id}</span> },
            {
              key: 'status',
              header: 'Estado',
              render: (j) => (
                <Badge tone={JOB_STATUS[j.status]?.tone ?? 'gray'} dot>
                  {JOB_STATUS[j.status]?.label ?? j.status}
                </Badge>
              ),
            },
            { key: 'start', header: 'Inicio', render: (j) => formatDateTime(j.started_at) },
            {
              key: 'duration',
              header: 'Duración',
              hideOnMobile: true,
              render: (j) => (j.finished_at ? formatElapsed(j.started_at, j.finished_at) : <span className="muted">en curso</span>),
            },
            {
              key: 'summary',
              header: 'Resumen',
              hideOnMobile: true,
              render: (j) => {
                if (j.error) return <span className="text-red text-sm">{j.error}</span>;
                const created = Object.values(j.stats ?? {}).reduce((n, s) => n + (s?.created ?? 0), 0);
                const updated = Object.values(j.stats ?? {}).reduce((n, s) => n + (s?.updated ?? 0), 0);
                return j.stats ? (
                  <span className="muted text-sm">
                    {formatNumber(created)} creados · {formatNumber(updated)} actualizados
                  </span>
                ) : (
                  <span className="muted">—</span>
                );
              },
            },
            {
              key: 'actions',
              header: '',
              className: 'col-actions',
              render: (j) => (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => viewJob(j.id)}>
                  Ver
                </button>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
