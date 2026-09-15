import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Unplug } from 'lucide-react';
import { api, asList, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useInterval } from '../../hooks/useInterval';
import { usePageVisible } from '../../hooks/usePageVisible';
import { Drawer } from '../../components/Drawer';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Badge, EmptyState, ErrorState, Spinner } from '../../components/ui';
import type { Stream, StreamConnection } from '../../types';
import { formatDateTime, formatNumber, timeAgo, truncate } from '../../utils/format';

const MODE_LABEL: Record<string, string> = {
  redirect: 'Redirección',
  xtream_upstream: 'XtreamUI de origen',
  proxy: 'Proxy',
  node: 'Servidor',
  app: 'App',
};

export function TrackingBadge({ tracking, timeout }: { tracking: string | undefined; timeout?: number }) {
  if (tracking === 'exact') {
    return (
      <Badge tone="green" dot>
        Exacta
      </Badge>
    );
  }
  return (
    <span
      className="badge badge-gray"
      title={`El video va directo a la fuente: no se puede saber cuándo cierra; se muestra durante ${timeout ?? 60} s tras abrir el canal.`}
    >
      Estimada
    </span>
  );
}

function shortAgent(ua: string): string {
  if (!ua) return '—';
  const m = ua.match(/(VLC|TiviMate|IPTV Smarters|XCIPTV|Kodi|ExoPlayer|AppleCoreMedia|okhttp|Lavf|Dalvik|curl|TestPlayer|Chrome|Firefox|Safari)[^\s;)]*/i);
  return truncate(m ? m[0] : ua, 32);
}

export function StreamConnectionsDrawer({ stream, onClose, onChanged }: { stream: Stream | null; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const visible = usePageVisible();
  const [kicking, setKicking] = useState<number | null>(null);
  const settings = useAsync(async () => api.settings.get().catch(() => null), []);
  const list = useAsync(async () => (stream ? asList(await api.streams.connections(stream.id)) : []), [stream?.id]);
  useInterval(() => void list.reload(true), stream && visible ? 3000 : null);

  useEffect(() => {
    if (!stream) list.setData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  const kick = async (c: StreamConnection) => {
    const ok = await confirm({
      title: 'Expulsar conexión',
      message: (
        <>
          Se cortará la reproducción de <strong>{c.username}</strong> ({c.ip}).
          {c.tracking === 'estimated' && ' Como la conexión es estimada, el video puede seguir si el reproductor ya estaba conectado a la fuente.'}
        </>
      ),
      confirmText: 'Expulsar',
      danger: true,
    });
    if (!ok) return;
    setKicking(c.id);
    try {
      await api.connections.kick(c.id);
      toast.success('Conexión expulsada');
      list.setData((prev) => prev?.filter((x) => x.id !== c.id) ?? prev);
      onChanged?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setKicking(null);
    }
  };

  const rows = list.data ?? [];
  const timeout = settings.data?.connection_timeout_seconds;

  return (
    <Drawer
      open={stream !== null}
      onClose={onClose}
      width={760}
      title={
        <span className="row-inline">
          <Radio size={18} className="text-green" /> Conexiones en vivo · {stream?.name}
        </span>
      }
      subtitle={
        <span className="check-status">
          <span className={`live-dot ${visible ? 'is-live' : ''}`} />
          {formatNumber(rows.length)} viendo ahora · se actualiza cada 3 s
        </span>
      }
    >
      {list.loading && !list.data ? (
        <Spinner label="Cargando…" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.reload()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Unplug size={28} />} title="Nadie está viendo este canal ahora" description="Las conexiones aparecen aquí en cuanto un cliente abre el canal." />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>IP</th>
                <th className="hide-mobile">Dispositivo</th>
                <th className="hide-mobile">Servidor</th>
                <th>Inicio</th>
                <th>Seguimiento</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="cell-main">
                      <Link to={`/clientes?search=${encodeURIComponent(c.username)}`} className="link strong" onClick={onClose}>
                        {c.username}
                      </Link>
                      {c.full_name && <span className="muted text-xs">{c.full_name}</span>}
                    </div>
                  </td>
                  <td className="mono text-sm">{c.ip}</td>
                  <td className="hide-mobile text-sm" title={c.user_agent}>
                    {shortAgent(c.user_agent)}
                  </td>
                  <td className="hide-mobile text-sm">
                    {c.server_name ?? <span className="muted">{MODE_LABEL[c.mode] ?? c.mode}</span>}
                  </td>
                  <td>
                    <span className="nowrap" title={formatDateTime(c.started_at)}>
                      {timeAgo(c.started_at)}
                    </span>
                  </td>
                  <td>
                    <TrackingBadge tracking={c.tracking} timeout={timeout} />
                  </td>
                  <td className="col-actions">
                    <button type="button" className="btn btn-danger-ghost btn-sm" disabled={kicking === c.id} onClick={() => void kick(c)}>
                      {kicking === c.id ? <Spinner size={12} /> : <Unplug size={14} />} <span className="hide-mobile">Expulsar</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}
