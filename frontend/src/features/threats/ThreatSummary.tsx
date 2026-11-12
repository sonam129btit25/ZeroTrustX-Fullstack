import { motion } from "framer-motion";
import { Card, CardHeader } from "@/components/ui/Page";
import { Skeleton } from "@/components/ui/Data";
import { cn, fmtNum } from "@/utils/format";
import {
  SEVERITIES, SEVERITY_FILL, SEVERITY_LABEL, SEVERITY_TEXT, type AlertStatusFilter, type ThreatSummary,
} from "@/features/threats/shared";
import type { Severity } from "@/types/api";

export function SeverityCards({ data, loading, selected, onSelect }: {
  data?: ThreatSummary; loading: boolean; selected: Severity | ""; onSelect: (s: Severity | "") => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {SEVERITIES.map((s, i) => {
        const n = data?.by_severity[s] ?? 0;
        const active = selected === s;
        return (
          <motion.button
            key={s}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            aria-pressed={active}
            onClick={() => onSelect(active ? "" : s)}
            data-cursor="hover"
            className={cn(
              "card group relative overflow-hidden px-4 py-3.5 text-left transition-[border-color,background] duration-200 hover:border-line-strong",
              s === "informational" && "col-span-2 sm:col-span-1",
              active && "border-accent/50 bg-accent/[0.05]",
            )}
          >
            <span className={cn("absolute inset-y-0 left-0 w-[3px] opacity-70", SEVERITY_FILL[s])} aria-hidden />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">{SEVERITY_LABEL[s]}</span>
              {active && <span className="text-2xs font-medium text-accent">Filtering</span>}
            </div>
            {loading ? <Skeleton className="mt-2 h-7 w-12" /> : (
              <p className={cn("num mt-1.5 text-[26px] font-semibold leading-tight tracking-tight", n > 0 ? (s === "critical" ? SEVERITY_TEXT[s] : "text-fg") : "text-subtle")}>
                {fmtNum(n)}
              </p>
            )}
            <p className="text-2xs text-subtle">active alerts</p>
          </motion.button>
        );
      })}
    </div>
  );
}

export function CategoryBreakdown({ data, loading, selected, onSelect }: {
  data?: ThreatSummary; loading: boolean; selected: string; onSelect: (c: string) => void;
}) {
  const entries = Object.entries(data?.by_category ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Active alerts by category" description="Open and investigating alerts grouped by detection category" />
      <div className="space-y-2.5 px-5 py-4">
        {loading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5" />)}
        {!loading && entries.length === 0 && <p className="py-3 text-center text-xs text-muted">No active alerts in any category.</p>}
        {entries.map(([cat, n], i) => {
          const active = selected === cat;
          return (
            <button key={cat} type="button" onClick={() => onSelect(active ? "" : cat)} aria-pressed={active} data-cursor="hover"
              className={cn("group grid w-full grid-cols-[minmax(0,9.5rem)_1fr_2rem] items-center gap-3 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-elevated/50",
                active && "bg-accent/[0.07]")}>
              <span className={cn("truncate text-xs", active ? "text-accent" : "text-muted group-hover:text-fg")}>{cat}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-elevated">
                <motion.span className={cn("block h-full rounded-full", active ? "bg-accent" : "bg-accent/60")}
                  initial={{ width: 0 }} animate={{ width: `${(n / max) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.05, ease: [0.2, 0.7, 0.2, 1] }} />
              </span>
              <span className="num text-right text-xs font-medium text-fg">{n}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

const STATUS_ROWS: { key: "open" | "investigating" | "resolved" | "dismissed"; label: string; dot: string }[] = [
  { key: "open", label: "Open", dot: "bg-warning" },
  { key: "investigating", label: "Investigating", dot: "bg-lavender" },
  { key: "resolved", label: "Resolved", dot: "bg-success" },
  { key: "dismissed", label: "Dismissed", dot: "bg-subtle" },
];

export function StatusCounts({ data, loading, selected, onSelect }: {
  data?: ThreatSummary; loading: boolean; selected: AlertStatusFilter; onSelect: (s: AlertStatusFilter) => void;
}) {
  const total = STATUS_ROWS.reduce((a, r) => a + (data?.by_status[r.key] ?? 0), 0);
  return (
    <Card>
      <CardHeader title="Alert lifecycle" description={loading ? "All alerts by status" : `${fmtNum(total)} alerts recorded`} />
      <div className="px-5 py-4">
        {loading ? <Skeleton className="h-2 w-full" /> : (
          <div className="flex h-2 overflow-hidden rounded-full bg-elevated" aria-hidden>
            {STATUS_ROWS.map((r) => {
              const n = data?.by_status[r.key] ?? 0;
              return n ? <motion.span key={r.key} className={cn("h-full", r.dot)} initial={{ width: 0 }} animate={{ width: `${(n / Math.max(1, total)) * 100}%` }} transition={{ duration: 0.6 }} /> : null;
            })}
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-1">
          {STATUS_ROWS.map((r) => {
            const active = selected === r.key;
            return (
              <button key={r.key} type="button" onClick={() => onSelect(active ? "active" : r.key)} aria-pressed={active} data-cursor="hover"
                className={cn("flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-elevated/60",
                  active && "bg-accent/[0.07]")}>
                <span className="flex items-center gap-2 text-muted"><span className={cn("h-1.5 w-1.5 rounded-full", r.dot)} />{r.label}</span>
                <span className="num font-medium text-fg">{loading ? "–" : fmtNum(data?.by_status[r.key] ?? 0)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
