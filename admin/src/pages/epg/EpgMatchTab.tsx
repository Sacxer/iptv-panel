import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, CircleCheck, Search, SearchCode, Sparkles, Wand2 } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useCategories } from '../../hooks/useResources';
import { DataTable } from '../../components/DataTable';
import { Popover } from '../../components/Popover';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, ChipGroup, FormField, Select, Spinner, Switch, Thumb } from '../../components/ui';
import type { EpgMatchCandidate, EpgMatchInput, EpgMatchItem, EpgMatchResult, EpgStatus, Settings } from '../../types';
import { formatNumber } from '../../utils/format';
import { EpgSearchModal, ScoreBar } from './EpgShared';

type RowFilter = '' | 'assign' | 'suggest' | 'none' | 'chosen';

interface Choice {
  checked: boolean;
  pick: EpgMatchCandidate | null;
}

/** Estado inicial de cada fila: las que se asignan quedan marcadas con la mejor coincidencia. */
function initialChoices(result: EpgMatchResult): Map<number, Choice> {
  const m = new Map<number, Choice>();
  result.results.forEach((r) => m.set(r.stream_id, { checked: r.action === 'assign', pick: r.match }));
  return m;
}

/** Fila elegida a mano: una sugerencia/alternativa/búsqueda, o una coincidencia distinta de la automática. */
function isManual(item: EpgMatchItem, c: Choice | undefined): boolean {
  if (!c?.checked || !c.pick) return false;
  return item.action !== 'assign' || c.pick.xmltv_id !== item.match?.xmltv_id;
}

export function EpgMatchTab({ status, settings, onApplied }: { status: EpgStatus | null; settings: Settings | null; onApplied: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { categories } = useCategories('live');

  const [onlyMissing, setOnlyMissing] = useState(true);
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [minScore, setMinScore] = useState(85);
  const [fillLogos, setFillLogos] = useState(true);
  const [touchedDefaults, setTouchedDefaults] = useState(false);

  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EpgMatchResult | null>(null);
  const [options, setOptions] = useState<EpgMatchInput | null>(null);
  const [choices, setChoices] = useState<Map<number, Choice>>(new Map());
  const [filter, setFilter] = useState<RowFilter>('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [manualFor, setManualFor] = useState<EpgMatchItem | null>(null);
  const [applying, setApplying] = useState<{ done: number; total: number } | null>(null);
  const [applied, setApplied] = useState<{ auto: number; manual: number; failed: number } | null>(null);
  const [building, setBuilding] = useState(false);

  // Los valores por defecto salen de los ajustes (hasta que el usuario los cambie aquí).
  useEffect(() => {
    if (!settings || touchedDefaults) return;
    setMinScore(settings.epg_min_score ?? 85);
    setFillLogos(settings.epg_fill_logos ?? true);
  }, [settings, touchedDefaults]);

  useEffect(() => setPage(1), [filter, limit, result]);

  const noGuides = status !== null && status.epg_channels === 0;

  const find = async () => {
    const input: EpgMatchInput = {
      only_missing: onlyMissing,
      min_score: minScore,
      fill_logos: fillLogos,
      ...(categoryId || search.trim() ? { filter: { ...(categoryId ? { category_id: Number(categoryId) } : {}), ...(search.trim() ? { search: search.trim() } : {}) } } : {}),
    };
    setSearching(true);
    setError(null);
    setApplied(null);
    try {
      const res = await api.epg.match({ ...input, dry_run: true });
      setResult(res);
      setOptions(input);
      setChoices(initialChoices(res));
      setFilter('');
    } catch (e) {
      setError(errorMessage(e));
      setResult(null);
    } finally {
      setSearching(false);
    }
  };

  const items = result?.results ?? [];
  const min = result?.min_score ?? minScore;

  const counts = useMemo(() => {
    const c = { assign: 0, suggest: 0, none: 0, chosen: 0 };
    items.forEach((i) => {
      c[i.action]++;
      if (isManual(i, choices.get(i.stream_id))) c.chosen++;
    });
    return c;
  }, [items, choices]);

  const rows = useMemo(
    () =>
      items.filter((i) => {
        if (!filter) return true;
        if (filter === 'chosen') return isManual(i, choices.get(i.stream_id));
        return i.action === filter;
      }),
    [items, filter, choices],
  );
  const pageRows = rows.slice((page - 1) * limit, page * limit);

  const autoIds = items.filter((i) => i.action === 'assign' && choices.get(i.stream_id)?.checked && !isManual(i, choices.get(i.stream_id))).map((i) => i.stream_id);
  const manualRows = items.filter((i) => isManual(i, choices.get(i.stream_id)));
  const untouched = manualRows.length === 0 && autoIds.length === counts.assign;
  const toApply = autoIds.length + manualRows.length;

  const setChoice = (id: number, patch: Partial<Choice>) =>
    setChoices((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? { checked: false, pick: null };
      next.set(id, { ...cur, ...patch });
      return next;
    });

  const apply = async () => {
    if (!result || !options || toApply === 0) return;
    const ok = await confirm({
      title: 'Aplicar EPG',
      message: (
        <>
          Se asignará EPG a <strong>{formatNumber(toApply)}</strong> canal{toApply === 1 ? '' : 'es'}
          {manualRows.length > 0 ? (
            <>
              {' '}
              ({formatNumber(autoIds.length)} automáticos y {formatNumber(manualRows.length)} elegidos a mano, que quedan <strong>bloqueados</strong> frente al
              emparejamiento automático)
            </>
          ) : null}
          .{fillLogos ? ' Los canales sin logo recibirán el de la guía.' : ''}
        </>
      ),
      confirmText: 'Aplicar',
    });
    if (!ok) return;
    let auto = 0;
    let manual = 0;
    let failed = 0;
    setApplying({ done: 0, total: manualRows.length + (autoIds.length ? 1 : 0) });
    try {
      if (untouched) {
        const res = await api.epg.match({ ...options, dry_run: false });
        auto = res.assigned;
      } else {
        if (autoIds.length) {
          // Los automáticos se aplican con /epg/match para que no queden bloqueados.
          const res = await api.epg.match({ only_missing: options.only_missing, min_score: options.min_score, fill_logos: options.fill_logos, stream_ids: autoIds, dry_run: false });
          auto = res.assigned;
          setApplying((a) => (a ? { ...a, done: a.done + 1 } : a));
        }
        for (const item of manualRows) {
          const c = choices.get(item.stream_id);
          try {
            await api.epg.assign({ stream_id: item.stream_id, xmltv_id: c?.pick?.xmltv_id ?? null, fill_logo: options.fill_logos });
            manual++;
          } catch {
            failed++;
          }
          setApplying((a) => (a ? { ...a, done: a.done + 1 } : a));
        }
      }
      setApplied({ auto, manual, failed });
      setResult(null);
      setChoices(new Map());
      onApplied();
      if (failed > 0) toast.error(`${formatNumber(failed)} canal(es) no se pudieron asignar`);
      else toast.success(`EPG asignado a ${formatNumber(auto + manual)} canal${auto + manual === 1 ? '' : 'es'}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setApplying(null);
    }
  };

  const buildGuide = async () => {
    setBuilding(true);
    try {
      await api.epg.buildGuide();
      toast.success('Generando la guía combinada…');
      onApplied();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="stack">
      {noGuides && (
        <Alert tone="amber" title="No hay canales de guía cargados">
          Agrega una fuente EPG en{' '}
          <Link className="link" to="/guia-epg">
            Resumen y fuentes
          </Link>{' '}
          y espera a que se actualice para poder emparejar.
        </Alert>
      )}

      <section className="card epg-match-controls">
        <div className="epg-controls-grid">
          <FormField label="Categoría" htmlFor="epg-cat">
            <Select id="epg-cat" value={categoryId} onChange={setCategoryId} placeholder="Todas las categorías" options={categories.map((c) => ({ value: String(c.id), label: c.name }))} />
          </FormField>
          <FormField label="Buscar canal" htmlFor="epg-search">
            <div className="input-icon">
              <Search size={16} />
              <input id="epg-search" className="input" value={search} placeholder="Nombre del canal…" onChange={(e) => setSearch(e.target.value)} />
            </div>
          </FormField>
          <FormField label={`Puntuación mínima: ${minScore}`} htmlFor="epg-min-match">
            <input
              id="epg-min-match"
              className="range"
              type="range"
              min={50}
              max={100}
              value={minScore}
              onChange={(e) => {
                setTouchedDefaults(true);
                setMinScore(Number(e.target.value));
              }}
            />
          </FormField>
        </div>
        <div className="row epg-controls-row">
          <Switch checked={onlyMissing} onChange={setOnlyMissing} label="Solo canales sin EPG" />
          <Switch
            checked={fillLogos}
            onChange={(v) => {
              setTouchedDefaults(true);
              setFillLogos(v);
            }}
            label="Rellenar logos"
          />
          <div className="grow" />
          <button type="button" className="btn btn-primary" onClick={() => void find()} disabled={searching || applying !== null || noGuides}>
            {searching ? <Spinner size={14} /> : <SearchCode size={16} />} Buscar coincidencias
          </button>
        </div>
        <p className="muted text-xs no-margin">
          Los canales asignados a mano (bloqueados) no se tocan. La búsqueda es una simulación: no se guarda nada hasta pulsar «Aplicar».
        </p>
      </section>

      {searching && (
        <div className="epg-progress" role="status">
          <Spinner size={16} /> Buscando coincidencias en las guías… puede tardar unos segundos.
        </div>
      )}
      {error && <Alert tone="red">{error}</Alert>}

      {applied && (
        <Alert tone="green" icon={<CircleCheck size={18} />} title="EPG aplicado">
          <div>
            {formatNumber(applied.auto)} automático{applied.auto === 1 ? '' : 's'}
            {applied.manual > 0 ? ` · ${formatNumber(applied.manual)} elegido${applied.manual === 1 ? '' : 's'} a mano (bloqueados)` : ''}
            {applied.failed > 0 ? ` · ${formatNumber(applied.failed)} con error` : ''}. Genera la guía para que los clientes vean la programación.
          </div>
          <div className="row mt-sm">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void buildGuide()} disabled={building || status?.guide.building}>
              {building || status?.guide.building ? <Spinner size={13} /> : <Wand2 size={14} />} Generar guía ahora
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void find()}>
              Volver a buscar
            </button>
          </div>
        </Alert>
      )}

      {result && !searching && (
        <>
          <div className="stat-tiles">
            <Tile value={result.checked} label="Revisados" />
            <Tile value={result.assigned} label={`Se asignarán (≥ ${min})`} tone="green" />
            <Tile value={result.suggested} label="Sugerencias" tone="amber" />
            <Tile value={result.not_found} label="Sin coincidencia" tone="gray" />
            <Tile value={result.logos_filled} label="Logos a rellenar" tone="blue" />
          </div>

          {result.checked === 0 ? (
            <Alert tone="blue">No hay canales que revisar con estos filtros{onlyMissing ? ' (todos tienen EPG o están bloqueados)' : ''}.</Alert>
          ) : (
            <>
              <div className="row row-between">
                <ChipGroup
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: '', label: `Todos (${formatNumber(items.length)})` },
                    { value: 'assign', label: `Se asignarán (${formatNumber(counts.assign)})` },
                    { value: 'suggest', label: `Sugerencias (${formatNumber(counts.suggest)})` },
                    { value: 'none', label: `Sin coincidencia (${formatNumber(counts.none)})` },
                    ...(counts.chosen > 0 ? [{ value: 'chosen' as RowFilter, label: `Elegidos a mano (${formatNumber(counts.chosen)})` }] : []),
                  ]}
                />
              </div>
              <DataTable<EpgMatchItem>
                rows={pageRows}
                rowKey={(i) => i.stream_id}
                emptyTitle="Ningún canal en este grupo"
                rowClassName={(i) => (choices.get(i.stream_id)?.checked ? '' : 'row-muted-soft')}
                pagination={rows.length > 25 ? { page, limit, total: rows.length, onPageChange: setPage, onLimitChange: setLimit } : undefined}
                columns={[
                  {
                    key: 'check',
                    header: '',
                    className: 'col-check',
                    render: (i) => {
                      const c = choices.get(i.stream_id);
                      return (
                        <input
                          type="checkbox"
                          className="checkbox"
                          aria-label={`Aplicar a ${i.name}`}
                          checked={Boolean(c?.checked)}
                          disabled={!c?.pick}
                          onChange={(e) => setChoice(i.stream_id, { checked: e.target.checked })}
                        />
                      );
                    },
                  },
                  {
                    key: 'channel',
                    header: 'Canal',
                    render: (i) => (
                      <div className="cell-main">
                        <span className="strong">{i.name}</span>
                        <span className="muted text-xs">
                          #{i.stream_id}
                          {i.current ? (
                            <>
                              {' '}
                              · Actual: <span className="mono">{i.current}</span>
                            </>
                          ) : (
                            ' · Sin EPG'
                          )}
                        </span>
                      </div>
                    ),
                  },
                  {
                    key: 'match',
                    header: 'Coincidencia',
                    render: (i) => <MatchCell item={i} choice={choices.get(i.stream_id)} min={min} />,
                  },
                  {
                    key: 'actions',
                    header: '',
                    className: 'col-actions',
                    render: (i) => {
                      const c = choices.get(i.stream_id);
                      const usingBest = c?.checked && c.pick?.xmltv_id === i.match?.xmltv_id;
                      return (
                        <div className="row-actions epg-row-actions">
                          {i.match && i.action !== 'assign' && !usingBest && (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setChoice(i.stream_id, { checked: true, pick: i.match })}>
                              <Sparkles size={13} /> Usar esta
                            </button>
                          )}
                          {i.alternatives.length > 0 && (
                            <Popover
                              triggerClassName="btn btn-ghost btn-sm"
                              triggerTitle="Otras coincidencias"
                              width={340}
                              trigger={
                                <>
                                  {formatNumber(i.alternatives.length + (i.match ? 1 : 0))} opciones <ChevronDown size={13} />
                                </>
                              }
                            >
                              <div className="epg-alts">
                                <div className="services-pop-title">Coincidencias para «{i.name}»</div>
                                <ul>
                                  {[...(i.match ? [i.match] : []), ...i.alternatives].map((alt) => {
                                    const chosen = c?.checked && c.pick?.xmltv_id === alt.xmltv_id;
                                    return (
                                      <li key={alt.xmltv_id}>
                                        <div className="epg-alt-main">
                                          <span className="strong text-sm">{alt.display_name}</span>
                                          <span className="mono text-xs">{alt.xmltv_id}</span>
                                          <span className="muted text-xs">{alt.source}</span>
                                          <ScoreBar score={alt.score} min={min} />
                                        </div>
                                        {chosen ? (
                                          <Badge tone="green">Elegida</Badge>
                                        ) : (
                                          <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setChoice(i.stream_id, { checked: true, pick: { ...alt, icon: alt.icon ?? (alt.xmltv_id === i.match?.xmltv_id ? i.match?.icon : undefined) } })}
                                          >
                                            Usar esta
                                          </button>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            </Popover>
                          )}
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManualFor(i)} title="Buscar manualmente en las guías">
                            <Search size={13} /> <span className="hide-mobile">Buscar manualmente…</span>
                          </button>
                        </div>
                      );
                    },
                  },
                ]}
              />
              <div className="epg-apply-bar">
                <span className="text-sm">
                  {toApply === 0 ? (
                    'Marca al menos un canal para aplicar.'
                  ) : (
                    <>
                      Se aplicará a <strong>{formatNumber(toApply)}</strong> canal{toApply === 1 ? '' : 'es'}
                      {manualRows.length > 0 ? ` (${formatNumber(manualRows.length)} elegidos a mano)` : ''}.
                    </>
                  )}
                </span>
                {applying && (
                  <span className="row-inline text-sm">
                    <Spinner size={14} /> Aplicando {formatNumber(applying.done)} / {formatNumber(applying.total)}…
                  </span>
                )}
                <button type="button" className="btn btn-primary" disabled={toApply === 0 || applying !== null} onClick={() => void apply()}>
                  {applying ? <Spinner size={14} /> : <CircleCheck size={16} />} Aplicar
                </button>
              </div>
            </>
          )}
        </>
      )}

      <EpgSearchModal
        open={manualFor !== null}
        title={manualFor ? `Buscar EPG para «${manualFor.name}»` : 'Buscar en la guía'}
        initialSearch={manualFor?.name ?? ''}
        confirmLabel="Usar esta"
        onClose={() => setManualFor(null)}
        onPick={(ch) => {
          if (manualFor) {
            setChoice(manualFor.stream_id, {
              checked: true,
              pick: { xmltv_id: ch.xmltv_id, display_name: ch.display_names[0] ?? ch.xmltv_id, icon: ch.icon, source: ch.source_name, score: 100 },
            });
          }
          setManualFor(null);
        }}
      />
    </div>
  );
}

function Tile({ value, label, tone }: { value: number; label: string; tone?: 'green' | 'amber' | 'gray' | 'blue' }) {
  return (
    <div className="stat-tile">
      <span className={`stat-tile-value ${tone ? `tile-${tone}` : ''}`}>{formatNumber(value)}</span>
      <span className="stat-tile-label">{label}</span>
    </div>
  );
}

function MatchCell({ item, choice, min }: { item: EpgMatchItem; choice: Choice | undefined; min: number }) {
  const pick = choice?.pick ?? null;
  if (!pick) return <Badge tone="gray">Sin coincidencia</Badge>;
  const manual = isManual(item, choice);
  const fromSearch = manual && pick.xmltv_id !== item.match?.xmltv_id && !item.alternatives.some((a) => a.xmltv_id === pick.xmltv_id);
  const status = manual ? (
    <Badge tone="blue">Elegida a mano</Badge>
  ) : item.action === 'assign' ? (
    <Badge tone="green">Se asignará</Badge>
  ) : item.action === 'suggest' ? (
    <Badge tone="amber">Sugerencia</Badge>
  ) : (
    <Badge tone="gray">Poco parecido</Badge>
  );
  return (
    <div className="epg-match">
      <Thumb src={pick.icon || null} alt={pick.display_name} />
      <div className="epg-match-main">
        <span className="row-inline">
          <span className="strong">{pick.display_name}</span>
          {status}
          {item.logo_filled && !manual && <Badge tone="purple">Logo</Badge>}
        </span>
        <span className="mono text-xs">{pick.xmltv_id}</span>
        <span className="muted text-xs">{pick.source}</span>
        {fromSearch ? <span className="muted text-xs">Búsqueda manual</span> : <ScoreBar score={pick.score} min={min} />}
      </div>
    </div>
  );
}
