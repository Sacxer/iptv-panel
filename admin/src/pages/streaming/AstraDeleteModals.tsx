import { useEffect, useState } from 'react';
import { Trash2, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Checkbox, FormField, Spinner } from '../../components/ui';
import type { AstraSource } from '../../types';
import { formatNumber } from '../../utils/format';

export type DeleteScope = 'all' | 'group' | 'selected';

const CONFIRM_WORD = 'ELIMINAR';

function resultToast(deleted: number, categories: number): string {
  const ch = `${formatNumber(deleted)} canal${deleted === 1 ? '' : 'es'}`;
  return categories > 0
    ? `Se eliminaron ${ch} y ${formatNumber(categories)} categoría${categories === 1 ? '' : 's'} vacía${categories === 1 ? '' : 's'}`
    : `Se eliminaron ${ch}`;
}

function DeleteWarning({ sourceDeleted = false }: { sourceDeleted?: boolean }) {
  return (
    <div className="danger-note">
      <TriangleAlert size={18} />
      <div>
        <strong>Esta acción no se puede deshacer en el portal.</strong> Los canales se eliminan del portal y de los paquetes y listas de los
        clientes, y quien los esté viendo se desconecta. <strong>En Astra no se modifica nada</strong>
        {sourceDeleted
          ? ': podrás volver a agregar la fuente e importarlos otra vez.'
          : ': los canales vuelven a «sin importar» y puedes importarlos otra vez cuando quieras.'}
      </div>
    </div>
  );
}

/** Confirmación para eliminar del portal los canales importados de una fuente Astra. */
export function DeleteImportedModal({
  open,
  source,
  defaultScope,
  group,
  groupImported,
  selectedIds,
  onClose,
  onDeleted,
}: {
  open: boolean;
  source: AstraSource;
  defaultScope: DeleteScope;
  group: string;
  groupImported: number | null;
  selectedIds: number[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [scope, setScope] = useState<DeleteScope>(defaultScope);
  const [removeCategories, setRemoveCategories] = useState(true);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setScope(defaultScope);
    setRemoveCategories(true);
    setTyped('');
    setError(null);
  }, [open, defaultScope]);

  const total = source.counts.imported;
  const options: { value: DeleteScope; label: string; count: number | null; available: boolean }[] = [
    { value: 'all', label: `Todos los importados (${formatNumber(total)})`, count: total, available: total > 0 },
    {
      value: 'group',
      label: group ? `Solo el grupo «${group}»${groupImported !== null ? ` (${formatNumber(groupImported)})` : ''}` : 'Solo el grupo seleccionado',
      count: groupImported,
      available: Boolean(group) && (groupImported ?? 0) > 0,
    },
    {
      value: 'selected',
      label: `Solo los seleccionados (${formatNumber(selectedIds.length)})`,
      count: selectedIds.length,
      available: selectedIds.length > 0,
    },
  ];
  const current = options.find((o) => o.value === scope);
  const needsWord = scope === 'all';
  const canSubmit = Boolean(current?.available) && (!needsWord || typed.trim().toUpperCase() === CONFIRM_WORD);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const body =
        scope === 'all'
          ? { all: true as const, remove_empty_categories: removeCategories }
          : scope === 'group'
            ? { group, remove_empty_categories: removeCategories }
            : { channel_ids: selectedIds, remove_empty_categories: removeCategories };
      const res = await api.astra.deleteImported(source.id, body);
      toast.success(resultToast(res.deleted, res.categories_deleted));
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Eliminar canales importados"
      onClose={onClose}
      dismissible={!busy}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy || !canSubmit}>
            {busy ? <Spinner size={14} /> : <Trash2 size={15} />} Eliminar{current?.count ? ` ${formatNumber(current.count)}` : ''} del portal
          </button>
        </>
      }
    >
      <p className="muted text-sm no-margin">
        Fuente: <strong>{source.name}</strong>
      </p>
      <FormField label="¿Qué canales quieres eliminar?">
        <div className="radio-cards">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`radio-card ${scope === o.value ? 'is-active' : ''}`}
              disabled={!o.available}
              onClick={() => setScope(o.value)}
              aria-pressed={scope === o.value}
            >
              <span className="radio-card-head">
                <span className="radio-dot" />
                <span className="radio-card-title">{o.label}</span>
              </span>
              {!o.available && (
                <span className="radio-card-desc">
                  {o.value === 'group' ? 'Activa un grupo con canales importados para usar esta opción.' : o.value === 'selected' ? 'Selecciona filas importadas en la tabla.' : 'No hay canales importados.'}
                </span>
              )}
            </button>
          ))}
        </div>
      </FormField>
      <Checkbox checked={removeCategories} onChange={setRemoveCategories} label="Eliminar también las categorías que queden vacías" />
      <DeleteWarning />
      {needsWord && (
        <FormField label={`Para confirmar, escribe ${CONFIRM_WORD}`}>
          <input className="input mono" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} placeholder={CONFIRM_WORD} />
        </FormField>
      )}
      {error && <div className="field-message">{error}</div>}
    </Modal>
  );
}

/** Confirmación para eliminar una fuente Astra, opcionalmente con sus canales importados. */
export function DeleteSourceModal({ source, onClose, onDeleted }: { source: AstraSource | null; onClose: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const [deleteStreams, setDeleteStreams] = useState(false);
  const [removeCategories, setRemoveCategories] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source) return;
    setDeleteStreams(false);
    setRemoveCategories(true);
    setError(null);
  }, [source]);

  const imported = source?.counts.imported ?? 0;

  const submit = async () => {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.astra.remove(source.id, { delete_streams: deleteStreams && imported > 0, remove_empty_categories: deleteStreams && removeCategories });
      toast.success(
        deleteStreams && imported > 0
          ? `Fuente eliminada. ${resultToast(res.deleted ?? 0, res.categories_deleted ?? 0)}`
          : 'Fuente eliminada',
      );
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={source !== null}
      title="Eliminar fuente Astra"
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy}>
            {busy ? <Spinner size={14} /> : <Trash2 size={15} />} Eliminar fuente
          </button>
        </>
      }
    >
      {source && (
        <div className="stack-sm">
          <p className="no-margin">
            ¿Eliminar la fuente <strong>{source.name}</strong>?
          </p>
          {imported > 0 ? (
            <>
              <Checkbox
                checked={deleteStreams}
                onChange={setDeleteStreams}
                label={`Eliminar también sus ${formatNumber(imported)} canales importados`}
              />
              {deleteStreams ? (
                <>
                  <div className="sub-option">
                    <Checkbox checked={removeCategories} onChange={setRemoveCategories} label="Eliminar también las categorías que queden vacías" />
                  </div>
                  <DeleteWarning sourceDeleted />
                </>
              ) : (
                <p className="muted text-sm no-margin">
                  Los {formatNumber(imported)} canales importados se quedan en el portal y siguen funcionando, pero dejarán de sincronizarse con
                  Astra (cambios de URL, nombres, altas y bajas).
                </p>
              )}
            </>
          ) : (
            <p className="muted text-sm no-margin">Esta fuente no tiene canales importados en el portal.</p>
          )}
          {error && <div className="field-message">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
