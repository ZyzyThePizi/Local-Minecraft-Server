import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

/** Runs `fn` now and then every `intervalMs` while `enabled`; pauses while the tab is hidden. */
export function usePoll<T>(fn: () => Promise<T>, intervalMs: number, deps: unknown[], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (document.visibilityState !== 'hidden') {
        try {
          const result = await fnRef.current();
          if (!alive) return;
          setData(result);
          setError(null);
        } catch (err) {
          if (alive) setError(err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', String(err)));
        }
      }
      if (alive) timer = setTimeout(run, intervalMs);
    };
    run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [enabled, intervalMs, tick, ...deps]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, refresh, setData };
}

export function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
