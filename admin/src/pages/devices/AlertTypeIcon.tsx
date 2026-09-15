import { BellPlus, Clock, UserRoundX } from 'lucide-react';
import type { DeviceAlertType } from '../../types';
import { DEVICE_ALERT } from '../../utils/labels';

/** Icono con color distinto para cada tipo de alerta de dispositivo. */
export function AlertTypeIcon({ type }: { type: DeviceAlertType }) {
  const tone = DEVICE_ALERT[type]?.tone ?? 'gray';
  const icon = type === 'inactive' ? <Clock size={16} /> : type === 'new_tvbox' ? <BellPlus size={16} /> : <UserRoundX size={16} />;
  return (
    <span className={`alert-type-icon stat-${tone}`} title={DEVICE_ALERT[type]?.label ?? type}>
      {icon}
    </span>
  );
}
