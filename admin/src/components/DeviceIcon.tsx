import type { ComponentType } from 'react';
import { Box, CircleHelp, Laptop, Router, Smartphone, Tablet, Tv, type LucideProps } from 'lucide-react';
import type { DeviceType } from '../types';
import { DEVICE_TYPE_LABEL } from '../utils/labels';

const ICONS: Record<DeviceType, ComponentType<LucideProps>> = {
  tvbox: Box,
  smart_tv: Tv,
  mobile: Smartphone,
  tablet: Tablet,
  pc: Laptop,
  stb: Router,
  unknown: CircleHelp,
};

/** Icono del tipo de dispositivo, opcionalmente con indicador de conexión. */
export function DeviceIcon({ type, online, size = 18 }: { type: DeviceType; online?: boolean; size?: number }) {
  const Icon = ICONS[type] ?? CircleHelp;
  return (
    <span className="device-icon" title={DEVICE_TYPE_LABEL[type] ?? type}>
      <Icon size={size} />
      {online !== undefined && (
        <span className={`online-dot ${online ? 'is-online' : ''}`} title={online ? 'En línea' : 'Desconectado'} />
      )}
    </span>
  );
}

/** Notifica al resto de la app (p. ej. la insignia del menú) que cambiaron dispositivos o alertas. */
export const DEVICES_CHANGED_EVENT = 'iptv:devices-changed';

export function notifyDevicesChanged(): void {
  window.dispatchEvent(new Event(DEVICES_CHANGED_EVENT));
}
