import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  FlaskConical,
  Info,
  PlugZap,
  RefreshCw,
  Save,
  TriangleAlert,
  Webhook,
} from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';
import { TagInput } from '../../components/TagInput';
import { Alert, Badge, CopyButton, EmptyState, ErrorState, FormField, PageLoader, Spinner, Switch } from '../../components/ui';
import type {
  BillingConfig,
  BillingConfigInput,
  BillingFieldKey,
  BillingMatchBy,
  BillingOverview,
  BillingRun,
  BillingTestResult,
  MappedStatus,
} from '../../types';
import { formatDateTime, formatNumber, timeAgo } from '../../utils/format';
import { BILLING_ACTION, BILLING_TRIGGER, CUT_MODE, FREE_HINT, MAPPED_STATUS } from '../../utils/labels';
import { ExternalStatusBadge } from '../../components/ExternalStatus';

type FormState = Omit<BillingConfig, 'api_key_set' | 'api_key_hint' | 'webhook_token'> & { api_key: string };
type StatusList = 'free' | 'active' | 'suspended' | 'disabled';

const STATUS_LIST_LABEL: Record<StatusList, string> = { free: 'Gratis', active: 'Activo', suspended: 'Suspendido', disabled: 'Cancelado' };

const MATCH_OPTIONS: { key: BillingMatchBy; label: string }[] = [
  { key: 'document', label: 'Cédula' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'username', label: 'Usuario' },
];

const FIELD_LABELS: Record<BillingFieldKey, string> = {
  id: 'ID del servicio',
  status: 'Estado',
  document: 'Cédula',
  username: 'Usuario',
  name: 'Nombre',
  email: 'Email',
  phone: 'Teléfono',
  plan: 'Plan',
};

function toForm(c: BillingConfig): FormState {
  return {
    enabled: c.enabled,
    provider: c.provider,
    base_url: c.base_url ?? '',
    list_path: c.list_path ?? '',
    auth_header: c.auth_header ?? '',
    auth_prefix: c.auth_prefix ?? '',
    page_size: c.page_size ?? 300,
    results_path: c.results_path ?? '',
    fields: { ...c.fields },
    status_map: {
      free: [...(c.status_map?.free ?? [])],
      active: [...(c.status_map?.active ?? [])],
      suspended: [...(c.status_map?.suspended ?? [])],
      disabled: [...(c.status_map?.disabled ?? [])],
    },
    match_by: [...(c.match_by ?? [])],
    auto_link: c.auto_link,
    reactivate: c.reactivate,
    interval_minutes: c.interval_minutes ?? 15,
    suspension_reason: c.suspension_reason ?? '',
    api_key: '',
  };
}

function toInput(f: FormState): BillingConfigInput {
  const { api_key, ...rest } = f;
  return { ...rest, ...(api_key.trim() ? { api_key: api_key.trim() } : {}) };
}

export function BillingIntegrationTab({ overview, onChanged }: { overview: BillingOverview; onChanged: (o: BillingOverview) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<FormState>(() => toForm(overview.config));
  const [showKey, setShowKey] = useState(false);
  const [advanced, setAdvanced] = useState(overview.config.provider === 'custom');
  const [errors, setErrors] = useState<{ base_url?: string; api_key?: string; interval?: string }>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<BillingTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testedWithUnsavedKey, setTestedWithUnsavedKey] = useState(false);
  const [correctedUrl, setCorrectedUrl] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<'dry' | 'real' | null>(null);
  const [syncResult, setSyncResult] = useState<{ run: BillingRun; dry: boolean } | null>(null);

  const saved = useMemo(() => JSON.stringify(toInput(toForm(overview.config))), [overview.config]);
  const dirty = JSON.stringify(toInput({ ...form, api_key: '' })) !== saved || form.api_key.trim() !== '';

  // Solo se reinicia el formulario si cambió la configuración guardada (no al regenerar el webhook, etc.).
  // La API Key escrita y aún no guardada se conserva al refrescar los datos.
  useEffect(() => {
    setForm((f) => ({ ...toForm(overview.config), api_key: f.api_key }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, overview.config.api_key_set]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const validate = (forTest: boolean) => {
    const e: typeof errors = {};
    if (!form.base_url.trim()) e.base_url = 'Indica la URL de consulta de la API';
    else if (!/^https?:\/\//i.test(form.base_url.trim())) e.base_url = 'Debe empezar por http:// o https://';
    if (!form.api_key.trim() && !overview.config.api_key_set) e.api_key = 'Indica la API Key';
    if (!forTest && (!Number.isInteger(Number(form.interval_minutes)) || Number(form.interval_minutes) < 5))
      e.interval = 'Mínimo 5 minutos';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const applyPreset = (provider: 'wisphub' | 'custom') => {
    if (provider === 'custom') {
      setForm((f) => ({ ...f, provider }));
      setAdvanced(true);
      return;
    }
    const p = overview.presets.wisphub;
    setForm((f) => ({
      ...f,
      provider: 'wisphub',
      base_url: f.base_url || p.base_url || '',
      list_path: p.list_path ?? f.list_path,
      auth_header: p.auth_header ?? f.auth_header,
      auth_prefix: p.auth_prefix ?? f.auth_prefix,
      page_size: p.page_size ?? f.page_size,
      results_path: p.results_path ?? f.results_path,
      fields: { ...f.fields, ...(p.fields ?? {}) },
      status_map: p.status_map
        ? { free: [...(p.status_map.free ?? ['Gratis'])], active: [...p.status_map.active], suspended: [...p.status_map.suspended], disabled: [...p.status_map.disabled] }
        : f.status_map,
    }));
  };

  const save = async () => {
    if (!validate(false)) {
      toast.error('Revisa los campos marcados');
      return;
    }
    setSaving(true);
    try {
      const o = await api.billing.update({ config: toInput({ ...form, interval_minutes: Number(form.interval_minutes) }) });
      toast.success(form.api_key.trim() ? 'Configuración y API Key guardadas' : 'Configuración guardada');
      setForm((f) => ({ ...f, api_key: '' }));
      setTestedWithUnsavedKey(false);
      onChanged(o);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (!validate(true)) return;
    setTesting(true);
    setTestError(null);
    setTest(null);
    setCorrectedUrl(null);
    setTestedWithUnsavedKey(form.api_key.trim() !== '');
    const draftUrl = form.base_url.trim().replace(/\/+$/, '');
    try {
      const res = await api.billing.test(toInput(form));
      setTest(res);
      if (res.base_url_corrected) {
        setCorrectedUrl(res.base_url_corrected);
        set('base_url', res.base_url_corrected);
        toast.info(`Se corrigió la URL de consulta a ${res.base_url_corrected}`);
        // Si era la URL guardada, el servidor ya guardó la corrección: se refrescan los datos.
        if ((overview.config.base_url ?? '').replace(/\/+$/, '') === draftUrl) onChanged(await api.billing.get());
      }
    } catch (e) {
      setTestError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  const runSync = async (dry: boolean) => {
    if (!dry) {
      const ok = await confirm({
        title: 'Sincronizar ahora',
        message:
          overview.cut_mode === 'manual'
            ? 'El modo de cortes es Manual: se vincularán clientes y se actualizarán estados externos, pero no se suspenderá ni reactivará a nadie.'
            : 'Se aplicarán los cortes y reactivaciones según el estado de cada cliente en la plataforma. ¿Continuar?',
        confirmText: 'Sincronizar',
        danger: overview.cut_mode !== 'manual',
      });
      if (!ok) return;
    }
    setSyncing(dry ? 'dry' : 'real');
    setSyncError(null);
    try {
      const run = await api.billing.sync(dry);
      setSyncResult({ run, dry });
      onChanged(await api.billing.get());
      if (run.error) setSyncError(run.error);
      toast.success(dry ? 'Simulación completada' : 'Sincronización completada');
    } catch (e) {
      setSyncError(errorMessage(e));
      toast.error(dry ? 'La simulación falló' : 'La sincronización falló');
    } finally {
      setSyncing(null);
    }
  };

  const addStatus = (value: string, list: StatusList) => {
    setForm((f) => ({
      ...f,
      status_map: {
        free: (f.status_map.free ?? []).filter((v) => v !== value),
        active: f.status_map.active.filter((v) => v !== value),
        suspended: f.status_map.suspended.filter((v) => v !== value),
        disabled: f.status_map.disabled.filter((v) => v !== value),
        [list]: [...(f.status_map[list] ?? []).filter((v) => v !== value), value],
      },
    }));
    setTest((t) =>
      t ? { ...t, status_values: t.status_values.map((s) => (s.value === value ? { ...s, maps_to: list as MappedStatus } : s)) } : t,
    );
    toast.info(`"${value}" se añadió a ${STATUS_LIST_LABEL[list]}. Guarda la configuración para aplicarlo.`);
  };

  return (
    <div className="billing-layout">
      {/* a) Conexión */}
      <section className="card">
        <div className="step-head">
          <span className="step-badge">1</span>
          <div>
            <h2 className="card-title no-margin">Conexión con la plataforma</h2>
            <p className="muted text-sm no-margin">Datos para leer los clientes y su estado de servicio.</p>
          </div>
        </div>

        <FormField label="Plataforma">
          <div className="segmented">
            <button type="button" className={`segment ${form.provider === 'wisphub' ? 'is-active' : ''}`} onClick={() => applyPreset('wisphub')}>
              WispHub
            </button>
            <button type="button" className={`segment ${form.provider === 'custom' ? 'is-active' : ''}`} onClick={() => applyPreset('custom')}>
              Personalizada
            </button>
          </div>
        </FormField>

        <div className="grid-2">
          <FormField
            label="URL de consulta de API"
            required
            error={errors.base_url}
            hint={
              form.provider === 'wisphub'
                ? 'En WispHub: Mi Empresa → URL de consulta de API. Ejemplo: https://api.wisphub.io/api (debe terminar en /api)'
                : 'URL base de la API de tu plataforma'
            }
          >
            <input
              className="input mono"
              value={form.base_url}
              onChange={(e) => {
                set('base_url', e.target.value);
                setCorrectedUrl(null);
              }}
              placeholder="https://api.wisphub.io/api"
            />
          </FormField>
          <FormField
            label={
              <span className="row-inline">
                API Key
                {overview.config.api_key_set && (
                  <span className="badge badge-green">
                    <CircleCheck size={11} /> Configurada
                  </span>
                )}
              </span>
            }
            required={!overview.config.api_key_set}
            error={errors.api_key}
            hint={
              form.api_key.trim() ? (
                <span className="text-amber">Nueva API Key sin guardar: pulsa «Guardar configuración» para conservarla.</span>
              ) : overview.config.api_key_set ? (
                <span>
                  Guardada {overview.config.api_key_hint ? <strong className="mono">{overview.config.api_key_hint}</strong> : ''}. Por seguridad no se
                  muestra completa; el campo vacío mantiene la actual.
                </span>
              ) : (
                'WispHub → Staff → Generar mi API Key; se recomienda una cuenta de administrador'
              )
            }
          >
            <div className="input-group">
              <input
                className="input mono"
                type={showKey ? 'text' : 'password'}
                autoComplete="new-password"
                value={form.api_key}
                placeholder={
                  overview.config.api_key_set
                    ? `Guardada: ${overview.config.api_key_hint ?? '••••'} (escribe una nueva para reemplazarla)`
                    : 'Pega aquí tu API Key'
                }
                onChange={(e) => set('api_key', e.target.value)}
              />
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowKey((s) => !s)} title={showKey ? 'Ocultar' : 'Mostrar'}>
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </FormField>
        </div>

        <div className="grid-2">
          <div className="stack-sm">
            <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label="Activar sincronización automática" description="Consulta la plataforma periódicamente y aplica el modo de cortes." />
            <Switch checked={form.reactivate} onChange={(v) => set('reactivate', v)} label="Reactivar automáticamente" description="Cuando la plataforma vuelve a marcar Activo, se levanta el corte que ella hizo." />
          </div>
          <div className="stack-sm">
            <FormField label="Sincronizar cada N minutos" error={errors.interval}>
              <input className="input input-narrow" type="number" min={5} value={form.interval_minutes} onChange={(e) => set('interval_minutes', Number(e.target.value))} />
            </FormField>
            <FormField label="Motivo del corte" hint="Lo ve el cliente en su app.">
              <input className="input" value={form.suspension_reason} onChange={(e) => set('suspension_reason', e.target.value)} />
            </FormField>
          </div>
        </div>

        <div className="subcard">
          <Switch
            checked={form.auto_link}
            onChange={(v) => set('auto_link', v)}
            label="Vinculación automática"
            description="Relaciona cada cliente de la plataforma con un cliente IPTV comparando estos datos, en este orden."
          />
          <div className="match-options">
            {MATCH_OPTIONS.map((m) => {
              const idx = form.match_by.indexOf(m.key);
              return (
                <label key={m.key} className={`match-option ${idx >= 0 ? 'is-checked' : ''} ${!form.auto_link ? 'is-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    disabled={!form.auto_link}
                    checked={idx >= 0}
                    onChange={(e) =>
                      set('match_by', e.target.checked ? [...form.match_by, m.key] : form.match_by.filter((k) => k !== m.key))
                    }
                  />
                  {idx >= 0 && <span className="match-order">{idx + 1}</span>}
                  {m.label}
                </label>
              );
            })}
          </div>
        </div>

        {/* b) Avanzado */}
        <button type="button" className="collapse-toggle" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
          {advanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Avanzado
          <span className="muted text-sm">ruta, autenticación, campos y estados</span>
        </button>
        {advanced && (
          <div className="advanced-box">
            <div className="grid-3">
              <FormField label="Ruta del listado" hint="list_path">
                <input className="input mono" value={form.list_path} onChange={(e) => set('list_path', e.target.value)} />
              </FormField>
              <FormField label="Cabecera de autenticación" hint="auth_header">
                <input className="input mono" value={form.auth_header} onChange={(e) => set('auth_header', e.target.value)} />
              </FormField>
              <FormField label="Prefijo de la clave" hint='auth_prefix (p. ej. "Api-Key ")'>
                <input className="input mono" value={form.auth_prefix} onChange={(e) => set('auth_prefix', e.target.value)} />
              </FormField>
              <FormField label="Tamaño de página" hint="page_size">
                <input className="input" type="number" min={1} max={1000} value={form.page_size} onChange={(e) => set('page_size', Number(e.target.value))} />
              </FormField>
              <FormField label="Ruta de resultados" hint="results_path (vacío = la respuesta es la lista)">
                <input className="input mono" value={form.results_path} onChange={(e) => set('results_path', e.target.value)} />
              </FormField>
            </div>
            <div className="field-label">Mapeo de campos</div>
            <div className="table-scroll">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Dato</th>
                    <th>Campo en la plataforma</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(FIELD_LABELS) as BillingFieldKey[]).map((k) => (
                    <tr key={k}>
                      <td>{FIELD_LABELS[k]}</td>
                      <td>
                        <input
                          className="input input-sm mono"
                          value={form.fields[k] ?? ''}
                          placeholder="p. ej. plan_internet.nombre"
                          onChange={(e) => set('fields', { ...form.fields, [k]: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="field-label mt">Estados de la plataforma</div>
            <div className="grid-2 status-map-grid">
              <FormField label={<span className="text-teal">Gratis — nunca se cortan</span>} hint="Cuentan como activos y tienen prioridad sobre los demás servicios de la persona">
                <TagInput tone="teal" value={form.status_map.free ?? []} onChange={(v) => set('status_map', { ...form.status_map, free: v })} ariaLabel="Estados gratis" />
              </FormField>
              <FormField label={<span className="text-green">Activo</span>} hint="Se reactiva (si la plataforma lo cortó)">
                <TagInput tone="green" value={form.status_map.active} onChange={(v) => set('status_map', { ...form.status_map, active: v })} ariaLabel="Estados activos" />
              </FormField>
              <FormField label={<span className="text-red">Suspendido</span>} hint="Se suspende el servicio de TV">
                <TagInput tone="red" value={form.status_map.suspended} onChange={(v) => set('status_map', { ...form.status_map, suspended: v })} ariaLabel="Estados suspendidos" />
              </FormField>
              <FormField label="Cancelado" hint="Se deshabilita la línea">
                <TagInput tone="gray" value={form.status_map.disabled} onChange={(v) => set('status_map', { ...form.status_map, disabled: v })} ariaLabel="Estados cancelados" />
              </FormField>
            </div>
          </div>
        )}

        <div className="row row-end mt">
          {dirty && <span className="muted text-sm">Hay cambios sin guardar</span>}
          <button type="button" className="btn btn-secondary" onClick={() => void runTest()} disabled={testing}>
            {testing ? <Spinner size={14} /> : <PlugZap size={16} />} Probar conexión
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <Spinner size={14} /> : <Save size={16} />} Guardar configuración
          </button>
        </div>

        {/* c) Resultado de la prueba */}
        {testError && (
          <Alert tone="red" icon={<CircleAlert size={18} />} title="No se pudo conectar">
            <span className="pre-wrap">{testError}</span>
          </Alert>
        )}
        {correctedUrl && (
          <Alert tone="blue" icon={<Info size={18} />} title="URL corregida">
            Se corrigió la URL de consulta a <code>{correctedUrl}</code>.
          </Alert>
        )}
        {(test || testError) && testedWithUnsavedKey && form.api_key.trim() !== '' && (
          <Alert tone="amber" icon={<Info size={18} />}>
            Recuerda <strong>Guardar</strong> para conservar la API Key.
          </Alert>
        )}
        {test && <TestResult test={test} onAddStatus={addStatus} />}
      </section>

      {/* d) Sincronización */}
      <section className="card">
        <div className="step-head">
          <span className="step-badge">2</span>
          <div>
            <h2 className="card-title no-margin">Sincronización</h2>
            <p className="muted text-sm no-margin">
              Modo de cortes actual: <strong>{CUT_MODE[overview.cut_mode].label}</strong>
              {overview.last_run?.finished_at ? ` · Última: ${timeAgo(overview.last_run.finished_at)}` : ''}
            </p>
          </div>
        </div>
        {!overview.config.api_key_set && <Alert tone="amber">Guarda primero la conexión (URL y API Key) para poder sincronizar.</Alert>}
        {dirty && overview.config.api_key_set && (
          <Alert tone="amber" icon={<Info size={18} />}>
            La sincronización usa la configuración <strong>guardada</strong>. Guarda los cambios para incluirlos.
          </Alert>
        )}
        <div className="row">
          <button type="button" className="btn btn-secondary" disabled={syncing !== null || !overview.config.api_key_set} onClick={() => void runSync(true)}>
            {syncing === 'dry' ? <Spinner size={14} /> : <FlaskConical size={16} />} Simular sincronización
          </button>
          <button type="button" className="btn btn-primary" disabled={syncing !== null || !overview.config.api_key_set} onClick={() => void runSync(false)}>
            {syncing === 'real' ? <Spinner size={14} /> : <RefreshCw size={16} />} Sincronizar ahora
          </button>
        </div>
        {syncError && (
          <Alert tone="red" icon={<CircleAlert size={18} />} title="Error de sincronización">
            <span className="pre-wrap">{syncError}</span>
          </Alert>
        )}
        {syncResult && <RunResult run={syncResult.run} dry={syncResult.dry} cutMode={overview.cut_mode} />}
      </section>

      {/* e) Webhook */}
      <WebhookCard overview={overview} onChanged={onChanged} />
    </div>
  );
}

// ---------- Resultado de la prueba ----------

function TestResult({ test, onAddStatus }: { test: BillingTestResult; onAddStatus: (value: string, list: StatusList) => void }) {
  return (
    <div className="test-result">
      <Alert tone="green" icon={<CircleCheck size={18} />} title={`Conexión correcta: ${formatNumber(test.total)} clientes en la plataforma`} />
      {test.missing_fields.length > 0 && (
        <Alert tone="amber" icon={<TriangleAlert size={18} />} title="Campos no encontrados">
          <ul className="plain-list">
            {test.missing_fields.map((m) => (
              <li key={m.field}>
                {FIELD_LABELS[m.field as BillingFieldKey] ?? m.field}: no existe <code>{m.path}</code> en los datos recibidos.
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <div>
        <div className="field-label">Campos recibidos</div>
        <div className="chips no-margin">
          {test.raw_keys.map((k) => (
            <span key={k} className="chip chip-static mono">
              {k}
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="field-label">Estados encontrados</div>
        <div className="status-values">
          {test.status_values.map((s) => {
            const mapped = s.maps_to && s.maps_to !== 'unknown' ? MAPPED_STATUS[s.maps_to] : null;
            return (
              <div key={s.value} className={`status-value ${mapped ? '' : 'is-unmapped'}`}>
                <span className="strong">{s.value}</span>
                <span className="muted">→</span>
                {mapped ? (
                  <span title={s.maps_to === 'free' ? FREE_HINT : undefined}>
                    <Badge tone={mapped.tone} dot>
                      {s.maps_to === 'free' ? 'Gratis (no se corta)' : mapped.label}
                    </Badge>
                  </span>
                ) : (
                  <>
                    <Badge tone="purple">Sin mapear</Badge>
                    <span className="status-assign">
                      Añadir a:
                      <button type="button" className="btn btn-link btn-sm text-teal" onClick={() => onAddStatus(s.value, 'free')}>
                        Gratis
                      </button>
                      <button type="button" className="btn btn-link btn-sm text-green" onClick={() => onAddStatus(s.value, 'active')}>
                        Activo
                      </button>
                      <button type="button" className="btn btn-link btn-sm text-red" onClick={() => onAddStatus(s.value, 'suspended')}>
                        Suspendido
                      </button>
                      <button type="button" className="btn btn-link btn-sm" onClick={() => onAddStatus(s.value, 'disabled')}>
                        Cancelado
                      </button>
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <div className="field-label">Muestra</div>
        <div className="table-scroll">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre</th>
                <th>Cédula</th>
                <th className="hide-mobile">Usuario</th>
                <th className="hide-mobile">Plan</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {test.sample.map((c) => {
                const m = test.status_values.find((s) => s.value === c.status)?.maps_to ?? null;
                return (
                  <tr key={c.external_id}>
                    <td className="mono">{c.external_id}</td>
                    <td>{c.name || '—'}</td>
                    <td className="mono">{c.document_id || '—'}</td>
                    <td className="hide-mobile">{c.username || '—'}</td>
                    <td className="hide-mobile">{c.plan || '—'}</td>
                    <td>
                      <ExternalStatusBadge status={c.status} mapped={m} dot={false} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- Resultado de una sincronización ----------

const STAT_CARDS: { key: keyof NonNullable<BillingRun['stats']>; label: string; tone: string }[] = [
  { key: 'fetched', label: 'Leídos', tone: 'blue' },
  { key: 'linked_total', label: 'Vinculados', tone: 'purple' },
  { key: 'linked_now', label: 'Vinculados ahora', tone: 'purple' },
  { key: 'suspended', label: 'Suspendidos', tone: 'red' },
  { key: 'disabled', label: 'Deshabilitados', tone: 'gray' },
  { key: 'reactivated', label: 'Reactivados', tone: 'green' },
  { key: 'skipped_manual', label: 'Omitidos (corte manual)', tone: 'amber' },
  { key: 'unknown_status', label: 'Estado desconocido', tone: 'purple' },
  { key: 'unchanged', label: 'Sin cambios', tone: 'gray' },
  { key: 'unlinked_external', label: 'Sin vincular', tone: 'orange' },
];

export function RunResult({ run, dry, cutMode }: { run: BillingRun; dry?: boolean; cutMode?: string }) {
  const s = run.stats ?? {};
  const isDry = dry ?? run.trigger === 'dry_run';
  const changes = run.changes ?? [];
  return (
    <div className="run-result">
      {run.error && (
        <Alert tone="red" icon={<CircleAlert size={18} />} title="La sincronización falló">
          {run.error}
        </Alert>
      )}
      {!s.applied ? (
        <div className="applied-banner is-dry">
          <FlaskConical size={18} />
          <span>
            {isDry
              ? 'Simulación: no se aplicó ningún cambio. Así quedaría si sincronizas ahora.'
              : cutMode === 'manual'
                ? 'Modo manual: no se aplican cambios. Solo se actualizaron vínculos y estados externos.'
                : 'No se aplicaron cambios.'}
          </span>
        </div>
      ) : (
        <div className="applied-banner is-applied">
          <CircleCheck size={18} />
          <span>Cambios aplicados en la plataforma IPTV.</span>
        </div>
      )}
      <div className="stat-tiles">
        {STAT_CARDS.map((c) => (
          <div key={c.key} className="stat-tile">
            <span className={`stat-tile-value mini-${c.tone}`}>{formatNumber(Number(s[c.key] ?? 0))}</span>
            <span className="stat-tile-label">{c.label}</span>
          </div>
        ))}
      </div>
      {changes.length === 0 ? (
        <div className="health-ok">
          <CircleCheck size={16} /> No hay cambios de estado que aplicar.
        </div>
      ) : (
        <div className="table-scroll">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Cliente IPTV</th>
                <th>Cliente en la plataforma</th>
                <th>Estado externo</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c, i) => {
                const a = BILLING_ACTION[c.action] ?? { label: c.action, tone: 'gray' as const };
                return (
                  <tr key={`${c.external_id}-${i}`}>
                    <td>
                      <span className="strong">{c.username ?? '—'}</span>
                      {(c.services ?? 0) > 1 && (
                        <span className="muted text-xs" title="Una cuenta IPTV para varios servicios con la misma cédula">
                          {' '}
                          · {formatNumber(c.services ?? 0)} servicios
                        </span>
                      )}
                    </td>
                    <td>
                      {c.external_name || '—'} <span className="muted text-xs mono">#{c.external_id}</span>
                    </td>
                    <td>{c.external_status || '—'}</td>
                    <td>
                      <Badge tone={a.tone} dot>
                        {a.label}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Webhook ----------

function WebhookCard({ overview, onChanged }: { overview: BillingOverview; onChanged: (o: BillingOverview) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const url = overview.webhook_path ? `${window.location.origin}${overview.webhook_path}` : '';
  const idField = overview.config.fields?.id || 'id_servicio';
  const statusField = overview.config.fields?.status || 'estado';
  const curl = url
    ? `curl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"${idField}": 102, "${statusField}": "Activo"}'`
    : '';

  const regenerate = async () => {
    if (overview.webhook_path) {
      const ok = await confirm({
        title: 'Regenerar URL del webhook',
        message: 'La URL actual dejará de funcionar. Tendrás que actualizarla en WispHub. ¿Continuar?',
        confirmText: 'Regenerar',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      onChanged(await api.billing.regenerateWebhook());
      toast.success('URL del webhook generada');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="step-head">
        <span className="step-badge">
          <Webhook size={14} />
        </span>
        <div>
          <h2 className="card-title no-margin">Webhook (cambios al instante)</h2>
          <p className="muted text-sm no-margin">
            Opcional: si la plataforma avisa cuando cambia un estado, el corte o la reactivación se aplica en segundos sin esperar la
            sincronización.
          </p>
        </div>
      </div>
      {url ? (
        <>
          <FormField label="URL del webhook">
            <div className="input-group">
              <input className="input mono" readOnly value={url} onFocus={(e) => e.target.select()} />
              <CopyButton text={url} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void regenerate()} disabled={busy}>
                {busy ? <Spinner size={13} /> : <RefreshCw size={14} />} Regenerar
              </button>
            </div>
          </FormField>
          <div className="field-label">Ejemplo de prueba</div>
          <div className="input-group align-start">
            <pre className="code-block grow">{curl}</pre>
            <CopyButton text={curl} />
          </div>
        </>
      ) : (
        <div className="row">
          <span className="muted text-sm">Aún no hay URL de webhook.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void regenerate()} disabled={busy}>
            {busy ? <Spinner size={13} /> : <Webhook size={14} />} Generar URL
          </button>
        </div>
      )}
    </section>
  );
}

// ---------- Historial ----------

export function RunsHistory({ refreshKey = 0 }: { refreshKey?: number }) {
  const [page, setPage] = useState(1);
  const runs = useAsync(() => api.billing.runs(page), [page, refreshKey]);
  const [openId, setOpenId] = useState<number | null>(null);
  const detail = useAsync(async () => (openId === null ? null : api.billing.run(openId)), [openId]);
  const rows = runs.data?.data ?? [];
  const pages = Math.max(1, Math.ceil((runs.data?.total ?? 0) / (runs.data?.limit ?? 20)));

  return (
    <section className="card">
      <div className="section-header">
        <h2 className="card-title no-margin">Historial de sincronizaciones</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void runs.reload()}>
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>
      {runs.loading && !runs.data ? (
        <Spinner label="Cargando…" />
      ) : runs.error ? (
        <ErrorState message={runs.error} onRetry={() => void runs.reload()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Aún no hay sincronizaciones" description="Aparecerán aquí las automáticas, manuales, simulaciones y avisos por webhook." />
      ) : (
        <>
          <ul className="run-list">
            {rows.map((r) => {
              const t = BILLING_TRIGGER[r.trigger] ?? { label: r.trigger, tone: 'gray' as const };
              const s = r.stats ?? {};
              return (
                <li key={r.id}>
                  <button type="button" className="run-row" onClick={() => setOpenId(r.id)}>
                    <Badge tone={t.tone}>{t.label}</Badge>
                    <span className="run-summary">
                      {r.error ? (
                        <span className="text-red">{r.error}</span>
                      ) : (
                        <>
                          {formatNumber(s.suspended ?? 0)} suspendidos · {formatNumber(s.reactivated ?? 0)} reactivados
                          {s.skipped_manual ? ` · ${formatNumber(s.skipped_manual)} omitidos` : ''}
                          {s.applied === false && r.trigger !== 'dry_run' ? ' · sin aplicar' : ''}
                        </>
                      )}
                    </span>
                    <span className="run-time" title={formatDateTime(r.started_at)}>
                      {timeAgo(r.finished_at ?? r.started_at)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {pages > 1 && (
            <div className="row row-end mt">
              <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Anterior
              </button>
              <span className="text-sm">
                {page} / {pages}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
      <Modal open={openId !== null} title="Detalle de la sincronización" onClose={() => setOpenId(null)} size="lg">
        {detail.loading && !detail.data ? (
          <PageLoader />
        ) : detail.error ? (
          <ErrorState message={detail.error} onRetry={() => void detail.reload()} />
        ) : detail.data ? (
          <>
            <p className="muted text-sm">
              {BILLING_TRIGGER[detail.data.trigger]?.label ?? detail.data.trigger} · {formatDateTime(detail.data.started_at)}
            </p>
            <RunResult run={detail.data} />
          </>
        ) : null}
      </Modal>
    </section>
  );
}
