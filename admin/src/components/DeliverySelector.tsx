import type { ReactElement } from 'react';
import { ArrowDown, ArrowUp, Cpu, Radio, Settings2, Zap } from 'lucide-react';
import type { DeliveryMode, DeliveryValue, StreamingServer, TranscodeProfile } from '../types';
import { formatNumber } from '../utils/format';
import { DELIVERY_MODE, SERVER_STATUS, TRANSCODE_HW } from '../utils/labels';
import { Alert, FormField, Select, Switch } from './ui';

const MODE_INFO: Record<DeliveryMode, { icon: ReactElement; description: string }> = {
  default: {
    icon: <Settings2 size={18} />,
    description: 'Usa el modo general configurado en Ajustes (redirección, proxy o XtreamUI de origen).',
  },
  direct: {
    icon: <Zap size={18} />,
    description: 'El cliente se conecta directo a la fuente; no consume ancho de banda del servidor. Las conexiones solo se estiman.',
  },
  restream: {
    icon: <Radio size={18} />,
    description: 'Un servidor toma la señal una sola vez y la reparte a todos los clientes; ideal para Astra; conexiones exactas.',
  },
  transcode: {
    icon: <Cpu size={18} />,
    description: 'El servidor convierte resolución/bitrate con un perfil; consume CPU o GPU.',
  },
};

export function emptyDelivery(mode: DeliveryMode = 'default'): DeliveryValue {
  return { delivery_mode: mode, transcode_profile_id: null, server_ids: [], always_on: false };
}

/** Devuelve un mensaje de error si la selección no es válida. */
export function validateDelivery(v: DeliveryValue): string | null {
  if (v.delivery_mode === 'transcode' && !v.transcode_profile_id) return 'Elige un perfil de transcodificación';
  return null;
}

export function DeliveryBadge({
  mode,
  profileName,
  servers,
}: {
  mode: DeliveryMode | null | undefined;
  profileName?: string | null;
  servers?: { id: number; name: string }[];
}) {
  const m = mode ?? 'default';
  const meta = DELIVERY_MODE[m];
  const icon = m === 'direct' ? <Zap size={12} /> : m === 'restream' ? <Radio size={12} /> : m === 'transcode' ? <Cpu size={12} /> : <Settings2 size={12} />;
  const title =
    m === 'restream' || m === 'transcode'
      ? servers && servers.length
        ? `Servidores: ${servers.map((s) => s.name).join(' → ')}`
        : 'Cualquier servidor disponible'
      : meta.label;
  return (
    <span className={`badge badge-${meta.tone} delivery-badge`} title={title}>
      {icon}
      {meta.short}
      {m === 'transcode' && profileName ? ` · ${profileName}` : ''}
    </span>
  );
}

interface Props {
  value: DeliveryValue;
  onChange: (v: DeliveryValue) => void;
  servers: StreamingServer[];
  profiles: TranscodeProfile[];
  allowDefault?: boolean;
  error?: string | null;
  /** Diseño compacto (tarjetas en 2 columnas). */
  compact?: boolean;
}

/** Selector reutilizable del modo de entrega de un canal. */
export function DeliverySelector({ value, onChange, servers, profiles, allowDefault = true, error, compact = false }: Props) {
  const modes = (Object.keys(DELIVERY_MODE) as DeliveryMode[]).filter((m) => allowDefault || m !== 'default');
  const set = (patch: Partial<DeliveryValue>) => onChange({ ...value, ...patch });
  const usesServer = value.delivery_mode === 'restream' || value.delivery_mode === 'transcode';
  const serverById = new Map(servers.map((s) => [s.id, s]));
  const selected = value.server_ids.filter((id) => serverById.has(id));
  const unselected = servers.filter((s) => !selected.includes(s.id));
  const profile = profiles.find((p) => p.id === value.transcode_profile_id) ?? null;
  const onlineEncoders = new Set(servers.filter((s) => s.status === 'online').flatMap((s) => s.hardware?.encoders ?? []));
  const profileUnsupported = profile && !TRANSCODE_HW[profile.hw].encoders.some((e) => onlineEncoders.has(e));

  const move = (index: number, dir: -1 | 1) => {
    const next = [...selected];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set({ server_ids: next });
  };

  return (
    <div className="delivery">
      <div className={`delivery-modes ${compact ? 'is-compact' : ''}`} role="radiogroup">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value.delivery_mode === m}
            className={`delivery-card delivery-${DELIVERY_MODE[m].tone} ${value.delivery_mode === m ? 'is-active' : ''}`}
            onClick={() => set({ delivery_mode: m })}
          >
            <span className="delivery-card-head">
              <span className="delivery-icon">{MODE_INFO[m].icon}</span>
              <span className="delivery-title">{m === 'default' ? 'Predeterminado (según Ajustes)' : DELIVERY_MODE[m].label}</span>
            </span>
            <span className="delivery-desc">{MODE_INFO[m].description}</span>
          </button>
        ))}
      </div>

      {usesServer && (
        <div className="delivery-options">
          <FormField label="Servidores" hint="Sin selección = cualquier servidor disponible. El primero tiene prioridad.">
            {servers.length === 0 ? (
              <Alert tone="amber">
                No hay servidores de streaming.{' '}
                <a href={`${import.meta.env.BASE_URL}servidores`} target="_blank" rel="noreferrer" className="link">
                  Agrega uno
                </a>{' '}
                para usar este modo.
              </Alert>
            ) : (
              <div className="server-picker">
                {selected.map((id, i) => {
                  const s = serverById.get(id) as StreamingServer;
                  return (
                    <div key={id} className="server-pick is-selected">
                      <span className="server-order">{i + 1}</span>
                      <ServerLine server={s} />
                      <span className="row-actions">
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Subir prioridad" disabled={i === 0} onClick={() => move(i, -1)}>
                          <ArrowUp size={14} />
                        </button>
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Bajar prioridad" disabled={i === selected.length - 1} onClick={() => move(i, 1)}>
                          <ArrowDown size={14} />
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ server_ids: selected.filter((x) => x !== id) })}>
                          Quitar
                        </button>
                      </span>
                    </div>
                  );
                })}
                {unselected.map((s) => (
                  <button key={s.id} type="button" className="server-pick" onClick={() => set({ server_ids: [...selected, s.id] })}>
                    <span className="server-order is-empty">+</span>
                    <ServerLine server={s} />
                  </button>
                ))}
              </div>
            )}
          </FormField>

          <FormField
            label="Perfil de transcodificación"
            required={value.delivery_mode === 'transcode'}
            error={error}
            hint={
              <>
                {value.delivery_mode === 'restream' ? 'No se usa en Reenvío. ' : ''}
                <a href={`${import.meta.env.BASE_URL}perfiles`} target="_blank" rel="noreferrer" className="link">
                  Crear o editar perfiles (nueva pestaña)
                </a>
              </>
            }
          >
            <Select
              value={value.transcode_profile_id === null ? '' : String(value.transcode_profile_id)}
              onChange={(v) => set({ transcode_profile_id: v ? Number(v) : null })}
              placeholder={value.delivery_mode === 'transcode' ? 'Selecciona un perfil…' : 'Sin perfil'}
              disabled={value.delivery_mode !== 'transcode'}
              options={profiles.map((p) => ({ value: String(p.id), label: `${p.name} (${TRANSCODE_HW[p.hw].label})` }))}
            />
          </FormField>
          {value.delivery_mode === 'transcode' && profileUnsupported && (
            <Alert tone="amber">
              Ningún servidor en línea reporta el encoder para <strong>{TRANSCODE_HW[profile.hw].label}</strong>. El canal no podrá transcodificarse hasta que haya uno.
            </Alert>
          )}
          <Switch
            checked={value.always_on}
            onChange={(v) => set({ always_on: v })}
            label="Siempre encendido"
            description="Arranca sin esperar al primer cliente; más rápido pero consume recursos."
          />
        </div>
      )}
    </div>
  );
}

function ServerLine({ server }: { server: StreamingServer }) {
  const st = SERVER_STATUS[server.status] ?? SERVER_STATUS.offline;
  const cpu = server.metrics?.cpu;
  return (
    <span className="server-line">
      <span className={`status-dot dot-${st.tone}`} title={st.label} />
      <span className="server-line-name">{server.name}</span>
      <span className="server-line-meta">
        {st.label}
        {server.status === 'online' && (
          <>
            {' · '}
            {formatNumber(server.clients)}
            {server.max_clients ? `/${formatNumber(server.max_clients)}` : ''} clientes
            {cpu !== null && cpu !== undefined ? ` · CPU ${Math.round(cpu)}%` : ''}
          </>
        )}
      </span>
    </span>
  );
}
