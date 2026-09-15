import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleCheck, Eye, EyeOff, PlugZap } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useCategories, usePackages } from '../../hooks/useResources';
import { useProfiles, useServers } from '../../hooks/useStreaming';
import { DeliverySelector, validateDelivery } from '../../components/DeliverySelector';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Alert, FormField, Select, Spinner, Switch } from '../../components/ui';
import type { AstraSource, AstraSourceInput, AstraTestResult, DeliveryValue } from '../../types';
import { formatNumber, isValidUrl } from '../../utils/format';

interface FormState {
  name: string;
  api_url: string;
  username: string;
  password: string;
  url_mode: 'play' | 'output';
  play_url: string;
  play_path: string;
  enabled: boolean;
  sync_interval_minutes: number;
  status_poll: boolean;
  status_interval_minutes: number;
  auto_import_new: boolean;
  disable_removed: boolean;
  sync_names: boolean;
  category_mode: 'group' | 'fixed';
  category_id: number | null;
  package_id: number | null;
  delivery: DeliveryValue;
}

function toForm(s: AstraSource | null): FormState {
  const d = s?.import_defaults ?? {};
  return {
    name: s?.name ?? '',
    api_url: s?.api_url ?? '',
    username: s?.username ?? 'admin',
    password: '',
    url_mode: s?.url_mode ?? 'play',
    play_url: s?.play_url ?? '',
    play_path: s?.play_path ?? '/play/{id}',
    enabled: s?.enabled ?? true,
    sync_interval_minutes: s?.sync_interval_minutes ?? 30,
    status_poll: s?.status_poll ?? true,
    status_interval_minutes: s?.status_interval_minutes ?? 5,
    auto_import_new: s?.auto_import_new ?? false,
    disable_removed: s?.disable_removed ?? true,
    sync_names: s?.sync_names ?? true,
    category_mode: d.category_mode ?? 'group',
    category_id: d.category_id ?? null,
    package_id: d.package_id ?? null,
    delivery: {
      delivery_mode: d.delivery_mode ?? 'restream',
      transcode_profile_id: d.transcode_profile_id ?? null,
      server_ids: d.server_ids ?? [],
      always_on: d.always_on ?? false,
    },
  };
}

function toInput(f: FormState): AstraSourceInput {
  return {
    name: f.name.trim(),
    api_url: f.api_url.trim().replace(/\/+$/, ''),
    username: f.username.trim(),
    ...(f.password ? { password: f.password } : {}),
    url_mode: f.url_mode,
    play_url: f.play_url.trim().replace(/\/+$/, ''),
    play_path: f.play_path.trim() || '/play/{id}',
    enabled: f.enabled,
    sync_interval_minutes: f.sync_interval_minutes,
    status_poll: f.status_poll,
    status_interval_minutes: f.status_interval_minutes,
    auto_import_new: f.auto_import_new,
    disable_removed: f.disable_removed,
    sync_names: f.sync_names,
    import_defaults: {
      category_mode: f.category_mode,
      category_id: f.category_mode === 'fixed' ? f.category_id : null,
      package_id: f.package_id,
      ...f.delivery,
    },
  };
}

const STEPS = ['Conexión', 'URLs', 'Automatización', 'Importación'];

export function AstraSourceWizard({
  open,
  source,
  onClose,
  onSaved,
}: {
  open: boolean;
  source: AstraSource | null;
  onClose: () => void;
  onSaved: (s: AstraSource, created: boolean) => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(() => toForm(source));
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<AstraTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { categories } = useCategories('live');
  const { packages } = usePackages();
  const { servers } = useServers(open);
  const { profiles } = useProfiles(open);

  useEffect(() => {
    if (!open) return;
    setForm(toForm(source));
    setStep(0);
    setErrors({});
    setTest(null);
    setTestError(null);
    setServerError(null);
  }, [open, source]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validateStep = (i: number): boolean => {
    const e: Record<string, string> = {};
    if (i === 0) {
      if (!form.name.trim()) e.name = 'Ponle un nombre a la fuente';
      if (!form.api_url.trim()) e.api_url = 'Indica la URL de Astra';
      else if (!/^https?:\/\//i.test(form.api_url.trim())) e.api_url = 'Debe empezar por http:// o https://';
    }
    if (i === 1 && form.play_url.trim() && !isValidUrl(form.play_url.trim())) e.play_url = 'URL no válida';
    if (i === 2) {
      if (form.sync_interval_minutes < 5) e.sync_interval_minutes = 'Mínimo 5 minutos';
      if (form.status_poll && form.status_interval_minutes < 1) e.status_interval_minutes = 'Mínimo 1 minuto';
    }
    if (i === 3) {
      const d = validateDelivery(form.delivery);
      if (d) e.delivery = d;
      if (form.category_mode === 'fixed' && form.category_id === null) e.category_id = 'Elige la categoría';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const runTest = async () => {
    if (!validateStep(0)) return;
    setTesting(true);
    setTest(null);
    setTestError(null);
    try {
      const input = toInput(form);
      setTest(await api.astra.test({ ...input, ...(source && !form.password ? { id: source.id } : {}) }));
    } catch (e) {
      setTestError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  const next = () => {
    if (validateStep(step)) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const save = async () => {
    for (let i = 0; i < STEPS.length; i++) {
      if (!validateStep(i)) {
        setStep(i);
        return;
      }
    }
    setBusy(true);
    setServerError(null);
    try {
      if (source) {
        const saved = await api.astra.update(source.id, toInput(form));
        toast.success('Fuente actualizada');
        onSaved(saved, false);
      } else {
        const res = await api.astra.create(toInput(form));
        if (res.error) toast.error(`Fuente guardada, pero la sincronización falló: ${res.error}`);
        else if (res.sync) toast.success(`Fuente creada: ${formatNumber(res.sync.total)} canales encontrados (${formatNumber(res.sync.new)} nuevos)`);
        onSaved(res.source, true);
      }
    } catch (e) {
      setServerError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const localHint = form.api_url.includes('127.0.0.1') || form.api_url.includes('localhost');

  return (
    <Modal
      open={open}
      title={source ? `Editar fuente Astra: ${source.name}` : 'Agregar fuente Astra'}
      onClose={onClose}
      size="lg"
      dismissible={!busy}
      footer={
        <>
          {step > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              <ArrowLeft size={15} /> Atrás
            </button>
          )}
          <div className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={next}>
              Siguiente <ArrowRight size={15} />
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {busy && <Spinner size={14} />} {source ? 'Guardar cambios' : 'Guardar y sincronizar'}
            </button>
          )}
        </>
      }
    >
      <ol className="steps steps-compact">
        {STEPS.map((label, i) => (
          <li key={label} className={`step ${step === i ? 'is-current' : ''} ${step > i ? 'is-done' : ''}`}>
            <button type="button" className="step-button" onClick={() => (i < step || validateStep(step)) && setStep(i)}>
              <span className="step-num">{step > i ? <CircleCheck size={14} /> : i + 1}</span>
              <span className="step-label">{label}</span>
            </button>
          </li>
        ))}
      </ol>
      {serverError && <Alert tone="red">{serverError}</Alert>}

      {step === 0 && (
        <div className="stack">
          <FormField label="Nombre" required error={errors.name}>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Astra principal" />
          </FormField>
          <FormField label="URL de la API" required error={errors.api_url} hint="URL de la interfaz web de Astra, p. ej. http://ip:8000">
            <input className="input mono" value={form.api_url} onChange={(e) => set('api_url', e.target.value)} placeholder="http://203.0.113.20:8000" />
          </FormField>
          <div className="grid-2">
            <FormField label="Usuario">
              <input className="input" autoComplete="off" value={form.username} onChange={(e) => set('username', e.target.value)} />
            </FormField>
            <FormField label="Contraseña" hint={source?.password_set ? 'Guardada. Déjala vacía para mantenerla.' : undefined}>
              <div className="input-group">
                <input
                  className="input"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.password}
                  placeholder={source?.password_set ? '•••••••• (guardada)' : ''}
                  onChange={(e) => set('password', e.target.value)}
                />
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowPass((v) => !v)} title={showPass ? 'Ocultar' : 'Mostrar'}>
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </FormField>
          </div>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => void runTest()} disabled={testing}>
              {testing ? <Spinner size={14} /> : <PlugZap size={16} />} Probar conexión
            </button>
          </div>
          {testError && (
            <Alert tone="red" title="No se pudo conectar">
              {testError}
            </Alert>
          )}
          {test && (
            <div className="test-result no-margin">
              <Alert tone="green" icon={<CircleCheck size={18} />} title={`Conexión correcta: ${formatNumber(test.total)} canales (${formatNumber(test.enabled)} habilitados)`} />
              {test.groups.length > 0 && (
                <div className="chips no-margin">
                  {test.groups.map((g) => (
                    <span key={g} className="chip chip-static">
                      {g}
                    </span>
                  ))}
                </div>
              )}
              <div className="table-scroll">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Canal</th>
                      <th className="hide-mobile">Grupo</th>
                      <th>URL de reproducción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {test.sample.map((c) => (
                      <tr key={c.astra_id} className={c.enabled ? '' : 'row-muted'}>
                        <td>
                          <div className="cell-main">
                            <span className="strong">{c.name}</span>
                            <span className="muted text-xs mono">
                              {c.astra_id}
                              {!c.enabled && ' · deshabilitado'}
                            </span>
                          </div>
                        </td>
                        <td className="hide-mobile">{c.group || '—'}</td>
                        <td className="mono text-xs break-all">{c.play_url || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          <FormField label="URL que se usará como fuente de cada canal">
            <div className="radio-cards">
              <button type="button" className={`radio-card ${form.url_mode === 'play' ? 'is-active' : ''}`} onClick={() => set('url_mode', 'play')}>
                <span className="radio-card-head">
                  <span className="radio-dot" />
                  <span className="radio-card-title">HTTP Play (/play/{'{id}'})</span>
                </span>
                <span className="radio-card-desc">Usa el servicio HTTP Play de Astra: una URL por canal con su ID. Recomendado.</span>
              </button>
              <button type="button" className={`radio-card ${form.url_mode === 'output' ? 'is-active' : ''}`} onClick={() => set('url_mode', 'output')}>
                <span className="radio-card-head">
                  <span className="radio-dot" />
                  <span className="radio-card-title">Salida HTTP del canal</span>
                </span>
                <span className="radio-card-desc">Usa la primera salida http:// configurada en cada canal de Astra.</span>
              </button>
            </div>
          </FormField>
          {form.url_mode === 'play' && (
            <div className="grid-2">
              <FormField label="URL de reproducción (play_url)" error={errors.play_url} hint="Vacío = la misma URL de la API">
                <input className="input mono" value={form.play_url} onChange={(e) => set('play_url', e.target.value)} placeholder="http://127.0.0.1:8000" />
              </FormField>
              <FormField label="Ruta" hint="{id} se reemplaza por el ID del canal">
                <input className="input mono" value={form.play_path} onChange={(e) => set('play_path', e.target.value)} />
              </FormField>
            </div>
          )}
          <Alert tone="blue" title="¿Astra está en el mismo equipo que el servidor de streaming?">
            Usa <code>http://127.0.0.1:8000</code> como URL de reproducción: así el servidor toma la señal localmente y el tráfico no sale a
            internet. Si Astra está en otro equipo, usa su IP interna o pública.
            {localHint && ' Ojo: la API usa localhost, verifica que el nodo pueda llegar a esa dirección.'}
          </Alert>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <div className="grid-2">
            <FormField label="Sincronizar cada (minutos)" error={errors.sync_interval_minutes} hint="Altas, bajas y cambios de URL">
              <input className="input input-narrow" type="number" min={5} value={form.sync_interval_minutes} onChange={(e) => set('sync_interval_minutes', Math.floor(Number(e.target.value)))} />
            </FormField>
            <FormField label="Consultar señal cada (minutos)" error={errors.status_interval_minutes}>
              <input className="input input-narrow" type="number" min={1} disabled={!form.status_poll} value={form.status_interval_minutes} onChange={(e) => set('status_interval_minutes', Math.floor(Number(e.target.value)))} />
            </FormField>
          </div>
          <Switch checked={form.status_poll} onChange={(v) => set('status_poll', v)} label="Consultar la señal en Astra" description="Marca los canales importados como en línea o caídos según Astra (al aire, bitrate, errores)." />
          <Switch checked={form.auto_import_new} onChange={(v) => set('auto_import_new', v)} label="Importar automáticamente los canales nuevos" description="Con las opciones de importación predeterminadas (paso 4)." />
          <Switch checked={form.disable_removed} onChange={(v) => set('disable_removed', v)} label="Deshabilitar los canales borrados en Astra" />
          <Switch checked={form.sync_names} onChange={(v) => set('sync_names', v)} label="Actualizar nombres desde Astra" description="Si cambias el nombre en Astra, se cambia también aquí." />
          <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label="Fuente habilitada" />
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <p className="muted text-sm no-margin">Valores predeterminados al importar canales de esta fuente (se pueden cambiar en cada importación).</p>
          <ImportOptionsFields
            categoryMode={form.category_mode}
            categoryId={form.category_id}
            packageId={form.package_id}
            delivery={form.delivery}
            categories={categories}
            packages={packages}
            servers={servers}
            profiles={profiles}
            errors={errors}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          />
        </div>
      )}
    </Modal>
  );
}

export function ImportOptionsFields({
  categoryMode,
  categoryId,
  packageId,
  delivery,
  categories,
  packages,
  servers,
  profiles,
  errors,
  onChange,
}: {
  categoryMode: 'group' | 'fixed';
  categoryId: number | null;
  packageId: number | null;
  delivery: DeliveryValue;
  categories: { id: number; name: string }[];
  packages: { id: number; name: string }[];
  servers: Parameters<typeof DeliverySelector>[0]['servers'];
  profiles: Parameters<typeof DeliverySelector>[0]['profiles'];
  errors: Record<string, string | undefined>;
  onChange: (patch: { category_mode?: 'group' | 'fixed'; category_id?: number | null; package_id?: number | null; delivery?: DeliveryValue }) => void;
}) {
  return (
    <>
      <div className="grid-2">
        <FormField label="Categoría" error={errors.category_id}>
          <div className="segmented">
            <button type="button" className={`segment ${categoryMode === 'group' ? 'is-active' : ''}`} onClick={() => onChange({ category_mode: 'group' })}>
              Según grupo de Astra
            </button>
            <button type="button" className={`segment ${categoryMode === 'fixed' ? 'is-active' : ''}`} onClick={() => onChange({ category_mode: 'fixed' })}>
              Categoría fija
            </button>
          </div>
          {categoryMode === 'fixed' ? (
            <Select
              className="mt-sm"
              value={categoryId === null ? '' : String(categoryId)}
              onChange={(v) => onChange({ category_id: v ? Number(v) : null })}
              placeholder="Selecciona…"
              options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
            />
          ) : (
            <span className="field-hint">Se crea una categoría por cada grupo si no existe.</span>
          )}
        </FormField>
        <FormField label="Añadir al paquete" hint="Opcional">
          <Select
            value={packageId === null ? '' : String(packageId)}
            onChange={(v) => onChange({ package_id: v ? Number(v) : null })}
            placeholder="— Ninguno —"
            options={packages.map((p) => ({ value: String(p.id), label: p.name }))}
          />
        </FormField>
      </div>
      <div className="field-label">Modo de entrega</div>
      <DeliverySelector value={delivery} onChange={(v) => onChange({ delivery: v })} servers={servers} profiles={profiles} error={errors.delivery} compact />
    </>
  );
}

