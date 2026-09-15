import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Package } from '../types';
import { Spinner } from './ui';

interface PackageChecklistProps {
  packages: Package[];
  value: number[];
  onChange: (ids: number[]) => void;
  loading?: boolean;
  emptyHint?: string;
}

/** Selección múltiple de paquetes con casillas, búsqueda y "seleccionar todos". */
export function PackageChecklist({ packages, value, onChange, loading, emptyHint }: PackageChecklistProps) {
  const [q, setQ] = useState('');
  const selected = useMemo(() => new Set(value), [value]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? packages.filter((p) => p.name.toLowerCase().includes(term)) : packages;
  }, [packages, q]);

  if (loading) return <Spinner label="Cargando paquetes…" />;
  if (packages.length === 0) {
    return <div className="muted text-sm">{emptyHint ?? 'No hay paquetes creados todavía.'}</div>;
  }

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const allSelected = packages.every((p) => selected.has(p.id));

  return (
    <div className="checklist">
      {packages.length > 6 && (
        <div className="input-icon checklist-search">
          <Search size={15} />
          <input className="input input-sm" placeholder="Buscar paquete…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <div className="checklist-toolbar">
        <span className="muted text-sm">
          {selected.size} de {packages.length} seleccionados
        </span>
        <button
          type="button"
          className="btn btn-link btn-sm"
          onClick={() => onChange(allSelected ? [] : packages.map((p) => p.id))}
        >
          {allSelected ? 'Quitar todos' : 'Seleccionar todos'}
        </button>
      </div>
      <div className="checklist-items">
        {filtered.map((p) => (
          <label key={p.id} className={`checklist-item ${selected.has(p.id) ? 'is-checked' : ''}`}>
            <input type="checkbox" className="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
            <span className="checklist-name">{p.name}</span>
            <span className="checklist-meta">
              {p.stream_count} canales/películas · {p.series_count} series
            </span>
          </label>
        ))}
        {filtered.length === 0 && <div className="muted text-sm">Sin resultados.</div>}
      </div>
    </div>
  );
}
