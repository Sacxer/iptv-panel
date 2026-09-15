import { useEffect, useRef } from 'react';

/** Ejecuta `callback` cada `delay` ms. Con `delay` null queda en pausa. */
export function useInterval(callback: () => void, delay: number | null): void {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (delay === null) return;
    const id = window.setInterval(() => saved.current(), delay);
    return () => window.clearInterval(id);
  }, [delay]);
}
