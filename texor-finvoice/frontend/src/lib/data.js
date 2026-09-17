'use client';

/**
 * A small fetch-and-cache hook.
 *
 * Every screen reads through `useResource(key, loader)`. Results are cached by
 * key for the session so moving back to a list is instant, and `invalidate`
 * refetches every mounted resource whose key starts with a prefix — saving an
 * invoice invalidates "invoices", and every invoice list and dashboard widget
 * showing one refreshes.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

const cache = new Map();
const listeners = new Set();
let version = 0;

export function invalidate(prefix = '') {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
  version += 1;
  for (const listener of listeners) listener();
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useResource(key, loader, { keepPrevious = true } = {}) {
  const tick = useSyncExternalStore(subscribe, () => version, () => 0);
  const cached = key ? cache.get(key) : undefined;
  const [state, setState] = useState(() => ({ data: cached, error: null, loading: !cached && Boolean(key) }));
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const load = useCallback(async () => {
    if (!key) return;
    setState((prev) => ({ data: cache.get(key) ?? (keepPrevious ? prev.data : undefined), error: null, loading: true }));
    try {
      const data = await loaderRef.current();
      cache.set(key, data);
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState((prev) => ({ data: prev.data, error, loading: false }));
    }
  }, [key, keepPrevious]);

  useEffect(() => {
    if (!key) return;
    if (cache.has(key)) setState({ data: cache.get(key), error: null, loading: false });
    else load();
  }, [key, tick, load]);

  const mutate = useCallback((next) => {
    const value = typeof next === 'function' ? next(cache.get(key)) : next;
    cache.set(key, value);
    setState((prev) => ({ ...prev, data: value }));
  }, [key]);

  return { ...state, reload: load, mutate };
}

/** Debounced value for search boxes. */
export function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** A value kept in localStorage — per-viewer conveniences only. */
export function useStored(key, initial) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw));
    } catch { /* private mode, or blocked storage */ }
  }, [key]);
  const set = useCallback((next) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      try { localStorage.setItem(key, JSON.stringify(resolved)); } catch { /* ignore */ }
      return resolved;
    });
  }, [key]);
  return [value, set];
}
