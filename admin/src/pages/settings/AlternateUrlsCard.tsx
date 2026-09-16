import { useEffect, useState } from 'react';
import { Fingerprint, Plus, Route, Save, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useToast } from '../../components/Toast';
import { Alert, Badge, CopyButton, Spinner } from '../../components/ui';
import type { NetworkSuggestion, Settings } from '../../types';

const MAX_URLS = 10;
const URL_RE = /^https?:\/\/[^/\s]+$/i;

const clean = (u: string) => u.trim().replace(/\/+$/, '');
const same = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase();

/** Direcciones alternativas del portal (la app y los nodos las prueban si la principal no responde) e identificador del portal. */
export function AlternateUrlsCard({
  settings,
  onSaved,
  suggestions,
  currentUrl,
}: {
  settings: Settings;
  onSaved: (next: Settings) => void;
  /** Sugerencias con la IP de cada interfaz y el puerto para clientes. */
  suggestions: NetworkSuggestion[];
  currentUrl: string;
}) {
  const toast = useToast();
  const saved = settings.alternate_urls ?? [];
  const savedKey = JSON.stringify(saved);
  const [list, setList] = useState<string[]>(saved);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    setList(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const listKey = JSON.stringify(list);
  const dirty = listKey !== savedKey;
  useEffect(() => setServerError(null), [listKey]);

  const add = (raw: string): boolean => {
    const url = clean(raw);
    if (!URL_RE.test(url)) {
      setDraftError('Usa http://ip-o-dominio:puerto (sin rutas)');
      return false;
    }
    if (list.some((u) => same(u, url))) {
      setDraftError('Esa dirección ya está en la lista');
      return false;
    }
    if (currentUrl && same(currentUrl, url)) {
      setDraftError('Es la URL para clientes: ya se prueba primero');
      return false;
    }
    if (list.length >= MAX_URLS) {
      setDraftError(`Máximo ${MAX_URLS} direcciones`);
      return false;
    }
    setList((l) => [...l, url]);
    setDraftError(null);
    return true;
  };

  const addDraft = () => {
    if (draft.trim() && add(draft)) setDraft('');
  };

  const save = async () => {
    setSaving(true);
    setServerError(null);
    try {
      const next = await api.settings.update({ alternate_urls: list });
      onSaved(next);
      toast.success('Direcciones alternativas guardadas');
    } catch (e) {
      setServerError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // Una por IP; sin las que ya están en la lista ni la URL para clientes.
  const seen = new Set<string>();
  const quick = suggestions.filter((s) => {
    if (seen.has(s.ip) || list.some((u) => same(u, s.url)) || (currentUrl && same(currentUrl, s.url))) return false;
    seen.add(s.ip);
    return true;
  });

  return (
    <section className="card alt-urls-card">
      <h2 className="card-title">
        <Route size={18} /> Direcciones alternativas
      </h2>
      <p className="muted text-sm no-margin">
        Si la dirección principal deja de responder (cambio de IP, otra red), la app y los nodos prueban estas: un dominio, la IP de otra tarjeta de
        red, una VPN…
      </p>

      {list.length === 0 ? (
        <p className="text-sm no-margin">Aún no hay direcciones alternativas.</p>
      ) : (
        <ul className="alt-urls">
          {list.map((u) => (
            <li key={u}>
              <span className="mono ellipsis">{u}</span>
              {!saved.some((s) => same(s, u)) && <Badge tone="blue">Nueva</Badge>}
              <span className="grow" />
              <CopyButton text={u} />
              <button type="button" className="btn btn-danger-ghost btn-icon btn-sm" title="Quitar" onClick={() => setList((l) => l.filter((x) => x !== u))}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="stack-sm">
        <div className="alt-urls-add">
          <input
            className={`input mono ${draftError ? 'is-invalid' : ''}`}
            value={draft}
            placeholder="http://tv.midominio.com:25461"
            aria-label="Nueva dirección alternativa"
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDraft();
              }
            }}
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={addDraft} disabled={!draft.trim() || list.length >= MAX_URLS}>
            <Plus size={14} /> Añadir
          </button>
        </div>
        {draftError && <div className="field-message">{draftError}</div>}
        {quick.length > 0 && list.length < MAX_URLS && (
          <div className="alt-urls-quick">
            <span className="muted text-xs">Añadir rápido:</span>
            {quick.map((s) => (
              <button key={s.url} type="button" className="chip" title={`${s.interface} · ${s.reason}`} onClick={() => add(s.url)}>
                <Plus size={12} /> <span className="mono">{s.url}</span> <span className="muted">{s.interface}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {serverError && <Alert tone="red">{serverError}</Alert>}

      {dirty && (
        <div className="row row-end">
          <span className="muted text-sm">Hay cambios sin guardar</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setList(saved)} disabled={saving}>
            <X size={14} /> Descartar
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner size={13} /> : <Save size={14} />} Guardar direcciones
          </button>
        </div>
      )}

      {settings.install_id && (
        <div className="portal-id">
          <span className="muted text-xs">
            <Fingerprint size={12} /> Identificador del portal
          </span>
          <span className="row-inline nowrap">
            <span className="mono text-xs ellipsis">{settings.install_id}</span>
            <CopyButton text={settings.install_id} />
          </span>
          <span className="muted text-xs">Las apps y los nodos lo usan para reconocer este portal en la red local.</span>
        </div>
      )}
    </section>
  );
}
