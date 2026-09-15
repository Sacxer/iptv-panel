import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { errorMessage } from '../api';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Vuelve a cargar. Con `silent` no muestra el estado de carga (útil al refrescar). */
  reload: (silent?: boolean) => Promise<void>;
  setData: (updater: T | null | ((prev: T | null) => T | null)) => void;
}

/**
 * Ejecuta una función asíncrona cuando cambian las dependencias, evitando
 * condiciones de carrera: solo se aplica la respuesta de la última petición.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async (silent = false) => {
    const id = ++reqId.current;
    if (!silent) setLoading(true);
    try {
      const result = await fnRef.current();
      if (mounted.current && id === reqId.current) {
        setDataState(result);
        setError(null);
      }
    } catch (e) {
      if (mounted.current && id === reqId.current) setError(errorMessage(e));
    } finally {
      if (mounted.current && id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((updater: T | null | ((prev: T | null) => T | null)) => {
    setDataState((prev) =>
      typeof updater === 'function' ? (updater as (p: T | null) => T | null)(prev) : updater,
    );
  }, []);

  return { data, loading, error, reload, setData };
}
