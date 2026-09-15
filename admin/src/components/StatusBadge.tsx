import type { ContentSource, UserStatus } from '../types';
import { SOURCE_LABEL, USER_STATUS } from '../utils/labels';
import { Badge } from './ui';

export function StatusBadge({ status }: { status: UserStatus }) {
  const s = USER_STATUS[status] ?? { label: status, tone: 'gray' as const };
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export function EnabledBadge({ enabled, on = 'Habilitado', off = 'Deshabilitado' }: { enabled: boolean; on?: string; off?: string }) {
  return (
    <Badge tone={enabled ? 'green' : 'gray'} dot>
      {enabled ? on : off}
    </Badge>
  );
}

export function SourceBadge({ source }: { source: ContentSource }) {
  if (source === 'local') return <Badge tone="gray">{SOURCE_LABEL.local}</Badge>;
  return <Badge tone={source === 'xtreamui' ? 'purple' : 'orange'}>{SOURCE_LABEL[source] ?? source}</Badge>;
}
