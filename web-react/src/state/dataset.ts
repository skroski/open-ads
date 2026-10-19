import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../lib/http';

export interface DatasetState<T> {
  value: T | undefined;
  loading: boolean;
  error: string | null;
  /** Momento (ms) da última carga concluída com sucesso. */
  loadedAt: number | null;
  reload(): void;
}

/**
 * Conjunto de dados carregado sob demanda: só consulta quando `enabled` e há parâmetros,
 * recarrega sozinho quando eles mudam e cancela a consulta anterior. Ao recarregar com os
 * mesmos parâmetros mantém o valor antigo na tela (como o `resource` do Angular).
 */
export function useDataset<T, P>(
  params: P | undefined,
  loader: (params: P, signal: AbortSignal) => Promise<T>,
  enabled: boolean,
): DatasetState<T> {
  const [state, setState] = useState<{ value: T | undefined; loading: boolean; error: string | null; loadedAt: number | null }>({
    value: undefined,
    loading: false,
    error: null,
    loadedAt: null,
  });
  const [reloads, setReloads] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const key = params === undefined ? '' : JSON.stringify(params);
  const lastKey = useRef(key);

  useEffect(() => {
    if (!enabled || params === undefined) {
      setState({ value: undefined, loading: false, error: null, loadedAt: null });
      return;
    }
    const keyChanged = lastKey.current !== key;
    lastKey.current = key;
    const controller = new AbortController();
    setState((s) => ({ value: keyChanged ? undefined : s.value, loading: true, error: null, loadedAt: keyChanged ? null : s.loadedAt }));
    loaderRef.current(params, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setState({ value, loading: false, error: null, loadedAt: Date.now() });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: describeError(error) }));
      });
    return () => controller.abort();
    // `params` é representado por `key`; o loader vem da ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, reloads]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  return { ...state, reload };
}
