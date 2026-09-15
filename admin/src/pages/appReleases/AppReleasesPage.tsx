import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  CircleCheck,
  CloudUpload,
  Download,
  FileWarning,
  MonitorSmartphone,
  PackageOpen,
  Pencil,
  Rocket,
  Smartphone,
  Trash2,
  Tv,
  Undo2,
  X,
} from 'lucide-react';
import { api, downloadWithToken, errorMessage, uploadAppApk } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, CopyButton, EmptyState, ErrorState, FormField, PageHeader, PageLoader, Spinner, Switch } from '../../components/ui';
import type { AppRelease, AppReleaseFile, AppReleasesOverview, AppTarget, AppUploadResult } from '../../types';
import { formatDateTime, formatNumber, timeAgo } from '../../utils/format';
import { formatBytes } from '../backups/backupUtils';
import { GithubAppUpdatesCard, useUpdates } from '../version/appUpdates';

const TARGET_LABEL: Record<string, string> = {
  tvbox: 'TV Box',
  smart_tv: 'Smart TV',
  mobile: 'Celular',
  tablet: 'Tablet',
  pc: 'PC',
  stb: 'Decodificador',
};

const ABI_LABEL: Record<string, string> = {
  'armeabi-v7a': 'armeabi-v7a (32 bits)',
  'arm64-v8a': 'arm64-v8a (64 bits)',
  x86_64: 'x86_64',
  universal: 'Universal',
};

function targetsText(targets: AppTarget[]): string {
  return targets.length === 0
    ? 'todos los equipos que tienen instalada la app desde el APK (celulares, TV Box, Android TV…)'
    : targets.map((t) => TARGET_LABEL[t] ?? t).join(', ');
}

// ---------- Cola de subida ----------

interface UploadItem {
  key: string;
  file: File;
  progress: number;
  status: 'waiting' | 'uploading' | 'done' | 'error';
  result?: AppUploadResult;
  error?: string;
}

export function AppReleasesPage() {
  const data = useAsync(() => api.appReleases.list(), []);
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const runningRef = useRef(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const updates = useUpdates({ onImported: (res) => {
    void data.reload(true);
    if (res.release_id) setHighlight(res.release_id);
  } });

  const showRelease = (id: number) => {
    setHighlight(id);
    window.setTimeout(() => document.getElementById(`release-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const d = data.data;

  const addFiles = (list: FileList | File[]) => {
    const files = [...list].filter((f) => f.name.toLowerCase().endsWith('.apk'));
    if (files.length === 0) return;
    setQueue((q) => [
      ...q.filter((i) => i.status !== 'done' && i.status !== 'error'),
      ...files.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, progress: 0, status: 'waiting' as const })),
    ]);
  };

  // Se suben de una en una, en el orden en que se eligieron.
  useEffect(() => {
    if (runningRef.current) return;
    const next = queue.find((i) => i.status === 'waiting');
    if (!next) return;
    runningRef.current = true;
    const update = (patch: Partial<UploadItem>) => setQueue((q) => q.map((i) => (i.key === next.key ? { ...i, ...patch } : i)));
    update({ status: 'uploading' });
    const job = uploadAppApk(next.file, (p) => update({ progress: p }));
    job.promise
      .then((result) => {
        update({ status: 'done', progress: 1, result });
        void data.reload(true);
      })
      .catch((e) => update({ status: 'error', error: errorMessage(e) }))
      .finally(() => {
        runningRef.current = false;
        setQueue((q) => [...q]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  if (!d) return data.error ? <ErrorState message={data.error} onRetry={() => void data.reload()} /> : <PageLoader />;

  const uploading = queue.some((i) => i.status === 'uploading' || i.status === 'waiting');

  return (
    <>
      <PageHeader
        title="Actualizaciones de la app"
        subtitle="Versiones de tu app IPTV Player que los equipos descargan e instalan desde el portal"
      />

      <Alert tone="blue" icon={<Tv size={18} />}>
        Los <strong>celulares, TV Box y Android TV</strong> que tienen la app instalada desde el APK buscan aquí las versiones nuevas. (Si más
        adelante publicas en Google Play, los que la instalen desde Play se actualizan por Play.)
      </Alert>

      <GithubAppUpdatesCard updates={updates} releases={data.data?.items ?? null} onShowRelease={showRelease} />

      <div className="apprel-top">
        <section className="card">
          <h2 className="card-title">
            <CloudUpload size={18} /> Subir APK
          </h2>
          <div
            className={`apprel-drop ${dragOver ? 'is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
          >
            <PackageOpen size={28} />
            <strong>Arrastra aquí los APK o haz clic para elegirlos</strong>
            <span className="muted text-sm">Puedes subir varios a la vez; los de la misma versión se agrupan.</span>
            <input
              ref={fileRef}
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          <details className="bulk-details apprel-help">
            <summary>¿Qué archivos subo?</summary>
            <ul className="plain-list text-sm">
              <li>
                <code>app-arm64-v8a-release.apk</code>: la mayoría de celulares y TV Box modernos.
              </li>
              <li>
                <code>app-armeabi-v7a-release.apk</code>: TV Box y celulares más antiguos o económicos.
              </li>
              <li>
                <code>app-x86_64-release.apk</code>: emuladores y PC.
              </li>
              <li>
                Si no estás seguro, el universal <code>app-release.apk</code>: sirve para todos, pero pesa más.
              </li>
            </ul>
          </details>
          {queue.length > 0 && (
            <ul className="apprel-queue">
              {queue.map((i) => (
                <UploadRow key={i.key} item={i} onRemove={() => setQueue((q) => q.filter((x) => x.key !== i.key))} />
              ))}
            </ul>
          )}
          {!uploading && queue.some((i) => i.status === 'done' || i.status === 'error') && (
            <button type="button" className="btn btn-link btn-sm" onClick={() => setQueue([])}>
              Limpiar lista
            </button>
          )}
        </section>

        <InstalledVersions overview={d} />
      </div>

      {d.items.length === 0 ? (
        <section className="card">
          <EmptyState
            icon={<Rocket size={30} />}
            title="Aún no hay versiones de la app"
            description={
              <>
                Genera los APK con <code>app/scripts/publicar.ps1</code> desde el proyecto (crea los archivos de cada arquitectura en{' '}
                <code>app/build/app/outputs/flutter-apk/</code>) y súbelos aquí, o tráelos desde GitHub con la tarjeta de arriba. Quedan como borrador
                hasta que los publiques; entonces los celulares, TV Box y Android TV con la app instalada desde el APK se actualizan solos.
              </>
            }
          />
        </section>
      ) : (
        <div className="apprel-list">
          {d.items.map((r) => (
            <ReleaseCard key={r.id} release={r} targets={d.targets} highlighted={highlight === r.id} onChanged={() => { void data.reload(true); void updates.data.reload(true); }} />
          ))}
        </div>
      )}
    </>
  );
}

function UploadRow({ item, onRemove }: { item: UploadItem; onRemove: () => void }) {
  const r = item.result;
  return (
    <li className={`apprel-upload is-${item.status}`}>
      <div className="apprel-upload-head">
        <span className="mono text-sm ellipsis">{item.file.name}</span>
        <span className="muted text-xs nowrap">{formatBytes(item.file.size)}</span>
        {item.status === 'waiting' && <Badge tone="gray">En cola</Badge>}
        {item.status === 'uploading' && <Badge tone="blue">Subiendo {Math.round(item.progress * 100)}%</Badge>}
        {item.status === 'done' && (
          <Badge tone="green">
            <CircleCheck size={11} /> {r?.replaced ? 'Reemplazado' : 'Subido'}
          </Badge>
        )}
        {item.status === 'error' && <Badge tone="red">Error</Badge>}
        {(item.status === 'done' || item.status === 'error' || item.status === 'waiting') && (
          <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Quitar de la lista" onClick={onRemove}>
            <X size={14} />
          </button>
        )}
      </div>
      {(item.status === 'uploading' || item.status === 'waiting') && (
        <div className="progress apprel-progress" role="progressbar" aria-valuenow={Math.round(item.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-bar" style={{ width: `${Math.round(item.progress * 100)}%` }} />
        </div>
      )}
      {r && (
        <div className="text-xs apprel-upload-info">
          <span className="mono">{r.apk.package}</span> · versión <strong>{r.apk.versionName}</strong> · versionCode <span className="mono">{r.apk.versionCode}</span> ·{' '}
          {ABI_LABEL[r.apk.abi] ?? r.apk.abi}
        </div>
      )}
      {r?.warnings?.length ? (
        <ul className="apprel-warnings">
          {r.warnings.map((w, i) => (
            <li key={i}>
              <AlertTriangle size={12} /> {w}
            </li>
          ))}
        </ul>
      ) : null}
      {item.error && <div className="text-red text-sm">{item.error}</div>}
    </li>
  );
}

function InstalledVersions({ overview }: { overview: AppReleasesOverview }) {
  const rows = overview.devices_by_version ?? [];
  const max = Math.max(1, ...rows.map((r) => r.devices));
  const total = rows.reduce((n, r) => n + r.devices, 0);
  return (
    <section className="card">
      <h2 className="card-title">
        <MonitorSmartphone size={18} /> Versiones instaladas
      </h2>
      <p className="muted text-sm no-margin">Equipos vistos en los últimos 30 días, según la versión de la app que informan.</p>
      {rows.length === 0 ? (
        <p className="muted text-sm">Todavía ningún equipo ha informado la versión de la app.</p>
      ) : (
        <ul className="apprel-versions">
          {rows.map((r) => (
            <li key={`${r.version}-${r.distribution}`}>
              <span className="apprel-version-name">
                <strong>{r.version || '—'}</strong>
                {r.distribution === 'play' ? (
                  <Badge tone="green">
                    <Smartphone size={10} /> Play
                  </Badge>
                ) : r.distribution === 'portal' ? (
                  <Badge tone="blue">
                    <Tv size={10} /> Portal
                  </Badge>
                ) : (
                  <Badge tone="gray">Sin dato</Badge>
                )}
              </span>
              <span className="apprel-bar">
                <span style={{ width: `${Math.max(4, (r.devices / max) * 100)}%` }} />
              </span>
              <span className="apprel-count">{formatNumber(r.devices)}</span>
            </li>
          ))}
        </ul>
      )}
      {total > 0 && <p className="muted text-xs no-margin">{formatNumber(total)} equipos en total</p>}
    </section>
  );
}

// ---------- Versión ----------

function ReleaseCard({ release, targets, highlighted, onChanged }: { release: AppRelease; targets: AppTarget[]; highlighted: boolean; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const r = release;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const togglePublish = async () => {
    if (!r.published) {
      if (r.files.length === 0) {
        toast.error('Sube al menos un APK antes de publicar');
        return;
      }
      const ok = await confirm({
        title: `Publicar la versión ${r.version_name}`,
        message: (
          <div className="stack-sm">
            <span>
              La recibirán <strong>{targetsText(r.targets)}</strong>
              {r.channel === 'beta' ? ' en el canal Beta' : ''}
              {r.rollout_percent < 100 ? `, solo el ${r.rollout_percent}% de los equipos (despliegue gradual)` : ''}.
            </span>
            {r.mandatory && <span className="text-red">Es obligatoria: la app no dejará seguir usándola hasta actualizar.</span>}
          </div>
        ),
        confirmText: 'Publicar',
      });
      if (!ok) return;
      await run('publish', () => api.appReleases.update(r.id, { published: true }), `Versión ${r.version_name} publicada`);
    } else {
      const ok = await confirm({
        title: `Despublicar la versión ${r.version_name}`,
        message: 'Los equipos dejarán de recibirla. Quienes ya la instalaron la conservan.',
        confirmText: 'Despublicar',
        danger: true,
      });
      if (!ok) return;
      await run('publish', () => api.appReleases.update(r.id, { published: false }), `Versión ${r.version_name} despublicada`);
    }
  };

  const removeRelease = async () => {
    const ok = await confirm({
      title: `Eliminar la versión ${r.version_name}`,
      message: `Se ${r.files.length === 1 ? 'borrará su APK' : `borrarán sus ${r.files.length} APK`} del servidor${r.published ? ' y dejará de ofrecerse a los equipos' : ''}. No se puede deshacer.`,
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    await run('delete', () => api.appReleases.remove(r.id), `Versión ${r.version_name} eliminada`);
  };

  const removeFile = async (f: AppReleaseFile) => {
    const last = r.files.length === 1;
    const ok = await confirm({
      title: 'Eliminar APK',
      message: `¿Eliminar el APK ${ABI_LABEL[f.abi] ?? f.abi} (versionCode ${f.version_code})?${last && r.published ? ' Es el último archivo: la versión se despublicará.' : ''}`,
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    await run(`file-${f.id}`, () => api.appReleases.removeFile(r.id, f.id), 'APK eliminado');
  };

  const download = async (f: AppReleaseFile) => {
    setBusy(`dl-${f.id}`);
    try {
      await downloadWithToken(api.appReleases.fileUrl(r.id, f.id), f.filename);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <article id={`release-${r.id}`} className={`card apprel-card ${r.published ? 'is-published' : ''} ${highlighted ? 'is-highlighted' : ''}`}>
      <header className="apprel-card-head">
        <div className="apprel-card-title">
          <h2 className="no-margin">{r.version_name}</h2>
          <span className="row-inline">
            {r.published ? <Badge tone="green">Publicada</Badge> : <Badge tone="gray">Borrador</Badge>}
            {r.mandatory && <Badge tone="red">Obligatoria</Badge>}
            {r.channel === 'beta' && <Badge tone="purple">Beta</Badge>}
            {r.rollout_percent < 100 && <Badge tone="amber">Despliegue {r.rollout_percent}%</Badge>}
            {r.targets.map((t) => (
              <Badge key={t} tone="blue">
                {TARGET_LABEL[t] ?? t}
              </Badge>
            ))}
          </span>
          <span className="muted text-xs">
            <span className="mono">{r.package_name}</span> · versionCode {r.version_code}
            {r.min_sdk ? ` · Android SDK ${r.min_sdk}+` : ''}
            {r.published_at ? ` · publicada ${formatDateTime(r.published_at)}` : ` · subida ${timeAgo(r.created_at)}`}
          </span>
        </div>
        <div className="apprel-card-actions">
          <button type="button" className={`btn btn-sm ${r.published ? 'btn-secondary' : 'btn-primary'}`} onClick={() => void togglePublish()} disabled={busy !== null}>
            {busy === 'publish' ? <Spinner size={13} /> : r.published ? <Undo2 size={14} /> : <Rocket size={14} />} {r.published ? 'Despublicar' : 'Publicar'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            <Pencil size={14} /> {editing ? 'Cerrar edición' : 'Editar'}
          </button>
          <button type="button" className="btn btn-danger-ghost btn-icon btn-sm" title="Eliminar versión" onClick={() => void removeRelease()} disabled={busy !== null}>
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <div className="apprel-stats">
        <span>
          <strong>{formatNumber(r.downloads)}</strong> {r.downloads === 1 ? 'descarga' : 'descargas'}
        </span>
        <span>
          <strong>{formatNumber(r.installed_devices ?? 0)}</strong> {r.installed_devices === 1 ? 'equipo' : 'equipos'} con esta versión
        </span>
      </div>
      {r.notes ? <p className="apprel-notes pre-wrap">{r.notes}</p> : <p className="muted text-sm no-margin">Sin novedades escritas.</p>}

      {editing && <ReleaseEditor release={r} targets={targets} onSaved={() => { setEditing(false); onChanged(); }} />}

      <div className="table-card apprel-files">
        <div className="table-scroll">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Arquitectura</th>
                <th>versionCode</th>
                <th>Tamaño</th>
                <th className="hide-mobile">Descargas</th>
                <th className="hide-mobile">SHA-256</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.files.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted text-sm">
                    Sin APK: sube al menos uno para poder publicarla.
                  </td>
                </tr>
              ) : (
                r.files.map((f) => (
                  <tr key={f.id} className={f.missing ? 'row-danger' : ''}>
                    <td>
                      <span className="strong">{ABI_LABEL[f.abi] ?? f.abi}</span>
                      {f.missing && (
                        <div className="text-red text-xs row-inline">
                          <FileWarning size={12} /> El archivo no está en el servidor
                        </div>
                      )}
                    </td>
                    <td className="mono">{f.version_code}</td>
                    <td className="nowrap">{formatBytes(f.size)}</td>
                    <td className="hide-mobile">{formatNumber(f.downloads)}</td>
                    <td className="hide-mobile">
                      <span className="row-inline nowrap">
                        <span className="mono text-xs" title={f.sha256}>
                          {f.sha256.slice(0, 12)}…
                        </span>
                        <CopyButton text={f.sha256} />
                      </span>
                    </td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Descargar APK" onClick={() => void download(f)} disabled={f.missing || busy !== null}>
                          {busy === `dl-${f.id}` ? <Spinner size={13} /> : <Download size={14} />}
                        </button>
                        <button type="button" className="btn btn-danger-ghost btn-icon btn-sm" title="Eliminar APK" onClick={() => void removeFile(f)} disabled={busy !== null}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}

function ReleaseEditor({ release, targets, onSaved }: { release: AppRelease; targets: AppTarget[]; onSaved: () => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState(release.notes ?? '');
  const [channel, setChannel] = useState(release.channel);
  const [sel, setSel] = useState<AppTarget[]>(release.targets ?? []);
  const [rollout, setRollout] = useState(String(release.rollout_percent ?? 100));
  const [mandatory, setMandatory] = useState(release.mandatory);
  const [busy, setBusy] = useState(false);

  const pct = Number(rollout);
  const validPct = Number.isInteger(pct) && pct >= 1 && pct <= 100;

  const toggle = (t: AppTarget) => setSel((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const save = async () => {
    if (!validPct) return;
    setBusy(true);
    try {
      await api.appReleases.update(release.id, { notes, channel, targets: sel, rollout_percent: pct, mandatory });
      toast.success('Cambios guardados');
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="apprel-editor stack">
      <FormField label="Novedades que verá el cliente" htmlFor={`notes-${release.id}`}>
        <textarea id={`notes-${release.id}`} className="input textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="- Nueva guía de canales&#10;- Corrección al cambiar de canal" />
      </FormField>
      <div className="grid-2 align-start">
        <FormField label="Canal">
          <div className="segmented">
            <button type="button" className={`segment ${channel === 'stable' ? 'is-active' : ''}`} onClick={() => setChannel('stable')}>
              Estable
            </button>
            <button type="button" className={`segment ${channel === 'beta' ? 'is-active' : ''}`} onClick={() => setChannel('beta')}>
              Beta
            </button>
          </div>
        </FormField>
        <FormField label={`Despliegue gradual: ${validPct ? pct : '—'}%`} error={validPct ? null : 'Entre 1 y 100'} hint="Cada equipo siempre obtiene la misma respuesta: sube el porcentaje poco a poco.">
          <div className="row">
            <input className="range apprel-range" type="range" min={1} max={100} value={validPct ? pct : 100} onChange={(e) => setRollout(e.target.value)} aria-label="Porcentaje de equipos" />
            <input className="input input-sm apprel-pct" type="number" min={1} max={100} value={rollout} onChange={(e) => setRollout(e.target.value)} aria-label="Porcentaje" />
          </div>
        </FormField>
      </div>
      <FormField label="Tipos de equipo" hint={sel.length === 0 ? 'Ninguno marcado = todos los equipos con la app instalada desde el APK.' : `Solo: ${targetsText(sel)}.`}>
        <div className="chips">
          {(targets.length ? targets : (Object.keys(TARGET_LABEL) as AppTarget[])).map((t) => (
            <button key={t} type="button" className={`chip ${sel.includes(t) ? 'chip-active' : ''}`} aria-pressed={sel.includes(t)} onClick={() => toggle(t)}>
              {TARGET_LABEL[t] ?? t}
            </button>
          ))}
        </div>
      </FormField>
      <Switch
        checked={mandatory}
        onChange={setMandatory}
        label="Actualización obligatoria"
        description="La app se bloquea hasta que el usuario instale esta versión. Se ofrece a todos los equipos elegidos, sin despliegue gradual."
      />
      {mandatory && <Alert tone="amber">Úsala solo para cambios imprescindibles: nadie podrá ver canales sin actualizar.</Alert>}
      <div className="row row-end">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !validPct}>
          {busy && <Spinner size={14} />} Guardar cambios
        </button>
      </div>
    </div>
  );
}
