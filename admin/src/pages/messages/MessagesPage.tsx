import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '../../components/ui';
import { MessagesTab } from './MessagesTab';
import { RemindersTab } from './RemindersTab';

type TabKey = 'mensajes' | 'recordatorios';

export function MessagesPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabKey = params.get('tab') === 'recordatorios' ? 'recordatorios' : 'mensajes';
  const [reminderFilter, setReminderFilter] = useState<{ id: number; title: string } | null>(null);

  const setTab = (t: TabKey) => {
    const next = new URLSearchParams(params);
    if (t === 'recordatorios') next.set('tab', t);
    else next.delete('tab');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title="Mensajes" subtitle="Bandeja de entrada de las apps de los clientes y recordatorios automáticos" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'mensajes', label: 'Mensajes' },
          { value: 'recordatorios', label: 'Recordatorios' },
        ]}
      />
      <div className="mt">
        {tab === 'mensajes' ? (
          <MessagesTab reminderFilter={reminderFilter} onClearReminder={() => setReminderFilter(null)} />
        ) : (
          <RemindersTab
            onViewSent={(r) => {
              setReminderFilter({ id: r.id, title: r.title });
              setTab('mensajes');
            }}
          />
        )}
      </div>
    </>
  );
}
