import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpenCheck, Info } from "lucide-react";
import { Drawer } from "@/components/ui/Overlay";
import { Badge, SeverityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/Data";
import { api, apiError } from "@/services/api";
import { SEVERITIES, type ThreatRule } from "@/features/threats/shared";

export function useThreatRules() {
  return useQuery({
    queryKey: ["threats", "rules"],
    queryFn: async () => (await api.get<ThreatRule[]>("/threats/rules")).data,
    staleTime: 10 * 60_000,
  });
}

/** Render a description template with `{placeholders}` highlighted as variables. */
function Template({ text }: { text: string }) {
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <>
      {parts.map((p, i) => p.startsWith("{") && p.endsWith("}") ? (
        <span key={i} className="mx-px rounded bg-accent/10 px-1 font-mono text-[11px] text-accent">{p.slice(1, -1).split(":")[0]}</span>
      ) : <Fragment key={i}>{p}</Fragment>)}
    </>
  );
}

export function RulesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rules = useThreatRules();
  const sorted = [...(rules.data ?? [])].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || b.risk - a.risk);
  return (
    <Drawer open={open} onClose={onClose} width="max-w-2xl"
      title={<span className="flex items-center gap-2"><BookOpenCheck className="h-4 w-4 text-accent" />Detection rules</span>}
      subtitle={rules.data ? `${rules.data.length} deterministic rules evaluated on platform telemetry` : undefined}>
      <div className="mb-5 flex gap-3 rounded-lg border border-line bg-elevated/40 px-3.5 py-3 text-xs leading-relaxed text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>
          Every alert comes from one of the rules below. Each rule is a fixed threshold or condition evaluated over
          sign-in, session, device and access-decision events recorded by ZeroTrustX. The same input always yields the
          same result, so every alert can be traced to its evidence. No machine-learning models or external
          threat-intelligence feeds are involved. Risk points are the score assigned to each alert; while an alert is
          open or investigating, its severity also raises the affected user's risk score.
        </p>
      </div>
      {rules.isLoading && <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>}
      {rules.isError && (
        <EmptyState title="Could not load rules" description={apiError(rules.error).message}
          action={<Button size="sm" onClick={() => rules.refetch()}>Retry</Button>} />
      )}
      <ul className="space-y-3">
        {sorted.map((r) => (
          <li key={r.key} className="rounded-xl border border-line bg-card/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-fg">{r.title}</p>
                <p className="mt-0.5 font-mono text-[11px] text-subtle">{r.key}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge>{r.category}</Badge>
                <SeverityBadge severity={r.severity} />
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted"><Template text={r.description} /></p>
            <div className="mt-3 grid gap-3 border-t border-line/70 pt-3 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="label">Recommended action</p>
                <p className="mt-1 text-xs leading-relaxed text-fg">{r.recommended_action}</p>
              </div>
              <div className="sm:text-right">
                <p className="label">Alert risk</p>
                <p className="num mt-1 text-[15px] font-semibold text-fg">{r.risk}<span className="text-xs font-normal text-subtle">/100</span></p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}
