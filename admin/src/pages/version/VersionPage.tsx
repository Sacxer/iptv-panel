import { useEffect, useState } from 'react';
import {
  CircleCheck,
  CloudDownload,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  Github,
  Info,
  RefreshCw,
  Save,
  Server,
  Terminal,
  TriangleAlert,
} from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../components/Toast';
import { Alert, Badge, CopyButton, ErrorState, PageHeader, PageLoader, Spinner, Switch } from '../../components/ui';
import type { UpdatesOverview, UpdatesSettings } from '../../types';
import { formatDateTime, formatNumber, timeAgo } from '../../utils/format';

import { UPDATES_CHANGED_EVENT } from './events';
import { AppCard, useUpdates } from './appUpdates';

const notifyUpdatesChanged = () => window.dispatchEvent(new Event(UPDATES_CHANGED_EVENT));

export function VersionPage() {
  const releases = useAsync(async () => api.appReleases.list().catch(() => null), []);
  const updates = useUpdates({ onImported: () => void releases.reload(true) });
  const data = updates.data;
  const d = data.data;

  if (!d) return data.error ? <ErrorState message={data.error} onRetry={() => void data.reload()} /> : <PageLoader />;

  const last = d.last;
  const busyCheck = updates.checking;

  return (
    <>
      <PageHeader
        title="Versión y actualizaciones"
        subtitle="Versión instalada del panel y nuevas versiones del panel y de la app publicadas en GitHub"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => void updates.check()} disabled={busyCheck}>
            {busyCheck ? <Spinner size={14} /> : <RefreshCw size={16} />} Buscar actualizaciones
          </button>
        }
      />

      <div className="upd-status">
        <span className="muted text-sm">
          {busyCheck ? 'Consultando GitHub…' : last?.checked_at ? (
            <span title={formatDateTime(last.checked_at)}>Última revisión {timeAgo(last.checked_at)}</span>
          ) : (
            'Aún no se ha revisado GitHub.'
          )}
          {last?.repo ? (
            <>
              {' '}
              · <span className="mono">{last.repo}</span>
              {last.branch ? ` (${last.branch})` : ''}
            </>
          ) : null}
        </span>
      </div>
      {last?.error && (
        <Alert tone="amber" icon={<TriangleAlert size={18} />} title="No se pudo consultar GitHub">
          {last.error}
          {last.panel || last.app ? ' Se muestra el último resultado correcto.' : ''}
        </Alert>
      )}

      <div className="upd-grid">
        <PanelCard overview={d} />
        <AppCard updates={updates} devices={releases.data?.devices_by_version ?? null} releases={releases.data?.items ?? null} />
      </div>

      <SettingsCard overview={d} onSaved={(o) => data.setData(o)} />
    </>
  );
}

// ---------- Panel ----------

function PanelCard({ overview }: { overview: UpdatesOverview }) {
  const c = overview.current;
  const repo = overview.repo;
  const p = overview.last?.panel ?? null;
  return (
    <section className="card upd-card">
      <h2 className="card-title">
        <Server size={18} /> Panel IPTV
      </h2>
      <div className="detail-kv">
        <span>Versión instalada</span>
        <span className="strong">v{c.version}</span>
        <span>Commit</span>
        <span>
          {c.commit ? (
            <a className="link mono" href={`https://github.com/${repo}/commit/${c.commit}`} target="_blank" rel="noreferrer">
              <GitCommitHorizontal size={13} /> {c.commit.slice(0, 7)}
            </a>
          ) : (
            <span className="muted">—</span>
          )}
          {c.branch && (
            <span className="muted text-sm">
              {' '}
              <GitBranch size={12} /> {c.branch}
            </span>
          )}
        </span>
        <span>Instalado</span>
        <span>{c.installed_at ? formatDateTime(c.installed_at) : c.source === 'git' ? 'desde el repositorio local' : 'desconocido'}</span>
        <span>Node.js</span>
        <span className="mono">{c.node}</span>
      </div>

      {!overview.last ? (
        <p className="muted text-sm">Pulsa «Buscar actualizaciones» para comparar con GitHub.</p>
      ) : !p ? null : p.update_available === true ? (
        <div className="upd-available">
          <div className="upd-available-head">
            <CloudDownload size={18} />
            <strong>Hay una actualización del panel</strong>
            {p.latest_version && <Badge tone="amber">v{p.latest_version}</Badge>}
            {p.commits_behind ? <span className="muted text-sm">{p.commits_behind === 1 ? '1 cambio nuevo' : `${formatNumber(p.commits_behind)} cambios nuevos`}</span> : null}
          </div>
          {p.changes.length > 0 && (
            <ul className="upd-changes">
              {p.changes.map((ch) => (
                <li key={ch.sha}>
                  <span className="mono text-xs muted">{ch.sha.slice(0, 7)}</span>
                  <span className="upd-change-msg">{ch.message}</span>
                  {ch.date && <span className="muted text-xs nowrap">{formatDateTime(ch.date)}</span>}
                </li>
              ))}
            </ul>
          )}
          {p.compare_url && (
            <a className="link text-sm" href={p.compare_url} target="_blank" rel="noreferrer">
              Ver todos los cambios en GitHub <ExternalLink size={12} />
            </a>
          )}
          {p.install_command && (
            <div className="stack-sm">
              <div className="field-label">
                <Terminal size={14} /> Cómo actualizar
              </div>
              <p className="text-sm no-margin">Conéctate al servidor por SSH y ejecuta este comando como root. Hace un backup, actualiza y conserva todos los datos.</p>
              <div className="input-group align-start">
                <pre className="code-block grow">{p.install_command}</pre>
                <CopyButton text={p.install_command} />
              </div>
            </div>
          )}
        </div>
      ) : p.update_available === false ? (
        <Alert tone="green" icon={<CircleCheck size={18} />}>
          El panel está al día{p.latest_version ? ` (v${p.latest_version})` : ''}.
        </Alert>
      ) : (
        <Alert tone="blue" icon={<Info size={18} />}>
          No se sabe de qué versión se instaló; al instalar con la línea de instalación se registra.
          {p.latest_version ? ` La última en GitHub es v${p.latest_version}.` : ''}
        </Alert>
      )}
    </section>
  );
}

// ---------- Configuración ----------

function toForm(s: UpdatesSettings) {
  return {
    check_enabled: s.check_enabled,
    check_hours: String(s.check_hours ?? 6),
    auto_import_app: s.auto_import_app,
    auto_publish_app: s.auto_publish_app,
  };
}

function SettingsCard({ overview, onSaved }: { overview: UpdatesOverview; onSaved: (o: UpdatesOverview) => void }) {
  const toast = useToast();
  const saved = JSON.stringify(toForm(overview.settings));
  const [form, setForm] = useState(() => toForm(overview.settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setForm(toForm(overview.settings)), [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof ReturnType<typeof toForm>>(k: K, v: ReturnType<typeof toForm>[K]) => setForm((f) => ({ ...f, [k]: v }));
  const hours = Number(form.check_hours);
  const hoursOk = Number.isInteger(hours) && hours >= 1 && hours <= 168;
  const dirty = JSON.stringify(form) !== saved;

  const save = async () => {
    if (!hoursOk) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.updates.updateSettings({
        check_enabled: form.check_enabled,
        check_hours: hours,
        auto_import_app: form.auto_import_app,
        auto_publish_app: form.auto_import_app && form.auto_publish_app,
      });
      onSaved(next);
      notifyUpdatesChanged();
      toast.success('Configuración de actualizaciones guardada');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card upd-settings">
      <h2 className="card-title">
        <Github size={18} /> Configuración
      </h2>
      <p className="muted text-sm">
        Las actualizaciones salen de{' '}
        <a href={`https://github.com/${overview.repo}`} target="_blank" rel="noreferrer" className="mono">
          github.com/{overview.repo}
        </a>{' '}
        (rama <span className="mono">{overview.branch}</span>). Es automático: no hay que configurarlo.
      </p>
      <div className="stack-sm">
        <div className="upd-inline">
          <Switch checked={form.check_enabled} onChange={(v) => set('check_enabled', v)} label="Buscar actualizaciones automáticamente" />
          <label className="upd-hours">
            cada
            <input
              className="input input-sm"
              type="number"
              min={1}
              max={168}
              value={form.check_hours}
              disabled={!form.check_enabled}
              onChange={(e) => set('check_hours', e.target.value)}
              aria-label="Horas entre revisiones"
            />
            horas
          </label>
        </div>
        {!hoursOk && <div className="text-red text-xs">Entre 1 y 168 horas.</div>}
        <Switch
          checked={form.auto_import_app}
          onChange={(v) => {
            set('auto_import_app', v);
            if (!v) set('auto_publish_app', false);
          }}
          label="Traer automáticamente las nuevas versiones de la app"
          description="Quedan en borrador en Actualizaciones de la app."
        />
        <Switch
          checked={form.auto_publish_app}
          disabled={!form.auto_import_app}
          onChange={(v) => set('auto_publish_app', v)}
          label="Publicarlas automáticamente para los equipos"
          description={form.auto_import_app ? undefined : 'Activa primero «Traer automáticamente».'}
        />
        {form.auto_import_app && form.auto_publish_app && (
          <Alert tone="amber" icon={<TriangleAlert size={18} />}>
            Los equipos con la app (celulares, TV Box, Android TV…) recibirán cada versión nueva sin que la revises antes.
          </Alert>
        )}
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <div className="row row-end">
        {dirty && <span className="muted text-sm">Hay cambios sin guardar</span>}
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !dirty || !hoursOk}>
          {busy ? <Spinner size={14} /> : <Save size={16} />} Guardar
        </button>
      </div>
    </section>
  );
}
