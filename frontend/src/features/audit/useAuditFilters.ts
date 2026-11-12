import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { cleanParams } from "@/services/api";

export const AUDIT_PAGE_SIZE = 25;
export const AUDIT_SORT_KEYS = ["created_at", "severity", "action"] as const;
export type AuditSortKey = (typeof AUDIT_SORT_KEYS)[number];

export interface AuditFilterState {
  q: string; category: string; action: string; severity: string; outcome: string; actor: string;
  from: string; to: string; includeDemo: boolean; sort: AuditSortKey; order: "asc" | "desc"; page: number;
}

const FILTER_KEYS = ["q", "category", "action", "severity", "outcome", "actor", "from", "to", "demo"] as const;

/** `datetime-local` value (local time, no zone) → ISO string, or undefined when invalid/empty. */
export function localToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Date → `datetime-local` value in the viewer's local time. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Audit log filters persisted in the URL search params. */
export function useAuditFilters() {
  const [sp, setSp] = useSearchParams();

  const state = useMemo<AuditFilterState>(() => {
    const sort = sp.get("sort") as AuditSortKey | null;
    const page = Number(sp.get("page") ?? "1");
    return {
      q: sp.get("q") ?? "", category: sp.get("category") ?? "", action: sp.get("action") ?? "",
      severity: sp.get("severity") ?? "", outcome: sp.get("outcome") ?? "", actor: sp.get("actor") ?? "",
      from: sp.get("from") ?? "", to: sp.get("to") ?? "", includeDemo: sp.get("demo") !== "0",
      sort: sort && AUDIT_SORT_KEYS.includes(sort) ? sort : "created_at",
      order: sp.get("order") === "asc" ? "asc" : "desc",
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    };
  }, [sp]);

  /** Patch params. Any filter change resets pagination. */
  const update = useCallback((patch: Record<string, string | null>) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      let filterChanged = false;
      for (const [k, v] of Object.entries(patch)) {
        if ((FILTER_KEYS as readonly string[]).includes(k) || k === "sort" || k === "order") filterChanged = true;
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (filterChanged && !("page" in patch)) next.delete("page");
      return next;
    }, { replace: true });
  }, [setSp]);

  const clear = useCallback(() => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      [...FILTER_KEYS, "page"].forEach((k) => next.delete(k));
      return next;
    }, { replace: true });
  }, [setSp]);

  /** Query params understood by GET /audit-logs and /audit-logs/export. */
  const apiParams = useMemo(() => cleanParams({
    q: state.q.trim(), category: state.category, action: state.action, severity: state.severity, outcome: state.outcome,
    actor: state.actor.trim(), date_from: localToIso(state.from), date_to: localToIso(state.to),
    include_demo: state.includeDemo, sort: state.sort, order: state.order,
  }), [state]);

  const activeCount = [state.q, state.category, state.action, state.severity, state.outcome, state.actor, state.from, state.to]
    .filter(Boolean).length + (state.includeDemo ? 0 : 1);

  return { state, update, clear, apiParams, activeCount };
}
