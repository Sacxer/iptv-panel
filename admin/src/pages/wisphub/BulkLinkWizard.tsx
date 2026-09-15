import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronDown, ChevronUp, CircleCheck, Copy, Download, KeyRound, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { DataTable } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { PackageChecklist } from '../../components/PackageChecklist';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, ChipGroup, FormField, Select, Spinner, Switch } from '../../components/ui';
import { useDebounce } from '../../hooks/useDebounce';
import { usePackages } from '../../hooks/useResources';
import type {
  BillingMatchBy,
  BillingOverview,
  BulkLinkAction,
  BulkLinkInput,
  BulkLinkItem,
  BulkLinkResult,
  BulkLinkStatus,
  ExternalClientsSummary,
  Package,
} from '../../types';
import { copyToClipboard, formatNumber } from '../../utils/format';
import { FREE_HINT, LINK_METHOD, MAPPED_STATUS } from '../../utils/labels';

// ---------- Modelo del formulario ----------

type Target = BulkLinkStatus | 'selected';
type UsernameFrom = 'usuario' | 'cedula' | 'email' | 'id';
type PasswordMode = 'random' | 'cedula' | 'fixed';
type Body = Omit<BulkLinkInput, 'dry_run'>;

interface BulkForm {
  target: Target;
  planContains: string;
  search: string;
  matchBy: BillingMatchBy[];
  createMissing: boolean;
  usernameFrom: UsernameFrom;
  passwordMode: PasswordMode;
  fixedPassword: string;
  packageIds: number[];
  maxConnections: string;
  expiry: 'never' | 'months';
  months: string;
  applyStatus: boolean;
}

type SetField = <K extends keyof BulkForm>(key: K, value: BulkForm[K]) => void;
type Errors = Partial<Record<'target' | 'match_by' | 'max_connections' | 'months' | 'password', string>>;

const MATCH_OPTIONS: { key: BillingMatchBy; label: string }[] = [
  { key: 'document', label: 'Cédula' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'username', label: 'Usuario' },
];

const USERNAME_FROM: { value: UsernameFrom; label: string }[] = [
  { value: 'cedula', label: 'Cédula' },
  { value: 'usuario', label: 'Usuario de WispHub' },
  { value: 'email', label: 'Parte del email antes de @' },
  { value: 'id', label: 'ID de servicio' },
];

const PASSWORD_MODES: { value: PasswordMode; label: string }[] = [
  { value: 'cedula', label: 'La cédula' },
  { value: 'random', label: 'Aleatoria' },
  { value: 'fixed', label: 'Fija' },
];

const CRED_RE = /^[A-Za-z0-9._@-]+$/;
/** Por encima de este número de cuentas nuevas se pide escribir la cantidad para confirmar. */
const TYPED_CONFIRM_OVER = 100;

type ItemKind = BulkLinkAction | 'join';

const ACTION_META: Record<ItemKind, { label: string; tone: 'green' | 'blue' | 'gray' | 'amber' | 'purple' }> = {
  link: { label: 'Vincular', tone: 'green' },
  create: { label: 'Crear', tone: 'blue' },
  join: { label: 'Unir a cuenta', tone: 'purple' },
  no_match: { label: 'Sin coincidencia', tone: 'gray' },
  ambiguous: { label: 'Ambiguo', tone: 'amber' },
};

const APPLY_LABEL: Record<string, { label: string; tone: 'teal' | 'green' | 'red' | 'gray' }> = {
  free: { label: 'Gratis', tone: 'teal' },
  active: { label: 'Activo', tone: 'green' },
  suspended: { label: 'Suspendido', tone: 'red' },
  disabled: { label: 'Deshabilitado', tone: 'gray' },
};

function defaultForm(overview: BillingOverview, target: Target, plan = '', search = ''): BulkForm {
  const fromConfig = (overview.config.match_by ?? []).filter((k) => MATCH_OPTIONS.some((m) => m.key === k));
  return {
    target,
    planContains: plan,
    search,
    matchBy: fromConfig.length > 0 ? fromConfig : ['document', 'email', 'phone', 'username'],
    createMissing: true,
    usernameFrom: 'cedula',
    passwordMode: 'cedula',
    fixedPassword: '',
    packageIds: [],
    maxConnections: '1',
    expiry: 'never',
    months: '1',
    applyStatus: true,
  };
}

function buildBody(f: BulkForm, selectedIds: number[]): Body {
  const b: Body = {
    status: f.target === 'selected' ? 'all' : f.target,
    match_by: f.matchBy,
    create_missing: f.createMissing,
    apply_status: f.applyStatus,
  };
  if (f.target === 'selected') b.ids = selectedIds;
  else {
    if (f.planContains.trim()) b.plan_contains = f.planContains.trim();
    if (f.search.trim()) b.search = f.search.trim();
  }
  if (f.createMissing) {
    b.create = {
      username_from: f.usernameFrom,
      password_mode: f.passwordMode,
      package_ids: f.packageIds,
      max_connections: Math.max(1, Math.floor(Number(f.maxConnections)) || 1),
      duration: f.expiry === 'never' ? null : { amount: Math.max(1, Math.floor(Number(f.months)) || 1), unit: 'months' },
    };
    if (f.passwordMode === 'fixed') b.create.password = f.fixedPassword;
  }
  return b;
}

function validateTarget(f: BulkForm, selectedIds: number[]): Errors {
  return f.target === 'selected' && selectedIds.length === 0 ? { target: 'Los clientes marcados ya están vinculados. Elige otro grupo.' } : {};
}

function validateOptions(f: BulkForm): Errors {
  const e: Errors = {};
  if (f.matchBy.length === 0) e.match_by = 'Elige al menos un dato para comparar.';
  if (f.createMissing) {
    const mc = Number(f.maxConnections);
    if (!Number.isInteger(mc) || mc < 1) e.max_connections = 'Debe ser un número entero mayor o igual a 1';
    if (f.expiry === 'months') {
      const m = Number(f.months);
      if (!Number.isInteger(m) || m < 1) e.months = 'Indica un número de meses válido';
    }
    if (f.passwordMode === 'fixed') {
      if (f.fixedPassword.length < 4) e.password = 'Mínimo 4 caracteres';
      else if (!CRED_RE.test(f.fixedPassword)) e.password = 'Solo letras, números y . _ - @ (sin espacios)';
    }
  }
  return e;
}

/** Estado compartido del formulario: valores, cuerpo de la petición y paquetes (preselecciona si solo hay uno). */
function useBulkForm(initial: () => BulkForm, selectedIds: number[]) {
  const [form, setForm] = useState<BulkForm>(initial);
  const { packages, loading: packagesLoading } = usePackages();
  const set: SetField = useCallback((key, value) => setForm((f) => ({ ...f, [key]: value })), []);
  const preselected = useRef(false);

  useEffect(() => {
    if (preselected.current || packagesLoading) return;
    preselected.current = true;
    if (packages.length === 1) setForm((f) => (f.packageIds.length === 0 ? { ...f, packageIds: [packages[0].id] } : f));
  }, [packages, packagesLoading]);

  const body = useMemo(() => buildBody(form, selectedIds), [form, selectedIds]);
  const bodyKey = useMemo(() => JSON.stringify(body), [body]);
  return { form, set, packages, packagesLoading, body, bodyKey };
}

/** Simulación (dry_run) del cuerpo actual. Solo guarda la respuesta de la última petición. */
function useBulkPreview(body: Body, bodyKey: string, active: boolean, delay: number) {
  const [preview, setPreview] = useState<BulkLinkResult | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);
  const bodyRef = useRef({ body, bodyKey });
  bodyRef.current = { body, bodyKey };
  const debouncedKey = useDebounce(bodyKey, delay);

  const run = useCallback(async () => {
    const id = ++reqRef.current;
    const { body: b, bodyKey: key } = bodyRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.billing.bulkLink({ ...b, dry_run: true });
      if (id !== reqRef.current) return;
      setPreview(res);
      setPreviewKey(key);
    } catch (e) {
      if (id !== reqRef.current) return;
      setError(errorMessage(e));
      setPreviewKey('');
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      reqRef.current++;
      setLoading(false);
      return;
    }
    if (debouncedKey !== bodyKey || previewKey === bodyKey) return;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, debouncedKey, bodyKey]);

  const fresh = preview !== null && previewKey === bodyKey && !loading;
  return { preview, fresh, loading: loading || (active && previewKey !== bodyKey && !error), error, run };
}

/** Aplicación real + control de cierre cuando hay contraseñas que solo se ven ahora. */
function useBulkApply(body: Body, onApplied: () => void) {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkLinkResult | null>(null);
  const [saved, setSaved] = useState(false);

  const apply = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const res = await api.billing.bulkLink({ ...body, dry_run: false });
      setResult({ ...res, items: res.items ?? [], credentials: res.credentials ?? [] });
      onApplied();
      const parts: string[] = [];
      if (res.linked > 0) parts.push(`${formatNumber(res.linked)} vinculado${res.linked === 1 ? '' : 's'}`);
      if (res.created > 0) parts.push(`${formatNumber(res.created)} cuenta${res.created === 1 ? '' : 's'} creada${res.created === 1 ? '' : 's'}`);
      if ((res.grouped ?? 0) > 0) parts.push(`${formatNumber(res.grouped ?? 0)} servicio${res.grouped === 1 ? '' : 's'} unido${res.grouped === 1 ? '' : 's'}`);
      toast.success(parts.length > 0 ? `Listo: ${parts.join(', ')}` : 'No hubo cambios');
    } catch (e) {
      setRunError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  return { running, runError, result, saved, setSaved, apply };
}

/** Contraseñas que no se pueden deducir (aleatorias, o de respaldo cuando la cédula es muy corta). */
function unrecoverableCount(result: BulkLinkResult, mode: PasswordMode): number {
  const creds = result.credentials ?? [];
  // El servidor indica el origen de cada contraseña; sin ese dato se deduce del modo elegido.
  if (creds.some((c) => c.password_source)) return creds.filter((c) => c.password_source === 'random').length;
  if (mode === 'random') return creds.length;
  if (mode === 'cedula') return creds.filter((c) => !/^\d{4,}$/.test(c.password)).length;
  return 0;
}

function useCloseGuard(result: BulkLinkResult | null, saved: boolean, mode: PasswordMode, running: boolean, onClose: () => void) {
  const confirm = useConfirm();
  const mustSave = result !== null && !saved && unrecoverableCount(result, mode) > 0;
  const requestClose = async () => {
    if (running) return;
    if (mustSave) {
      const ok = await confirm({
        title: 'Cerrar sin guardar las contraseñas',
        message: 'Hay contraseñas aleatorias que no se podrán volver a consultar (solo restablecer). ¿Cerrar de todos modos?',
        confirmText: 'Cerrar',
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  };
  return { requestClose, dismissible: !running && !mustSave };
}

/** Servicios que quedarán vinculados: a cuentas existentes, a cuentas nuevas y unidos a una cuenta nueva por cédula. */
function servicesToApply(r: BulkLinkResult | null): number {
  return r ? r.linked + r.created + (r.grouped ?? 0) : 0;
}

function confirmLabel(verb: 'sync' | 'wizard', r: BulkLinkResult): string {
  const n = servicesToApply(r);
  if (n === 0) return 'Nada que aplicar';
  const grouped = r.grouped ?? 0;
  const parts: string[] = [];
  if (r.created > 0) parts.push(`crear ${formatNumber(r.created)} cuenta${r.created === 1 ? '' : 's'}`);
  if (grouped > 0) parts.push(`unir ${formatNumber(grouped)} servicio${grouped === 1 ? '' : 's'}`);
  if (r.linked > 0) parts.push(`vincular ${formatNumber(r.linked)}`);
  const noun = `servicio${n === 1 ? '' : 's'}`;
  if (verb === 'sync') return `Sincronizar ${formatNumber(n)} ${noun} (${parts.join(', ')})`;
  const last = parts.pop() ?? '';
  const text = parts.length > 0 ? `${parts.join(', ')} y ${last}` : last;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function targetOptionsFor(summary: ExternalClientsSummary | null, quick: boolean, selectedCount: number, selectedLinkedCount: number) {
  const u = summary?.unlinked_by_status;
  const total = u ? (u.free ?? 0) + u.active + u.suspended + u.disabled + u.unknown : null;
  const opts: { value: Target; label: string; count: number | null; desc?: string }[] = [
    { value: 'all', label: quick ? 'Todos los que faltan por sincronizar' : 'Todos los sin vincular', count: total },
    { value: 'active', label: 'Activos', count: u?.active ?? null },
    { value: 'free', label: 'Gratis', count: u ? (u.free ?? 0) : null, desc: 'No les afecta el corte.' },
    { value: 'suspended', label: 'Suspendidos', count: u?.suspended ?? null },
    { value: 'disabled', label: 'Cancelados', count: u?.disabled ?? null },
  ];
  if (!quick && (u?.unknown ?? 0) > 0) opts.push({ value: 'unknown', label: 'Con estado sin mapear', count: u?.unknown ?? 0 });
  if (!quick && (selectedCount > 0 || selectedLinkedCount > 0)) {
    opts.push({
      value: 'selected',
      label: `Solo los seleccionados (${formatNumber(selectedCount)})`,
      count: null,
      desc:
        selectedLinkedCount > 0
          ? `${formatNumber(selectedLinkedCount)} marcado${selectedLinkedCount === 1 ? '' : 's'} ya vinculado${selectedLinkedCount === 1 ? '' : 's'}: se omitirá${selectedLinkedCount === 1 ? '' : 'n'}.`
          : undefined,
    });
  }
  return opts;
}

// ---------- Diálogo rápido: "Sincronizar todos" ----------

export interface SyncAllDialogProps {
  overview: BillingOverview;
  summary: ExternalClientsSummary | null;
  initialStatus?: 'free' | 'active' | 'suspended' | 'disabled' | '';
  onClose: () => void;
  onApplied: () => void;
}

export function SyncAllDialog({ overview, summary, initialStatus = '', onClose, onApplied }: SyncAllDialogProps) {
  const noIds = useMemo<number[]>(() => [], []);
  const { form, set, packages, packagesLoading, body, bodyKey } = useBulkForm(() => defaultForm(overview, initialStatus || 'all'), noIds);
  const [showOptions, setShowOptions] = useState(false);
  const [typed, setTyped] = useState('');
  const errors = validateOptions(form);
  const valid = Object.keys(errors).length === 0;
  const { running, runError, result, saved, setSaved, apply } = useBulkApply(body, onApplied);
  const pv = useBulkPreview(body, bodyKey, valid && !result && !running, 450);
  const { requestClose, dismissible } = useCloseGuard(result, saved, form.passwordMode, running, onClose);

  useEffect(() => setTyped(''), [bodyKey]);

  const freshPreview = pv.fresh ? pv.preview : null;
  const toCreate = freshPreview?.created ?? 0;
  const needsTyped = toCreate > TYPED_CONFIRM_OVER;
  const canApply = valid && servicesToApply(freshPreview) > 0 && (!needsTyped || typed.trim() === String(toCreate));
  const options = targetOptionsFor(summary, true, 0, 0);

  return (
    <Modal
      open
      title={result ? 'Sincronización: resultado' : 'Sincronizar clientes de WispHub'}
      onClose={() => void requestClose()}
      size="md"
      dismissible={dismissible}
      footer={
        result ? (
          <>
            <div className="grow" />
            <button type="button" className="btn btn-primary" onClick={() => void requestClose()}>
              Cerrar
            </button>
          </>
        ) : (
          <>
            <div className="grow" />
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={running}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary btn-long" onClick={() => void apply()} disabled={!canApply || running}>
              {(running || pv.loading) && <Spinner size={14} />} {freshPreview ? confirmLabel('sync', freshPreview) : 'Sincronizar'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <ResultScreen result={result} form={form} saved={saved} onSaved={() => setSaved(true)} />
      ) : (
        <div className="stack">
          <FormField label="¿Qué clientes quieres sincronizar?">
            <TargetCards options={options} value={form.target} onChange={(v) => set('target', v)} />
          </FormField>

          {form.createMissing && (
            <FormField label="Paquetes para las cuentas nuevas">
              <PackagesField packages={packages} loading={packagesLoading} value={form.packageIds} onChange={(v) => set('packageIds', v)} />
            </FormField>
          )}

          <div className="sync-summary">
            <ul className="sync-summary-list">
              <OptionsSummary form={form} />
            </ul>
            <button type="button" className="btn btn-link btn-sm" onClick={() => setShowOptions((s) => !s)} aria-expanded={showOptions}>
              {showOptions ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {showOptions ? 'Ocultar opciones' : 'Cambiar opciones'}
            </button>
          </div>
          {showOptions && (
            <div className="sync-options">
              <OptionsFields form={form} set={set} errors={errors} packages={packages} packagesLoading={packagesLoading} hidePackages />
            </div>
          )}

          <PreviewPanel
            state={pv}
            createMissing={form.createMissing}
            applyStatus={form.applyStatus}
            invalid={!valid}
            detailsCollapsed
            typedField={
              needsTyped && pv.fresh ? <TypedConfirm count={toCreate} value={typed} onChange={setTyped} /> : null
            }
          />
          {runError && <Alert tone="red">{runError}</Alert>}
        </div>
      )}
    </Modal>
  );
}

function OptionsSummary({ form }: { form: BulkForm }) {
  const matchLabels = form.matchBy.map((k) => MATCH_OPTIONS.find((m) => m.key === k)?.label ?? k).join(', ');
  let creds: ReactNode;
  if (!form.createMissing) creds = <>No se crean cuentas nuevas: los que no coincidan quedan sin vincular.</>;
  else if (form.usernameFrom === 'cedula' && form.passwordMode === 'cedula')
    creds = (
      <>
        <strong>Usuario y contraseña:</strong> la cédula del cliente (sin puntos) · una sola cuenta por persona
      </>
    );
  else
    creds = (
      <>
        <strong>Usuario:</strong> {USERNAME_FROM.find((u) => u.value === form.usernameFrom)?.label.toLowerCase()} · <strong>Contraseña:</strong>{' '}
        {PASSWORD_MODES.find((p) => p.value === form.passwordMode)?.label.toLowerCase()}
      </>
    );
  return (
    <>
      <li>{creds}</li>
      <li>
        <strong>Vincula por:</strong> {matchLabels || '—'}
      </li>
      <li>
        <strong>Estado de WispHub:</strong> {form.applyStatus ? 'se aplica ya (suspendido → suspendido, cancelado → deshabilitado; Gratis nunca se corta)' : 'no se aplica ahora'}
        {form.createMissing && (
          <>
            {' '}
            · <strong>Vencimiento:</strong> {form.expiry === 'never' ? 'sin vencimiento' : `${form.months} mes${form.months === '1' ? '' : 'es'}`}
          </>
        )}
      </li>
    </>
  );
}

// ---------- Asistente completo: "Vincular en lote" ----------

const STEPS = ['Qué clientes', 'Cómo vincular', 'Vista previa'];

export interface BulkLinkWizardProps {
  overview: BillingOverview;
  summary: ExternalClientsSummary | null;
  /** IDs (sin vincular) marcados en la tabla. */
  selectedIds: number[];
  /** Marcados que ya estaban vinculados (se omiten). */
  selectedLinkedCount: number;
  initialStatus?: 'free' | 'active' | 'suspended' | 'disabled' | '';
  initialPlan?: string;
  initialSearch?: string;
  onClose: () => void;
  /** Se llama tras aplicar la vinculación (para refrescar resumen y listas). */
  onApplied: () => void;
}

export function BulkLinkWizard({
  overview,
  summary,
  selectedIds,
  selectedLinkedCount,
  initialStatus = '',
  initialPlan = '',
  initialSearch = '',
  onClose,
  onApplied,
}: BulkLinkWizardProps) {
  const { form, set, packages, packagesLoading, body, bodyKey } = useBulkForm(
    () => defaultForm(overview, selectedIds.length > 0 || selectedLinkedCount > 0 ? 'selected' : initialStatus || 'all', initialPlan, initialSearch),
    selectedIds,
  );
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [typed, setTyped] = useState('');
  const { running, runError, result, saved, setSaved, apply } = useBulkApply(body, onApplied);
  const pv = useBulkPreview(body, bodyKey, step === 2 && !result && !running, 0);
  const { requestClose, dismissible } = useCloseGuard(result, saved, form.passwordMode, running, onClose);

  useEffect(() => setTyped(''), [bodyKey]);

  const validateStep = (s: number): boolean => {
    const e = s === 0 ? validateTarget(form, selectedIds) : s === 1 ? validateOptions(form) : {};
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goTo = (s: number) => {
    if (running || result) return;
    if (s <= step) {
      setStep(s);
      return;
    }
    for (let i = step; i < s; i++) {
      if (!validateStep(i)) {
        setStep(i);
        return;
      }
    }
    setStep(s);
  };

  // Las opciones se corrigen al vuelo una vez mostrado el error.
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    setErrors(step === 0 ? validateTarget(form, selectedIds) : step === 1 ? validateOptions(form) : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const freshPreview = pv.fresh ? pv.preview : null;
  const toCreate = freshPreview?.created ?? 0;
  const needsTyped = toCreate > TYPED_CONFIRM_OVER;
  const canApply = servicesToApply(freshPreview) > 0 && (!needsTyped || typed.trim() === String(toCreate));
  const options = targetOptionsFor(summary, false, selectedIds.length, selectedLinkedCount);
  const u = summary?.unlinked_by_status;
  const unlinkedTotal = u ? (u.free ?? 0) + u.active + u.suspended + u.disabled + u.unknown : 0;

  return (
    <Modal
      open
      title={result ? 'Vinculación en lote: resultado' : 'Vincular en lote'}
      onClose={() => void requestClose()}
      size="lg"
      dismissible={dismissible}
      footer={
        result ? (
          <>
            <div className="grow" />
            <button type="button" className="btn btn-primary" onClick={() => void requestClose()}>
              Cerrar
            </button>
          </>
        ) : (
          <>
            {step > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)} disabled={running}>
                <ArrowLeft size={15} /> Atrás
              </button>
            )}
            <div className="grow" />
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={running}>
              Cancelar
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn btn-primary" onClick={() => goTo(step + 1)}>
                Siguiente <ArrowRight size={15} />
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-long" onClick={() => void apply()} disabled={!canApply || running}>
                {(running || pv.loading) && <Spinner size={14} />} {freshPreview ? confirmLabel('wizard', freshPreview) : 'Aplicar'}
              </button>
            )}
          </>
        )
      }
    >
      {result ? (
        <ResultScreen result={result} form={form} saved={saved} onSaved={() => setSaved(true)} />
      ) : (
        <>
          <ol className="steps steps-compact">
            {STEPS.map((label, i) => (
              <li key={label} className={`step ${step === i ? 'is-current' : ''} ${step > i ? 'is-done' : ''}`}>
                <button type="button" className="step-button" onClick={() => goTo(i)}>
                  <span className="step-num">{step > i ? <CircleCheck size={14} /> : i + 1}</span>
                  <span className="step-label">{label}</span>
                </button>
              </li>
            ))}
          </ol>

          {step === 0 && (
            <div className="stack">
              <p className="muted text-sm">
                Solo se procesan los clientes de la plataforma que aún no están vinculados a un cliente IPTV
                {summary ? ` (${formatNumber(unlinkedTotal)} de ${formatNumber(summary.total)})` : ''}.
              </p>
              <FormField label="¿Qué clientes quieres vincular?" error={errors.target}>
                <TargetCards options={options} value={form.target} onChange={(v) => set('target', v)} />
              </FormField>
              {form.target !== 'selected' && (
                <>
                  <div className="grid-2 align-start">
                    <FormField label="El plan contiene… (opcional)" hint="Por ejemplo «TV» para incluir solo los planes con televisión." htmlFor="bl-plan">
                      <input
                        id="bl-plan"
                        className="input"
                        list="bl-plan-list"
                        value={form.planContains}
                        placeholder="Cualquier plan"
                        autoComplete="off"
                        onChange={(e) => set('planContains', e.target.value)}
                      />
                      <datalist id="bl-plan-list">
                        {(summary?.plans ?? []).map((p) => (
                          <option key={p.name} value={p.name}>{`${p.count} clientes`}</option>
                        ))}
                      </datalist>
                    </FormField>
                    <FormField label="Búsqueda (opcional)" hint="Nombre, cédula, usuario, email, teléfono o ID." htmlFor="bl-search">
                      <input id="bl-search" className="input" value={form.search} placeholder="Sin filtrar" autoComplete="off" onChange={(e) => set('search', e.target.value)} />
                    </FormField>
                  </div>
                  {(summary?.plans.length ?? 0) > 0 && (
                    <div className="plan-suggest">
                      <span className="muted text-xs">Planes:</span>
                      {(summary?.plans ?? []).slice(0, 12).map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          className={`chip chip-sm ${form.planContains === p.name ? 'chip-active' : ''}`}
                          onClick={() => set('planContains', form.planContains === p.name ? '' : p.name)}
                        >
                          {p.name} <span className="chip-count">{formatNumber(p.count)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 1 && <OptionsFields form={form} set={set} errors={errors} packages={packages} packagesLoading={packagesLoading} />}

          {step === 2 && (
            <div className="stack">
              <PreviewPanel
                state={pv}
                createMissing={form.createMissing}
                applyStatus={form.applyStatus}
                typedField={needsTyped && pv.fresh ? <TypedConfirm count={toCreate} value={typed} onChange={setTyped} /> : null}
              />
              {runError && <Alert tone="red">{runError}</Alert>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// ---------- Piezas compartidas ----------

function TargetCards({
  options,
  value,
  onChange,
}: {
  options: { value: Target; label: string; count: number | null; desc?: string }[];
  value: Target;
  onChange: (v: Target) => void;
}) {
  return (
    <div className="radio-cards radio-cards-2">
      {options.map((o) => (
        <button key={o.value} type="button" className={`radio-card ${value === o.value ? 'is-active' : ''}`} onClick={() => onChange(o.value)} aria-pressed={value === o.value}>
          <span className="radio-card-head">
            <span className="radio-dot" />
            <span className="radio-card-title">{o.label}</span>
            {o.count !== null && <span className="radio-card-count">{formatNumber(o.count)}</span>}
          </span>
          {o.desc && <span className="radio-card-desc">{o.desc}</span>}
        </button>
      ))}
    </div>
  );
}

function PackagesField({ packages, loading, value, onChange }: { packages: Package[]; loading: boolean; value: number[]; onChange: (v: number[]) => void }) {
  return (
    <>
      <PackageChecklist packages={packages} value={value} onChange={onChange} loading={loading} />
      {!loading && packages.length > 0 && value.length === 0 && (
        <div className="field-hint text-amber hint-icon">
          <AlertTriangle size={13} /> Recomendado: elige al menos un paquete; sin paquetes las cuentas no verán contenido.
        </div>
      )}
    </>
  );
}

function OptionsFields({
  form,
  set,
  errors,
  packages,
  packagesLoading,
  hidePackages = false,
}: {
  form: BulkForm;
  set: SetField;
  errors: Errors;
  packages: Package[];
  packagesLoading: boolean;
  hidePackages?: boolean;
}) {
  const cedulaHint =
    form.usernameFrom === 'cedula' || form.passwordMode === 'cedula'
      ? 'Se usan solo los dígitos de la cédula. Con menos de 3 dígitos el usuario será wh<ID de servicio>; con menos de 4, la contraseña será aleatoria. Una cédula repetida (dos servicios) recibe el sufijo -2.'
      : 'Si el usuario se repite se añade un sufijo (-2, -3…).';
  return (
    <div className="stack">
      <FormField label="Comparar con los clientes IPTV por (en este orden)" error={errors.match_by} hint="Se vincula con el primer dato que coincida con un único cliente IPTV.">
        <div className="match-options match-options-flush">
          {MATCH_OPTIONS.map((m) => {
            const idx = form.matchBy.indexOf(m.key);
            return (
              <label key={m.key} className={`match-option ${idx >= 0 ? 'is-checked' : ''}`}>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={idx >= 0}
                  onChange={(e) => set('matchBy', e.target.checked ? [...form.matchBy, m.key] : form.matchBy.filter((k) => k !== m.key))}
                />
                {idx >= 0 && <span className="match-order">{idx + 1}</span>}
                {m.label}
              </label>
            );
          })}
        </div>
      </FormField>

      <div className="bulk-option">
        <Switch
          checked={form.createMissing}
          onChange={(v) => set('createMissing', v)}
          label="Crear cuenta IPTV para los que no existan"
          description="Los clientes sin coincidencia reciben una cuenta nueva ya vinculada. Los servicios con la misma cédula comparten una sola cuenta."
        />
        {form.createMissing && (
          <div className="bulk-sub stack">
            <div className="grid-2 align-start">
              <FormField label="Usuario a partir de" htmlFor="bl-user-from">
                <Select id="bl-user-from" value={form.usernameFrom} onChange={(v) => set('usernameFrom', v as UsernameFrom)} options={USERNAME_FROM} />
              </FormField>
              <FormField label="Conexiones simultáneas" htmlFor="bl-maxc" error={errors.max_connections}>
                <input id="bl-maxc" className="input" type="number" min={1} value={form.maxConnections} onChange={(e) => set('maxConnections', e.target.value)} />
              </FormField>
            </div>
            <FormField label="Contraseña" error={errors.password} hint={cedulaHint}>
              <div className="segmented">
                {PASSWORD_MODES.map((p) => (
                  <button key={p.value} type="button" className={`segment ${form.passwordMode === p.value ? 'is-active' : ''}`} onClick={() => set('passwordMode', p.value)}>
                    {p.label}
                  </button>
                ))}
              </div>
              {form.passwordMode === 'fixed' && (
                <input
                  className="input mono bulk-password"
                  value={form.fixedPassword}
                  autoComplete="off"
                  placeholder="Contraseña para todas las cuentas"
                  aria-label="Contraseña fija"
                  onChange={(e) => set('fixedPassword', e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Vencimiento" error={errors.months}>
              <div className="segmented">
                <button type="button" className={`segment ${form.expiry === 'never' ? 'is-active' : ''}`} onClick={() => set('expiry', 'never')}>
                  Sin vencimiento
                </button>
                <button type="button" className={`segment ${form.expiry === 'months' ? 'is-active' : ''}`} onClick={() => set('expiry', 'months')}>
                  Meses
                </button>
              </div>
              {form.expiry === 'never' ? (
                <div className="field-hint">Recomendado: los cortes y reactivaciones los controla WispHub.</div>
              ) : (
                <div className="row mt-sm">
                  <input className="input input-narrow" type="number" min={1} value={form.months} aria-label="Meses" onChange={(e) => set('months', e.target.value)} />
                  <span className="muted text-sm">mes{form.months === '1' ? '' : 'es'} desde hoy</span>
                </div>
              )}
            </FormField>
            {!hidePackages && (
              <FormField label="Paquetes">
                <PackagesField packages={packages} loading={packagesLoading} value={form.packageIds} onChange={(v) => set('packageIds', v)} />
              </FormField>
            )}
          </div>
        )}
      </div>

      <div className="bulk-option">
        <Switch
          checked={form.applyStatus}
          onChange={(v) => set('applyStatus', v)}
          label="Aplicar ya el estado de WispHub"
          description="Suspendido → cliente suspendido; cancelado → deshabilitado; Gratis nunca se corta. Con varios servicios manda el de mayor prioridad (Gratis > Activo > Suspendido > Cancelado). Un corte manual nunca se levanta."
        />
      </div>
    </div>
  );
}

function TypedConfirm({ count, value, onChange }: { count: number; value: string; onChange: (v: string) => void }) {
  return (
    <FormField label={`Se crearán ${formatNumber(count)} cuentas IPTV. Para confirmar, escribe ${count}`} htmlFor="bl-typed">
      <input id="bl-typed" className="input mono input-narrow" inputMode="numeric" autoComplete="off" value={value} placeholder={String(count)} onChange={(e) => onChange(e.target.value)} />
    </FormField>
  );
}

function PreviewPanel({
  state,
  createMissing,
  applyStatus,
  invalid = false,
  detailsCollapsed = false,
  typedField,
}: {
  state: ReturnType<typeof useBulkPreview>;
  createMissing: boolean;
  applyStatus: boolean;
  invalid?: boolean;
  detailsCollapsed?: boolean;
  typedField?: ReactNode;
}) {
  const { preview, fresh, loading, error, run } = state;
  if (invalid) return <Alert tone="amber">Revisa las opciones marcadas para ver la vista previa.</Alert>;
  if (error && !loading)
    return (
      <Alert tone="red" title="No se pudo simular">
        <div>{error}</div>
        <button type="button" className="btn btn-secondary btn-sm mt-sm" onClick={() => void run()}>
          <RefreshCw size={14} /> Reintentar
        </button>
      </Alert>
    );
  if (!preview)
    return (
      <div className="bulk-loading">
        <Spinner label="Simulando… (no se guarda nada)" />
      </div>
    );
  const r = preview;
  return (
    <section className={`bulk-preview stack-sm ${fresh ? '' : 'is-stale'}`} aria-busy={loading}>
      <div className="row">
        <h3 className="form-section-title grow">Vista previa</h3>
        {loading ? <Spinner size={14} label="Actualizando…" /> : <span className="muted text-xs">Simulación: aún no se ha guardado nada</span>}
      </div>
      <ResultTiles r={r} applyStatus={applyStatus} future />
      <LeftOutNote r={r} createMissing={createMissing} />
      {r.selected === 0 ? (
        <Alert tone="blue">No hay clientes sin vincular que cumplan estos criterios.</Alert>
      ) : (
        <>
          {servicesToApply(r) === 0 && <Alert tone="amber">Con estas opciones no se vincularía ni crearía ningún cliente.</Alert>}
          {detailsCollapsed ? (
            <details className="bulk-details">
              <summary>Ver detalle por cliente ({formatNumber(r.items.length)})</summary>
              <ItemsTable items={r.items} />
            </details>
          ) : (
            <ItemsTable items={r.items} />
          )}
        </>
      )}
      {typedField}
    </section>
  );
}

function ResultTiles({ r, applyStatus, future = false }: { r: BulkLinkResult; applyStatus: boolean; future?: boolean }) {
  const sa = r.status_applied ?? { active: 0, suspended: 0, disabled: 0 };
  const cut = sa.suspended + sa.disabled;
  const grouped = r.grouped ?? 0;
  return (
    <>
      <div className="account-line">
        <span>
          <strong>Cuentas IPTV:</strong> {formatNumber(r.accounts ?? r.created + r.linked)}
        </span>
        <span>
          <strong>Servicios agrupados en la misma cuenta:</strong> {formatNumber(grouped)}
        </span>
      </div>
      <div className="stat-tiles">
        <Tile value={r.selected} label="Servicios seleccionados" />
        <Tile value={r.created} label={future ? 'Cuentas a crear' : 'Cuentas creadas'} tone="blue" />
        <Tile value={grouped} label={future ? 'Servicios a unir (misma cédula)' : 'Servicios unidos (misma cédula)'} tone={grouped > 0 ? 'purple' : undefined} />
        <Tile value={r.linked} label={future ? 'A vincular con cuentas existentes' : 'Vinculados a cuentas existentes'} tone="green" />
        <Tile value={r.no_match} label="Sin coincidencia" tone={r.no_match > 0 ? 'gray' : undefined} />
        <Tile value={r.ambiguous} label="Ambiguos" tone={r.ambiguous > 0 ? 'amber' : undefined} />
        <div className="stat-tile">
          <span className={`stat-tile-value ${applyStatus && cut > 0 ? 'tile-red' : 'mini-gray'}`}>{applyStatus ? formatNumber(cut) : '—'}</span>
          <span className="stat-tile-label">
            {applyStatus
              ? `${future ? 'Cortes a aplicar' : 'Cortes aplicados'}: ${formatNumber(sa.suspended)} susp. · ${formatNumber(sa.disabled)} deshab.`
              : 'Estado: no se aplica'}
          </span>
        </div>
        <div className="stat-tile" title="Cuentas cuyo estado sale de un servicio Gratis: no les afecta el corte">
          <span className={`stat-tile-value ${applyStatus && (sa.free ?? 0) > 0 ? 'tile-teal' : 'mini-gray'}`}>{applyStatus ? formatNumber(sa.free ?? 0) : '—'}</span>
          <span className="stat-tile-label">Gratis (no se cortan)</span>
        </div>
      </div>
    </>
  );
}

function Tile({ value, label, tone }: { value: number; label: string; tone?: 'green' | 'blue' | 'gray' | 'amber' | 'purple' }) {
  return (
    <div className="stat-tile">
      <span className={`stat-tile-value ${tone ? `tile-${tone}` : ''}`}>{formatNumber(value)}</span>
      <span className="stat-tile-label">{label}</span>
    </div>
  );
}

function LeftOutNote({ r, createMissing }: { r: BulkLinkResult; createMissing: boolean }) {
  if (r.no_match === 0 && r.ambiguous === 0) return null;
  const parts: string[] = [];
  if (r.no_match > 0) parts.push(`${formatNumber(r.no_match)} sin coincidencia`);
  if (r.ambiguous > 0) parts.push(`${formatNumber(r.ambiguous)} ambiguo${r.ambiguous === 1 ? '' : 's'} (coinciden con varios clientes IPTV)`);
  return (
    <Alert tone="amber">
      {parts.join(' y ')} quedarán sin vincular.{' '}
      {!createMissing && r.no_match > 0 ? 'Activa «Crear cuenta IPTV para los que no existan» para darles una cuenta nueva, o vincúlalos a mano. ' : ''}
      {r.ambiguous > 0 ? 'Los ambiguos debes vincularlos a mano desde la tabla.' : ''}
    </Alert>
  );
}

type ActionFilter = '' | ItemKind;

function itemKind(i: BulkLinkItem): ItemKind {
  return i.action === 'link' && i.method === 'same_document' ? 'join' : i.action;
}

function ItemsTable({ items }: { items: BulkLinkItem[] }) {
  const [filter, setFilter] = useState<ActionFilter>('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const counts = useMemo(() => {
    const c: Record<ItemKind, number> = { link: 0, create: 0, join: 0, no_match: 0, ambiguous: 0 };
    items.forEach((i) => {
      const k = itemKind(i);
      if (k in c) c[k]++;
    });
    return c;
  }, [items]);
  const rows = useMemo(() => (filter ? items.filter((i) => itemKind(i) === filter) : items), [items, filter]);
  useEffect(() => setPage(1), [filter, limit, items]);
  const pageRows = rows.slice((page - 1) * limit, page * limit);

  const options: { value: ActionFilter; label: string }[] = [{ value: '', label: `Todos (${formatNumber(items.length)})` }];
  (['create', 'join', 'link', 'no_match', 'ambiguous'] as ItemKind[]).forEach((a) => {
    if (counts[a] > 0) options.push({ value: a, label: `${ACTION_META[a].label} (${formatNumber(counts[a])})` });
  });

  return (
    <div className="stack-sm">
      {options.length > 2 && <ChipGroup value={filter} onChange={setFilter} options={options} />}
      <DataTable<BulkLinkItem, string>
        rows={pageRows}
        rowKey={(i) => `${i.external_id}-${i.action}-${i.username ?? ''}`}
        emptyTitle="Sin clientes"
        pagination={rows.length > 20 ? { page, limit, total: rows.length, onPageChange: setPage, onLimitChange: setLimit } : undefined}
        columns={[
          {
            key: 'client',
            header: 'Cliente en la plataforma',
            render: (i) => (
              <div className="cell-main">
                <span className="strong">{i.name || '—'}</span>
                <span className="muted text-xs">
                  ID {i.external_id}
                  {i.external_status ? ` · ${i.external_status}` : ''}
                </span>
              </div>
            ),
          },
          { key: 'action', header: 'Acción', render: (i) => <ActionCell item={i} /> },
          {
            key: 'status',
            header: 'Estado a aplicar',
            hideOnMobile: true,
            render: (i) => {
              if (i.status_applied) {
                const m = APPLY_LABEL[i.status_applied] ?? MAPPED_STATUS.unknown;
                return (
                  <span title={i.status_applied === 'free' ? FREE_HINT : undefined}>
                    <Badge tone={m.tone} dot>
                      {m.label}
                    </Badge>
                  </span>
                );
              }
              if (i.status_skipped) return <span className="muted text-xs">{skippedLabel(i.status_skipped)}</span>;
              return <span className="muted">—</span>;
            },
          },
        ]}
      />
    </div>
  );
}

function skippedLabel(v: string): string {
  if (/manual/i.test(v)) return 'Corte manual: se mantiene';
  return v;
}

function ActionCell({ item }: { item: BulkLinkItem }) {
  const kind = itemKind(item);
  const meta = ACTION_META[kind] ?? { label: item.action, tone: 'gray' as const };
  if (kind === 'join') {
    return <Badge tone={meta.tone}>Se une a la cuenta «{item.username ?? '—'}» (misma cédula)</Badge>;
  }
  if (item.action === 'link') {
    return (
      <div className="cell-main">
        <Badge tone={meta.tone}>Vincular a «{item.username ?? '—'}»</Badge>
        {item.method && <span className="muted text-xs">{(LINK_METHOD[item.method] ?? item.method).toLowerCase()}</span>}
      </div>
    );
  }
  if (item.action === 'create') return <Badge tone={meta.tone}>Crear «{item.username ?? '—'}»</Badge>;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

// ---------- Resultado ----------

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function ResultScreen({ result, form, saved, onSaved }: { result: BulkLinkResult; form: BulkForm; saved: boolean; onSaved: () => void }) {
  const toast = useToast();
  const creds = result.credentials ?? [];
  const mode = form.createMissing ? form.passwordMode : 'fixed';
  const unrecoverable = unrecoverableCount(result, mode);

  const downloadCsv = () => {
    // Separador ";" (configuración regional es-CO de Excel) y BOM para que Excel respete UTF-8.
    const lines = [['usuario', 'contraseña', 'nombre', 'id_servicio'].join(';')];
    creds.forEach((c) => lines.push([c.username, c.password, c.name, c.external_id].map(csvCell).join(';')));
    const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cuentas-iptv-${stamp()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onSaved();
  };

  const copyAll = async () => {
    const text = ['Usuario\tContraseña\tNombre\tServicio', ...creds.map((c) => `${c.username}\t${c.password}\t${c.name}\t${c.external_id}`)].join('\n');
    const ok = await copyToClipboard(text);
    if (ok) {
      toast.success(`${formatNumber(creds.length)} credenciales copiadas`);
      onSaved();
    } else toast.error('No se pudo copiar. Descarga el CSV.');
  };

  let warning: ReactNode = null;
  if (creds.length > 0) {
    if (mode === 'random') {
      warning = (
        <Alert tone={saved ? 'blue' : 'amber'} icon={<KeyRound size={18} />} title="Estas contraseñas solo se muestran ahora">
          Descárgalas o cópialas antes de cerrar: no se pueden volver a consultar (solo restablecer).
        </Alert>
      );
    } else if (mode === 'cedula') {
      warning = (
        <Alert tone={unrecoverable > 0 && !saved ? 'amber' : 'blue'} icon={<KeyRound size={18} />} title="Las contraseñas son la cédula del cliente">
          El CSV es opcional: úsalo si quieres entregar los accesos.
          {unrecoverable > 0 &&
            ` ${formatNumber(unrecoverable)} cuenta${unrecoverable === 1 ? '' : 's'} con cédula muy corta o vacía recibi${unrecoverable === 1 ? 'ó' : 'eron'} una contraseña aleatoria que solo se muestra ahora: descárgala antes de cerrar.`}
        </Alert>
      );
    } else {
      warning = (
        <Alert tone="blue" icon={<KeyRound size={18} />} title="Todas las cuentas usan la contraseña fija elegida">
          El CSV es opcional: úsalo si quieres entregar los accesos.
        </Alert>
      );
    }
  }

  return (
    <div className="stack">
      <Alert tone="green" icon={<CircleCheck size={18} />} title="Vinculación aplicada">
        Los clientes vinculados seguirán desde ahora el estado de WispHub según el modo de cortes.
      </Alert>
      <ResultTiles r={result} applyStatus={form.applyStatus} />
      {creds.length > 0 && (
        <section className="stack-sm">
          {warning}
          <div className="row">
            <h3 className="form-section-title grow">Cuentas creadas ({formatNumber(creds.length)})</h3>
            <button type="button" className="btn btn-primary btn-sm" onClick={downloadCsv}>
              <Download size={14} /> Descargar CSV
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyAll()}>
              <Copy size={14} /> Copiar todo
            </button>
          </div>
          <div className="table-card cred-table">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Contraseña</th>
                    <th>Nombre</th>
                    <th>Servicio</th>
                  </tr>
                </thead>
                <tbody>
                  {creds.map((c) => (
                    <tr key={`${c.external_id}-${c.username}`}>
                      <td className="mono text-sm">{c.username}</td>
                      <td className="mono text-sm">{c.password}</td>
                      <td className="text-sm">{c.name}</td>
                      <td className="mono text-sm">{c.external_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
      {result.items.length > 0 && (
        <details className="bulk-details">
          <summary>Detalle por cliente ({formatNumber(result.items.length)})</summary>
          <ItemsTable items={result.items} />
        </details>
      )}
    </div>
  );
}
