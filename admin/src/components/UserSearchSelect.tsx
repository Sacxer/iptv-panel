import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../api';
import { useDebounce } from '../hooks/useDebounce';
import type { User } from '../types';
import { StatusBadge } from './StatusBadge';
import { Spinner } from './ui';

interface Props {
  userId: number | null;
  /** Etiqueta a mostrar para un cliente ya seleccionado (p. ej. target_label). */
  label?: string;
  onChange: (user: { id: number; username: string } | null) => void;
  invalid?: boolean;
}

/** Buscador de clientes por nombre de usuario con lista de sugerencias. */
export function UserSearchSelect({ userId, label, onChange, invalid }: Props) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = debounced.trim();
    if (!term || userId !== null) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.users
      .list({ search: term, page: 1, limit: 10, sort: 'username', order: 'asc' })
      .then((res) => {
        if (!cancelled) setResults(res?.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo buscar clientes');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, userId]);

  if (userId !== null) {
    return (
      <div className="selected-pill">
        <span>
          <span className="strong">{label || `Cliente #${userId}`}</span>
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
          <X size={14} /> Cambiar
        </button>
      </div>
    );
  }

  return (
    <div className="user-search">
      <div className="input-icon">
        <Search size={16} />
        <input
          className={`input ${invalid ? 'is-invalid' : ''}`}
          placeholder="Escribe el usuario o nombre del cliente…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {(loading || error || results.length > 0 || (debounced.trim() && !loading)) && (
        <div className="user-search-results">
          {loading && (
            <div className="user-search-empty">
              <Spinner size={14} label="Buscando…" />
            </div>
          )}
          {error && <div className="user-search-empty text-red">{error}</div>}
          {!loading && !error && results.length === 0 && debounced.trim() && (
            <div className="user-search-empty muted">Sin resultados</div>
          )}
          {!loading &&
            results.map((u) => (
              <button
                key={u.id}
                type="button"
                className="user-search-item"
                onClick={() => {
                  onChange({ id: u.id, username: u.username });
                  setQuery('');
                }}
              >
                <span className="cell-main">
                  <span className="strong">{u.username}</span>
                  {u.full_name && <span className="muted text-xs">{u.full_name}</span>}
                </span>
                <StatusBadge status={u.status} />
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
