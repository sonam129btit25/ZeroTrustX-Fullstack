import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { PermissionDef, RoleFull } from "./types";

/** Returns `value` after it has been stable for `delay` ms. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Forces a re-render every `ms` so relative timestamps stay fresh. */
export function useTick(ms = 30_000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setN((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

export function useRoles(enabled = true) {
  return useQuery({
    queryKey: ["users", "roles"],
    queryFn: async () => (await api.get<RoleFull[]>("/roles")).data,
    enabled,
    staleTime: 60_000,
  });
}

export function usePermissionCatalog(enabled = true) {
  return useQuery({
    queryKey: ["users", "permissions-catalog"],
    queryFn: async () => (await api.get<PermissionDef[]>("/permissions")).data,
    enabled,
    staleTime: 300_000,
  });
}

/** Group items by a string key while preserving first-seen order. */
export function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return [...m.entries()];
}

export function isLocked(u: { locked_until: string | null }) {
  return !!u.locked_until && new Date(u.locked_until).getTime() > Date.now();
}
