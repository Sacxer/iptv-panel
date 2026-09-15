import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  FolderOpen,
  GripVertical,
  Info,
  RotateCcw,
  Save,
  WandSparkles,
} from 'lucide-react';
import { api, errorMessage, fetchAllPages } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useCategories } from '../../hooks/useResources';
import { Popover } from '../../components/Popover';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, EmptyState, ErrorState, PageHeader, Spinner, Tabs, Thumb } from '../../components/ui';
import type { Category, Stream, StreamSortMode, StreamType } from '../../types';
import { formatNumber } from '../../utils/format';

type CatKey = number | 'none';

const SORT_MODES: { mode: StreamSortMode; label: string; hint?: string }[] = [
  { mode: 'alpha', label: 'Alfabético A–Z' },
  { mode: 'alpha_desc', label: 'Alfabético Z–A' },
  { mode: 'number', label: 'Por número en el nombre', hint: 'Canal 1, 2, 10…' },
  { mode: 'added', label: 'Más antiguos primero' },
  { mode: 'added_desc', label: 'Más recientes primero' },
  { mode: 'epg', label: 'Con EPG primero' },
];

const sameOrder = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Mueve un bloque de ids una posición arriba o abajo conservando su orden relativo. */
function stepMove<T extends { id: number }>(list: T[], ids: Set<number>, dir: -1 | 1): T[] {
  const out = [...list];
  if (dir === -1) {
    for (let i = 1; i < out.length; i++) {
      if (ids.has(out[i].id) && !ids.has(out[i - 1].id)) [out[i - 1], out[i]] = [out[i], out[i - 1]];
    }
  } else {
    for (let i = out.length - 2; i >= 0; i--) {
      if (ids.has(out[i].id) && !ids.has(out[i + 1].id)) [out[i + 1], out[i]] = [out[i], out[i + 1]];
    }
  }
  return out;
}

function edgeMove<T extends { id: number }>(list: T[], ids: Set<number>, edge: 'top' | 'bottom'): T[] {
  const moving = list.filter((x) => ids.has(x.id));
  const rest = list.filter((x) => !ids.has(x.id));
  return edge === 'top' ? [...moving, ...rest] : [...rest, ...moving];
}

/** Inserta los ids arrastrados antes o después de la fila destino. */
function dropMove<T extends { id: number }>(list: T[], ids: Set<number>, targetId: number, after: boolean): T[] {
  if (ids.has(targetId)) return list;
  const moving = list.filter((x) => ids.has(x.id));
  const rest = list.filter((x) => !ids.has(x.id));
  const idx = rest.findIndex((x) => x.id === targetId);
  if (idx < 0) return list;
  const at = idx + (after ? 1 : 0);
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

export function ChannelOrderPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const type: StreamType = params.get('type') === 'movie' ? 'movie' : 'live';
  const isMovie = type === 'movie';
  const noun = isMovie ? 'películas' : 'canales';

  const cats = useCategories(type);
  const [catOrder, setCatOrder] = useState<Category[]>([]);
  const [selectedCat, setSelectedCat] = useState<CatKey | null>(null);
  const [savingCats, setSavingCats] = useState(false);

  const [items, setItems] = useState<Stream[]>([]);
  const [original, setOriginal] = useState<number[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [drag, setDrag] = useState<{ ids: Set<number> } | null>(null);
  const [dropHint, setDropHint] = useState<{ id: number; after: boolean } | null>(null);
  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  const focusAfter = useRef<number | null>(null);

  // Orden de categorías: se toma del servidor salvo que haya cambios sin guardar.
  const savedCatIds = useMemo(() => cats.categories.map((c) => c.id), [cats.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const catDirty = !sameOrder(
    catOrder.map((c) => c.id),
    savedCatIds,
  );
  useEffect(() => {
    setCatOrder(cats.data ? [...cats.data].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)) : []);
  }, [cats.data]);
  useEffect(() => {
    // Espera a que termine de cargar la lista del tipo actual (al cambiar de pestaña quedan un momento las anteriores).
    const fresh = cats.data && !cats.loading && (cats.data.length === 0 || cats.data.every((c) => c.type === type));
    if (selectedCat === null && fresh) setSelectedCat(cats.categories[0]?.id ?? 'none');
  }, [cats.data, cats.loading, selectedCat, type]);

  const streams = useAsync(async () => {
    if (selectedCat === null) return null;
    if (selectedCat === 'none') {
      const all = await fetchAllPages((page, limit) => api.streams.list({ type, page, limit }), 1000);
      return all.filter((s) => s.category_id === null);
    }
    return fetchAllPages((page, limit) => api.streams.list({ type, category_id: selectedCat, page, limit }), 1000);
  }, [type, selectedCat]);

  useEffect(() => {
    const list = streams.data ?? [];
    setItems(list);
    setOriginal(list.map((s) => s.id));
    setSelected(new Set());
    setAnchor(null);
  }, [streams.data]);

  const dirty = !sameOrder(
    items.map((s) => s.id),
    original,
  );

  // Aviso al salir con cambios sin guardar.
  useEffect(() => {
    if (!dirty && !catDirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, catDirty]);

  // Tras mover con el teclado, el foco sigue a la fila.
  useEffect(() => {
    if (focusAfter.current === null) return;
    rowRefs.current.get(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [items]);

  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return confirm({
      title: 'Cambios sin guardar',
      message: `Hay un orden de ${noun} sin guardar en esta categoría. ¿Descartarlo?`,
      confirmText: 'Descartar',
      danger: true,
    });
  }, [dirty, confirm, noun]);

  const chooseCat = async (key: CatKey) => {
    if (key === selectedCat) return;
    if (!(await confirmDiscard())) return;
    setSelectedCat(key);
  };

  const chooseType = async (t: StreamType) => {
    if (t === type) return;
    if (!(await confirmDiscard())) return;
    if (catDirty) {
      const ok = await confirm({ title: 'Cambios sin guardar', message: 'El orden de las categorías no se ha guardado. ¿Descartarlo?', confirmText: 'Descartar', danger: true });
      if (!ok) return;
    }
    setSelectedCat(null);
    const next = new URLSearchParams(params);
    if (t === 'movie') next.set('type', 'movie');
    else next.delete('type');
    setParams(next, { replace: true });
  };

  /** Filas afectadas por una acción de fila: la selección si incluye la fila, si no solo la fila. */
  const idsFor = (id: number) => (selected.has(id) && selected.size > 1 ? new Set(selected) : new Set([id]));

  const move = (ids: Set<number>, how: 'up' | 'down' | 'top' | 'bottom', focusId?: number) => {
    if (focusId !== undefined) focusAfter.current = focusId;
    setItems((list) => (how === 'up' ? stepMove(list, ids, -1) : how === 'down' ? stepMove(list, ids, 1) : edgeMove(list, ids, how)));
  };

  const onRowClick = (e: MouseEvent, id: number, index: number) => {
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    if (e.shiftKey && anchor !== null) {
      const from = items.findIndex((s) => s.id === anchor);
      const [a, b] = from < index ? [from, index] : [index, from];
      setSelected(new Set(items.slice(a, b + 1).map((s) => s.id)));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelected(new Set([id]));
    }
    setAnchor(id);
  };

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, id: number, index: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const ids = selected.has(id) ? new Set(selected) : new Set([id]);
      if (!selected.has(id)) setSelected(new Set([id]));
      move(ids, e.key === 'ArrowUp' ? 'up' : 'down', id);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[index + (e.key === 'ArrowUp' ? -1 : 1)];
      if (next) rowRefs.current.get(next.id)?.focus();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      toggle(id);
    }
  };

  const onDragStart = (e: DragEvent<HTMLLIElement>, id: number) => {
    const ids = idsFor(id);
    setDrag({ ids });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
  };

  const onDragOver = (e: DragEvent<HTMLLIElement>, id: number) => {
    if (!drag) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDropHint((h) => (h && h.id === id && h.after === after ? h : { id, after }));
  };

  const onDrop = (e: DragEvent<HTMLLIElement>, id: number) => {
    e.preventDefault();
    if (drag && dropHint) setItems((list) => dropMove(list, drag.ids, id, dropHint.after));
    setDrag(null);
    setDropHint(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      const ids = items.map((s) => s.id);
      await api.streams.reorder(ids);
      setOriginal(ids);
      toast.success(`Orden guardado (${formatNumber(ids.length)} ${noun})`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const autoSort = async (mode: StreamSortMode, label: string) => {
    if (selectedCat === null) return;
    const catName = selectedCat === 'none' ? 'Sin categoría' : catOrder.find((c) => c.id === selectedCat)?.name ?? '';
    const ok = await confirm({
      title: 'Ordenar automáticamente',
      message: (
        <>
          Se ordenarán los {formatNumber(items.length)} {noun} de <strong>{catName}</strong> por «{label}» y se guardará al instante
          {dirty ? '; el orden manual sin guardar se descartará' : ''}.
        </>
      ),
      confirmText: 'Ordenar',
    });
    if (!ok) return;
    setSorting(true);
    try {
      await api.streams.sort({ type, category_id: selectedCat === 'none' ? null : selectedCat, mode });
      toast.success(`Ordenados por «${label}»`);
      await streams.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSorting(false);
    }
  };

  // ---------- Categorías ----------
  const [catDrag, setCatDrag] = useState<number | null>(null);
  const moveCat = (id: number, dir: -1 | 1) => setCatOrder((list) => stepMove(list, new Set([id]), dir));
  const saveCats = async () => {
    setSavingCats(true);
    try {
      await api.categories.reorder(catOrder.map((c) => c.id));
      toast.success('Orden de categorías guardado');
      await cats.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSavingCats(false);
    }
  };

  const currentCatName = selectedCat === 'none' ? 'Sin categoría' : catOrder.find((c) => c.id === selectedCat)?.name ?? '';

  return (
    <>
      <PageHeader
        title="Ordenar canales"
        subtitle="Orden de las categorías y de los canales y películas dentro de cada una"
        actions={
          <Link to={isMovie ? '/peliculas' : '/canales'} className="btn btn-ghost">
            <ArrowLeft size={16} /> {isMovie ? 'Películas' : 'Canales'}
          </Link>
        }
      />
      <Tabs
        value={type}
        onChange={(t) => void chooseType(t)}
        tabs={[
          { value: 'live', label: 'Canales en vivo' },
          { value: 'movie', label: 'Películas' },
        ]}
      />
      <Alert tone="blue" icon={<Info size={18} />}>
        Así los verán los clientes en IPTV Smarters, TiviMate y la app: primero por el orden de las categorías y dentro de cada una en este orden; el
        número de canal es la posición. Aquí se muestra la posición dentro de la categoría.
      </Alert>

      <div className="order-layout">
        {/* Categorías */}
        <section className="card order-cats">
          <h2 className="card-title">Categorías</h2>
          {cats.loading && !cats.data ? (
            <Spinner label="Cargando…" />
          ) : cats.error && !cats.data ? (
            <ErrorState message={cats.error} onRetry={() => void cats.reload()} />
          ) : (
            <>
              <ol className="order-cat-list">
                {catOrder.map((c, i) => (
                  <li
                    key={c.id}
                    draggable
                    className={`order-cat ${selectedCat === c.id ? 'is-selected' : ''} ${catDrag === c.id ? 'is-dragging' : ''}`}
                    onDragStart={(e) => {
                      setCatDrag(c.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', `cat-${c.id}`);
                    }}
                    onDragOver={(e) => {
                      if (catDrag !== null) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (catDrag === null) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const after = e.clientY > rect.top + rect.height / 2;
                      setCatOrder((list) => dropMove(list, new Set([catDrag]), c.id, after));
                      setCatDrag(null);
                    }}
                    onDragEnd={() => setCatDrag(null)}
                  >
                    <GripVertical size={14} className="drag-handle" aria-hidden />
                    <button type="button" className="order-cat-name" onClick={() => void chooseCat(c.id)} aria-current={selectedCat === c.id}>
                      <span className="order-cat-pos">{i + 1}</span>
                      <span className="ellipsis">{c.name}</span>
                      <span className="muted text-xs">{formatNumber(c.item_count)}</span>
                    </button>
                    <span className="order-cat-actions">
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Subir" aria-label={`Subir ${c.name}`} disabled={i === 0} onClick={() => moveCat(c.id, -1)}>
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        title="Bajar"
                        aria-label={`Bajar ${c.name}`}
                        disabled={i === catOrder.length - 1}
                        onClick={() => moveCat(c.id, 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                    </span>
                  </li>
                ))}
                <li className={`order-cat order-cat-none ${selectedCat === 'none' ? 'is-selected' : ''}`}>
                  <FolderOpen size={14} className="muted" aria-hidden />
                  <button type="button" className="order-cat-name" onClick={() => void chooseCat('none')} aria-current={selectedCat === 'none'}>
                    <span className="ellipsis">Sin categoría</span>
                  </button>
                </li>
              </ol>
              {catDirty && (
                <div className="order-save-bar order-save-bar-inline">
                  <span className="text-sm">Orden de categorías sin guardar</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCatOrder(cats.categories)} disabled={savingCats}>
                    Descartar
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveCats()} disabled={savingCats}>
                    {savingCats ? <Spinner size={13} /> : <Save size={14} />} Guardar
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Canales de la categoría */}
        <section className="card order-items">
          <div className="section-header">
            <div className="min-w-0">
              <h2 className="card-title no-margin ellipsis">{currentCatName || '—'}</h2>
              <p className="muted text-xs no-margin">
                {formatNumber(items.length)} {noun} · arrastra, usa los botones o selecciona y pulsa Alt+↑/↓
              </p>
            </div>
            <Popover
              triggerClassName="btn btn-secondary btn-sm"
              triggerTitle="Ordenar automáticamente esta categoría"
              closeOnSelect
              width={260}
              trigger={
                <>
                  {sorting ? <Spinner size={13} /> : <WandSparkles size={14} />} Ordenar automáticamente
                </>
              }
            >
              <div className="order-sort-menu" role="menu">
                {SORT_MODES.map((m) => (
                  <button
                    key={m.mode}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={sorting || items.length < 2}
                    onClick={() => void autoSort(m.mode, m.label)}
                  >
                    <span className="menu-item-text">
                      <span>{m.label}</span>
                      {m.hint && <span className="menu-item-hint">{m.hint}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </Popover>
          </div>

          {selected.size > 1 && (
            <div className="order-selection-bar">
              <span className="text-sm strong">{formatNumber(selected.size)} seleccionados</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(new Set(selected), 'top')}>
                <ChevronsUp size={14} /> Al principio
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(new Set(selected), 'up')}>
                <ArrowUp size={14} /> Subir
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(new Set(selected), 'down')}>
                <ArrowDown size={14} /> Bajar
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(new Set(selected), 'bottom')}>
                <ChevronsDown size={14} /> Al final
              </button>
              <button type="button" className="btn btn-link btn-sm" onClick={() => setSelected(new Set())}>
                Quitar selección
              </button>
            </div>
          )}

          {streams.loading && !streams.data ? (
            <Spinner label="Cargando…" />
          ) : streams.error && !streams.data ? (
            <ErrorState message={streams.error} onRetry={() => void streams.reload()} />
          ) : items.length === 0 ? (
            <EmptyState title={`No hay ${noun} en esta categoría`} />
          ) : (
            <ol className="order-list" aria-label={`Orden de ${noun}`} onDragLeave={(e) => e.currentTarget === e.target && setDropHint(null)}>
              {items.map((s, i) => {
                const isSel = selected.has(s.id);
                const hint = dropHint?.id === s.id ? (dropHint.after ? 'drop-after' : 'drop-before') : '';
                return (
                  <li
                    key={s.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(s.id, el);
                      else rowRefs.current.delete(s.id);
                    }}
                    tabIndex={0}
                    draggable
                    aria-selected={isSel}
                    className={`order-row ${isSel ? 'is-selected' : ''} ${drag?.ids.has(s.id) ? 'is-dragging' : ''} ${hint}`}
                    onClick={(e) => onRowClick(e, s.id, i)}
                    onKeyDown={(e) => onRowKey(e, s.id, i)}
                    onDragStart={(e) => onDragStart(e, s.id)}
                    onDragOver={(e) => onDragOver(e, s.id)}
                    onDrop={(e) => onDrop(e, s.id)}
                    onDragEnd={() => {
                      setDrag(null);
                      setDropHint(null);
                    }}
                  >
                    <input type="checkbox" className="checkbox" checked={isSel} onChange={() => toggle(s.id)} aria-label={`Seleccionar ${s.name}`} />
                    <GripVertical size={15} className="drag-handle" aria-hidden />
                    <span className="order-pos" title="Posición dentro de la categoría">
                      {i + 1}
                    </span>
                    <Thumb src={(isMovie ? s.info?.cover || s.logo : s.logo) || null} alt={s.name} variant={isMovie ? 'poster' : 'logo'} />
                    <span className="order-name">
                      <span className="strong ellipsis">{s.name}</span>
                      <span className="order-badges">
                        {!isMovie && (s.epg_channel_id ? <Badge tone="green">EPG</Badge> : <Badge tone="gray">Sin EPG</Badge>)}
                        {!s.enabled && <Badge tone="gray">Deshabilitado</Badge>}
                      </span>
                    </span>
                    <span className="order-row-actions">
                      <button type="button" className="btn btn-ghost btn-icon btn-sm hide-mobile" title="Al principio" disabled={i === 0} onClick={() => move(idsFor(s.id), 'top')}>
                        <ChevronsUp size={14} />
                      </button>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Subir" disabled={i === 0} onClick={() => move(idsFor(s.id), 'up')}>
                        <ArrowUp size={14} />
                      </button>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Bajar" disabled={i === items.length - 1} onClick={() => move(idsFor(s.id), 'down')}>
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm hide-mobile"
                        title="Al final"
                        disabled={i === items.length - 1}
                        onClick={() => move(idsFor(s.id), 'bottom')}
                      >
                        <ChevronsDown size={14} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {dirty && (
        <div className="order-save-bar" role="status">
          <span className="text-sm">
            Orden de <strong>{currentCatName}</strong> sin guardar
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={saving}
            onClick={() => {
              setItems((list) => original.map((id) => list.find((s) => s.id === id)).filter((s): s is Stream => Boolean(s)));
              setSelected(new Set());
            }}
          >
            <RotateCcw size={14} /> Descartar
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>
            {saving ? <Spinner size={13} /> : <Save size={14} />} Guardar orden
          </button>
        </div>
      )}
    </>
  );
}
