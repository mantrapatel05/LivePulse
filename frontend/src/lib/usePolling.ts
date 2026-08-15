import { useCallback, useEffect, useRef, useState } from "react";

type State<T> = { data: T | null; error: string | null; loading: boolean };

/**
 * Tiny fetch-on-interval hook. The collector is a plain REST service, so we
 * poll instead of pulling in a cache layer for read-only panels.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  intervalMs = 10_000,
): State<T> & { refresh: () => void } {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const fnRef = useRef(fetcher);
  fnRef.current = fetcher;

  const run = useCallback(async () => {
    try {
      const data = await fnRef.current();
      setState({ data, error: null, loading: false });
    } catch (err) {
      setState((s) => ({
        data: s.data,
        error: err instanceof Error ? err.message : "Request failed",
        loading: false,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: s.data === null }));
    void run();
    const t = setInterval(() => {
      if (alive) void run();
    }, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [run, intervalMs]);

  return { ...state, refresh: () => void run() };
}

/** Pulls the first array found in a loosely-typed collector response. */
export function toArray<T = Record<string, unknown>>(value: unknown, ...keys: string[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const k of keys) if (Array.isArray(obj[k])) return obj[k] as T[];
    for (const v of Object.values(obj)) if (Array.isArray(v)) return v as T[];
  }
  return [];
}

export function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function timeAgo(ts: number | string | undefined): string {
  if (!ts) return "—";
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function clock(ts: number | string | undefined): string {
  const t = typeof ts === "number" ? ts : Date.parse(String(ts ?? ""));
  const d = Number.isFinite(t) ? new Date(t) : new Date();
  return d.toTimeString().slice(0, 8);
}
