import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, House, Info, KeyRound, MonitorSmartphone, Network, Save, ScanSearch, ZapOff } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../components/Toast';
import { Alert, ErrorState, FormField, PageHeader, PageLoader, Select, Spinner, Switch, Tabs } from '../components/ui';
import { CompanyPanel } from './settings/CompanyPanel';
import type { DeviceOwnership, SettingsInput, StreamMode } from '../types';
import { isValidUrl } from '../utils/format';
import { CUT_MODE, DEVICE_OWNERSHIP, STREAM_MODE } from '../utils/labels';

const FALLBACK_TIMEZONES = [
  'America/Bogota',
  'America/Mexico_City',
  'America/Lima',
  'America/Guayaquil',
  'America/Caracas',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Sao_Paulo',
  'America/La_Paz',
  'America/Asuncion',
  'America/Montevideo',
  'America/Panama',
  'America/Costa_Rica',
  'America/Guatemala',
  'America/El_Salvador',
  'America/Tegucigalpa',
  'America/Managua',
  'America/Santo_Domingo',
  'America/Havana',
  'America/Puerto_Rico',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/Madrid',
  'UTC',
];

function timezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const list = intl.supportedValuesOf?.('timeZone');
    if (list && list.length) return list.includes('UTC') ? list : [...list, 'UTC'];
  } catch {
    /* navegador antiguo */
  }
  return FALLBACK_TIMEZONES;
}

interface FormState {
  server_name: string;
  public_url: string;
  stream_mode: StreamMode;
  xtream_upstream_url: string;
  epg_url: string;
  timezone: string;
  allow_all_without_package: boolean;
  connection_timeout_seconds: string;
  node_fallback_direct: boolean;
  node_offline_seconds: string;
  device_online_minutes: string;
  device_inactive_days: string;
  device_check_interval_minutes: string;
  tvbox_default_ownership: DeviceOwnership;
  device_alert_new_tvbox: boolean;
  device_inactive_message_client: boolean;
  stream_check_enabled: boolean;
  stream_check_interval_minutes: string;
  stream_check_batch: string;
  stream_check_concurrency: string;
  stream_check_timeout_seconds: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

export function SettingsPage() {
  const toast = useToast();
  const settings = useAsync(() => api.settings.get(), []);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const tzList = useMemo(timezones, []);
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: 'general' | 'red' | 'empresa' = rawTab === 'red' || rawTab === 'empresa' ? rawTab : 'general';
  const setTab = (t: 'general' | 'red' | 'empresa') => {
    const next = new URLSearchParams(params);
    if (t !== 'general') next.set('tab', t);
    else next.delete('tab');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setForm({
      server_name: s.server_name ?? '',
      public_url: s.public_url ?? '',
      stream_mode: s.stream_mode ?? 'redirect',
      xtream_upstream_url: s.xtream_upstream_url ?? '',
      epg_url: s.epg_url ?? '',
      timezone: s.timezone ?? 'UTC',
      allow_all_without_package: Boolean(s.allow_all_without_package),
      connection_timeout_seconds: String(s.connection_timeout_seconds ?? 60),
      node_fallback_direct: s.node_fallback_direct ?? true,
      node_offline_seconds: String(s.node_offline_seconds ?? 30),
      device_online_minutes: String(s.device_online_minutes ?? 10),
      device_inactive_days: String(s.device_inactive_days ?? 30),
      device_check_interval_minutes: String(s.device_check_interval_minutes ?? 60),
      tvbox_default_ownership: s.tvbox_default_ownership ?? 'company',
      device_alert_new_tvbox: s.device_alert_new_tvbox ?? true,
      device_inactive_message_client: Boolean(s.device_inactive_message_client),
      stream_check_enabled: s.stream_check_enabled ?? true,
      stream_check_interval_minutes: String(s.stream_check_interval_minutes ?? 30),
      stream_check_batch: String(s.stream_check_batch ?? 500),
      stream_check_concurrency: String(s.stream_check_concurrency ?? 10),
      stream_check_timeout_seconds: String(s.stream_check_timeout_seconds ?? 8),
    });
  }, [settings.data]);

  if (settings.loading && !settings.data) return <PageLoader />;
  if (settings.error && !settings.data) return <ErrorState message={settings.error} onRetry={() => void settings.reload()} />;
  if (!form) return null;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const save = async () => {
    const e: Errors = {};
    if (!form.server_name.trim()) e.server_name = 'El nombre del servidor es obligatorio';
    if (form.stream_mode === 'xtream_upstream') {
      if (!form.xtream_upstream_url.trim()) e.xtream_upstream_url = 'Indica la URL del XtreamUI de origen';
      else if (!isValidUrl(form.xtream_upstream_url.trim())) e.xtream_upstream_url = 'URL no válida';
    }
    if (form.epg_url.trim() && !isValidUrl(form.epg_url.trim())) e.epg_url = 'URL no válida';
    const t = Number(form.connection_timeout_seconds);
    if (!Number.isInteger(t) || t < 10) e.connection_timeout_seconds = 'Debe ser un número entero de al menos 10 segundos';
    const nodeOffline = Number(form.node_offline_seconds);
    if (!Number.isInteger(nodeOffline) || nodeOffline < 5) e.node_offline_seconds = 'Debe ser un número entero de al menos 5 segundos';
    if (!form.timezone.trim()) e.timezone = 'Indica la zona horaria';
    const onlineMin = Number(form.device_online_minutes);
    if (!Number.isInteger(onlineMin) || onlineMin < 1) e.device_online_minutes = 'Debe ser un número entero de al menos 1 minuto';
    const inactiveDays = Number(form.device_inactive_days);
    if (!Number.isInteger(inactiveDays) || inactiveDays < 1) e.device_inactive_days = 'Debe ser un número entero de al menos 1 día';
    const checkMin = Number(form.device_check_interval_minutes);
    if (!Number.isInteger(checkMin) || checkMin < 5) e.device_check_interval_minutes = 'Debe ser un número entero de al menos 5 minutos';
    const scInterval = Number(form.stream_check_interval_minutes);
    if (!Number.isInteger(scInterval) || scInterval < 1) e.stream_check_interval_minutes = 'Debe ser un número entero de al menos 1 minuto';
    const scBatch = Number(form.stream_check_batch);
    if (!Number.isInteger(scBatch) || scBatch < 1) e.stream_check_batch = 'Debe ser un número entero mayor que 0';
    const scConc = Number(form.stream_check_concurrency);
    if (!Number.isInteger(scConc) || scConc < 1 || scConc > 100) e.stream_check_concurrency = 'Entre 1 y 100';
    const scTimeout = Number(form.stream_check_timeout_seconds);
    if (!Number.isInteger(scTimeout) || scTimeout < 1 || scTimeout > 120) e.stream_check_timeout_seconds = 'Entre 1 y 120 segundos';
    setErrors(e);
    if (Object.keys(e).length) {
      toast.error('Revisa los campos marcados en rojo');
      return;
    }

    setSaving(true);
    setSaveError(null);
    const body: SettingsInput = {
      server_name: form.server_name.trim(),
      stream_mode: form.stream_mode,
      xtream_upstream_url: form.xtream_upstream_url.trim().replace(/\/+$/, ''),
      epg_url: form.epg_url.trim(),
      timezone: form.timezone.trim(),
      allow_all_without_package: form.allow_all_without_package,
      connection_timeout_seconds: t,
      node_fallback_direct: form.node_fallback_direct,
      node_offline_seconds: nodeOffline,
      device_online_minutes: onlineMin,
      device_inactive_days: inactiveDays,
      device_check_interval_minutes: checkMin,
      tvbox_default_ownership: form.tvbox_default_ownership,
      device_alert_new_tvbox: form.device_alert_new_tvbox,
      device_inactive_message_client: form.device_inactive_message_client,
      stream_check_enabled: form.stream_check_enabled,
      stream_check_interval_minutes: scInterval,
      stream_check_batch: scBatch,
      stream_check_concurrency: scConc,
      stream_check_timeout_seconds: scTimeout,
    };
    try {
      const updated = await api.settings.update(body);
      if (updated && typeof updated === 'object' && 'server_name' in updated) settings.setData(updated);
      toast.success('Ajustes guardados');
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Ajustes"
        subtitle="Configuración general del servidor"
        actions={
          tab === 'general' ? (
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner size={14} /> : <Save size={16} />} Guardar ajustes
            </button>
          ) : undefined
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'general', label: 'General' },
          { value: 'red', label: 'Red y URL para clientes' },
          { value: 'empresa', label: 'Empresa' },
        ]}
      />
      <div className="mt" />
      {tab === 'empresa' ? (
        <CompanyPanel />
      ) : tab === 'red' ? (
        <section className="card settings-moved">
          <h2 className="card-title">
            <Network size={18} /> Red y URL para clientes
          </h2>
          <p className="no-margin">
            La IP y los puertos del portal se configuran en <strong>Servidores → Servidor principal</strong>.
          </p>
          <p className="muted text-sm no-margin">
            Allí están la URL para clientes (y si sigue a la IP de su interfaz), las direcciones alternativas, el identificador del portal, los puertos
            para clientes (Xtream Codes / M3U) con la separación del panel, las IPs de cada interfaz de red y los puertos TCP a la escucha.
          </p>
          <div>
            <Link to="/servidores/principal" className="btn btn-primary">
              <House size={16} /> Ir a Servidor principal <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      ) : (
      <>
      {saveError && <Alert tone="red">{saveError}</Alert>}

      <div className="settings-grid">
        <section className="card">
          <h2 className="card-title">General</h2>
          <FormField label="Nombre del servidor" required error={errors.server_name} hint="Se muestra en las apps de los clientes.">
            <input className="input" value={form.server_name} onChange={(e) => set('server_name', e.target.value)} />
          </FormField>
          <FormField
            label="URL para clientes"
            hint={
              <>
                Dirección con la que los clientes acceden (incluye puerto); se usa en las listas M3U y los datos de acceso. Se cambia en{' '}
                <Link to="/servidores/principal" className="link">
                  Servidores → Servidor principal
                </Link>
                , junto con los puertos.
              </>
            }
          >
            <input className="input mono" value={form.public_url} readOnly placeholder="Sin configurar (se detecta automáticamente)" />
          </FormField>
          <FormField label="Zona horaria" required error={errors.timezone}>
            <input className="input" list="tz-list" value={form.timezone} onChange={(e) => set('timezone', e.target.value)} />
            <datalist id="tz-list">
              {tzList.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </FormField>
          <FormField label="URL de la guía EPG (XMLTV)" error={errors.epg_url} hint="Se entrega a los clientes a través de xmltv.php.">
            <input className="input mono" value={form.epg_url} onChange={(e) => set('epg_url', e.target.value)} placeholder="http://epg.proveedor.com/guide.xml" />
          </FormField>
        </section>

        <section className="card">
          <h2 className="card-title">Reproducción</h2>
          <FormField label="Modo de entrega de streams">
            <div className="radio-cards">
              {(Object.keys(STREAM_MODE) as StreamMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`radio-card ${form.stream_mode === mode ? 'is-active' : ''}`}
                  onClick={() => set('stream_mode', mode)}
                  aria-pressed={form.stream_mode === mode}
                >
                  <span className="radio-card-head">
                    <span className="radio-dot" />
                    <span className="radio-card-title">{STREAM_MODE[mode].label}</span>
                    <code className="text-xs muted">{mode}</code>
                  </span>
                  <span className="radio-card-desc">{STREAM_MODE[mode].description}</span>
                </button>
              ))}
            </div>
          </FormField>
          {form.stream_mode === 'xtream_upstream' && (
            <FormField
              label="URL del XtreamUI de origen"
              required
              error={errors.xtream_upstream_url}
              hint="Servidor antiguo al que se redirigirá la reproducción con las mismas credenciales."
            >
              <input className="input mono" value={form.xtream_upstream_url} onChange={(e) => set('xtream_upstream_url', e.target.value)} placeholder="http://ip-antigua:25461" />
            </FormField>
          )}
          <FormField
            label="Tiempo de espera de conexión (segundos)"
            error={errors.connection_timeout_seconds}
            hint="Si una conexión no da señales durante este tiempo se considera cerrada y libera el cupo."
          >
            <input className="input input-narrow" type="number" min={10} value={form.connection_timeout_seconds} onChange={(e) => set('connection_timeout_seconds', e.target.value)} />
          </FormField>
          <div className="subcard stack-sm">
            <div className="field-label no-margin">Servidores de streaming</div>
            <Switch
              checked={form.node_fallback_direct}
              onChange={(v) => set('node_fallback_direct', v)}
              label="Si ningún servidor asignado está en línea, enviar al cliente directo a la fuente"
              description={form.node_fallback_direct ? 'El canal sigue funcionando aunque los servidores estén caídos (sin conexiones exactas).' : 'Si no hay servidor disponible, el cliente recibe un error (503).'}
            />
            <FormField
              label="Considerar un servidor fuera de línea tras (segundos sin latido)"
              error={errors.node_offline_seconds}
            >
              <input className="input input-narrow" type="number" min={5} value={form.node_offline_seconds} onChange={(e) => set('node_offline_seconds', e.target.value)} />
            </FormField>
          </div>
          <Switch
            checked={form.allow_all_without_package}
            onChange={(v) => set('allow_all_without_package', v)}
            label="Clientes sin paquete ven todo el contenido"
            description={
              form.allow_all_without_package
                ? 'Un cliente que no tiene ningún paquete asignado puede ver todos los canales, películas y series.'
                : 'Un cliente sin paquetes asignados no verá ningún contenido.'
            }
          />
        </section>

        <section className="card">
          <h2 className="card-title">
            <MonitorSmartphone size={18} /> Dispositivos
          </h2>
          <div className="grid-2">
            <FormField
              label="Considerar en línea si se conectó en los últimos N minutos"
              error={errors.device_online_minutes}
            >
              <input className="input input-narrow" type="number" min={1} value={form.device_online_minutes} onChange={(e) => set('device_online_minutes', e.target.value)} />
            </FormField>
            <FormField label="Alertar si un dispositivo no se conecta en N días" error={errors.device_inactive_days}>
              <input className="input input-narrow" type="number" min={1} value={form.device_inactive_days} onChange={(e) => set('device_inactive_days', e.target.value)} />
            </FormField>
            <FormField
              label="Revisar cada N minutos"
              error={errors.device_check_interval_minutes}
              hint="Frecuencia de la revisión automática de inactividad (mínimo 5)."
            >
              <input className="input input-narrow" type="number" min={5} value={form.device_check_interval_minutes} onChange={(e) => set('device_check_interval_minutes', e.target.value)} />
            </FormField>
            <FormField label="Los TV Box detectados se marcan como">
              <Select
                value={form.tvbox_default_ownership}
                onChange={(v) => set('tvbox_default_ownership', v as DeviceOwnership)}
                options={(Object.keys(DEVICE_OWNERSHIP) as DeviceOwnership[]).map((o) => ({ value: o, label: DEVICE_OWNERSHIP[o].label }))}
              />
            </FormField>
          </div>
          <div className="stack-sm">
            <Switch
              checked={form.device_alert_new_tvbox}
              onChange={(v) => set('device_alert_new_tvbox', v)}
              label="Alertar cuando se detecte un TV Box nuevo"
              description="Crea una alerta para confirmar si el equipo es de la empresa y asignarlo al cliente."
            />
            <Switch
              checked={form.device_inactive_message_client}
              onChange={(v) => set('device_inactive_message_client', v)}
              label="Enviar también un mensaje al cliente cuando su equipo esté inactivo"
              description="Además de la alerta en el panel, el cliente recibe un mensaje en la bandeja de su app."
            />
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">
            <ScanSearch size={18} /> Revisión de canales y películas
          </h2>
          <Switch
            checked={form.stream_check_enabled}
            onChange={(v) => set('stream_check_enabled', v)}
            label="Revisar automáticamente las fuentes"
            description="Comprueba periódicamente si los canales y películas responden y marca los caídos."
          />
          <div className="grid-2 mt">
            <FormField label="Revisar cada N minutos" error={errors.stream_check_interval_minutes}>
              <input
                className="input input-narrow"
                type="number"
                min={1}
                value={form.stream_check_interval_minutes}
                disabled={!form.stream_check_enabled}
                onChange={(e) => set('stream_check_interval_minutes', e.target.value)}
              />
            </FormField>
            <FormField label="Contenidos por ronda" error={errors.stream_check_batch} hint="Se revisan primero los que llevan más tiempo sin comprobarse.">
              <input
                className="input input-narrow"
                type="number"
                min={1}
                value={form.stream_check_batch}
                disabled={!form.stream_check_enabled}
                onChange={(e) => set('stream_check_batch', e.target.value)}
              />
            </FormField>
            <FormField label="Revisiones simultáneas" error={errors.stream_check_concurrency}>
              <input
                className="input input-narrow"
                type="number"
                min={1}
                max={100}
                value={form.stream_check_concurrency}
                onChange={(e) => set('stream_check_concurrency', e.target.value)}
              />
            </FormField>
            <FormField label="Tiempo de espera por fuente (segundos)" error={errors.stream_check_timeout_seconds}>
              <input
                className="input input-narrow"
                type="number"
                min={1}
                max={120}
                value={form.stream_check_timeout_seconds}
                onChange={(e) => set('stream_check_timeout_seconds', e.target.value)}
              />
            </FormField>
          </div>
          <Alert tone="amber" icon={<Info size={18} />}>
            Cada revisión abre brevemente una conexión con el proveedor. Valores muy agresivos (muchas revisiones
            simultáneas o intervalos muy cortos) pueden contar contra el límite de conexiones de tu proveedor.
          </Alert>
        </section>

        <section className="card">
          <h2 className="card-title">
            <ZapOff size={18} /> Modo de cortes
          </h2>
          <div className="cut-summary">
            <div>
              <div className="cut-summary-mode">{CUT_MODE[settings.data?.cut_mode ?? 'manual']?.label ?? '—'}</div>
              <div className="muted text-sm">{CUT_MODE[settings.data?.cut_mode ?? 'manual']?.short}</div>
            </div>
            <Link to="/cortes?tab=modo" className="btn btn-secondary btn-sm">
              Cambiar en Cortes <ArrowRight size={14} />
            </Link>
          </div>
          <p className="muted text-xs no-margin">
            El modo de cortes se configura en Cortes → Modo de cortes; la conexión con WispHub y la vinculación de clientes, en Sistema → Migración WispHub.
          </p>
        </section>

        <ChangePasswordCard />
      </div>
      </>
      )}
    </>
  );
}

function ChangePasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e: typeof errors = {};
    if (!current) e.current = 'Ingresa tu contraseña actual';
    if (!next) e.next = 'Ingresa la nueva contraseña';
    else if (next.length < 6) e.next = 'Mínimo 6 caracteres';
    else if (next === current) e.next = 'Debe ser distinta de la actual';
    if (next && confirmPass !== next) e.confirm = 'Las contraseñas no coinciden';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    try {
      await api.auth.changePassword(current, next);
      toast.success('Contraseña actualizada');
      setCurrent('');
      setNext('');
      setConfirmPass('');
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 className="card-title">
        <KeyRound size={18} /> Cambiar mi contraseña
      </h2>
      <form onSubmit={(e) => void submit(e)} noValidate>
        {serverError && <Alert tone="red">{serverError}</Alert>}
        <FormField label="Contraseña actual" required error={errors.current}>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </FormField>
        <FormField label="Nueva contraseña" required error={errors.next}>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </FormField>
        <FormField label="Repite la nueva contraseña" required error={errors.confirm}>
          <input className="input" type="password" autoComplete="new-password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} />
        </FormField>
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy && <Spinner size={14} />} Cambiar contraseña
        </button>
      </form>
    </section>
  );
}
