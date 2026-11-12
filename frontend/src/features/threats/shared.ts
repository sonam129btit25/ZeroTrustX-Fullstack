import { useEffect, useState } from "react";
import type { Severity, ThreatAlert } from "@/types/api";

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "informational"];

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low", informational: "Informational",
};

/** Solid fill classes for small severity marks (dots, bars). Tokens only. */
export const SEVERITY_FILL: Record<string, string> = {
  critical: "bg-danger", high: "bg-danger/70", medium: "bg-warning", low: "bg-accent", informational: "bg-subtle",
};
export const SEVERITY_TEXT: Record<string, string> = {
  critical: "text-danger", high: "text-danger", medium: "text-warning", low: "text-accent", informational: "text-muted",
};

export type AlertStatus = ThreatAlert["status"];
export type AlertStatusFilter = AlertStatus | "active" | "all";

export const ALERT_STATUS_FILTERS: { value: AlertStatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All statuses" },
];

export interface ThreatRule {
  key: string; title: string; category: string; severity: Severity; description: string; recommended_action: string; risk: number;
}

export interface ThreatSummary {
  by_severity: Partial<Record<Severity, number>>;
  by_status: Partial<Record<AlertStatus, number>>;
  by_category: Record<string, number>;
  active: number;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return match;
}
