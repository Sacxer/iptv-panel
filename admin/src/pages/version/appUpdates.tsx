import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, CloudDownload, ExternalLink, Github, Info, RefreshCw, Smartphone, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useInterval } from '../../hooks/useInterval';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Spinner } from '../../components/ui';
import type { AppImportResult, AppRelease, GithubAppRelease, UpdatesOverview } from '../../types';
import { formatDateTime, formatNumber, timeAgo } from '../../utils/format';
import { formatBytes } from '../backups/backupUtils';
import { UPDATES_CHANGED_EVENT } from './events';

const notifyUpdatesChanged = () => window.dispatchEvent(new Event(UPDATES_CHANGED_EVENT));

const ABI_LABEL: Record<string, string> = {
  'armeabi-v7a': 'armeabi-v7a (32 bits)',
  'arm64-v8a': 'arm64-v8a (64 bits)',
  x86_64: 'x86_64',
  universal: 'Universal',
};

/** Estado de /updates con las acciones «Buscar ahora» y «Traer a este portal» (compartido por /version y /actualizaciones-app). */
export function useUpdates(options: { onImported?: (res: AppImportResult) => void } = {}) {
  const toast = useToast();
  const data = useAsync(() => api.updates.get(), []);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<AppImportResult | null>(null);
  const d = data.data;

  // Mientras el servidor revisa o importa por su cuenta (p. ej. la revisión automática) se consulta cada 2 s.
  useInterval(() => void data.reload(true), d && (d.checking || d.importing) ? 2000 : null);

  const check = async () => {
    setChecking(true);
    try {
      const next = await api.updates.check();
      data.setData(next);
      notifyUpdatesChanged();
      if (next.last?.error) toast.error(next.last.error);
      else toast.success('Revisión completada');
    } catch (e) {
      toast.error(errorMessage(e));
      await data.reload(true); // conserva el último resultado bueno con last.error
    } finally {
      setChecking(false);
    }
  };

  const importApp = async (tag?: string) => {
    setImporting(tag ?? 'latest');
    setImportResult(null);
    try {
      const res = await api.updates.importApp(tag ? { tag } : {});
      setImportResult(res);
      if (res.overview) data.setData(res.overview);
      else void data.reload(true);
      notifyUpdatesChanged();
      options.onImported?.(res);
      const errors = res.files.filter((f) => 'error' in f).length;
      if (errors) toast.error(`Versión ${res.version_name}: ${errors} APK con error`);
      else toast.success(`Versión ${res.version_name} traída ${res.published ? 'y publicada' : 'en borrador'}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setImporting(null);
    }
  };

  return { data, checking: checking || Boolean(d?.checking), importing, importResult, check, importApp };
}

export type UpdatesState = ReturnType<typeof useUpdates>;

export function ReleaseBlock({ rel, compact = false, showAssets = true }: { rel: GithubAppRelease; compact?: boolean; showAssets?: boolean }) {
  const apks = rel.assets.filter((a) => a.name.toLowerCase().endsWith('.apk'));
  return (
    <div className={`upd-release ${compact ? 'is-compact' : ''}`}>
      <div className="upd-release-head">
        <strong className={compact ? '' : 'upd-release-version'}>{rel.version_name}</strong>
        {rel.prerelease && <Badge tone="purple">Beta</Badge>}
        <span className="muted text-xs">
          <span className="mono">{rel.tag}</span>
          {rel.published_at ? ` · ${formatDateTime(rel.published_at)}` : ''}
        </span>
        {rel.url && (
          <a className="link text-xs" href={rel.url} target="_blank" rel="noreferrer">
            Ver en GitHub <ExternalLink size={11} />
          </a>
        )}
      </div>
      {rel.notes && <p className="upd-notes pre-wrap">{rel.notes}</p>}
      {showAssets &&
        (apks.length > 0 ? (
          <ul className="upd-assets">
            {apks.map((a) => (
              <li key={a.name}>
                <span className="mono text-xs ellipsis" title={a.name}>
                  {a.name}
                </span>
                <Badge tone="gray">{a.abi ? ABI_LABEL[a.abi] ?? a.abi : 'Sin arquitectura'}</Badge>
                <span className="muted text-xs nowrap">{formatBytes(a.size)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-amber text-sm no-margin">Este Release no tiene APK adjuntos.</p>
        ))}
    </div>
  );
}

function ImportResultBlock({ result }: { result: AppImportResult }) {
  return (
    <div className="upd-import-result">
      <div className="row-inline">
        <strong>
          Resultado: versión {result.version_name} ({result.tag})
        </strong>
        {result.published ? <Badge tone="green">Publicada</Badge> : <Badge tone="gray">En borrador</Badge>}
      </div>
      <ul className="upd-assets">
        {result.files.map((f) =>
          'error' in f ? (
            <li key={f.name}>
              <span className="mono text-xs ellipsis">{f.name}</span>
              <span className="text-red text-xs">
                <CircleAlert size={12} /> {f.error}
              </span>
            </li>
          ) : (
            <li key={f.name}>
              <span className="mono text-xs ellipsis">{f.name}</span>
              <Badge tone="green">{ABI_LABEL[f.abi] ?? f.abi}</Badge>
              <span className="muted text-xs nowrap">
                versionCode {f.version_code}
                {f.replaced ? ' · reemplazado' : ''}
              </span>
              {f.warnings?.map((w, i) => (
                <span key={i} className="text-amber text-xs upd-warning">
                  {w}
                </span>
              ))}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/** Tarjeta completa de la app en /version. */
export function AppCard({
  updates,
  devices,
  releases,
}: {
  updates: UpdatesState;
  devices: { version: string; distribution: string | null; devices: number }[] | null;
  releases?: AppRelease[] | null;
}) {
  const overview = updates.data.data as UpdatesOverview;
  const app = overview.last?.app ?? null;
  const busy = updates.importing !== null || overview.importing;
  return (
    <section className="card upd-card">
      <h2 className="card-title">
        <Smartphone size={18} /> App IPTV Player
      </h2>
      {!overview.last ? (
        <p className="muted text-sm">Pulsa «Buscar actualizaciones» para ver las versiones de la app publicadas en GitHub.</p>
      ) : !app?.latest ? (
        <Alert tone="blue" icon={<Github size={18} />} title="Aún no hay versiones de la app en GitHub">
          Cada versión es un Release del repositorio con la etiqueta <code>app-v1.0.2</code> (por ejemplo) y los APK adjuntos. El script{' '}
          <code>publicar.ps1 -GitHub</code> los crea al publicar una versión nueva.
        </Alert>
      ) : (
        <div className="stack">
          <div className="field-label">Última versión en GitHub</div>
          <ReleaseBlock rel={app.latest} />
          <AppState overview={overview} updates={updates} releases={releases} />
          {app.beta && (
            <details className="bulk-details upd-beta">
              <summary>Beta disponible: {app.beta.version_name}</summary>
              <ReleaseBlock rel={app.beta} compact />
              <button type="button" className="btn btn-secondary btn-sm mt-sm" onClick={() => void updates.importApp(app.beta?.tag)} disabled={busy}>
                {updates.importing === app.beta.tag ? <Spinner size={13} /> : <CloudDownload size={14} />} Traer beta
              </button>
            </details>
          )}
        </div>
      )}

      {updates.importResult && <ImportResultBlock result={updates.importResult} />}

      <div className="upd-devices">
        <div className="field-label">Equipos por versión (últimos 30 días)</div>
        {!devices || devices.length === 0 ? (
          <p className="muted text-sm no-margin">
            Ningún equipo ha informado la versión todavía.{' '}
            <Link className="link" to="/actualizaciones-app">
              Actualizaciones de la app
            </Link>
          </p>
        ) : (
          <ul className="upd-device-list">
            {devices.map((v) => (
              <li key={`${v.version}-${v.distribution}`}>
                <strong>{v.version || '—'}</strong>
                <span className="muted text-xs">{v.distribution === 'play' ? 'Google Play' : v.distribution === 'portal' ? 'Portal' : 'sin dato'}</span>
                <span className="apprel-count">{formatNumber(v.devices)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Estado de la última versión de GitHub respecto a este portal. */
function AppState({
  overview,
  updates,
  releases,
  onShowRelease,
}: {
  overview: UpdatesOverview;
  updates: UpdatesState;
  releases?: AppRelease[] | null;
  onShowRelease?: (releaseId: number) => void;
}) {
  const app = overview.last?.app;
  if (!app?.latest) return null;
  const busy = updates.importing !== null || overview.importing;
  // El estado guardado de la última revisión puede quedar desfasado (p. ej. tras publicar): manda la lista de versiones del portal.
  const live = releases ? releases.find((r) => r.id === app.release_id) ?? releases.find((r) => r.version_name === app.latest?.version_name) ?? null : null;
  const imported = releases ? Boolean(live) : app.imported;
  const published = live ? live.published : app.published;
  const releaseId = live?.id ?? app.release_id;
  if (!imported) {
    return (
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => void updates.importApp()} disabled={busy}>
          {updates.importing === 'latest' ? <Spinner size={14} /> : <CloudDownload size={16} />} Traer a este portal
        </button>
        <span className="muted text-sm">Descarga los APK, comprueba su huella y los deja en borrador.</span>
      </div>
    );
  }
  if (published) {
    return (
      <Alert tone="green" icon={<CircleCheck size={18} />}>
        Publicada para los equipos.{' '}
        {onShowRelease && releaseId ? (
          <button type="button" className="btn btn-link btn-sm inline-link" onClick={() => onShowRelease(releaseId)}>
            Ver abajo
          </button>
        ) : (
          <Link className="link" to="/actualizaciones-app">
            Ver en Actualizaciones de la app
          </Link>
        )}
      </Alert>
    );
  }
  return (
    <Alert tone="amber" icon={<Info size={18} />} title="Importada en borrador">
      {onShowRelease && releaseId ? (
        <>
          Revísala y publícala más abajo.{' '}
          <button type="button" className="btn btn-link btn-sm inline-link" onClick={() => onShowRelease(releaseId)}>
            Ir a la versión
          </button>
        </>
      ) : (
        <>
          Revísala y publícala en{' '}
          <Link className="link" to="/actualizaciones-app">
            Actualizaciones de la app
          </Link>
          .
        </>
      )}
    </Alert>
  );
}

/** Tarjeta compacta para /actualizaciones-app: buscar ahora, última versión en GitHub y su estado. */
export function GithubAppUpdatesCard({
  updates,
  releases,
  onShowRelease,
}: {
  updates: UpdatesState;
  releases?: AppRelease[] | null;
  onShowRelease: (releaseId: number) => void;
}) {
  const overview = updates.data.data;
  if (!overview) {
    return updates.data.error ? (
      <section className="card">
        <h2 className="card-title">
          <Github size={18} /> Buscar actualizaciones en GitHub
        </h2>
        <p className="text-red text-sm no-margin">{updates.data.error}</p>
      </section>
    ) : null;
  }
  const last = overview.last;
  const app = last?.app ?? null;
  const s = overview.settings;
  return (
    <section className="card upd-card upd-embedded">
      <div className="section-header">
        <h2 className="card-title no-margin">
          <Github size={18} /> Buscar actualizaciones en GitHub
        </h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void updates.check()} disabled={updates.checking}>
          {updates.checking ? <Spinner size={13} /> : <RefreshCw size={14} />} Buscar ahora
        </button>
      </div>
      <p className="muted text-sm no-margin">
        {updates.checking ? 'Consultando GitHub…' : last?.checked_at ? (
          <span title={formatDateTime(last.checked_at)}>Última revisión {timeAgo(last.checked_at)}</span>
        ) : (
          'Aún no se ha revisado GitHub.'
        )}
      </p>
      {last?.error && (
        <Alert tone="amber" icon={<TriangleAlert size={18} />}>
          {last.error}
        </Alert>
      )}
      {last &&
        (app?.latest ? (
          <>
            <ReleaseBlock rel={app.latest} compact showAssets={!(releases ? releases.some((r) => r.version_name === app.latest?.version_name) : app.imported)} />
            <AppState overview={overview} updates={updates} releases={releases} onShowRelease={onShowRelease} />
          </>
        ) : (
          <p className="text-sm no-margin">No hay versiones nuevas de la app en GitHub.</p>
        ))}
      {updates.importResult && <ImportResultBlock result={updates.importResult} />}
      <p className="muted text-xs no-margin">
        Revisión automática {s.check_enabled ? `cada ${s.check_hours} h` : 'apagada'} · traer automáticamente: {s.auto_import_app ? 'sí' : 'no'}
        {s.auto_import_app ? ` · publicar automáticamente: ${s.auto_publish_app ? 'sí' : 'no'}` : ''} ·{' '}
        <Link className="link" to="/version">
          Configurar
        </Link>
      </p>
    </section>
  );
}
