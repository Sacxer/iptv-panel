import { ChevronDown } from 'lucide-react';
import type { BillingConfig, ExternalService, MappedStatus } from '../types';
import { FREE_HINT, MAPPED_STATUS } from '../utils/labels';
import { Popover } from './Popover';
import { Badge } from './ui';

type StatusMap = BillingConfig['status_map'] | null | undefined;

/** Traduce un estado de la plataforma (p. ej. «Gratis») a su estado mapeado según `status_map`. */
export function mapExternalStatus(raw: string | null | undefined, statusMap: StatusMap): MappedStatus {
  if (!raw || !statusMap) return null;
  const v = raw.trim().toLowerCase();
  const has = (list?: string[]) => (list ?? []).some((s) => s.trim().toLowerCase() === v);
  if (has(statusMap.free)) return 'free';
  if (has(statusMap.active)) return 'active';
  if (has(statusMap.suspended)) return 'suspended';
  if (has(statusMap.disabled)) return 'disabled';
  return 'unknown';
}

/** Estado externo con el color de su estado mapeado; Gratis lleva la aclaración de que no le afecta el corte. */
export function ExternalStatusBadge({ status, mapped, dot = true }: { status: string | null | undefined; mapped: MappedStatus; dot?: boolean }) {
  const meta = mapped ? MAPPED_STATUS[mapped] : null;
  const badge = (
    <Badge tone={meta?.tone ?? 'purple'} dot={dot}>
      {status || '—'}
    </Badge>
  );
  if (mapped === 'free') {
    return (
      <span className="has-tip" title={FREE_HINT}>
        {badge}
      </span>
    );
  }
  return meta ? badge : <span title="Estado sin mapear">{badge}</span>;
}

/**
 * Distintivo de cuenta vinculada a la plataforma. Con varios servicios (misma cédula) muestra
 * «WispHub · N servicios» y un panel con cada servicio.
 */
export function ExternalLinkBadge({
  platformName,
  externalId,
  externalStatus,
  services,
  statusMap,
  title,
}: {
  platformName: string;
  externalId: string;
  externalStatus?: string | null;
  services?: ExternalService[];
  statusMap: StatusMap;
  title?: string;
}) {
  const list = services ?? [];
  if (list.length <= 1) {
    const mapped = statusMap ? mapExternalStatus(externalStatus, statusMap) : null;
    return (
      <span className={`badge ${mapped === 'free' ? 'badge-teal' : 'badge-blue'}`} title={mapped === 'free' ? `${title ?? ''} · ${FREE_HINT}` : title}>
        {platformName}
        {externalStatus ? ` · ${externalStatus}` : ''}
      </span>
    );
  }
  const anyOn = list.some((s) => {
    const m = mapExternalStatus(s.status, statusMap);
    return m === 'free' || m === 'active';
  });
  return (
    <Popover
      triggerClassName={`badge badge-blue badge-button ${anyOn ? '' : 'is-off'}`}
      triggerTitle={`Vinculado a ${list.length} servicios (ID principal ${externalId})`}
      trigger={
        <>
          {platformName} · {list.length} servicios <ChevronDown size={11} />
        </>
      }
    >
      <div className="services-pop">
        <div className="services-pop-title">
          {list.length} servicios en {platformName}
        </div>
        <ul className="services-pop-list">
          {list.map((s) => (
            <li key={s.external_id}>
              <span className="mono text-sm">#{s.external_id}</span>
              <span className="services-pop-plan" title={s.plan || undefined}>
                {s.plan || <span className="muted">Sin plan</span>}
              </span>
              <ExternalStatusBadge status={s.status} mapped={statusMap ? mapExternalStatus(s.status, statusMap) : null} />
            </li>
          ))}
        </ul>
        <p className="services-pop-note">Una sola cuenta IPTV: queda activa si algún servicio está Gratis o Activo.</p>
      </div>
    </Popover>
  );
}
