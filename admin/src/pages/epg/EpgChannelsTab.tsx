import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { DataTable } from '../../components/DataTable';
import { Badge, Select, Thumb } from '../../components/ui';
import type { EpgChannel, EpgSource } from '../../types';
import { formatNumber, truncate } from '../../utils/format';

export function EpgChannelsTab({ sources }: { sources: EpgSource[] }) {
  const [search, setSearch] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const debounced = useDebounce(search);

  useEffect(() => setPage(1), [debounced, sourceId, limit]);

  const list = useAsync(
    () => api.epg.channels({ search: debounced.trim(), source_id: sourceId ? Number(sourceId) : '', page, limit }),
    [debounced, sourceId, page, limit],
  );

  return (
    <>
      <div className="toolbar">
        <div className="input-icon toolbar-search">
          <Search size={16} />
          <input className="input" placeholder="Buscar por nombre o ID de la guía…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select
          value={sourceId}
          onChange={setSourceId}
          placeholder="Todas las guías"
          options={sources.map((s) => ({ value: String(s.id), label: s.name }))}
          ariaLabel="Guía"
        />
      </div>
      <DataTable<EpgChannel>
        rows={list.data?.data ?? []}
        rowKey={(c) => c.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        emptyTitle={debounced || sourceId ? 'Ningún canal coincide' : 'Aún no hay canales de guía'}
        emptyDescription={debounced || sourceId ? undefined : 'Agrega una fuente EPG y actualízala para ver aquí sus canales.'}
        pagination={{ page, limit, total: list.data?.total ?? 0, onPageChange: setPage, onLimitChange: setLimit }}
        columns={[
          { key: 'icon', header: '', className: 'col-thumb', render: (c) => <Thumb src={c.icon || null} alt={c.display_names[0] ?? c.xmltv_id} /> },
          {
            key: 'name',
            header: 'Canal',
            render: (c) => (
              <div className="cell-main">
                <span className="strong">{c.display_names[0] ?? '—'}</span>
                {c.display_names.length > 1 && (
                  <span className="muted text-xs" title={c.display_names.join(' · ')}>
                    {truncate(c.display_names.slice(1).join(' · '), 60)}
                  </span>
                )}
              </div>
            ),
          },
          { key: 'id', header: 'ID XMLTV', render: (c) => <span className="mono text-sm">{c.xmltv_id}</span> },
          { key: 'source', header: 'Guía', hideOnMobile: true, render: (c) => c.source_name },
          { key: 'country', header: 'País', hideOnMobile: true, render: (c) => (c.country ? c.country.toUpperCase() : <span className="muted">—</span>) },
          {
            key: 'used',
            header: 'En uso',
            render: (c) => (c.used_by > 0 ? <Badge tone="green">{formatNumber(c.used_by)} canal{c.used_by === 1 ? '' : 'es'}</Badge> : <span className="muted">—</span>),
          },
        ]}
      />
    </>
  );
}
