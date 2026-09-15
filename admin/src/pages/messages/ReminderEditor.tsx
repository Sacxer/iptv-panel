import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Info, Plus, X } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { DateTimeInput } from '../../components/DateTimeInput';
import { KindIcon } from '../../components/KindBadge';
import { Modal } from '../../components/Modal';
import { UserSearchSelect } from '../../components/UserSearchSelect';
import { useToast } from '../../components/Toast';
import { Alert, FormField, Select, Spinner, Switch } from '../../components/ui';
import type { MessageDisplay, MessageKind, MessageTarget, Package, Reminder, ReminderConfig, ReminderInput, ReminderRecurrence } from '../../types';
import { addToUnix, formatDate, formatDateTime, nowUnix, timeFromNow } from '../../utils/format';
import { MESSAGE_DISPLAY, MESSAGE_KIND } from '../../utils/labels';
import { RECURRENCE_LABEL, TEMPLATE_VARS, WEEKDAY_SHORT, recurrenceText, renderTemplate } from '../../utils/recurrence';

interface FormState {
  title: string;
  body: string;
  kind: MessageKind;
  display: MessageDisplay;
  target: MessageTarget;
  user_id: number | null;
  package_id: number | null;
  recurrence: ReminderRecurrence;
  time: string;
  weekdays: number[];
  month_day: number;
  every_days: number;
  days_before: number[];
  message_ttl_days: number;
  replace_previous: boolean;
  starts_at: number | null;
  ends_at: number | null;
  active: boolean;
}

function toForm(r: Reminder | null): FormState {
  const c: ReminderConfig = r?.config ?? {};
  return {
    title: r?.title ?? '',
    body: r?.body ?? '',
    kind: r?.kind ?? 'payment',
    display: r?.display ?? 'inbox',
    target: r?.target ?? 'all',
    user_id: r?.user_id ?? null,
    package_id: r?.package_id ?? null,
    recurrence: r?.recurrence ?? 'weekly',
    time: c.time ?? '09:00',
    weekdays: c.weekdays ?? [1],
    month_day: c.month_day ?? 5,
    every_days: c.every_days ?? 3,
    days_before: c.days_before ?? [3, 1],
    message_ttl_days: r?.message_ttl_days ?? 7,
    replace_previous: r?.replace_previous ?? true,
    starts_at: r?.starts_at ?? null,
    ends_at: r?.ends_at ?? null,
    active: r?.active ?? true,
  };
}

function configFor(f: FormState): ReminderConfig {
  switch (f.recurrence) {
    case 'once':
      return {};
    case 'daily':
      return { time: f.time };
    case 'weekly':
      return { time: f.time, weekdays: [...f.weekdays].sort((a, b) => a - b) };
    case 'monthly':
      return { time: f.time, month_day: f.month_day };
    case 'interval':
      return { time: f.time, every_days: f.every_days };
    case 'before_expiration':
      return { time: f.time, days_before: [...f.days_before].sort((a, b) => b - a) };
    default:
      return {};
  }
}

function toInput(f: FormState): Partial<ReminderInput> {
  return {
    title: f.title.trim(),
    body: f.body.trim(),
    kind: f.kind,
    display: f.display,
    target: f.target,
    user_id: f.target === 'user' ? f.user_id : null,
    package_id: f.target === 'package' ? f.package_id : null,
    recurrence: f.recurrence,
    config: configFor(f),
    message_ttl_days: f.message_ttl_days,
    replace_previous: f.replace_previous,
    starts_at: f.starts_at,
    ends_at: f.recurrence === 'once' ? null : f.ends_at,
    active: f.active,
  };
}

const RECURRENCES: ReminderRecurrence[] = ['once', 'daily', 'weekly', 'monthly', 'interval', 'before_expiration'];

export function ReminderEditor({
  open,
  reminder,
  packages,
  onClose,
  onSaved,
}: {
  open: boolean;
  reminder: Reminder | null;
  packages: Package[];
  onClose: () => void;
  onSaved: (r: Reminder) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => toForm(reminder));
  const [userLabel, setUserLabel] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'title' | 'body' | 'target' | 'weekdays' | 'days_before' | 'time' | 'ends', string>>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [dayDraft, setDayDraft] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<'title' | 'body'>('body');
  const settings = useAsync(async () => api.settings.get().catch(() => null), []);

  useEffect(() => {
    if (!open) return;
    setForm(toForm(reminder));
    setUserLabel(reminder?.target === 'user' ? reminder.target_label.replace(/^Cliente:\s*/, '') : '');
    setErrors({});
    setServerError(null);
    setDayDraft('');
  }, [open, reminder]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const insertVar = (token: string) => {
    const field = lastField.current;
    const el = field === 'title' ? titleRef.current : bodyRef.current;
    const current = form[field];
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    set(field, next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const toggleWeekday = (d: number) =>
    set('weekdays', form.weekdays.includes(d) ? form.weekdays.filter((x) => x !== d) : [...form.weekdays, d]);

  const addDayBefore = (raw: string | number) => {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0 || n > 60) {
      setErrors((e) => ({ ...e, days_before: 'Entre 0 y 60 días' }));
      return;
    }
    if (!form.days_before.includes(n)) set('days_before', [...form.days_before, n].sort((a, b) => b - a));
    setDayDraft('');
    setErrors((e) => ({ ...e, days_before: undefined }));
  };

  const savedSignature = useMemo(() => (reminder ? JSON.stringify([reminder.recurrence, reminder.config, reminder.starts_at, reminder.ends_at, reminder.active]) : ''), [reminder]);
  const currentSignature = JSON.stringify([form.recurrence, configFor(form), form.starts_at, form.recurrence === 'once' ? null : form.ends_at, form.active]);
  const scheduleChanged = !reminder || savedSignature !== currentSignature;

  const sample = useMemo(() => {
    const exp = addToUnix(nowUnix(), 3, 'days');
    return {
      nombre: 'Carlos Gómez',
      usuario: 'carlos.gomez',
      vence: formatDate(exp),
      dias: '3',
      servidor: settings.data?.server_name || 'Mi IPTV',
    };
  }, [settings.data]);

  const submit = async () => {
    const e: typeof errors = {};
    if (!form.title.trim()) e.title = 'El título es obligatorio';
    if (!form.body.trim()) e.body = 'El mensaje es obligatorio';
    if (form.target === 'user' && form.user_id === null) e.target = 'Selecciona un cliente';
    if (form.target === 'package' && form.package_id === null) e.target = 'Selecciona un paquete';
    if (form.recurrence !== 'once' && !/^\d{2}:\d{2}$/.test(form.time)) e.time = 'Indica la hora';
    if (form.recurrence === 'weekly' && form.weekdays.length === 0) e.weekdays = 'Elige al menos un día';
    if (form.recurrence === 'before_expiration' && form.days_before.length === 0) e.days_before = 'Indica al menos un día';
    if (form.recurrence !== 'once' && form.starts_at && form.ends_at && form.ends_at <= form.starts_at) e.ends = 'Debe ser posterior al inicio';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    try {
      const saved = reminder ? await api.reminders.update(reminder.id, toInput(form)) : await api.reminders.create(toInput(form));
      toast.success(reminder ? 'Recordatorio actualizado' : 'Recordatorio creado');
      onSaved(saved);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const kindTone = MESSAGE_KIND[form.kind]?.tone ?? 'gray';

  return (
    <Modal
      open={open}
      title={reminder ? 'Editar recordatorio' : 'Nuevo recordatorio'}
      onClose={onClose}
      size="xl"
      dismissible={!busy}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={14} />} {reminder ? 'Guardar' : 'Crear recordatorio'}
          </button>
        </>
      }
    >
      {serverError && <Alert tone="red">{serverError}</Alert>}
      <div className="reminder-layout">
        <div className="stack">
          <FormField label="Título" required error={errors.title}>
            <input
              ref={titleRef}
              className="input"
              value={form.title}
              onFocus={() => (lastField.current = 'title')}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Tu servicio vence pronto"
            />
          </FormField>
          <FormField label="Mensaje" required error={errors.body}>
            <textarea
              ref={bodyRef}
              className="input textarea"
              rows={4}
              value={form.body}
              onFocus={() => (lastField.current = 'body')}
              onChange={(e) => set('body', e.target.value)}
              placeholder="Hola {nombre}, tu plan vence el {vence}. Renueva para no perder el servicio."
            />
          </FormField>
          <div className="var-chips">
            <span className="muted text-xs">Insertar:</span>
            {TEMPLATE_VARS.map((v) => (
              <button key={v.key} type="button" className="chip chip-var" title={v.label} onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(v.key)}>
                {v.key}
              </button>
            ))}
          </div>

          <div className="grid-2">
            <FormField label="Tipo">
              <div className="kind-picker">
                {(Object.keys(MESSAGE_KIND) as MessageKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`kind-option kind-${MESSAGE_KIND[k].tone} ${form.kind === k ? 'is-active' : ''}`}
                    onClick={() => set('kind', k)}
                    aria-pressed={form.kind === k}
                  >
                    <KindIcon kind={k} size={14} /> {MESSAGE_KIND[k].label}
                  </button>
                ))}
              </div>
            </FormField>
            <div className="stack-sm">
              <FormField label="Mostrar como">
                <Select value={form.display} onChange={(v) => set('display', v as MessageDisplay)} options={(Object.keys(MESSAGE_DISPLAY) as MessageDisplay[]).map((d) => ({ value: d, label: MESSAGE_DISPLAY[d] }))} />
              </FormField>
              <FormField label="Destinatarios" error={errors.target}>
                <div className="segmented">
                  {(['all', 'user', 'package'] as const).map((t) => (
                    <button key={t} type="button" className={`segment ${form.target === t ? 'is-active' : ''}`} onClick={() => set('target', t)}>
                      {t === 'all' ? 'Todos' : t === 'user' ? 'Cliente' : 'Paquete'}
                    </button>
                  ))}
                </div>
              </FormField>
            </div>
          </div>
          {form.target === 'user' && (
            <UserSearchSelect
              userId={form.user_id}
              label={userLabel}
              invalid={Boolean(errors.target)}
              onChange={(u) => {
                set('user_id', u?.id ?? null);
                setUserLabel(u?.username ?? '');
              }}
            />
          )}
          {form.target === 'package' && (
            <Select
              value={form.package_id === null ? '' : String(form.package_id)}
              onChange={(v) => set('package_id', v ? Number(v) : null)}
              placeholder="Selecciona un paquete…"
              options={packages.map((p) => ({ value: String(p.id), label: p.name }))}
            />
          )}
          {form.recurrence === 'before_expiration' && form.target !== 'user' && (
            <p className="muted text-xs no-margin">Se envía un mensaje individual a cada cliente {form.target === 'package' ? 'del paquete ' : ''}que vence en esos días.</p>
          )}

          <div className="subcard stack">
            <FormField label="Repetición">
              <Select
                value={form.recurrence}
                onChange={(v) => set('recurrence', v as ReminderRecurrence)}
                options={RECURRENCES.map((r) => ({ value: r, label: RECURRENCE_LABEL[r] }))}
              />
            </FormField>

            {form.recurrence === 'once' ? (
              <FormField label="Fecha y hora de envío" hint="Vacío = se envía en cuanto se guarde activo.">
                <DateTimeInput value={form.starts_at} onChange={(v) => set('starts_at', v)} clearable />
              </FormField>
            ) : (
              <div className="recurrence-row">
                <FormField label="Hora" error={errors.time} hint={settings.data?.timezone ? `Zona horaria: ${settings.data.timezone}` : undefined}>
                  <input type="time" className="input input-narrow" value={form.time} onChange={(e) => set('time', e.target.value)} />
                </FormField>
                {form.recurrence === 'monthly' && (
                  <FormField label="Día del mes" hint="Si el mes es más corto, el último día.">
                    <input type="number" min={1} max={31} className="input input-narrow" value={form.month_day} onChange={(e) => set('month_day', Math.max(1, Math.min(31, Math.floor(Number(e.target.value) || 1))))} />
                  </FormField>
                )}
                {form.recurrence === 'interval' && (
                  <FormField label="Cada N días">
                    <input type="number" min={1} max={365} className="input input-narrow" value={form.every_days} onChange={(e) => set('every_days', Math.max(1, Math.min(365, Math.floor(Number(e.target.value) || 1))))} />
                  </FormField>
                )}
              </div>
            )}

            {form.recurrence === 'weekly' && (
              <FormField label="Días" error={errors.weekdays}>
                <div className="weekday-pills">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <button key={d} type="button" className={`weekday-pill ${form.weekdays.includes(d) ? 'is-active' : ''}`} onClick={() => toggleWeekday(d)} aria-pressed={form.weekdays.includes(d)}>
                      {WEEKDAY_SHORT[d]}
                    </button>
                  ))}
                </div>
              </FormField>
            )}

            {form.recurrence === 'before_expiration' && (
              <FormField label="Días antes del vencimiento" error={errors.days_before} hint="0 = el mismo día que vence.">
                <div className="days-before">
                  {form.days_before.map((d) => (
                    <span key={d} className="badge badge-orange tag">
                      {d === 0 ? 'Mismo día' : `${d} ${d === 1 ? 'día' : 'días'}`}
                      <button type="button" className="tag-remove" aria-label={`Quitar ${d}`} onClick={() => set('days_before', form.days_before.filter((x) => x !== d))}>
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  <input
                    type="number"
                    min={0}
                    max={60}
                    className="input input-sm days-input"
                    value={dayDraft}
                    placeholder="días"
                    onChange={(e) => setDayDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (dayDraft !== '') addDayBefore(dayDraft);
                      }
                    }}
                  />
                  <button type="button" className="btn btn-ghost btn-sm" disabled={dayDraft === ''} onClick={() => addDayBefore(dayDraft)}>
                    <Plus size={13} /> Añadir
                  </button>
                  {[7, 3, 1].filter((d) => !form.days_before.includes(d)).map((d) => (
                    <button key={d} type="button" className="chip" onClick={() => addDayBefore(d)}>
                      +{d}
                    </button>
                  ))}
                </div>
              </FormField>
            )}

            {form.recurrence !== 'once' && (
              <div className="grid-2">
                <FormField label="Empieza" hint="Opcional">
                  <DateTimeInput value={form.starts_at} onChange={(v) => set('starts_at', v)} clearable />
                </FormField>
                <FormField label="Termina" hint="Opcional" error={errors.ends}>
                  <DateTimeInput value={form.ends_at} onChange={(v) => set('ends_at', v)} clearable />
                </FormField>
              </div>
            )}
          </div>

          <div className="grid-2">
            <FormField label="Días visible" hint="Tiempo que el mensaje queda en la bandeja.">
              <input type="number" min={1} max={365} className="input input-narrow" value={form.message_ttl_days} onChange={(e) => set('message_ttl_days', Math.max(1, Math.min(365, Math.floor(Number(e.target.value) || 1))))} />
            </FormField>
            <div className="stack-sm">
              <Switch checked={form.replace_previous} onChange={(v) => set('replace_previous', v)} label="Reemplazar el anterior" description="Al enviarse de nuevo, el mensaje anterior de este recordatorio caduca." />
              <Switch checked={form.active} onChange={(v) => set('active', v)} label="Activo" />
            </div>
          </div>
        </div>

        <aside className="reminder-preview">
          <div className="field-label">Programación</div>
          {settings.data?.timezone && (
            <p className="muted text-xs no-margin">Horas en {settings.data.timezone}; las fechas de abajo se muestran en la hora de este navegador.</p>
          )}
          <div className="preview-schedule">
            <CalendarClock size={16} />
            <span>{recurrenceText(form.recurrence, configFor(form), form.starts_at)}</span>
          </div>
          {!form.active ? (
            <p className="muted text-sm">Pausado: no se enviará mientras esté inactivo.</p>
          ) : scheduleChanged ? (
            <Alert tone="blue" icon={<Info size={16} />}>
              {reminder ? 'Cambiaste la programación: los próximos envíos se recalculan al guardar.' : 'Los próximos envíos se calculan al guardar.'}
            </Alert>
          ) : reminder && reminder.upcoming.length > 0 ? (
            <ol className="upcoming-list">
              {reminder.upcoming.slice(0, 5).map((t) => (
                <li key={t}>
                  <span>{formatDateTime(t)}</span>
                  <span className="muted text-xs">{timeFromNow(t)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted text-sm">Sin envíos futuros.</p>
          )}

          <div className="field-label mt">Vista previa del mensaje</div>
          <div className={`message-preview mp-${kindTone}`}>
            <div className="mp-head">
              <span className="mp-icon">
                <KindIcon kind={form.kind} size={15} />
              </span>
              <span className="mp-kind">{MESSAGE_KIND[form.kind].label}</span>
              <span className="mp-display">{form.display === 'popup' ? 'Ventana emergente' : 'Bandeja'}</span>
            </div>
            <div className="mp-title">{renderTemplate(form.title, sample) || 'Título del recordatorio'}</div>
            <div className="mp-body">{renderTemplate(form.body, sample) || 'Aquí aparecerá el mensaje.'}</div>
          </div>
          <p className="muted text-xs">
            Ejemplo con el cliente {sample.nombre} ({sample.usuario}), que vence el {sample.vence}.
          </p>
        </aside>
      </div>
    </Modal>
  );
}
