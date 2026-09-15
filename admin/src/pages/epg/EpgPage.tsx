import { useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useInterval } from '../../hooks/useInterval';
import { PageHeader, Tabs } from '../../components/ui';
import { formatNumber } from '../../utils/format';
import { EpgChannelsTab } from './EpgChannelsTab';
import { EpgMatchTab } from './EpgMatchTab';
import { EpgOverviewTab } from './EpgOverviewTab';

type TabKey = 'resumen' | 'emparejar' | 'canales';
const TABS: TabKey[] = ['resumen', 'emparejar', 'canales'];

export function EpgPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as TabKey | null;
  const tab: TabKey = raw && TABS.includes(raw) ? raw : 'resumen';

  const status = useAsync(() => api.epg.status(), []);
  const settings = useAsync(() => api.settings.get(), []);
  const s = status.data;
  const busy = Boolean(s && (s.guide.building || s.sources.some((x) => x.status === 'refreshing')));

  // Mientras se actualiza alguna guía o se genera la combinada, se consulta el estado cada 3 s.
  useInterval(() => void status.reload(true), busy ? 3000 : null);

  const setTab = (t: TabKey) => {
    const next = new URLSearchParams(params);
    if (t === 'resumen') next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Guía EPG"
        subtitle="Guías de programación XMLTV: fuentes, emparejamiento automático de los canales y guía combinada para los clientes"
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => void status.reload(true)} title="Actualizar">
            <RefreshCw size={16} />
          </button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'resumen', label: 'Resumen y fuentes' },
          {
            value: 'emparejar',
            label: (
              <>
                Emparejar canales {s && s.streams.without_epg > 0 && <span className="tab-count tab-count-alert">{formatNumber(s.streams.without_epg)}</span>}
              </>
            ),
          },
          {
            value: 'canales',
            label: (
              <>
                Canales de las guías {s && s.epg_channels > 0 && <span className="tab-count">{formatNumber(s.epg_channels)}</span>}
              </>
            ),
          },
        ]}
      />
      <div className="mt">
        {tab === 'resumen' ? (
          <EpgOverviewTab status={status} settings={settings} />
        ) : tab === 'emparejar' ? (
          <EpgMatchTab status={s} settings={settings.data} onApplied={() => void status.reload(true)} />
        ) : (
          <EpgChannelsTab sources={s?.sources ?? []} />
        )}
      </div>
    </>
  );
}
