import { Link } from 'react-router-dom';
import { ChevronRight, House, Link as LinkIcon, Plug, TriangleAlert } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useInterval } from '../../hooks/useInterval';
import { usePageVisible } from '../../hooks/usePageVisible';
import { Badge, CopyButton } from '../../components/ui';
import { Skeleton } from '../../components/charts';
import { isLocalUrl } from '../settings/NetworkPanel';
import type { PortListener } from '../../types';

const DOT: Record<string, string> = { listening: 'green', waiting: 'amber', error: 'red' };

function chipTitle(l: PortListener): string {
  const role = l.role === 'panel' ? 'Panel y API' : 'Clientes';
  if (l.status === 'listening') return `${role}: abierto`;
  if (l.status === 'waiting') return `${role}: ocupado por otro programa, se abrirá solo cuando se libere`;
  return `${role}: ${l.error ?? 'error'}`;
}

/** Resumen del propio portal arriba de la lista de servidores de streaming. */
export function MainServerCard() {
  const visible = usePageVisible();
  const ports = useAsync(() => api.system.ports(), []);
  useInterval(() => void ports.reload(true), visible ? 10000 : null);
  const info = ports.data;

  // Con la separación de puertos activa, el puerto del panel no atiende a los clientes.
  const listeners = info
    ? info.listeners
        .filter((l) => !(info.separation_active && l.role === 'panel'))
        .sort((a, b) => (a.role === b.role ? a.port - b.port : a.role === 'panel' ? -1 : 1))
    : [];
  const waiting = listeners.filter((l) => l.status === 'waiting').map((l) => l.port);
  const failed = listeners.filter((l) => l.status !== 'waiting' && l.status !== 'listening').map((l) => l.port);
  const url = info?.public_url ?? '';
  const urlProblem = info ? (!url.trim() ? 'empty' : isLocalUrl(url) ? 'local' : null) : null;
  const needsReview = Boolean(urlProblem || waiting.length || failed.length);

  return (
    <article className="server-card main-server-card">
      <header className="server-card-head">
        <span className="main-server-icon">
          <House size={20} />
        </span>
        <div className="grow cell-main">
          <Link to="/servidores/principal" className="server-card-name">
            Servidor principal (este portal)
          </Link>
          <span className="muted text-xs">Panel, API y conexiones de los clientes</span>
        </div>
        {info &&
          (needsReview ? (
            <Badge tone="amber" dot>
              Revisar
            </Badge>
          ) : (
            <Badge tone="green" dot>
              En línea
            </Badge>
          ))}
      </header>

      {!info ? (
        ports.error ? (
          <p className="text-red text-sm no-margin">
            <TriangleAlert size={14} /> No se pudo leer el estado del portal: {ports.error}
          </p>
        ) : (
          <div className="main-server-grid">
            <Skeleton width="100%" height={44} radius={10} />
            <Skeleton width="100%" height={44} radius={10} />
          </div>
        )
      ) : (
        <div className="main-server-grid">
          <div className="main-server-field">
            <span className="scs-label">
              <LinkIcon size={12} /> URL para clientes
            </span>
            <span className="row-inline main-server-url">
              {url ? <span className="mono ellipsis">{url}</span> : <span className="muted">Sin configurar (se detecta sola)</span>}
              {url && <CopyButton text={url} />}
            </span>
            {urlProblem && (
              <span title={urlProblem === 'local' ? 'La URL apunta al propio equipo (127.0.0.1 / localhost)' : 'Los enlaces M3U y las apps podrían recibir una dirección local'}>
                <Badge tone="amber">{urlProblem === 'local' ? 'Solo funciona dentro del servidor' : 'Elige la IP para los clientes'}</Badge>
              </span>
            )}
          </div>
          <div className="main-server-field">
            <span className="scs-label">
              <Plug size={12} /> Puertos para clientes
            </span>
            <span className="port-chips">
              {listeners.map((l) => (
                <span key={`${l.role}-${l.port}`} className={`port-chip is-${DOT[l.status] ?? 'red'}`} title={chipTitle(l)}>
                  <span className={`status-dot dot-${DOT[l.status] ?? 'red'}`} />
                  <span className="mono">{l.port}</span>
                  {l.role === 'panel' && <span className="muted">panel</span>}
                </span>
              ))}
            </span>
            {waiting.length > 0 && (
              <span title="Otro programa lo está usando; el portal lo abrirá solo cuando se libere">
                <Badge tone="amber">
                  {waiting.length === 1 ? `Puerto ${waiting[0]} ocupado` : `Puertos ${waiting.join(', ')} ocupados`} por otro programa
                </Badge>
              </span>
            )}
            {failed.length > 0 && <Badge tone="red">Error en {failed.length === 1 ? `el puerto ${failed[0]}` : `los puertos ${failed.join(', ')}`}</Badge>}
          </div>
        </div>
      )}

      <footer className="server-card-actions">
        <span className="muted text-xs">Se actualiza cada 10 s</span>
        <Link to="/servidores/principal" className="btn btn-secondary btn-sm">
          Configurar IP y puertos <ChevronRight size={14} />
        </Link>
      </footer>
    </article>
  );
}
