import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Ban,
  CalendarClock,
  CalendarPlus,
  CircleCheck,
  LogIn,
  Pencil,
  Play,
  Plus,
  ScanSearch,
  ScrollText,
  Trash2,
  Upload,
  UserRoundCheck,
} from 'lucide-react';
import { StatusBadge } from '../../components/StatusBadge';
import type { LogEntry, User } from '../../types';
import { formatDate, formatDateTime, logDetails, relativeExpiry, timeAgo } from '../../utils/format';
import { Panel } from './Panel';

// ---------- Próximos a vencer ----------

export function ExpiringPanel({ users, total, className = '' }: { users: User[]; total: number; className?: string }) {
  const rows = users.slice(0, 5);
  return (
    <Panel
      className={className}
      title="Próximos a vencer"
      icon={<CalendarClock size={18} />}
      tone="orange"
      subtitle={total > 0 ? `${total} en los próximos 7 días` : 'Nadie vence esta semana'}
      link="/clientes?status=expiring"
    >
      {rows.length === 0 ? (
        <div className="health-ok">
          <CircleCheck size={18} /> No hay clientes por vencer en los próximos días
        </div>
      ) : (
        <ul className="compact-list">
          {rows.map((u) => (
            <li key={u.id}>
              <Link to={`/clientes?search=${encodeURIComponent(u.username)}`} className="compact-row">
                <span className="compact-main">
                  <span className="compact-title">{u.username}</span>
                  {u.full_name && <span className="compact-sub">{u.full_name}</span>}
                </span>
                <StatusBadge status={u.status} />
                <span className="compact-side" title={formatDateTime(u.exp_date)}>
                  <span className="compact-date">{formatDate(u.exp_date)}</span>
                  <span className="compact-rel">{relativeExpiry(u.exp_date)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------- Actividad reciente ----------

const ENTITY_LABEL: Record<string, string> = {
  user: 'el cliente',
  users: 'clientes',
  admin: 'el usuario',
  stream: 'el contenido',
  streams: 'contenidos',
  package: 'el paquete',
  category: 'la categoría',
  series: 'la serie',
  episode: 'el episodio',
  message: 'el mensaje',
  notice: 'el aviso',
  outage: 'el corte',
  device: 'el dispositivo',
  settings: 'los ajustes',
  connection: 'la conexión',
  xtream: 'la migración',
};

type Verb = { text: string; icon: ReactNode; tone: string };

function verbFor(action: string): Verb {
  const a = action.toLowerCase();
  const last = a.split('.').pop() ?? a;
  if (a.includes('login')) return { text: 'inició sesión', icon: <LogIn size={14} />, tone: 'purple' };
  if (a.includes('password')) return { text: 'cambió su contraseña', icon: <Pencil size={14} />, tone: 'blue' };
  if (last.includes('create') || last === 'add') return { text: 'creó', icon: <Plus size={14} />, tone: 'green' };
  if (last.includes('delete') || last.includes('remove')) return { text: 'eliminó', icon: <Trash2 size={14} />, tone: 'red' };
  if (last.includes('suspend')) return { text: 'suspendió', icon: <Ban size={14} />, tone: 'red' };
  if (last.includes('reactivate')) return { text: 'reactivó', icon: <Play size={14} />, tone: 'green' };
  if (last.includes('extend')) return { text: 'extendió', icon: <CalendarPlus size={14} />, tone: 'green' };
  if (last.includes('assign')) return { text: 'asignó', icon: <UserRoundCheck size={14} />, tone: 'blue' };
  if (last.includes('resolve')) return { text: 'resolvió una alerta de', icon: <CircleCheck size={14} />, tone: 'green' };
  if (last.includes('check')) return { text: 'revisó', icon: <ScanSearch size={14} />, tone: 'blue' };
  if (last.includes('import') || a.includes('migrat')) return { text: 'importó', icon: <Upload size={14} />, tone: 'purple' };
  if (last.includes('bulk')) return { text: 'aplicó una acción masiva a', icon: <Activity size={14} />, tone: 'orange' };
  if (last.includes('kick')) return { text: 'expulsó', icon: <Ban size={14} />, tone: 'red' };
  if (last.includes('update') || last.includes('edit')) return { text: 'actualizó', icon: <Pencil size={14} />, tone: 'blue' };
  return { text: action, icon: <Activity size={14} />, tone: 'gray' };
}

function parseDetails(details: unknown): Record<string, unknown> {
  let value = details;
  if (typeof details === 'string') {
    try {
      value = JSON.parse(details);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function detailName(d: Record<string, unknown>): string | null {
  for (const k of ['name', 'username', 'title']) if (typeof d[k] === 'string' && d[k]) return d[k] as string;
  return null;
}

function describe(log: LogEntry): { who: string; text: string; verb: Verb } {
  const action = log.action ?? '';
  const verb = verbFor(action);
  const who = log.admin_username ?? 'Sistema';
  const d = parseDetails(log.details);
  if (/login|password/i.test(action)) return { who, text: verb.text, verb };

  // Casos con un texto más natural.
  if (action === 'stream.check') {
    const types = Array.isArray(d.types) ? (d.types as string[]) : [];
    const ids = Array.isArray(d.ids) ? (d.ids as unknown[]) : [];
    const what = ids.length
      ? `${ids.length} contenido${ids.length === 1 ? '' : 's'}`
      : types.length === 1
        ? types[0] === 'movie'
          ? 'las películas'
          : 'los canales'
        : 'las fuentes';
    return { who, text: `revisó ${what}`, verb };
  }
  if (action === 'stream.import_m3u') {
    const created = typeof d.created === 'number' ? d.created : null;
    return { who, text: created !== null ? `importó ${created} contenido${created === 1 ? '' : 's'} desde M3U` : 'importó una lista M3U', verb };
  }
  if (action === 'device.check') return { who, text: 'revisó la inactividad de los dispositivos', verb };
  if (action.startsWith('device.alert')) return { who, text: `resolvió una alerta del dispositivo${log.entity_id ? ` #${log.entity_id}` : ''}`, verb };

  let entity = log.entity ? ENTITY_LABEL[log.entity] ?? log.entity : '';
  if (log.entity === 'stream' && (d.type === 'live' || d.type === 'movie')) entity = d.type === 'movie' ? 'la película' : 'el canal';
  const name = detailName(d);
  const target = name ? `${entity} ${name}` : `${entity}${log.entity_id ? ` #${log.entity_id}` : ''}`;
  return { who, text: `${verb.text} ${target}`.trim(), verb };
}

export function ActivityPanel({ logs, isAdmin, className = '' }: { logs: LogEntry[]; isAdmin: boolean; className?: string }) {
  const rows = logs.slice(0, 6);
  return (
    <Panel
      className={className}
      title="Actividad reciente"
      icon={<ScrollText size={18} />}
      tone="gray"
      link={isAdmin ? '/registro' : undefined}
      linkLabel={
        <>
          Ver registro<span className="hide-mobile"> completo</span>
        </>
      }
    >
      {rows.length === 0 ? (
        <div className="health-ok muted">Sin actividad reciente</div>
      ) : (
        <ul className="activity-compact">
          {rows.map((log) => {
            const d = describe(log);
            const full = [`${d.who} ${d.text}`, logDetails(log.details), formatDateTime(log.created_at)].filter(Boolean).join('\n');
            return (
              <li key={log.id} className="activity-row" title={full}>
                <span className={`activity-icon stat-${d.verb.tone}`}>{d.verb.icon}</span>
                <span className="activity-text">
                  <strong>{d.who}</strong> {d.text}
                </span>
                <span className="activity-time">{timeAgo(log.created_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
