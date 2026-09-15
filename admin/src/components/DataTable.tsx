import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Inbox } from 'lucide-react';
import { formatNumber } from '../utils/format';
import { EmptyState, ErrorState, Spinner } from './ui';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  /** Si se indica, la cabecera permite ordenar por esta clave. */
  sortKey?: string;
  /** Oculta la columna en pantallas pequeñas. */
  hideOnMobile?: boolean;
}

export interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  /** Tamaños de página disponibles (por defecto 25, 50, 100 y 200). */
  limits?: number[];
}

interface DataTableProps<T, K extends string | number> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => K;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  selectable?: boolean;
  selected?: Set<K>;
  onSelectedChange?: (selected: Set<K>) => void;
  pagination?: PaginationProps;
  sort?: { key: string; order: 'asc' | 'desc' };
  onSortChange?: (key: string, order: 'asc' | 'desc') => void;
  rowClassName?: (row: T) => string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T, K extends string | number = number>({
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  onRetry,
  emptyTitle = 'No hay registros',
  emptyDescription,
  emptyAction,
  selectable = false,
  selected,
  onSelectedChange,
  pagination,
  sort,
  onSortChange,
  rowClassName,
  onRowClick,
}: DataTableProps<T, K>) {
  const selectedSet = selected ?? new Set<K>();
  const pageKeys = rows.map(rowKey);
  const allOnPage = pageKeys.length > 0 && pageKeys.every((k) => selectedSet.has(k));
  const someOnPage = pageKeys.some((k) => selectedSet.has(k));

  const togglePage = () => {
    if (!onSelectedChange) return;
    const next = new Set(selectedSet);
    if (allOnPage) pageKeys.forEach((k) => next.delete(k));
    else pageKeys.forEach((k) => next.add(k));
    onSelectedChange(next);
  };

  const toggleRow = (key: K) => {
    if (!onSelectedChange) return;
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedChange(next);
  };

  const colCount = columns.length + (selectable ? 1 : 0);
  const showInitialLoader = loading && rows.length === 0;

  return (
    <div className="table-card">
      {loading && rows.length > 0 && <div className="table-progress" />}
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {selectable && (
                <th className="col-check">
                  <input
                    type="checkbox"
                    className="checkbox"
                    aria-label="Seleccionar página"
                    checked={allOnPage}
                    ref={(el) => {
                      if (el) el.indeterminate = someOnPage && !allOnPage;
                    }}
                    onChange={togglePage}
                    disabled={rows.length === 0}
                  />
                </th>
              )}
              {columns.map((col) => {
                const sortable = Boolean(col.sortKey && onSortChange);
                const active = sortable && sort?.key === col.sortKey;
                return (
                  <th key={col.key} className={`${col.className ?? ''} ${col.hideOnMobile ? 'hide-mobile' : ''}`}>
                    {sortable ? (
                      <button
                        type="button"
                        className={`th-sort ${active ? 'is-active' : ''}`}
                        onClick={() =>
                          onSortChange?.(col.sortKey as string, active && sort?.order === 'asc' ? 'desc' : 'asc')
                        }
                      >
                        {col.header}
                        {active && (sort?.order === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={colCount}>
                  <ErrorState message={error} onRetry={onRetry} />
                </td>
              </tr>
            ) : showInitialLoader ? (
              <tr>
                <td colSpan={colCount}>
                  <div className="table-loader">
                    <Spinner size={24} label="Cargando…" />
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount}>
                  <EmptyState icon={<Inbox size={28} />} title={emptyTitle} description={emptyDescription} action={emptyAction} />
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const key = rowKey(row);
                const isSel = selectedSet.has(key);
                return (
                  <tr
                    key={key}
                    className={`${isSel ? 'is-selected' : ''} ${rowClassName?.(row) ?? ''} ${onRowClick ? 'is-clickable' : ''}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selectable && (
                      <td className="col-check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="checkbox"
                          aria-label="Seleccionar fila"
                          checked={isSel}
                          onChange={() => toggleRow(key)}
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className={`${col.className ?? ''} ${col.hideOnMobile ? 'hide-mobile' : ''}`}>
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {pagination && !error && <Pagination {...pagination} />}
    </div>
  );
}

const LIMITS = [25, 50, 100, 200];

export function Pagination({ page, limit, total, onPageChange, onLimitChange, limits }: PaginationProps) {
  const options = [...new Set([...(limits ?? LIMITS), limit])].sort((a, b) => a - b);
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="pagination">
      <div className="pagination-info">
        {formatNumber(from)}–{formatNumber(to)} de {formatNumber(total)}
      </div>
      <div className="pagination-controls">
        {onLimitChange && (
          <select
            className="input select input-sm"
            value={limit}
            aria-label="Filas por página"
            onChange={(e) => onLimitChange(Number(e.target.value))}
          >
            {options.map((l) => (
              <option key={l} value={l}>
                {l} / pág.
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={page <= 1} onClick={() => onPageChange(1)} title="Primera">
          <ChevronsLeft size={16} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} title="Anterior">
          <ChevronLeft size={16} />
        </button>
        <span className="pagination-page">
          Página {page} de {pages}
        </span>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)} title="Siguiente">
          <ChevronRight size={16} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={page >= pages} onClick={() => onPageChange(pages)} title="Última">
          <ChevronsRight size={16} />
        </button>
      </div>
    </div>
  );
}

/** Barra de acciones masivas que aparece cuando hay filas seleccionadas. */
export function BulkBar({ count, onClear, children, className = '' }: { count: number; onClear: () => void; children: ReactNode; className?: string }) {
  if (count === 0) return null;
  return (
    <div className={`bulk-bar ${className}`}>
      <span className="bulk-count">
        {formatNumber(count)} {count === 1 ? 'seleccionado' : 'seleccionados'}
      </span>
      <div className="bulk-actions">{children}</div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
        Limpiar selección
      </button>
    </div>
  );
}
