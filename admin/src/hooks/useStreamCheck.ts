import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, errorMessage } from '../api';
import { useToast } from '../components/Toast';
import type { StreamCheckResponse, StreamHealth, StreamType } from '../types';
import { formatNumber } from '../utils/format';
import { useInterval } from './useInterval';

const POLL_MS = 3000;

/**
 * Estado de la revisión de salud de canales/películas: permite iniciar una revisión completa
 * (en segundo plano, seguida con GET /streams/health cada 3 s) o revisar contenidos concretos.
 */
export function useStreamCheck(options: { initialRunning?: boolean; onFinished?: (health: StreamHealth) => void } = {}) {
  const toast = useToast();
  const [health, setHealth] = useState<StreamHealth | null>(null);
  const [running, setRunning] = useState(Boolean(options.initialRunning));
  const [runningType, setRunningType] = useState<StreamType | null>(null);
  const [starting, setStarting] = useState(false);
  const onFinished = useRef(options.onFinished);
  onFinished.current = options.onFinished;

  useEffect(() => {
    if (options.initialRunning) setRunning(true);
  }, [options.initialRunning]);

  const runningRef = useRef(running);
  runningRef.current = running;

  const poll = useCallback(async () => {
    try {
      const h = await api.streams.health();
      setHealth(h);
      if (h.running) {
        setRunning(true);
      } else if (runningRef.current) {
        runningRef.current = false;
        setRunning(false);
        setRunningType(null);
        onFinished.current?.(h);
      }
    } catch {
      /* se reintenta en el siguiente ciclo */
    }
  }, []);

  useInterval(() => void poll(), running ? POLL_MS : null);

  const startAll = useCallback(
    async (type: StreamType) => {
      setStarting(true);
      try {
        const res = await api.streams.check({ type, all: true });
        setRunningType(type);
        if (res?.running === false) {
          // La revisión terminó enseguida: se consulta el estado final y se notifica.
          runningRef.current = true;
          await poll();
        } else {
          setRunning(true);
          toast.info(type === 'live' ? 'Revisando canales en segundo plano…' : 'Revisando películas en segundo plano…');
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          toast.info('Ya hay una revisión en curso');
          setRunning(true);
        } else toast.error(errorMessage(e));
      } finally {
        setStarting(false);
      }
    },
    [poll, toast],
  );

  /** Revisa hasta 50 contenidos y devuelve la respuesta (con `results`). */
  const checkIds = useCallback(
    async (ids: number[]): Promise<StreamCheckResponse | null> => {
      if (ids.length === 0) return null;
      if (ids.length > 50) {
        toast.error('Puedes revisar como máximo 50 contenidos a la vez');
        return null;
      }
      try {
        return await api.streams.check({ ids });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) toast.info('Ya hay una revisión en curso; inténtalo en unos segundos');
        else toast.error(errorMessage(e));
        return null;
      }
    },
    [toast],
  );

  return { health, running, runningType, starting, startAll, checkIds, refresh: poll };
}

export function checkSummary(res: StreamCheckResponse): string {
  const results = res.results;
  if (results && results.length === 1) {
    const r = results[0];
    return r.status === 'online'
      ? `En línea${r.ms !== null ? ` (${formatNumber(r.ms)} ms)` : ''}`
      : `Caído${r.error ? `: ${r.error}` : ''}`;
  }
  const online = results ? results.filter((r) => r.status === 'online').length : res.progress?.online ?? 0;
  const offline = results ? results.filter((r) => r.status === 'offline').length : res.progress?.offline ?? 0;
  return `Revisión completada: ${formatNumber(online)} en línea, ${formatNumber(offline)} caído(s)`;
}
