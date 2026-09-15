import { useState, type ReactNode } from 'react';
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  EthernetPort,
  Globe,
  Link as LinkIcon,
  Pencil,
  Radar,
  RefreshCw,
  Repeat,
  Save,
  Shield,
  Star,
  TriangleAlert,
  Wifi,
} from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { DataTable } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Alert, Badge, CopyButton, ErrorState, FormField, PageLoader, Spinner } from '../../components/ui';
import type { ListeningPort, NetworkAddress, NetworkPort, PublicIpInfo } from '../../types';
import { formatNumber, isValidUrl } from '../../utils/format';
import type { Tone } from '../../utils/labels';

const SCOPE: Record<string, { label: string; tone: Tone }> = {
  public: { label: 'Pública', tone: 'green' },
  private: { label: 'Privada', tone: 'blue' },
  cgnat: { label: 'CGNAT', tone: 'amber' },
  'link-local': { label: 'Link-local', tone: 'gray' },
  loopback: { label: 'Loopback', tone: 'gray' },
};

const TYPE_ICON: Record<string, ReactNode> = {
  ethernet: <EthernetPort size={18} />,
  wifi: <Wifi size={18} />,
  vpn: <Shield size={18} />,
  virtual: <Boxes size={18} />,
  loopback: <Repeat size={18} />,
};

const TYPE_TONE: Record<string, Tone> = { ethernet: 'blue', wifi: 'purple', vpn: 'teal', virtual: 'gray', loopback: 'gray' };

export function normUrl(u: string | null | undefined): string {
  return (u ?? '').trim().replace(/\/+$/, '').toLowerCase();
}

export function isLocalUrl(u: string | null | undefined): boolean {
  return /\/\/(localhost|127\.|\[::1\])/i.test(u ?? '');
}

function formatSpeed(mbps: number | null | undefined): string | null {
  if (!mbps) return null;
  if (mbps >= 1000) return `${(mbps / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} Gbps`;
  return `${formatNumber(mbps)} Mbps`;
}

/** URL para clientes a partir de una IP y un puerto (sin «:80»; IPv6 entre corchetes). */
export function buildClientUrl(ip: string, port: number): string {
  const host = ip.includes(':') ? `[${ip}]` : ip;
  return port === 80 ? `http://${host}` : `http://${host}:${port}`;
}

function usable(port: NetworkPort, a: NetworkAddress): boolean {
  return port.status === 'up' && a.scope !== 'loopback' && a.scope !== 'link-local';
}

function publicIpAddress(p: PublicIpInfo | string | null | undefined): PublicIpInfo | null {
  if (!p) return null;
  if (typeof p === 'string') return { address: p };
  return p;
}

export function NetworkPanel({ onPublicUrlSaved }: { onPublicUrlSaved: (url: string) => void }) {
  const toast = useToast();
  const net = useAsync(() => api.system.network(), []);
  const [publicIp, setPublicIp] = useState<PublicIpInfo | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [savingUrl, setSavingUrl] = useState<string | null>(null);
  const [chooser, setChooser] = useState<{ ip: string; iface: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  const d = net.data;

  const savePublicUrl = async (url: string) => {
    const clean = url.trim().replace(/\/+$/, '');
    setSavingUrl(clean);
    try {
      await api.settings.update({ public_url: clean });
      // Se muestra ya el valor guardado; el nuevo escaneo (tarda unos segundos) actualiza sugerencias y «En uso».
      net.setData((prev) => (prev ? { ...prev, current_public_url: clean, effective_base_url: clean || prev.effective_base_url } : prev));
      toast.success(clean ? `URL para clientes: ${clean}` : 'URL para clientes vacía: se usará la detectada automáticamente');
      onPublicUrlSaved(clean);
      setEditing(false);
      setChooser(null);
      await net.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSavingUrl(null);
    }
  };

  const detectPublicIp = async () => {
    setDetecting(true);
    try {
      const res = await api.system.network(true);
      net.setData(res);
      setPublicIp(publicIpAddress(res.public_ip) ?? { address: null, error: 'No se pudo detectar la IP de salida' });
    } catch (e) {
      setPublicIp({ address: null, error: errorMessage(e) });
    } finally {
      setDetecting(false);
    }
  };

  if (!d) return net.error ? <ErrorState message={net.error} onRetry={() => void net.reload()} /> : <PageLoader label="Analizando la red del servidor…" />;

  const current = d.current_public_url;
  const shownUrl = current || d.effective_base_url;
  const portalPorts = d.portal_ports ?? [];
  const suggestions = d.suggestions ?? [];
  // Las sugerencias con la IP de salida solo llegan con ?external=true: se conservan tras volver a escanear.
  const ipInfo = publicIp ?? publicIpAddress(d.public_ip);

  const startEdit = () => {
    setDraft(current || '');
    setDraftError(null);
    setEditing(true);
  };

  const submitDraft = () => {
    const v = draft.trim();
    if (v && !isValidUrl(v)) {
      setDraftError('URL no válida (ej.: http://192.168.1.20:25461 o http://tv.midominio.com)');
      return;
    }
    void savePublicUrl(v);
  };

  return (
    <div className="stack">
      <div className="net-toolbar">
        <p className="muted text-sm no-margin">Puertos de red del servidor, sus IPs y la dirección que usan los clientes.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void net.reload(true)} disabled={net.loading}>
          {net.loading ? <Spinner size={13} /> : <RefreshCw size={14} />} Volver a escanear
        </button>
      </div>

      {/* 1) URL para clientes */}
      <section className="card net-url-card">
        <h2 className="card-title">
          <LinkIcon size={18} /> URL para clientes
        </h2>
        <div className="net-url-current">
          <span className="net-url-value mono">{shownUrl || '—'}</span>
          {shownUrl && <CopyButton text={shownUrl} label="Copiar" />}
          {!current && <Badge tone="gray">Se usa automáticamente</Badge>}
          {!editing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={startEdit}>
              <Pencil size={14} /> Cambiar
            </button>
          )}
        </div>
        {isLocalUrl(shownUrl) && (
          <Alert tone="amber" icon={<TriangleAlert size={18} />}>
            Esta dirección solo funciona dentro del propio servidor. Elige abajo una IP de sus puertos de red.
          </Alert>
        )}
        <p className="muted text-sm no-margin">
          Es la dirección que usan IPTV Smarters, TiviMate y la app, y la que aparece en los enlaces M3U. Puede ser una IP privada si los clientes están
          en tu red (ZeroTier, LAN) o un dominio.
        </p>
        {editing && (
          <div className="net-url-edit">
            <FormField label="Nueva URL para clientes" error={draftError} hint="Déjala vacía para que se detecte automáticamente.">
              <div className="input-group">
                <input
                  className="input mono"
                  value={draft}
                  autoFocus
                  placeholder={suggestions[0]?.url ?? 'http://192.168.1.20:25461'}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setDraftError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitDraft();
                    }
                  }}
                />
              </div>
            </FormField>
            <div className="row row-end">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={savingUrl !== null}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={submitDraft} disabled={savingUrl !== null}>
                {savingUrl !== null ? <Spinner size={13} /> : <Save size={14} />} Guardar
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 2) Puertos de red (interfaces) */}
      <section className="card">
        <h2 className="card-title">
          <EthernetPort size={18} /> Puertos de red
        </h2>
        <NetworkPortsList ports={d.network_ports ?? []} current={current} disabled={savingUrl !== null} onUse={(ip, iface) => setChooser({ ip, iface })} />
      </section>

      {/* 3) Sugerencias */}
      <section className="card">
        <div className="section-header">
          <h2 className="card-title no-margin">
            <Radar size={18} /> Sugerencias
          </h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void detectPublicIp()} disabled={detecting}>
            {detecting ? <Spinner size={13} /> : <Globe size={14} />} Detectar IP de salida a internet
          </button>
        </div>
        {ipInfo && (
          <div className="net-public-ip">
            {ipInfo.address ? (
              <>
                <span>
                  IP de salida a internet: <strong className="mono">{ipInfo.address}</strong>
                </span>
                {ipInfo.scope && SCOPE[ipInfo.scope] && <Badge tone={SCOPE[ipInfo.scope].tone}>{SCOPE[ipInfo.scope].label}</Badge>}
                <CopyButton text={ipInfo.address} />
                <span className="muted text-xs net-public-note">Solo sirve si el router redirige el puerto a este servidor (NAT).</span>
              </>
            ) : (
              <span className="text-red text-sm">
                <CircleAlert size={14} /> {ipInfo.error ?? 'No se pudo detectar la IP de salida'}
              </span>
            )}
          </div>
        )}
        {suggestions.length === 0 ? (
          <p className="muted text-sm no-margin">No hay direcciones utilizables: revisa que el servidor tenga una interfaz conectada.</p>
        ) : (
          <ul className="net-suggestions">
            {suggestions.map((s) => {
              const inUse = normUrl(s.url) === normUrl(current);
              return (
                <li key={s.url} className={inUse ? 'is-current' : ''}>
                  <div className="net-suggestion-main">
                    <span className="row-inline">
                      <span className="mono strong">{s.url}</span>
                      {inUse && <Badge tone="green">En uso</Badge>}
                      {s.responds ? (
                        <Badge tone="green" dot>
                          Responde
                        </Badge>
                      ) : (
                        <span title="El portal no contestó en esa IP y puerto desde el propio servidor">
                          <Badge tone="amber" dot>
                            No responde
                          </Badge>
                        </span>
                      )}
                    </span>
                    <span className="muted text-xs">{s.reason}</span>
                  </div>
                  <div className="row-actions">
                    <CopyButton text={s.url} />
                    <button type="button" className="btn btn-secondary btn-sm" disabled={inUse || savingUrl !== null} onClick={() => void savePublicUrl(s.url)}>
                      {savingUrl === s.url ? <Spinner size={13} /> : null} Usar esta
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 4) Puertos TCP a la escucha */}
      <ListeningCard listening={d.listening ?? []} />

      <PortChooser
        target={chooser}
        ports={portalPorts}
        current={current}
        saving={savingUrl !== null}
        onClose={() => setChooser(null)}
        onSave={(url) => void savePublicUrl(url)}
      />
    </div>
  );
}

/** Interfaces conectadas y, plegadas, las locales o sin conexión (mismo orden que la API). */
export function NetworkPortsList({
  ports,
  current,
  disabled = false,
  useLabel = 'Usar para clientes',
  onUse,
}: {
  ports: NetworkPort[];
  current: string;
  disabled?: boolean;
  useLabel?: string;
  onUse: (ip: string, iface: string) => void;
}) {
  const [showOther, setShowOther] = useState(false);
  const main = ports.filter((p) => p.status === 'up' && p.type !== 'loopback');
  const other = ports.filter((p) => !(p.status === 'up' && p.type !== 'loopback'));
  return (
    <>
      {main.length === 0 && <p className="muted text-sm">No hay interfaces conectadas.</p>}
      <div className="net-ports">
        {main.map((p) => (
          <PortCard key={p.name} port={p} onUse={(ip) => onUse(ip, p.name)} disabled={disabled} current={current} useLabel={useLabel} />
        ))}
      </div>
      {other.length > 0 && (
        <>
          <button type="button" className="collapse-toggle" onClick={() => setShowOther((v) => !v)} aria-expanded={showOther}>
            {showOther ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {showOther ? 'Ocultar' : 'Mostrar'} interfaces sin conexión / locales
            <span className="muted text-sm">({formatNumber(other.length)})</span>
          </button>
          {showOther && (
            <div className="net-ports net-ports-other">
              {other.map((p) => (
                <PortCard key={p.name} port={p} onUse={(ip) => onUse(ip, p.name)} disabled={disabled} current={current} useLabel={useLabel} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function PortCard({
  port,
  onUse,
  disabled,
  current,
  useLabel,
}: {
  port: NetworkPort;
  onUse: (ip: string) => void;
  disabled: boolean;
  current: string;
  useLabel: string;
}) {
  const p = port;
  const up = p.status === 'up';
  const speed = formatSpeed(p.speed_mbps);
  return (
    <article className={`net-port ${up ? '' : 'is-down'} ${p.default_route ? 'is-main' : ''}`}>
      <header className="net-port-head">
        <span className={`net-port-icon stat-${TYPE_TONE[p.type] ?? 'gray'}`}>{TYPE_ICON[p.type] ?? <EthernetPort size={18} />}</span>
        <div className="net-port-title">
          <span className="row-inline">
            <span className="strong">{p.name}</span>
            {p.default_route && (
              <span title="Tiene la puerta de enlace predeterminada">
                <Badge tone="amber">
                  <Star size={11} /> Principal
                </Badge>
              </span>
            )}
          </span>
          {p.description && <span className="muted text-xs">{p.description}</span>}
        </div>
        <div className="net-port-badges">
          <Badge tone={TYPE_TONE[p.type] ?? 'gray'}>{p.type_label || p.type}</Badge>
          {up ? (
            <Badge tone="green" dot>
              Conectado
            </Badge>
          ) : (
            <Badge tone="gray" dot>
              Desconectado
            </Badge>
          )}
        </div>
      </header>
      {(speed || p.mac || p.gateway) && (
        <div className="net-port-meta">
          {speed && (
            <span>
              <span className="muted">Velocidad</span> {speed}
            </span>
          )}
          {p.mac && (
            <span>
              <span className="muted">MAC</span> <span className="mono">{p.mac}</span>
            </span>
          )}
          {p.gateway && (
            <span>
              <span className="muted">Puerta de enlace</span> <span className="mono">{p.gateway}</span>
            </span>
          )}
        </div>
      )}
      {p.addresses.length === 0 ? (
        <p className="muted text-xs no-margin">Sin direcciones IP.</p>
      ) : (
        <ul className="net-addresses">
          {p.addresses.map((a) => {
            const scope = SCOPE[a.scope] ?? { label: a.scope, tone: 'gray' as Tone };
            const ok = usable(p, a);
            const inUse = current && normUrl(current).includes(`//${a.address.includes(':') ? `[${a.address}]` : a.address}`.toLowerCase());
            return (
              <li key={a.address} className={ok ? '' : 'is-dim'}>
                <span className="mono net-ip">
                  {a.address}
                  {a.cidr !== null && a.cidr !== undefined ? <span className="muted">/{a.cidr}</span> : null}
                </span>
                <span className="muted text-xs">{a.family}</span>
                <Badge tone={scope.tone}>{scope.label}</Badge>
                {ok && (
                  <button type="button" className="btn btn-ghost btn-sm net-use" disabled={disabled || Boolean(inUse)} onClick={() => onUse(a.address)}>
                    {inUse ? 'En uso' : useLabel}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

function PortChooser({
  target,
  ports,
  current,
  saving,
  onClose,
  onSave,
}: {
  target: { ip: string; iface: string } | null;
  ports: number[];
  current: string;
  saving: boolean;
  onClose: () => void;
  onSave: (url: string) => void;
}) {
  const options = ports.length > 0 ? ports : [25461];
  const recommended = options.includes(25461) ? 25461 : options[0];
  const [port, setPort] = useState<number>(recommended);
  const [lastTarget, setLastTarget] = useState<string | null>(null);

  // Al abrir para otra IP se vuelve al puerto recomendado.
  if (target && target.ip !== lastTarget) {
    setLastTarget(target.ip);
    setPort(recommended);
  }

  const url = target ? buildClientUrl(target.ip, port) : '';
  const same = normUrl(url) === normUrl(current);

  return (
    <Modal
      open={target !== null}
      title="Usar esta IP para los clientes"
      onClose={onClose}
      size="sm"
      dismissible={!saving}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(url)} disabled={saving || same}>
            {saving ? <Spinner size={14} /> : <CircleCheck size={15} />} {same ? 'Ya está en uso' : 'Guardar'}
          </button>
        </>
      }
    >
      {target && (
        <div className="stack">
          <p className="no-margin text-sm">
            IP <strong className="mono">{target.ip}</strong> de <strong>{target.iface}</strong>. Elige el puerto del portal:
          </p>
          <div className="radio-cards">
            {options.map((p) => (
              <button key={p} type="button" className={`radio-card ${port === p ? 'is-active' : ''}`} onClick={() => setPort(p)} aria-pressed={port === p}>
                <span className="radio-card-head">
                  <span className="radio-dot" />
                  <span className="radio-card-title mono">{p}</span>
                  {p === 25461 && <Badge tone="green">Recomendado</Badge>}
                  {p === 80 && <Badge tone="gray">Web (sin puerto en la URL)</Badge>}
                </span>
              </button>
            ))}
          </div>
          <FormField label="Quedará así">
            <div className="net-url-preview mono">{url}</div>
          </FormField>
        </div>
      )}
    </Modal>
  );
}

function ListeningCard({ listening }: { listening: ListeningPort[] }) {
  const [onlyPortal, setOnlyPortal] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const rows = onlyPortal ? listening.filter((l) => l.portal) : listening;
  const pageRows = rows.slice((page - 1) * limit, page * limit);

  return (
    <section className="card">
      <div className="section-header">
        <h2 className="card-title no-margin">
          <Radar size={18} /> Puertos TCP a la escucha
        </h2>
        <button
          type="button"
          className={`chip chip-toggle ${onlyPortal ? 'chip-active' : ''}`}
          aria-pressed={onlyPortal}
          onClick={() => {
            setOnlyPortal((v) => !v);
            setPage(1);
          }}
        >
          Solo del portal
        </button>
      </div>
      <Alert tone="blue" icon={<Shield size={18} />}>
        Asegúrate de abrir en el firewall/router el puerto que usan los clientes.
      </Alert>
      <DataTable<ListeningPort, string>
        rows={pageRows}
        rowKey={(l) => `${l.ip}-${l.port}-${l.process ?? ''}`}
        rowClassName={(l) => (l.portal ? 'row-highlight' : '')}
        emptyTitle="No se encontraron puertos a la escucha"
        pagination={rows.length > 25 ? { page, limit, total: rows.length, onPageChange: setPage, onLimitChange: setLimit } : undefined}
        columns={[
          {
            key: 'ip',
            header: 'IP',
            render: (l) =>
              l.all_interfaces ? (
                <div className="cell-main">
                  <span>Todas las interfaces</span>
                  <span className="muted text-xs mono">{l.ip}</span>
                </div>
              ) : (
                <span className="mono text-sm">{l.ip}</span>
              ),
          },
          { key: 'port', header: 'Puerto', render: (l) => <span className="mono strong">{l.port}</span> },
          {
            key: 'service',
            header: 'Servicio',
            render: (l) => (
              <span className="row-inline">
                {l.service || <span className="muted">—</span>}
                {l.portal && <Badge tone="green">Portal</Badge>}
              </span>
            ),
          },
          { key: 'process', header: 'Proceso', hideOnMobile: true, render: (l) => (l.process ? <span className="text-sm">{l.process}</span> : <span className="muted">—</span>) },
        ]}
      />
    </section>
  );
}
