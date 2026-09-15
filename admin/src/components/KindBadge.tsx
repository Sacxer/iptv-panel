import type { ComponentType } from 'react';
import { CalendarClock, CreditCard, Info, LifeBuoy, Tag, Wrench, type LucideProps } from 'lucide-react';
import type { MessageKind } from '../types';
import { MESSAGE_KIND } from '../utils/labels';

const ICONS: Record<MessageKind, ComponentType<LucideProps>> = {
  payment: CreditCard,
  expiration: CalendarClock,
  maintenance: Wrench,
  promotion: Tag,
  support: LifeBuoy,
  general: Info,
};

/** Insignia con icono y color según el tipo de mensaje o recordatorio. */
export function KindBadge({ kind, compact = false }: { kind: MessageKind | undefined; compact?: boolean }) {
  const k = kind && MESSAGE_KIND[kind] ? kind : 'general';
  const Icon = ICONS[k];
  const meta = MESSAGE_KIND[k];
  return (
    <span className={`badge badge-${meta.tone} kind-badge`} title={meta.label}>
      <Icon size={12} />
      {!compact && meta.label}
    </span>
  );
}

export function KindIcon({ kind, size = 16 }: { kind: MessageKind; size?: number }) {
  const Icon = ICONS[kind] ?? Info;
  return <Icon size={size} />;
}
