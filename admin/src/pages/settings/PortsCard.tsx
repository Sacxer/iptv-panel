import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  Lightbulb,
  Plug,
  Plus,
  RefreshCw,
  Save,
  SearchCheck,
  ShieldCheck,
  Star,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useInterval } from '../../hooks/useInterval';
import { usePageVisible } from '../../hooks/usePageVisible';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Checkbox, CopyButton, ErrorState, Spinner, Switch } from '../../components/ui';
import type { PortCheck, PortListener, PortsInfo, PortsSaveResult } from '../../types';
import { timeAgo } from '../../utils/format';

const RESERVED = [22, 25, 53, 3306, 5432];

export function urlPort(url: string): number | null {
  const m = /^https?:\/\/[^/]+?:(\d+)(\/|$)/i.exec(url.trim());
  return m ? Number(m[1]) : null;
}
const MAX_PORTS = 10;

function portError(value: number, info: PortsInfo, list: number[], self?: number): string | null {
  if (!Number.isInteger(value) || value < 1 || value > 65535) return 'Debe ser un número entre 1 y 65535';
  if (value === info.panel_port) return `El ${value} es el puerto del panel: usa uno distinto para los clientes`;
  if (RESERVED.includes(value)) return `El ${value} lo usa otro servicio del sistema (SSH, correo, DNS o base de datos)`;
  if (list.some((p, i) => p === value && i !== self)) return 'Ese puerto ya está en la lista';
  return null;
}

function ListenerStatus({ l }: { l: PortListener }) {
  if (l.status === 'listening') {
    return (
      <Badge tone="green" dot>
        Abierto
      </Badge>
    );
  }
  if (l.status === 'waiting') {
    return (
      <span className="row-inline">
        <Badge tone="amber" dot>
          Ocupado por otro programa
        </Badge>
        <span className="muted text-xs">se abrirá solo cuando se libere</span>
      </span>
    );
  }
  return (
    <span className="row-inline">
      <Badge tone="red" dot>
        Error
      </Badge>
      {l.error && <span className="text-red text-xs">{l.error}</span>}
    </span>
  );
}

function CheckBadge({ check }: { check: PortCheck | 'loading' | undefined }) {
  if (!check) return null;
  if (check === 'loading') return <Spinner size={12} />;
  if (check.in_use_by_portal) return <Badge tone="blue">Lo usa el portal</Badge>;
  if (check.available) return <Badge tone="green">Libre</Badge>;
  return (
    <span title={check.error ?? undefined}>
      <Badge tone="amber">
        Ocupado
        {check.error && check.error !== 'Ocupado por otro programa' ? `: ${check.error}` : ''}
      </Badge>
    </span>
  );
}

/** Puertos del portal: estado de cada puerto, editor de puertos para clientes y ayuda para migrar desde XtreamUI. */
export function PortsCard({
  onSaved,
  onInfo,
  refreshKey = 0,
}: {
  /** Tras guardar puertos o cambiar la separación (puede traer una URL para clientes nueva). */
  onSaved?: (result: { public_url_changed: string | null }) => void;
  /** Cada vez que llega el estado de los puertos. */
  onInfo?: (info: PortsInfo) => void;
  refreshKey?: number;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const visible = usePageVisible();
  const ports = useAsync(() => api.system.ports(), []);
  const [list, setList] = useState<number[]>([]);
  const [newPort, setNewPort] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
  const [checks, setChecks] = useState<Record<number, PortCheck | 'loading'>>({});
  const [updateUrl, setUpdateUrl] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<PortsSaveResult | null>(null);
  const [sepBusy, setSepBusy] = useState(false);
  const [sepError, setSepError] = useState<string | null>(null);

  const info = ports.data;

  useEffect(() => {
    if (info) onInfo?.(info);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  // La URL para clientes se cambió en otra tarjeta: se refresca ya, sin esperar los 10 s.
  useEffect(() => {
    if (refreshKey) void ports.reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const savedKey = JSON.stringify(info?.client_ports ?? []);

  // Estado de los puertos cada 10 s mientras la página está abierta.
  useInterval(() => void ports.reload(true), visible && !saving && !sepBusy ? 10000 : null);

  useEffect(() => {
    if (info) setList(info.client_ports);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  // Un error del servidor deja de aplicar en cuanto se cambia la lista.
  const listKey = JSON.stringify(list);
  useEffect(() => setServerError(null), [listKey]);

  const dirty = listKey !== savedKey;
  const original = useMemo(() => new Set(info?.client_ports ?? []), [info?.client_ports]);

  if (!info) {
    return (
      <section className="card">
        <h2 className="card-title">
          <Plug size={18} /> Puertos del portal
        </h2>
        {ports.error ? <ErrorState message={ports.error} onRetry={() => void ports.reload()} /> : <Spinner label="Cargando puertos…" />}
      </section>
    );
  }

  const listeners = [...info.listeners].sort((a, b) => (a.role === b.role ? a.port - b.port : a.role === 'panel' ? -1 : 1));
  const listenerOf = (p: number) => info.listeners.find((l) => l.port === p);
  const openClientPorts = listeners.filter((l) => l.role === 'clients' && l.status === 'listening').map((l) => l.port);
  const separated = Boolean(info.separation_active);

  const toggleSeparation = async (value: boolean) => {
    setSepError(null);
    const panel = info.panel_port;
    const first = openClientPorts[0];
    const url = info.public_url || '';
    const urlOnPanel = urlPort(url) === panel;
    const ok = await confirm(
      value
        ? {
            title: 'Separar panel y clientes',
            message: (
              <div className="stack-sm">
                {first === undefined ? (
                  <span className="text-amber">Hace falta al menos un puerto para clientes abierto: añádelo abajo y guárdalo primero.</span>
                ) : (
                  <>
                    <span>
                      El puerto del panel (<strong>{panel}</strong>) dejará de atender a los clientes: las apps y listas M3U que usen el {panel} deben
                      pasar al <strong>{first}</strong>. La app 1.0.2 o posterior lo hace sola.
                    </span>
                    <span>
                      {openClientPorts.length === 1 ? 'El puerto para clientes' : 'Los puertos para clientes'} ({openClientPorts.join(', ')}) dejará
                      {openClientPorts.length === 1 ? '' : 'n'} de mostrar el panel: entra siempre por el {panel}.
                    </span>
                    {urlOnPanel && (
                      <span>
                        La URL para clientes pasará a <strong className="mono">{url.replace(`:${panel}`, `:${first}`)}</strong>.
                      </span>
                    )}
                    <span className="muted text-sm">/health, los nodos y las páginas legales siguen respondiendo en todos los puertos.</span>
                  </>
                )}
              </div>
            ),
            confirmText: 'Separar',
          }
        : {
            title: 'Dejar de separar panel y clientes',
            message: `Los clientes podrán usar también el puerto del panel (${panel}) y el panel se podrá abrir por los puertos para clientes. El tráfico y los ataques al puerto público podrán afectar al panel.`,
            confirmText: 'Dejar de separar',
            danger: true,
          },
    );
    if (!ok) return;
    setSepBusy(true);
    try {
      const res = await api.system.setSeparation(value);
      ports.setData(res);
      onSaved?.(res);
      toast.success(value ? 'Panel y clientes separados' : 'Separación desactivada');
      if (res.public_url_changed) toast.info(`URL para clientes: ${res.public_url_changed}`);
    } catch (e) {
      setSepError(errorMessage(e));
    } finally {
      setSepBusy(false);
    }
  };

  const check = async (p: number) => {
    setChecks((c) => ({ ...c, [p]: 'loading' }));
    try {
      const r = await api.system.checkPort(p);
      setChecks((c) => ({ ...c, [p]: r }));
    } catch (e) {
      setChecks((c) => {
        const next = { ...c };
        delete next[p];
        return next;
      });
      setFieldErrors((f) => ({ ...f, [p]: errorMessage(e) }));
    }
  };

  const add = (value: number, first = false) => {
    const err = portError(value, info, list);
    if (err && !(first && list.includes(value))) {
      setNewError(err);
      return false;
    }
    if (!list.includes(value) && list.length >= MAX_PORTS) {
      setNewError(`Máximo ${MAX_PORTS} puertos`);
      return false;
    }
    setList((l) => (first ? [value, ...l.filter((x) => x !== value)] : [...l, value]));
    setNewError(null);
    setResult(null);
    if (!original.has(value)) void check(value);
    return true;
  };

  const addFromInput = () => {
    if (!newPort.trim()) return;
    if (add(Number(newPort.trim()))) setNewPort('');
  };

  const remove = (p: number) => {
    setList((l) => l.filter((x) => x !== p));
    setFieldErrors((f) => {
      const next = { ...f };
      delete next[p];
      return next;
    });
    setResult(null);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    setList((l) => {
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const save = async () => {
    setServerError(null);
    if (list.length === 0) {
      setServerError('Deja al menos un puerto para clientes');
      return;
    }
    const opened = list.filter((p) => !original.has(p));
    const closed = [...original].filter((p) => !list.includes(p));
    const currentUrl = info.public_url || '';
    const lostUrlPort = urlPort(currentUrl);
    const urlLoses = lostUrlPort !== null && closed.includes(lostUrlPort);
    const busy = opened.filter((p) => {
      const c = checks[p];
      return c && c !== 'loading' && !c.available && !c.in_use_by_portal;
    });
    const ok = await confirm({
      title: 'Cambiar los puertos para clientes',
      message: (
        <div className="stack-sm">
          {opened.length > 0 && (
            <span>
              Se abrirá{opened.length === 1 ? '' : 'n'}: <strong>{opened.join(', ')}</strong>.
            </span>
          )}
          {busy.length > 0 && (
            <span className="text-amber">
              {busy.length === 1 ? `El ${busy[0]} está ocupado` : `Los puertos ${busy.join(', ')} están ocupados`} por otro programa: quedará
              {busy.length === 1 ? '' : 'n'} en espera y el portal {busy.length === 1 ? 'lo' : 'los'} abrirá solo cuando se libere
              {busy.length === 1 ? '' : 'n'}.
            </span>
          )}
          {closed.length > 0 && (
            <span className="text-red">
              Se cerrará{closed.length === 1 ? '' : 'n'}: <strong>{closed.join(', ')}</strong>. Los clientes conectados por un puerto que se cierra se
              cortan.
            </span>
          )}
          {urlLoses &&
            (updateUrl ? (
              <span>
                La URL para clientes usa el {lostUrlPort}: pasará a{' '}
                <strong className="mono">{currentUrl.replace(`:${lostUrlPort}`, `:${list[0]}`)}</strong>.
              </span>
            ) : (
              <span className="text-amber">
                La URL para clientes (<span className="mono">{currentUrl}</span>) usa el {lostUrlPort} y no se actualizará: los clientes no podrán
                conectarse hasta que la cambies.
              </span>
            ))}
          {opened.length === 0 && closed.length === 0 && <span>Cambia el orden: el puerto principal pasa a ser el {list[0]}.</span>}
          <span className="muted text-sm">
            Puerto principal (el de los enlaces de los clientes): <strong>{list[0]}</strong>. Se aplica al instante, sin reiniciar.
          </span>
        </div>
      ),
      confirmText: 'Aplicar',
      danger: closed.length > 0,
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await api.system.savePorts({
        client_ports: list,
        update_public_url: updateUrl,
      });
      setResult(res);
      ports.setData(res);
      setFieldErrors({});
      setChecks({});
      onSaved?.(res);
      const failed = res.results.filter((r) => !r.ok && !r.closed).length;
      if (failed) toast.info(`Puertos guardados. ${failed === 1 ? 'Un puerto quedó' : `${failed} puertos quedaron`} en espera`);
      else toast.success('Puertos actualizados');
    } catch (e) {
      const msg = errorMessage(e);
      // Si el mensaje nombra un puerto de la lista, se muestra junto a ese puerto.
      const p = list.find((x) => new RegExp(`\\b${x}\\b`).test(msg));
      if (p !== undefined) setFieldErrors((f) => ({ ...f, [p]: msg }));
      else setServerError(msg);
    } finally {
      setSaving(false);
    }
  };

  const x = info.xtream;
  const xName = x.on_server || x.migrated_from;
  const suggested = x.suggested_port;
  const suggestedWaiting = suggested ? listenerOf(suggested)?.status === 'waiting' : false;
  // Migración terminada: el puerto recomendado ya es el principal y está abierto.
  const migrationDone = suggested !== null && info.client_ports[0] === suggested && listenerOf(suggested)?.status === 'listening';
  const port80Waiting = listenerOf(80)?.status === 'waiting';
  const currentUrlPort = urlPort(info.public_url || '');
  const firewallManual = result?.firewall.filter((f) => !f.ok || f.manual) ?? [];

  return (
    <section className="card ports-card">
      <div className="section-header">
        <h2 className="card-title no-margin">
          <Plug size={18} /> Puertos del portal
        </h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void ports.reload(true)} title="Actualizar estado">
          <RefreshCw size={14} />
        </button>
      </div>

      {xName && suggested && !migrationDone && (
        <Alert tone="blue" icon={<Lightbulb size={18} />} title={`¿Terminaste de migrar desde ${xName}?`}>
          <div className="stack-sm">
            <span>
              Apágalo (y su inicio automático) y usa el puerto <strong>{suggested}</strong> para que los clientes no cambien nada
              {x.original_port ? ` (tus clientes usaban el ${x.original_port})` : ''}.
              {x.on_server ? ` ${x.on_server} parece seguir instalado en este servidor.` : ''}
            </span>
            {list[0] === suggested && !original.has(suggested) && (
              <span className="strong">Quedó primero en la lista: pulsa «Guardar puertos» para aplicarlo.</span>
            )}
            {list[0] !== suggested && (
              <div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => add(suggested, true)}>
                  <Star size={14} /> Usar el puerto {suggested}
                </button>
              </div>
            )}
          </div>
        </Alert>
      )}

      <div className="table-card">
        <div className="table-scroll">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Puerto</th>
                <th>Uso</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {listeners.map((l) => (
                <tr key={`${l.role}-${l.port}`}>
                  <td className="mono strong">{l.port}</td>
                  <td>
                    {l.role === 'panel' ? 'Panel y API' : 'Clientes'}
                    {l.role === 'panel' && !separated && <div className="muted text-xs">también atiende a los clientes</div>}
                  </td>
                  <td>
                    <ListenerStatus l={l} />
                    {/* En espera, «since» se renueva en cada reintento: no se muestra. */}
                    {l.since && l.status !== 'waiting' ? <div className="muted text-xs">desde {timeAgo(Math.floor(l.since / 1000))}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted text-xs no-margin">Se actualiza cada 10 s. Un puerto ocupado se vuelve a intentar cada 30 s.</p>

      <div className="ports-roles">
        <div className="ports-role">
          <span className="scs-label">Puerto del panel y la API</span>
          <span className="ports-role-value mono">{info.panel_port}</span>
          <span className="muted text-xs">Se cambia al instalar. {separated ? 'No atiende a los clientes.' : 'También atiende a los clientes.'}</span>
        </div>
        <div className="ports-role is-clients">
          <span className="scs-label">Puertos para clientes</span>
          <span className="ports-role-value mono">{openClientPorts.length ? openClientPorts.join(' · ') : '—'}</span>
          <span className="muted text-xs">
            {openClientPorts.length === 0
              ? `Ninguno abierto: los clientes usan el ${info.panel_port}.`
              : separated
                ? 'Solo clientes: no muestran el panel.'
                : 'Clientes (el panel también responde aquí).'}
          </span>
        </div>
      </div>

      {info.separate_ports !== undefined && (
        <div className="ports-separation">
          <div className="url-follow">
            <Switch
              checked={Boolean(info.separate_ports)}
              disabled={sepBusy}
              onChange={(v) => void toggleSeparation(v)}
              label="Separar panel y clientes (recomendado)"
              description="El panel no se abre por los puertos para clientes y los clientes no usan el puerto del panel: el tráfico y los ataques al puerto público no afectan al panel."
            />
            {sepBusy && <Spinner size={13} />}
          </div>
          {separated ? (
            <span className="text-green text-sm">
              <ShieldCheck size={13} /> Activa: los clientes entran por {openClientPorts.join(', ')} y el panel por el {info.panel_port}.
            </span>
          ) : info.separate_ports ? (
            <span className="text-amber text-sm">
              <TriangleAlert size={13} /> Encendida, pero sin efecto hasta que haya un puerto para clientes abierto.
            </span>
          ) : openClientPorts.length === 0 ? (
            <span className="muted text-sm">Necesita al menos un puerto para clientes abierto.</span>
          ) : null}
          {sepError && <Alert tone="red">{sepError}</Alert>}
        </div>
      )}

      <div className="stack-sm">
        <div className="row-inline">
          <span className="field-label no-margin">Puertos para clientes (Xtream Codes / M3U)</span>
          {info.source === 'env' && dirty === false && <Badge tone="gray">Configurado en el .env del servidor</Badge>}
        </div>
        <p className="muted text-sm no-margin">
          El primero es el principal: el que se usa en los enlaces de los clientes cuando la URL es automática o cuando se quita el puerto de la URL.
          Los cambios se aplican al instante.
        </p>
        {list.length === 0 ? (
          <p className="text-sm no-margin">Aún no hay puertos para clientes: solo atiende el {info.panel_port}.</p>
        ) : (
          <ol className="ports-list">
            {list.map((p, i) => {
              const l = listenerOf(p);
              const isNew = !original.has(p);
              return (
                <li key={p} className={fieldErrors[p] ? 'has-error' : ''}>
                  <span className="ports-order">{i + 1}</span>
                  <span className="mono strong ports-num">{p}</span>
                  {i === 0 && <Badge tone="purple">Principal</Badge>}
                  {isNew ? <Badge tone="blue">Nuevo</Badge> : l ? <ListenerStatus l={l} /> : null}
                  {isNew && <CheckBadge check={checks[p]} />}
                  <span className="ports-actions">
                    {isNew && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void check(p)} disabled={checks[p] === 'loading'}>
                        <SearchCheck size={14} /> <span className="hide-mobile">Comprobar</span>
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Subir" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      title="Bajar"
                      disabled={i === list.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button type="button" className="btn btn-danger-ghost btn-icon btn-sm" title="Quitar" onClick={() => remove(p)}>
                      <Trash2 size={14} />
                    </button>
                  </span>
                  {fieldErrors[p] && <div className="field-message ports-error">{fieldErrors[p]}</div>}
                </li>
              );
            })}
          </ol>
        )}
        <div className="ports-add">
          <input
            className={`input input-narrow ${newError ? 'is-invalid' : ''}`}
            type="number"
            min={1}
            max={65535}
            placeholder="p. ej. 25461"
            title={`Distinto del ${info.panel_port} (puerto del panel)`}
            value={newPort}
            aria-label="Nuevo puerto"
            onChange={(e) => {
              setNewPort(e.target.value);
              setNewError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addFromInput();
              }
            }}
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={addFromInput} disabled={!newPort.trim() || list.length >= MAX_PORTS}>
            <Plus size={14} /> Añadir puerto
          </button>
          <span className="muted text-xs">
            {list.length >= MAX_PORTS ? `Máximo ${MAX_PORTS} puertos` : `Distinto del ${info.panel_port} (el del panel).`}
          </span>
        </div>
        {newError && <div className="field-message">{newError}</div>}
      </div>

      {(list.includes(80) || port80Waiting) && (
        <Alert tone={port80Waiting ? 'amber' : 'blue'} icon={<TriangleAlert size={18} />}>
          El puerto 80 suele estar ocupado por el Nginx del panel u otro servidor web.{' '}
          {port80Waiting
            ? 'Por eso aparece en espera: libéralo (o cambia ese servidor de puerto) y el portal lo abrirá solo.'
            : 'Si queda en espera después de guardar, revisa qué programa lo usa.'}
        </Alert>
      )}

      <div className="stack-sm">
        <Checkbox checked={updateUrl} onChange={setUpdateUrl} label="Actualizar la URL para clientes si su puerto deja de estar abierto" />
        <span className="muted text-sm">
          URL para clientes actual: <span className="mono">{info.public_url || 'automática'}</span>
        </span>
        {currentUrlPort !== null && !listeners.some((l) => l.port === currentUrlPort && l.status === 'listening') && (
          <span className="text-amber text-sm">
            <TriangleAlert size={13} /> El puerto {currentUrlPort} de la URL no está abierto en este portal: los clientes no podrán conectarse (salvo
            que el router lo redirija a otro puerto abierto).
          </span>
        )}
      </div>

      {serverError && <Alert tone="red">{serverError}</Alert>}

      <div className="row row-end">
        {dirty && (
          <>
            <span className="muted text-sm">Hay cambios sin guardar</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setList(info.client_ports)} disabled={saving}>
              <X size={14} /> Descartar
            </button>
          </>
        )}
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? <Spinner size={14} /> : <Save size={16} />} Guardar puertos
        </button>
      </div>

      {result && (
        <div className="ports-result">
          <div className="field-label">Resultado</div>
          <ul className="plain-list text-sm">
            {result.results.map((r) => (
              <li key={r.port}>
                <strong className="mono">{r.port}</strong>:{' '}
                {r.closed ? (
                  'cerrado'
                ) : r.ok ? (
                  <span className="text-green">{r.already ? 'ya estaba abierto' : 'abierto'}</span>
                ) : (
                  <span className="text-amber">en espera — {r.error ?? 'ocupado por otro programa'}</span>
                )}
              </li>
            ))}
          </ul>
          {result.public_url_changed && (
            <Alert tone="blue" icon={<CircleCheck size={18} />}>
              La URL para clientes cambió a <span className="mono">{result.public_url_changed}</span>.
            </Alert>
          )}
          {suggestedWaiting && suggested && list.includes(suggested) && (
            <Alert tone="amber" icon={<TriangleAlert size={18} />}>
              El puerto {suggested} sigue ocupado: {xName ?? 'XtreamUI'} todavía está funcionando. Cuando lo apagues, el portal tomará el puerto solo
              (lo intenta cada 30 s).
            </Alert>
          )}
          {result.firewall.length > 0 && firewallManual.length === 0 && (
            <p className="text-green text-sm no-margin">
              <CircleCheck size={13} /> Firewall actualizado ({result.firewall.map((f) => f.port).join(', ')}).
            </p>
          )}
          {firewallManual.length > 0 && (
            <div className="stack-sm">
              <div className="field-label">
                <Terminal size={14} /> Firewall
              </div>
              <p className="text-sm no-margin">
                {info.firewall_helper
                  ? 'No se pudo abrir el puerto en el firewall automáticamente.'
                  : 'Este servidor no tiene el ayudante de firewall del instalador.'}{' '}
                Ábrelo en el servidor por SSH:
              </p>
              {firewallManual.map((f) => (
                <div key={f.port} className="stack-sm">
                  {f.error && <span className="text-red text-xs">{f.error}</span>}
                  {f.manual && (
                    <div className="input-group align-start">
                      <pre className="code-block grow">{f.manual}</pre>
                      <CopyButton text={f.manual} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
