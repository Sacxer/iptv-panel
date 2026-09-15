import { useMemo, useRef, useState } from 'react';
import { Pause, Play, RefreshCw, Search, Unplug } from 'lucide-react';
import { api, asList, errorMessage } from '../api';
import { useAsync } from '../hooks/useAsync';
import { useInterval } from '../hooks/useInterval';
import { DataTable } from '../components/DataTable';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { Alert, PageHeader } from '../components/ui';
import { TrackingBadge } from './streams/StreamConnectionsDrawer';
import { Info } from 'lucide-react';
import type { Connection } from '../types';
import { formatDateTime, formatElapsed, formatNumber, nowUnix, truncate } from '../utils/format';

const REFRESH_SECONDS = 10;

export function ConnectionsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [paused, setPaused] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [filter, setFilter] = useState('');
  const countdownRef = useRef(REFRESH_SECONDS);
  const list = useAsync(async () => asList(await api.connections.list()), []);
  const settings = useAsync(async () => api.settings.get().catch(() => null), []);
  const timeout = settings.data?.connection_timeout_seconds;

  const resetCountdown = () => {
    countdownRef.current = REFRESH_SECONDS;
    setCountdown(REFRESH_SECONDS);
  };

  // Cada segundo: actualiza la cuenta atrás (y los tiempos transcurridos); cada 10 s recarga.
  useInterval(
    () => {
      countdownRef.current -= 1;
      if (countdownRef.current <= 0) {
        countdownRef.current = REFRESH_SECONDS;
        void list.reload(true);
      }
      setCountdown(countdownRef.current);
    },
    paused ? null : 1000,
  );

  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const data = list.data ?? [];
    const filtered = term
      ? data.filter(
          (c) =>
            c.username?.toLowerCase().includes(term) ||
            c.ip?.toLowerCase().includes(term) ||
            (c.stream_name ?? '').toLowerCase().includes(term),
        )
      : data;
    return [...filtered].sort((a, b) => b.started_at - a.started_at);
  }, [list.data, filter]);

  const uniqueUsers = useMemo(() => new Set((list.data ?? []).map((c) => c.user_id)).size, [list.data]);

  const kick = async (c: Connection) => {
    const ok = await confirm({
      title: 'Expulsar conexión',
      message: (
        <>
          Se cortará la reproducción de <strong>{c.username}</strong> ({c.ip}). ¿Continuar?
        </>
      ),
      confirmText: 'Expulsar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.connections.kick(c.id);
      toast.success('Conexión expulsada');
      list.setData((prev) => prev?.filter((x) => x.id !== c.id) ?? prev);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Conexiones activas"
        subtitle={`${formatNumber(list.data?.length ?? 0)} conexiones de ${formatNumber(uniqueUsers)} clientes`}
        actions={
          <>
            <span className="muted text-sm refresh-indicator">
              {paused ? 'Actualización en pausa' : `Actualiza en ${countdown} s`}
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => setPaused((p) => !p)} title={paused ? 'Reanudar' : 'Pausar'}>
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                resetCountdown();
                void list.reload(true);
              }}
            >
              <RefreshCw size={16} className={list.loading ? 'spin' : ''} /> Actualizar
            </button>
          </>
        }
      />
      <Alert tone="blue" icon={<Info size={18} />} title="Conexiones exactas y estimadas">
        <span className="text-sm">
          <strong>Exacta</strong>: el video pasa por el portal o por un servidor de streaming, así que la conexión se mantiene hasta que el
          cliente cierra. <strong>Estimada</strong>: el reproductor va directo a la fuente y no se puede saber cuándo cierra; se muestra
          durante {timeout ?? 60} s tras abrir el canal. Para que sean exactas, usa en los canales el modo <strong>Reenvío</strong> o{' '}
          <strong>Transcodificar</strong>, o el modo <strong>Proxy</strong> en Ajustes. La app propia informa la reproducción
          automáticamente, así que sus conexiones siempre son exactas.
        </span>
      </Alert>
      <div className="toolbar">
        <div className="input-icon toolbar-search">
          <Search size={16} />
          <input className="input" placeholder="Filtrar por cliente, IP o contenido…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      <DataTable<Connection>
        rows={rows}
        rowKey={(c) => c.id}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        emptyTitle={filter ? 'Ninguna conexión coincide' : 'No hay conexiones activas'}
        columns={[
          { key: 'user', header: 'Cliente', render: (c) => <span className="strong">{c.username}</span> },
          { key: 'stream', header: 'Contenido', render: (c) => c.stream_name ?? <span className="muted">#{c.stream_id ?? '—'}</span> },
          { key: 'ip', header: 'IP', render: (c) => <span className="mono text-sm">{c.ip}</span> },
          {
            key: 'server',
            header: 'Servidor',
            hideOnMobile: true,
            render: (c) => (c.server_name ? <span className="text-sm">{c.server_name}</span> : <span className="muted text-sm">{c.mode === 'app' ? 'App' : c.mode === 'proxy' ? 'Portal (proxy)' : 'Directo'}</span>),
          },
          { key: 'tracking', header: 'Seguimiento', render: (c) => <TrackingBadge tracking={c.tracking} timeout={timeout} /> },
          { key: 'ua', header: 'Dispositivo', hideOnMobile: true, render: (c) => <span className="muted text-sm" title={c.user_agent}>{truncate(c.user_agent, 42) || '—'}</span> },
          {
            key: 'started',
            header: 'Inicio',
            render: (c) => (
              <div className="cell-main">
                <span>{formatDateTime(c.started_at)}</span>
                <span className="muted text-xs">hace {formatElapsed(c.started_at)}</span>
              </div>
            ),
          },
          {
            key: 'seen',
            header: 'Última actividad',
            hideOnMobile: true,
            render: (c) => <span className={nowUnix() - c.last_seen_at > 60 ? 'text-amber' : 'muted'}>hace {formatElapsed(c.last_seen_at)}</span>,
          },
          {
            key: 'actions',
            header: '',
            className: 'col-actions',
            render: (c) => (
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => void kick(c)}>
                <Unplug size={14} /> Expulsar
              </button>
            ),
          },
        ]}
      />
    </>
  );
}
