import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Alert, FormField, Select, Spinner } from '../../components/ui';
import type { DeviceBulkAction, DeviceFilterParams, DeviceInventoryStatus, DeviceOwnership, DeviceType } from '../../types';
import { formatNumber } from '../../utils/format';
import { DEVICE_INVENTORY, DEVICE_OWNERSHIP, DEVICE_TYPE_LABEL } from '../../utils/labels';

/** Lo que está seleccionado: IDs concretos o todos los que coinciden con un filtro. */
export type DeviceSelectionTarget = { mode: 'ids'; ids: number[] } | { mode: 'filter'; filter: DeviceFilterParams; total: number };

const CONFIRM_WORD = 'ELIMINAR';
/** A partir de este número de dispositivos, eliminar exige escribir la palabra de confirmación. */
const TYPED_DELETE_OVER = 50;

const META: Record<DeviceBulkAction, { title: string; confirm: string; danger?: boolean; valueLabel?: string }> = {
  set_ownership: { title: 'Cambiar propiedad', confirm: 'Cambiar propiedad', valueLabel: 'Nueva propiedad' },
  set_inventory: { title: 'Estado de inventario', confirm: 'Cambiar estado', valueLabel: 'Nuevo estado de inventario' },
  set_type: { title: 'Cambiar tipo', confirm: 'Cambiar tipo', valueLabel: 'Nuevo tipo' },
  unassign: { title: 'Quitar asignación', confirm: 'Quitar asignación' },
  resolve_alerts: { title: 'Resolver alertas', confirm: 'Resolver alertas' },
  delete: { title: 'Eliminar dispositivos', confirm: 'Eliminar', danger: true },
};

function options(action: DeviceBulkAction): { value: string; label: string }[] {
  if (action === 'set_ownership') return (Object.keys(DEVICE_OWNERSHIP) as DeviceOwnership[]).map((v) => ({ value: v, label: DEVICE_OWNERSHIP[v].label }));
  if (action === 'set_inventory') return (Object.keys(DEVICE_INVENTORY) as DeviceInventoryStatus[]).map((v) => ({ value: v, label: DEVICE_INVENTORY[v].label }));
  if (action === 'set_type') return (Object.keys(DEVICE_TYPE_LABEL) as DeviceType[]).map((v) => ({ value: v, label: DEVICE_TYPE_LABEL[v] }));
  return [];
}

function devicesText(n: number) {
  return `${formatNumber(n)} dispositivo${n === 1 ? '' : 's'}`;
}

function resultText(action: DeviceBulkAction, affected: number, selected: number | undefined): string {
  const d = devicesText(affected);
  const of = selected !== undefined && selected !== affected && action !== 'resolve_alerts' ? ` (de ${formatNumber(selected)} seleccionados)` : '';
  switch (action) {
    case 'delete':
      return `Se eliminaron ${d}${of}`;
    case 'set_ownership':
      return `Propiedad cambiada en ${d}${of}`;
    case 'set_inventory':
      return `Estado de inventario actualizado en ${d}${of}`;
    case 'set_type':
      return `Tipo cambiado en ${d}${of}`;
    case 'unassign':
      return `Se quitó la asignación a ${d}${of}`;
    case 'resolve_alerts':
      return affected === 0 ? 'No había alertas abiertas en la selección' : `Se resolvieron ${formatNumber(affected)} alerta${affected === 1 ? '' : 's'}`;
  }
}

export function DeviceBulkModal({
  action,
  target,
  count,
  onClose,
  onDone,
}: {
  action: DeviceBulkAction | null;
  target: DeviceSelectionTarget | null;
  /** Dispositivos a los que se aplicará (para los textos). */
  count: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!action) return;
    setValue(options(action)[0]?.value ?? '');
    setTyped('');
    setError(null);
  }, [action]);

  if (!action || !target) return null;
  const meta = META[action];
  const needsWord = action === 'delete' && count > TYPED_DELETE_OVER;
  const needsValue = ['set_ownership', 'set_inventory', 'set_type'].includes(action);
  const canSubmit = !busy && (!needsValue || value !== '') && (!needsWord || typed.trim().toUpperCase() === CONFIRM_WORD);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const v = needsValue ? value : action === 'resolve_alerts' && value.trim() ? value.trim() : undefined;
      const base = { action, ...(v !== undefined ? { value: v } : {}) };
      const res = await api.devices.bulk(target.mode === 'filter' ? { ...base, filter: target.filter } : { ...base, ids: target.ids });
      toast.success(resultText(action, res.affected ?? 0, res.selected));
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={meta.title}
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className={`btn ${meta.danger ? 'btn-danger' : 'btn-primary'}`} disabled={!canSubmit}>
            {busy && <Spinner size={14} />} {meta.confirm}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="no-margin">
          Se aplicará a <strong>{devicesText(count)}</strong>
          {target.mode === 'filter' ? ' (todos los que coinciden con los filtros)' : ''}.
        </p>
        {needsValue && (
          <FormField label={meta.valueLabel} htmlFor="bulk-value" hint={action === 'set_type' ? 'El tipo queda fijado y la detección automática ya no lo cambiará.' : undefined}>
            <Select id="bulk-value" value={value} onChange={setValue} options={options(action)} />
          </FormField>
        )}
        {action === 'unassign' && (
          <p className="muted text-sm no-margin">Los dispositivos quedarán sin cliente; los que estaban «Asignado» pasan a «En bodega».</p>
        )}
        {action === 'resolve_alerts' && (
          <FormField label="Nota de resolución (opcional)" htmlFor="bulk-note">
            <input id="bulk-note" className="input" value={value} maxLength={255} placeholder="Revisado en lote" onChange={(e) => setValue(e.target.value)} />
          </FormField>
        )}
        {action === 'delete' && (
          <Alert tone="red">
            Se eliminarán los dispositivos y su historial de alertas. Si un equipo vuelve a conectarse se registrará de nuevo como detectado.
          </Alert>
        )}
        {needsWord && (
          <FormField label={`Para confirmar, escribe ${CONFIRM_WORD}`} htmlFor="bulk-word">
            <input id="bulk-word" className="input mono" value={typed} autoComplete="off" placeholder={CONFIRM_WORD} onChange={(e) => setTyped(e.target.value)} />
          </FormField>
        )}
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}
