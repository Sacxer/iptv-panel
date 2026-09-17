import { useEffect, useState } from 'react';
import { Dices, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { Modal } from '../../components/Modal';
import { DateTimeInput } from '../../components/DateTimeInput';
import { PackageChecklist } from '../../components/PackageChecklist';
import { ContentSectionsField } from '../../components/ContentSectionsField';
import { Alert, Checkbox, FormField, Select, Spinner, Switch } from '../../components/ui';
import { useToast } from '../../components/Toast';
import type { AdminAccount, ContentSection, Package, TimeUnit, User, UserInput } from '../../types';
import { addToUnix, formatDateTime, generatePassword, generateUsername, isValidEmail, nowUnix } from '../../utils/format';
import { ROLE_LABEL } from '../../utils/labels';

type ExpiryMode = 'duration' | 'date' | 'never';

interface Props {
  open: boolean;
  user: User | null;
  packages: Package[];
  packagesLoading: boolean;
  admins: AdminAccount[];
  isAdmin: boolean;
  /** Nombre de la plataforma si se puede actualizar el cliente desde ella (null = no). */
  platformName?: string | null;
  onRefreshExternal?: (user: User) => Promise<void>;
  onClose: () => void;
  onSaved: (user: User) => void;
}

interface FormState {
  random: boolean;
  username: string;
  password: string;
  full_name: string;
  email: string;
  phone: string;
  expiryMode: ExpiryMode;
  durationAmount: number;
  durationUnit: TimeUnit;
  exp_date: number | null;
  max_connections: string;
  is_trial: boolean;
  package_ids: number[];
  content_sections: ContentSection[];
  notes: string;
  enabled: boolean;
  owner_id: string;
  document_id: string;
  external_id: string;
}

const QUICK_DURATIONS: { label: string; amount: number; unit: TimeUnit }[] = [
  { label: '1 día', amount: 1, unit: 'days' },
  { label: '1 mes', amount: 1, unit: 'months' },
  { label: '3 meses', amount: 3, unit: 'months' },
  { label: '6 meses', amount: 6, unit: 'months' },
  { label: '12 meses', amount: 12, unit: 'months' },
];

function initialState(user: User | null): FormState {
  if (user) {
    return {
      random: false,
      username: user.username,
      password: user.password ?? '',
      full_name: user.full_name ?? '',
      email: user.email ?? '',
      phone: user.phone ?? '',
      expiryMode: user.exp_date === null ? 'never' : 'date',
      durationAmount: 1,
      durationUnit: 'months',
      exp_date: user.exp_date,
      max_connections: String(user.max_connections ?? 1),
      is_trial: user.is_trial,
      package_ids: user.package_ids ?? [],
      content_sections: user.content_sections ?? [],
      notes: user.notes ?? '',
      enabled: user.enabled,
      owner_id: user.owner_id !== null && user.owner_id !== undefined ? String(user.owner_id) : '',
      document_id: user.document_id ?? '',
      external_id: user.external_id ?? '',
    };
  }
  return {
    random: false,
    username: '',
    password: generatePassword(10),
    full_name: '',
    email: '',
    phone: '',
    expiryMode: 'duration',
    durationAmount: 1,
    durationUnit: 'months',
    exp_date: null,
    max_connections: '1',
    is_trial: false,
    package_ids: [],
    content_sections: [],
    notes: '',
    enabled: true,
    owner_id: '',
    document_id: '',
    external_id: '',
  };
}

const CRED_RE = /^[A-Za-z0-9._@-]+$/;

export function UserFormModal({ open, user, packages, packagesLoading, admins, isAdmin, platformName, onRefreshExternal, onClose, onSaved }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const isEdit = user !== null;
  const [form, setForm] = useState<FormState>(() => initialState(user));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(true);
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setForm(initialState(user));
      setErrors({});
      setServerError(null);
    }
  }, [open, user]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.random || isEdit) {
      if (!form.username.trim()) e.username = 'El usuario es obligatorio';
      else if (form.username.trim().length < 3) e.username = 'Mínimo 3 caracteres';
      else if (!CRED_RE.test(form.username.trim())) e.username = 'Solo letras, números y . _ - @ (sin espacios)';
      if (!form.password) e.password = 'La contraseña es obligatoria';
      else if (form.password.length < 4) e.password = 'Mínimo 4 caracteres';
      else if (!CRED_RE.test(form.password)) e.password = 'Solo letras, números y . _ - @ (sin espacios)';
    }
    if (form.email.trim() && !isValidEmail(form.email.trim())) e.email = 'Correo electrónico no válido';
    const mc = Number(form.max_connections);
    if (!Number.isInteger(mc) || mc < 1) e.max_connections = 'Debe ser un número entero mayor o igual a 1';
    if (form.expiryMode === 'date' && form.exp_date === null) e.exp_date = 'Selecciona la fecha de vencimiento';
    if (form.expiryMode === 'duration' && (!Number.isInteger(form.durationAmount) || form.durationAmount < 1))
      e.durationAmount = 'Indica una duración válida';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    setServerError(null);
    const body: UserInput = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      max_connections: Number(form.max_connections),
      is_trial: form.is_trial,
      package_ids: form.package_ids,
      content_sections: form.content_sections,
      notes: form.notes,
      enabled: form.enabled,
      document_id: form.document_id.trim(),
    };
    if (isAdmin) body.external_id = form.external_id.trim() || null;
    if (!isEdit && form.random) body.random = true;
    else {
      body.username = form.username.trim();
      body.password = form.password;
    }
    if (form.expiryMode === 'never') body.exp_date = null;
    else if (form.expiryMode === 'date') body.exp_date = form.exp_date;
    else body.duration = { amount: form.durationAmount, unit: form.durationUnit };
    if (isAdmin && form.owner_id) body.owner_id = Number(form.owner_id);

    try {
      const saved = isEdit ? await api.users.update(user.id, body) : await api.users.create(body);
      toast.success(isEdit ? 'Cliente actualizado' : `Cliente "${saved?.username ?? body.username ?? ''}" creado`);
      onSaved(saved);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const durationPreview =
    form.expiryMode === 'duration' && form.durationAmount > 0
      ? formatDateTime(addToUnix(nowUnix(), form.durationAmount, form.durationUnit))
      : null;

  return (
    <Modal
      open={open}
      title={isEdit ? `Editar cliente: ${user.username}` : 'Nuevo cliente'}
      onClose={onClose}
      size="lg"
      dismissible={!saving}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving && <Spinner size={14} />}
            {isEdit ? 'Guardar cambios' : 'Crear cliente'}
          </button>
        </>
      }
    >
      {serverError && <Alert tone="red">{serverError}</Alert>}

      {isEdit && user.external_id && platformName && onRefreshExternal && (
        <div className="external-refresh-bar">
          <span className="text-sm">
            Vinculado a {platformName} · servicio <span className="mono">{user.external_id}</span>
            {user.external_status ? ` · ${user.external_status}` : ''}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={refreshing || saving}
            onClick={async () => {
              setRefreshing(true);
              try {
                await onRefreshExternal(user);
              } finally {
                setRefreshing(false);
              }
            }}
          >
            {refreshing ? <Spinner size={13} /> : <RefreshCw size={14} />} Actualizar desde {platformName}
          </button>
        </div>
      )}

      <h3 className="form-section-title">Credenciales</h3>
      {!isEdit && (
        <Checkbox
          checked={form.random}
          onChange={(v) => set('random', v)}
          label="Generar usuario y contraseña automáticamente"
          description="El servidor asignará credenciales aleatorias al crear la línea."
        />
      )}
      {(!form.random || isEdit) && (
        <div className="grid-2">
          <FormField label="Usuario" required error={errors.username} htmlFor="uf-username">
            <div className="input-group">
              <input
                id="uf-username"
                className="input"
                autoComplete="off"
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
              />
              {!isEdit && (
                <button type="button" className="btn btn-ghost btn-icon" title="Generar usuario" onClick={() => set('username', generateUsername())}>
                  <Dices size={16} />
                </button>
              )}
            </div>
          </FormField>
          <FormField label="Contraseña" required error={errors.password} htmlFor="uf-password">
            <div className="input-group">
              <input
                id="uf-password"
                className="input mono"
                autoComplete="new-password"
                type={showPass ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
              />
              <button type="button" className="btn btn-ghost btn-icon" title={showPass ? 'Ocultar' : 'Mostrar'} onClick={() => setShowPass((s) => !s)}>
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('password', generatePassword(10))}>
                <Dices size={15} /> Generar
              </button>
            </div>
          </FormField>
        </div>
      )}

      <h3 className="form-section-title">Datos del cliente</h3>
      <div className="grid-3">
        <FormField label="Cédula / Documento" htmlFor="uf-doc" hint="Se usa para vincularlo con la plataforma de facturación.">
          <input id="uf-doc" className="input mono" value={form.document_id} onChange={(e) => set('document_id', e.target.value)} />
        </FormField>
        {isAdmin && (
          <FormField label="ID en plataforma externa" htmlFor="uf-ext" hint="Vacío = sin vincular (o se vincula automáticamente al sincronizar).">
            <input id="uf-ext" className="input mono" value={form.external_id} onChange={(e) => set('external_id', e.target.value)} placeholder="p. ej. id_servicio de WispHub" />
          </FormField>
        )}
        <FormField label="Nombre" htmlFor="uf-name">
          <input id="uf-name" className="input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
        </FormField>
        <FormField label="Correo electrónico" error={errors.email} htmlFor="uf-email">
          <input id="uf-email" className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </FormField>
        <FormField label="Teléfono" htmlFor="uf-phone">
          <input id="uf-phone" className="input" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </FormField>
      </div>

      <h3 className="form-section-title">Plan</h3>
      <FormField label="Vencimiento">
        <div className="segmented">
          {!isEdit && (
            <button type="button" className={`segment ${form.expiryMode === 'duration' ? 'is-active' : ''}`} onClick={() => set('expiryMode', 'duration')}>
              Duración
            </button>
          )}
          <button
            type="button"
            className={`segment ${form.expiryMode === 'date' ? 'is-active' : ''}`}
            onClick={() => {
              if (form.exp_date === null) set('exp_date', addToUnix(nowUnix(), 1, 'months'));
              set('expiryMode', 'date');
            }}
          >
            Fecha
          </button>
          <button type="button" className={`segment ${form.expiryMode === 'never' ? 'is-active' : ''}`} onClick={() => set('expiryMode', 'never')}>
            Sin vencimiento
          </button>
        </div>
      </FormField>

      {form.expiryMode === 'duration' && (
        <div className="stack-sm">
          <div className="chips">
            {QUICK_DURATIONS.map((d) => (
              <button
                key={d.label}
                type="button"
                className={`chip ${form.durationAmount === d.amount && form.durationUnit === d.unit ? 'chip-active' : ''}`}
                onClick={() => {
                  set('durationAmount', d.amount);
                  set('durationUnit', d.unit);
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="row">
            <input
              className="input input-narrow"
              type="number"
              min={1}
              value={form.durationAmount}
              onChange={(e) => set('durationAmount', Math.floor(Number(e.target.value)))}
              aria-label="Cantidad"
            />
            <Select
              className="input-narrow"
              value={form.durationUnit}
              onChange={(v) => set('durationUnit', v as TimeUnit)}
              options={[
                { value: 'days', label: 'días' },
                { value: 'months', label: 'meses' },
              ]}
              ariaLabel="Unidad"
            />
            {durationPreview && <span className="muted text-sm">Vencerá aprox. el {durationPreview}</span>}
          </div>
          {errors.durationAmount && <div className="field-message">{errors.durationAmount}</div>}
        </div>
      )}
      {form.expiryMode === 'date' && (
        <FormField error={errors.exp_date} hint={isEdit ? 'Para sumar tiempo desde el vencimiento actual usa la acción "Extender".' : undefined}>
          <DateTimeInput value={form.exp_date} onChange={(v) => set('exp_date', v)} />
        </FormField>
      )}
      {form.expiryMode === 'never' && <p className="muted text-sm">La línea no vencerá nunca.</p>}

      <div className="grid-3 mt">
        <FormField label="Conexiones máximas" required error={errors.max_connections} htmlFor="uf-maxcon">
          <input
            id="uf-maxcon"
            className="input"
            type="number"
            min={1}
            value={form.max_connections}
            onChange={(e) => set('max_connections', e.target.value)}
          />
        </FormField>
        {isAdmin && (
          <FormField label="Propietario (revendedor)" htmlFor="uf-owner" hint="Vacío = tu cuenta">
            <Select
              id="uf-owner"
              value={form.owner_id}
              onChange={(v) => set('owner_id', v)}
              placeholder="— Mi cuenta —"
              options={admins.map((a) => ({ value: String(a.id), label: `${a.username} (${ROLE_LABEL[a.role] ?? a.role})` }))}
            />
          </FormField>
        )}
        <div className="field field-switches">
          <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label="Habilitado" />
          <Switch checked={form.is_trial} onChange={(v) => set('is_trial', v)} label="Cuenta de prueba" />
        </div>
      </div>

      <h3 className="form-section-title">Paquetes</h3>
      <PackageChecklist
        packages={packages}
        loading={packagesLoading}
        value={form.package_ids}
        onChange={(ids) => set('package_ids', ids)}
        emptyHint="No hay paquetes. Según los ajustes, un cliente sin paquetes puede ver todo el contenido o nada."
      />

      <h3 className="form-section-title">Contenido que ve el cliente</h3>
      <ContentSectionsField value={form.content_sections} onChange={(v) => set('content_sections', v)} disabled={saving} />

      <h3 className="form-section-title">Notas</h3>
      <FormField>
        <textarea className="input textarea" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Notas internas (no visibles para el cliente)" />
      </FormField>
    </Modal>
  );
}
