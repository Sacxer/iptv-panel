import { api, asList } from '../api';
import type { StreamingServer, TranscodeProfile } from '../types';
import { useAsync } from './useAsync';
import { useInterval } from './useInterval';
import { usePageVisible } from './usePageVisible';

/** Servidores de streaming; con `pollMs` se refresca periódicamente mientras la pestaña está visible. */
export function useServers(enabled = true, pollMs: number | null = null) {
  const visible = usePageVisible();
  const state = useAsync<StreamingServer[]>(async () => (enabled ? asList(await api.servers.list()) : []), [enabled]);
  useInterval(() => void state.reload(true), enabled && pollMs && visible ? pollMs : null);
  return { ...state, servers: state.data ?? [] };
}

export function useProfiles(enabled = true) {
  const state = useAsync<TranscodeProfile[]>(async () => (enabled ? asList(await api.profiles.list()) : []), [enabled]);
  return { ...state, profiles: state.data ?? [] };
}
