import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { Category } from '../../types';
import { Checkbox, ErrorState, Select, Spinner, Switch } from '../../components/ui';
import { formatNumber } from '../../utils/format';

export interface PickerItem {
  id: number;
  name: string;
  category_id: number | null;
  category_name?: string | null;
  enabled?: boolean;
}

interface Props {
  items: PickerItem[];
  categories: Category[];
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  noun: string;
}

interface Group {
  key: string;
  name: string;
  items: PickerItem[];
  totalInCategory: number;
}

const RENDER_LIMIT = 300;

/** Selector de contenido agrupado por categoría con búsqueda y selección masiva. */
export function ContentPicker({ items, categories, selected, onChange, loading, error, onRetry, noun }: Props) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());

  const term = search.trim().toLowerCase();
  const autoExpand = Boolean(term || category || onlySelected);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    const order = new Map<string, number>();
    categories.forEach((c, i) => {
      map.set(String(c.id), { key: String(c.id), name: c.name, items: [], totalInCategory: 0 });
      order.set(String(c.id), i);
    });
    for (const item of items) {
      const key = item.category_id === null || item.category_id === undefined ? 'none' : String(item.category_id);
      let g = map.get(key);
      if (!g) {
        g = { key, name: key === 'none' ? 'Sin categoría' : item.category_name || `Categoría #${key}`, items: [], totalInCategory: 0 };
        map.set(key, g);
      }
      g.totalInCategory++;
      if (category && key !== category) continue;
      if (term && !item.name.toLowerCase().includes(term)) continue;
      if (onlySelected && !selected.has(item.id)) continue;
      g.items.push(item);
    }
    return [...map.values()]
      .filter((g) => g.items.length > 0)
      .sort((a, b) => (order.get(a.key) ?? 1e9) - (order.get(b.key) ?? 1e9) || a.name.localeCompare(b.name));
  }, [items, categories, category, term, onlySelected, selected]);

  const visibleItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const selectedCount = useMemo(() => items.reduce((n, i) => n + (selected.has(i.id) ? 1 : 0), 0), [items, selected]);

  const setMany = (list: PickerItem[], value: boolean) => {
    const next = new Set(selected);
    for (const i of list) {
      if (value) next.add(i.id);
      else next.delete(i.id);
    }
    onChange(next);
  };

  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const toggleExpanded = (key: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  if (loading) {
    return (
      <div className="picker-loading">
        <Spinner label={`Cargando ${noun}…`} />
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((i) => selected.has(i.id));

  return (
    <div className="picker">
      <div className="picker-toolbar">
        <div className="input-icon toolbar-search">
          <Search size={16} />
          <input className="input" placeholder={`Buscar ${noun}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select
          value={category}
          onChange={setCategory}
          placeholder="Todas las categorías"
          options={[
            ...categories.map((c) => ({ value: String(c.id), label: c.name })),
            ...(items.some((i) => i.category_id === null) ? [{ value: 'none', label: 'Sin categoría' }] : []),
          ]}
          ariaLabel="Filtrar por categoría"
        />
        <Switch checked={onlySelected} onChange={setOnlySelected} label="Solo seleccionados" />
      </div>
      <div className="picker-summary">
        <span>
          <strong>{formatNumber(selectedCount)}</strong> de {formatNumber(items.length)} {noun} seleccionados
          {visibleItems.length !== items.length && <span className="muted"> · {formatNumber(visibleItems.length)} visibles</span>}
        </span>
        <div className="row">
          <button type="button" className="btn btn-link btn-sm" disabled={visibleItems.length === 0} onClick={() => setMany(visibleItems, !allVisibleSelected)}>
            {allVisibleSelected ? 'Quitar visibles' : 'Seleccionar visibles'}
          </button>
          {selectedCount > 0 && (
            <button type="button" className="btn btn-link btn-sm text-red" onClick={() => setMany(items, false)}>
              Quitar todo
            </button>
          )}
        </div>
      </div>

      <div className="picker-groups">
        {groups.length === 0 && <div className="muted text-sm picker-empty">No hay {noun} que coincidan.</div>}
        {groups.map((g) => {
          const selInGroup = g.items.filter((i) => selected.has(i.id)).length;
          const all = selInGroup === g.items.length;
          const isOpen = autoExpand || expanded.has(g.key);
          const limit = showAll.has(g.key) ? g.items.length : RENDER_LIMIT;
          return (
            <div key={g.key} className="picker-group">
              <div className="picker-group-header">
                <Checkbox checked={all} indeterminate={selInGroup > 0} onChange={(v) => setMany(g.items, v)} />
                <button type="button" className="picker-group-toggle" onClick={() => toggleExpanded(g.key)} disabled={autoExpand}>
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="strong">{g.name}</span>
                  <span className="muted text-sm">
                    {selInGroup}/{g.items.length}
                    {g.items.length !== g.totalInCategory && ` (de ${g.totalInCategory})`}
                  </span>
                </button>
              </div>
              {isOpen && (
                <div className="picker-items">
                  {g.items.slice(0, limit).map((i) => (
                    <label key={i.id} className={`picker-item ${selected.has(i.id) ? 'is-checked' : ''}`}>
                      <input type="checkbox" className="checkbox" checked={selected.has(i.id)} onChange={() => toggleOne(i.id)} />
                      <span className={i.enabled === false ? 'muted' : ''}>{i.name}</span>
                      {i.enabled === false && <span className="muted text-xs">(deshabilitado)</span>}
                    </label>
                  ))}
                  {g.items.length > limit && (
                    <button
                      type="button"
                      className="btn btn-link btn-sm"
                      onClick={() => setShowAll((s) => new Set(s).add(g.key))}
                    >
                      Mostrar los {formatNumber(g.items.length - limit)} restantes
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
