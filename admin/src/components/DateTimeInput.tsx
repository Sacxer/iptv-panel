import { X } from 'lucide-react';
import { localInputToUnix, unixToLocalInput } from '../utils/format';

interface DateTimeInputProps {
  /** Segundos unix o null. */
  value: number | null;
  onChange: (value: number | null) => void;
  id?: string;
  /** Permite dejar el campo vacío (muestra botón para limpiar). */
  clearable?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/** Selector de fecha y hora local que convierte a/desde segundos unix. */
export function DateTimeInput({ value, onChange, id, clearable = false, disabled, placeholder }: DateTimeInputProps) {
  return (
    <div className="input-group">
      <input
        id={id}
        type="datetime-local"
        className="input"
        value={unixToLocalInput(value)}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(localInputToUnix(e.target.value))}
      />
      {clearable && value !== null && !disabled && (
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onChange(null)} title="Quitar fecha">
          <X size={15} />
        </button>
      )}
    </div>
  );
}
