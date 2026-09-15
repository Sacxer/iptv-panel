import { useEffect, useId, useState, type ReactNode } from 'react';
import { Check, Copy, ImageOff, RefreshCw, CircleAlert } from 'lucide-react';
import { copyToClipboard } from '../utils/format';
import type { Tone } from '../utils/labels';
import { useToast } from './Toast';

// ---------- Spinner ----------

export function Spinner({ size = 18, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" style={{ width: size, height: size }} />
      {label && <span className="spinner-label">{label}</span>}
    </span>
  );
}

export function PageLoader({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="page-loader">
      <Spinner size={28} label={label} />
    </div>
  );
}

// ---------- Empty / Error ----------

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {description && <div className="empty-desc">{description}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <CircleAlert size={20} />
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry}>
          <RefreshCw size={14} /> Reintentar
        </button>
      )}
    </div>
  );
}

export function Alert({ tone = 'blue', icon, title, children }: { tone?: Tone; icon?: ReactNode; title?: string; children?: ReactNode }) {
  return (
    <div className={`alert alert-${tone}`}>
      {icon && <span className="alert-icon">{icon}</span>}
      <div className="alert-content">
        {title && <div className="alert-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

// ---------- Badge ----------

export function Badge({ tone = 'gray', children, dot = false }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

// ---------- Page header ----------

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

// ---------- Form field ----------

export function FormField({
  label,
  error,
  hint,
  required,
  children,
  className = '',
  htmlFor,
}: {
  label?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={`field ${error ? 'field-error' : ''} ${className}`}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="field-required"> *</span>}
        </label>
      )}
      {children}
      {error ? <div className="field-message">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

// ---------- Select ----------

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  id,
  disabled,
  className = '',
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      className={`input select ${className}`}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------- Switch / Checkbox ----------

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label className={`switch-row ${disabled ? 'is-disabled' : ''}`} htmlFor={id}>
      <span className="switch">
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track">
          <span className="switch-thumb" />
        </span>
      </span>
      {(label || description) && (
        <span className="switch-text">
          {label && <span className="switch-label">{label}</span>}
          {description && <span className="switch-desc">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  indeterminate = false,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={`check-row ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        className="checkbox"
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate && !checked;
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      {(label || description) && (
        <span className="check-text">
          {label && <span className="check-label">{label}</span>}
          {description && <span className="check-desc">{description}</span>}
        </span>
      )}
    </label>
  );
}

// ---------- Chips ----------

export function ChipGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; tone?: Tone }[];
}) {
  return (
    <div className="chips" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value || 'all'}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`chip ${value === o.value ? 'chip-active' : ''} ${o.tone ? `chip-${o.tone}` : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Tabs ----------

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          className={`tab ${value === t.value ? 'tab-active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Copy ----------

export function CopyButton({ text, label, size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className={`btn btn-ghost ${size === 'sm' ? 'btn-sm' : ''} ${label ? '' : 'btn-icon'}`}
      title="Copiar"
      onClick={async () => {
        const ok = await copyToClipboard(text);
        if (ok) setCopied(true);
        else toast.error('No se pudo copiar. Selecciona el texto y cópialo manualmente.');
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {label && <span>{copied ? 'Copiado' : label}</span>}
    </button>
  );
}

export function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="input-group">
        <input className={`input ${mono ? 'mono' : ''}`} readOnly value={value} onFocus={(e) => e.target.select()} />
        <CopyButton text={value} />
      </div>
    </div>
  );
}

// ---------- Thumb ----------

export function Thumb({ src, alt, variant = 'logo' }: { src?: string | null; alt: string; variant?: 'logo' | 'poster' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <span className={`thumb thumb-${variant} thumb-empty`} aria-label={alt}>
        <ImageOff size={16} />
      </span>
    );
  }
  return <img className={`thumb thumb-${variant}`} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

// ---------- Stat card ----------

export function StatCard({
  label,
  value,
  icon,
  tone = 'blue',
  hint,
  onClick,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  hint?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className={`stat-icon stat-${tone}`}>{icon}</div>
      <div className="stat-body">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
    </>
  );
  return onClick ? (
    <button type="button" className="stat-card stat-clickable" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="stat-card">{content}</div>
  );
}
