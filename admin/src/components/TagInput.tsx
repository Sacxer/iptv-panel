import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import type { Tone } from '../utils/labels';

/** Lista de etiquetas editable: Enter o coma para añadir, clic en la X para quitar. */
export function TagInput({
  value,
  onChange,
  placeholder = 'Escribe y pulsa Enter',
  tone = 'gray',
  ariaLabel,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  tone?: Tone;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...value];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setDraft('');
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="tag-input">
      {value.map((v) => (
        <span key={v} className={`badge badge-${tone} tag`}>
          {v}
          <button type="button" className="tag-remove" aria-label={`Quitar ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        className="tag-field"
        value={draft}
        aria-label={ariaLabel}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => add(draft)}
      />
    </div>
  );
}
