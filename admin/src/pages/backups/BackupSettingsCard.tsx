import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, KeyRound, Lock, Save, ShieldAlert } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useDebounce } from '../../hooks/useDebounce';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, FormField, Spinner, Switch } from '../../components/ui';
import type { BackupFrequency, BackupsOverview, BackupSettingsInput } from '../../types';
import { formatInZone, WEEKDAYS } from './backupUtils';

interface Form {
  schedule_enabled: boolean;
  frequency: BackupFrequency;
  time: string;
  weekdays: number[];
  every_hours: string;
  keep_local: string;
  drive_keep: string;
  include_logs: boolean;
  include_epg: boolean;
  encrypt: boolean;
  password: string;
}

function toForm(o: BackupsOverview): Form {
  const s = o.settings;
  return {
    schedule_enabled: s.schedule_enabled,
    frequency: s.frequency ?? 'daily',
    time: s.time || '03:00',
    weekdays: s.weekdays?.length ? [...s.weekdays] : [7],
    every_hours: String(s.every_hours ?? 12),
    keep_local: String(s.keep_local ?? 10),
    drive_keep: String(s.google_drive?.keep ?? 30),
    include_logs: s.include_logs,
    include_epg: s.include_epg,
    encrypt: s.encrypt,
    password: '',
  };
}

const FREQUENCIES: { value: BackupFrequency; label: string }[] = [
  { value: 'daily', label: 'Diaria' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'hours', label: 'Cada N horas' },
];

export function BackupSettingsCard({ overview, onSaved }: { overview: BackupsOverview; onSaved: (o: BackupsOverview) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const saved = useMemo(() => JSON.stringify(toForm(overview)), [overview]);
  const [form, setForm] = useState<Form>(() => toForm(overview));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ timezone: string; runs: number[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const passwordSet = overview.settings.password_set;
  const tz = overview.timezone;

  // Solo se reinicia si cambian los ajustes guardados (la contraseña escrita se conserva).
  useEffect(() => {
    setForm((f) => ({ ...toForm(overview), password: f.password }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const errors = {
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(form.time) ? null : 'Hora no válida (HH:MM)',
    weekdays: form.frequency === 'weekly' && form.weekdays.length === 0 ? 'Elige al menos un día' : null,
    every_hours: form.frequency === 'hours' && !(Number.isInteger(Number(form.every_hours)) && Number(form.every_hours) >= 1 && Number(form.every_hours) <= 168) ? 'Entre 1 y 168 horas' : null,
    keep_local: Number.isInteger(Number(form.keep_local)) && Number(form.keep_local) >= 1 ? null : 'Número entero mayor que 0',
    drive_keep: Number.isInteger(Number(form.drive_keep)) && Number(form.drive_keep) >= 0 ? null : 'Número entero (0 = no borrar)',
    password:
      form.encrypt && !passwordSet && form.password.length < 8
        ? 'Escribe una contraseña de al menos 8 caracteres'
        : form.password && form.password.length < 8
          ? 'Mínimo 8 caracteres'
          : null,
  };
  const valid = Object.values(errors).every((e) => !e);
  const dirty = JSON.stringify({ ...form, password: '' }) !== saved || form.password !== '';

  // Vista previa de las próximas copias (con la programación escrita, aunque no se haya guardado).
  const scheduleKey = JSON.stringify({ f: form.frequency, t: form.time, w: form.weekdays, h: form.every_hours });
  const debouncedKey = useDebounce(scheduleKey, 400);
  useEffect(() => {
    if (!form.schedule_enabled || errors.time || errors.weekdays || errors.every_hours) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    api.backups
      .preview({ frequency: form.frequency, time: form.time, weekdays: form.weekdays, every_hours: Number(form.every_hours) })
      .then((res) => {
        if (!cancelled) {
          setPreview(res);
          setPreviewError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setPreviewError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey, form.schedule_enabled]);

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const body: BackupSettingsInput = {
        schedule_enabled: form.schedule_enabled,
        frequency: form.frequency,
        time: form.time,
        weekdays: [...form.weekdays].sort((a, b) => a - b),
        every_hours: Number(form.every_hours),
        keep_local: Number(form.keep_local),
        include_logs: form.include_logs,
        include_epg: form.include_epg,
        encrypt: form.encrypt,
        google_drive: { keep: Number(form.drive_keep) },
        ...(form.password ? { password: form.password } : {}),
      };
      const next = await api.backups.updateSettings(body);
      setForm((f) => ({ ...f, password: '' }));
      onSaved(next);
      toast.success('Ajustes de copias guardados');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const clearPassword = async () => {
    const ok = await confirm({
      title: 'Quitar contraseña',
      message: 'Las próximas copias no se cifrarán. Las copias cifradas que ya existen seguirán necesitando su contraseña para restaurarse.',
      confirmText: 'Quitar contraseña',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const next = await api.backups.updateSettings({ clear_password: true, encrypt: false });
      setForm((f) => ({ ...f, password: '', encrypt: false }));
      onSaved(next);
      toast.success('Contraseña quitada');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleDay = (d: number) =>
    setForm((f) => ({ ...f, weekdays: f.weekdays.includes(d) ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d] }));

  return (
    <section className="card">
      <h2 className="card-title">
        <Clock size={18} /> Copias automáticas y opciones
      </h2>

      <div className="stack">
        <Switch
          checked={form.schedule_enabled}
          onChange={(v) => set('schedule_enabled', v)}
          label="Crear copias automáticamente"
          description="La primera se hará en el próximo horario, no al activar."
        />

        {form.schedule_enabled && (
          <div className="bk-schedule stack">
            <div className="segmented">
              {FREQUENCIES.map((f) => (
                <button key={f.value} type="button" className={`segment ${form.frequency === f.value ? 'is-active' : ''}`} onClick={() => set('frequency', f.value)}>
                  {f.label}
                </button>
              ))}
            </div>
            {form.frequency === 'weekly' && (
              <FormField label="Días" error={errors.weekdays}>
                <div className="bk-weekdays">
                  {WEEKDAYS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      className={`chip ${form.weekdays.includes(d.value) ? 'chip-active' : ''}`}
                      aria-pressed={form.weekdays.includes(d.value)}
                      title={d.long}
                      onClick={() => toggleDay(d.value)}
                    >
                      {d.short}
                    </button>
                  ))}
                </div>
              </FormField>
            )}
            {form.frequency === 'hours' ? (
              <FormField label="Cada cuántas horas" htmlFor="bk-hours" error={errors.every_hours}>
                <input id="bk-hours" className="input input-narrow" type="number" min={1} max={168} value={form.every_hours} onChange={(e) => set('every_hours', e.target.value)} />
              </FormField>
            ) : (
              <FormField label="Hora" htmlFor="bk-time" error={errors.time} hint={`Zona horaria del portal: ${tz}`}>
                <input id="bk-time" className="input input-narrow" type="time" value={form.time} onChange={(e) => set('time', e.target.value)} />
              </FormField>
            )}
            {tz === 'UTC' && (
              <Alert tone="amber" icon={<Clock size={18} />}>
                Las horas están en UTC. Configura tu zona horaria (p. ej. America/Bogota) en{' '}
                <Link className="link" to="/ajustes">
                  Ajustes
                </Link>
                .
              </Alert>
            )}
            <div>
              <div className="field-label">Próximas copias</div>
              {errors.time || errors.weekdays || errors.every_hours ? (
                <span className="muted text-sm">Completa la programación para ver las próximas copias.</span>
              ) : previewError ? (
                <span className="text-red text-sm">{previewError}</span>
              ) : !preview ? (
                <Spinner size={14} label="Calculando…" />
              ) : (
                <ol className="bk-preview">
                  {preview.runs.map((r) => (
                    <li key={r}>{formatInZone(r, preview.timezone || tz, true)}</li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}

        <div className="grid-2 align-start">
          <FormField label="Copias a conservar en el servidor" htmlFor="bk-keep" error={errors.keep_local} hint="Las fijadas no cuentan ni se borran.">
            <input id="bk-keep" className="input input-narrow" type="number" min={1} value={form.keep_local} onChange={(e) => set('keep_local', e.target.value)} />
          </FormField>
          <FormField label="Copias a conservar en Drive" htmlFor="bk-drive-keep" error={errors.drive_keep} hint="0 = no borrar nunca.">
            <input id="bk-drive-keep" className="input input-narrow" type="number" min={0} value={form.drive_keep} onChange={(e) => set('drive_keep', e.target.value)} />
          </FormField>
        </div>

        <div className="stack-sm">
          <div className="field-label">Incluir</div>
          <Switch checked={form.include_logs} onChange={(v) => set('include_logs', v)} label="Registro de actividad" />
          <Switch
            checked={form.include_epg}
            onChange={(v) => set('include_epg', v)}
            label="Programación EPG"
            description="Normalmente no hace falta: las guías se vuelven a descargar solas."
          />
        </div>

        <div className="bk-encrypt stack-sm">
          <Switch
            checked={form.encrypt}
            onChange={(v) => set('encrypt', v)}
            label={
              <span className="row-inline">
                <Lock size={14} /> Cifrar las copias con contraseña
              </span>
            }
            description="AES-256: sin la contraseña nadie puede leer el archivo, ni siquiera tú."
          />
          {(form.encrypt || passwordSet) && (
            <>
              <FormField
                label={
                  <span className="row-inline">
                    {passwordSet ? 'Cambiar contraseña' : 'Contraseña'}
                    {passwordSet && (
                      <Badge tone="green">
                        <KeyRound size={11} /> Contraseña guardada
                      </Badge>
                    )}
                  </span>
                }
                htmlFor="bk-password"
                error={errors.password}
                hint={passwordSet ? 'Déjala vacía para conservar la actual.' : 'Mínimo 8 caracteres.'}
              >
                <input
                  id="bk-password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                />
              </FormField>
              <Alert tone="red" icon={<ShieldAlert size={18} />}>
                Sin la contraseña la copia <strong>no se puede restaurar</strong>. Guárdala también en otro lugar (fuera de este servidor).
              </Alert>
              {passwordSet && (
                <button type="button" className="btn btn-danger-ghost btn-sm self-start" onClick={() => void clearPassword()} disabled={busy}>
                  Quitar contraseña
                </button>
              )}
            </>
          )}
        </div>

        <div className="row row-end">
          {dirty && <span className="muted text-sm">Hay cambios sin guardar</span>}
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !dirty || !valid}>
            {busy ? <Spinner size={14} /> : <Save size={16} />} Guardar
          </button>
        </div>
      </div>
    </section>
  );
}
