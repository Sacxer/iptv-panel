import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { Modal } from '../../components/Modal';
import { ErrorState, Spinner, Thumb } from '../../components/ui';
import type { EpgChannel } from '../../types';
import { formatNumber } from '../../utils/format';

/** Tamaño legible (B, KB, MB). */
export function formatSize(bytes: number | null | undefined): string {
  const b = Number(bytes ?? 0);
  if (b < 1024) return `${formatNumber(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toLocaleString('es-CO', { maximumFractionDigits: 1 })} KB`;
  return `${(b / 1024 / 1024).toLocaleString('es-CO', { maximumFractionDigits: 1 })} MB`;
}

/** Barra de puntuación: verde si alcanza el mínimo, ámbar entre 60 y el mínimo, gris por debajo. */
export function ScoreBar({ score, min }: { score: number; min: number }) {
  const tone = score >= min ? 'green' : score >= 60 ? 'amber' : 'gray';
  const label = score >= min ? 'se asigna automáticamente' : score >= 60 ? 'sugerencia' : 'poco parecido';
  return (
    <span className={`score score-${tone}`} title={`Puntuación ${score} de 100 (${label}; mínimo ${min})`}>
      <span className="score-track">
        <span className="score-fill" style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
      </span>
      <span className="score-value">{score}</span>
    </span>
  );
}

/** Buscador de canales de las guías para asignar un ID EPG a mano. */
export function EpgSearchModal({
  open,
  title = 'Buscar en la guía',
  initialSearch = '',
  confirmLabel = 'Usar',
  onClose,
  onPick,
}: {
  open: boolean;
  title?: string;
  initialSearch?: string;
  confirmLabel?: string;
  onClose: () => void;
  onPick: (channel: EpgChannel) => void;
}) {
  const [search, setSearch] = useState(initialSearch);
  const debounced = useDebounce(search, 300);

  useEffect(() => {
    if (open) setSearch(initialSearch);
  }, [open, initialSearch]);

  const results = useAsync(
    async () => (open && debounced.trim() ? api.epg.channels({ search: debounced.trim(), limit: 40 }) : null),
    [open, debounced],
  );
  const rows = results.data?.data ?? [];

  return (
    <Modal open={open} title={title} onClose={onClose} size="lg">
      <div className="stack">
        <div className="input-icon">
          <Search size={16} />
          <input
            className="input"
            autoFocus
            placeholder="Nombre del canal o ID de la guía (p. ej. Caracol, ESPN)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
          />
        </div>
        {!debounced.trim() ? (
          <p className="muted text-sm no-margin">Escribe para buscar entre los canales de las guías cargadas.</p>
        ) : results.loading && !results.data ? (
          <Spinner label="Buscando…" />
        ) : results.error ? (
          <ErrorState message={results.error} onRetry={() => void results.reload()} />
        ) : rows.length === 0 ? (
          <p className="muted text-sm no-margin">Ningún canal de las guías coincide con «{debounced.trim()}».</p>
        ) : (
          <>
            <ul className="epg-pick-list">
              {rows.map((c) => (
                <li key={c.id}>
                  <Thumb src={c.icon || null} alt={c.display_names[0] ?? c.xmltv_id} />
                  <div className="epg-pick-main">
                    <span className="strong">{c.display_names[0] ?? c.xmltv_id}</span>
                    <span className="mono text-xs">{c.xmltv_id}</span>
                    <span className="muted text-xs">
                      {c.source_name}
                      {c.country ? ` · ${c.country.toUpperCase()}` : ''}
                      {c.display_names.length > 1 ? ` · también «${c.display_names.slice(1, 3).join('», «')}»` : ''}
                    </span>
                  </div>
                  <span className={`text-xs nowrap ${c.used_by > 0 ? 'text-amber' : 'muted'}`} title="Canales del portal que ya usan este ID">
                    {c.used_by > 0 ? `En uso por ${formatNumber(c.used_by)}` : 'Sin usar'}
                  </span>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onPick(c)}>
                    {confirmLabel}
                  </button>
                </li>
              ))}
            </ul>
            {(results.data?.total ?? 0) > rows.length && (
              <p className="muted text-xs no-margin">
                Mostrando {formatNumber(rows.length)} de {formatNumber(results.data?.total ?? 0)}. Afina la búsqueda para ver otros.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
