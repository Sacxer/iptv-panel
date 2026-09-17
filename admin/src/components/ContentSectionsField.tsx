import type { ContentSection } from '../types';
import { CONTENT_SECTIONS, contentSectionsText } from '../utils/labels';

interface ContentSectionsFieldProps {
  /** Secciones marcadas; [] = automático (según sus paquetes). */
  value: ContentSection[];
  onChange: (sections: ContentSection[]) => void;
  disabled?: boolean;
}

/** Casillas «Canales en vivo / Películas / Series» para elegir qué ve el cliente en las apps. */
export function ContentSectionsField({ value, onChange, disabled }: ContentSectionsFieldProps) {
  const chosen = new Set(value);

  const toggle = (section: ContentSection) => {
    const next = new Set(chosen);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    // Siempre en el mismo orden que devuelve el servidor.
    onChange(CONTENT_SECTIONS.map((c) => c.value).filter((s) => next.has(s)));
  };

  return (
    <div className="checklist">
      <div className="checklist-toolbar">
        <span className="muted text-sm">
          {value.length === 0 ? (
            <>
              <strong>Automático:</strong> según sus paquetes
            </>
          ) : (
            <>
              <strong>Solo verá:</strong> {contentSectionsText(value, true)}
            </>
          )}
        </span>
        {value.length > 0 && (
          <button type="button" className="btn btn-link btn-sm" disabled={disabled} onClick={() => onChange([])}>
            Volver a automático
          </button>
        )}
      </div>
      <div className="checklist-items checklist-items-sm">
        {CONTENT_SECTIONS.map((c) => (
          <label key={c.value} className={`checklist-item ${chosen.has(c.value) ? 'is-checked' : ''}`}>
            <input
              type="checkbox"
              className="checkbox"
              checked={chosen.has(c.value)}
              disabled={disabled}
              onChange={() => toggle(c.value)}
            />
            <span className="checklist-name">{c.label}</span>
          </label>
        ))}
      </div>
      <div className="field-hint">
        Sin marcar: automático (según sus paquetes). Si marca alguna, el cliente solo verá esas en la app.
        <br />
        Solo canales: la app abre directo en el último canal.
      </div>
    </div>
  );
}
