import { useState } from "react";
import { History, Pencil, PlayCircle } from "lucide-react";
import type { Policy, PolicyFields } from "@/types/api";
import { apiError } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { Drawer } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { DecisionBadge, DemoTag, StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState, KeyValue, Skeleton, Tabs } from "@/components/ui/Data";
import { StatCard } from "@/components/ui/StatCard";
import { cn, fmtDate, fmtNum, timeAgo, titleCase } from "@/utils/format";
import { usePolicyDetail } from "./api";
import { ConditionList, SectionLabel } from "./ui";
import { conditionText } from "./conditions";
import type { PolicyChange } from "./types";

function ChangeDetails({ change, catalogue }: { change: PolicyChange; catalogue?: PolicyFields }) {
  const d = change.details ?? {};
  const after = d.after as Record<string, unknown> | undefined;
  const before = d.before as Record<string, unknown> | undefined;
  if (change.action === "policy.updated" && after && before) {
    const diffs: [string, string, string][] = [];
    const show = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v));
    if (before.name !== after.name) diffs.push(["Name", show(before.name), show(after.name)]);
    if (before.priority !== after.priority) diffs.push(["Priority", show(before.priority), show(after.priority)]);
    if (before.action !== after.action) diffs.push(["Action", show(before.action), show(after.action)]);
    if (before.enabled !== after.is_enabled) diffs.push(["Enabled", show(before.enabled), show(after.is_enabled)]);
    const bc = (before.conditions as { field: string; operator: string; value: unknown }[] | undefined) ?? [];
    const ac = (after.conditions as { field: string; operator: string; value: unknown }[] | undefined) ?? [];
    const bText = bc.map((c) => conditionText(c, catalogue)).join(" · ");
    const aText = ac.map((c) => conditionText(c, catalogue)).join(" · ");
    if (bText !== aText) diffs.push(["Conditions", bText || "none", aText || "none"]);
    if (!diffs.length) return <p className="text-2xs text-subtle">Metadata updated{d.version ? ` · v${String(d.version)}` : ""}</p>;
    return (
      <ul className="mt-1 space-y-1">
        {diffs.map(([k, a, b]) => (
          <li key={k} className="text-2xs leading-relaxed">
            <span className="text-muted">{k}: </span>
            <span className="font-mono text-danger/80 line-through decoration-danger/40">{a}</span>
            <span className="text-subtle"> → </span>
            <span className="font-mono text-success">{b}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (change.action === "policy.created" && d.action) {
    return <p className="mt-0.5 text-2xs text-muted">Created with action <span className="font-mono">{String(d.action)}</span>, priority {String(d.priority)}</p>;
  }
  return null;
}

export function PolicyDetailDrawer({ policyId, onClose, catalogue, onEdit, onSimulate }: {
  policyId: string | null; onClose: () => void; catalogue?: PolicyFields; onEdit: (p: Policy) => void; onSimulate?: () => void;
}) {
  const { can } = useAuth();
  const q = usePolicyDetail(policyId);
  const p = q.data;
  const [tab, setTab] = useState<"executions" | "history">("executions");

  return (
    <Drawer open={!!policyId} onClose={onClose} width="max-w-2xl"
      title={p ? <span className="flex items-center gap-2">{p.name}{p.is_demo && <DemoTag />}</span> : "Policy"}
      subtitle={p && <span className="flex flex-wrap items-center gap-2"><span className="font-mono">P{p.priority}</span>·<span>v{p.version}</span>·<span>updated {timeAgo(p.updated_at)}</span></span>}
      footer={p && <>
        {onSimulate && can("policies:simulate") && <Button variant="ghost" icon={<PlayCircle className="h-3.5 w-3.5" />} onClick={onSimulate}>Open simulator</Button>}
        {can("policies:write") && <Button variant="primary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(p)}>Edit policy</Button>}
      </>}>
      {q.isLoading && <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-28" /><Skeleton className="h-40" /></div>}
      {q.isError && <EmptyState title="Could not load policy" description={apiError(q.error).message} />}
      {p && (
        <div className="space-y-5">
          {p.description && <p className="text-[13px] leading-relaxed text-muted">{p.description}</p>}
          <KeyValue items={[
            ["Outcome", <DecisionBadge decision={p.action} />],
            ["State", <StatusBadge status={p.is_enabled ? "active" : "deactivated"} />],
            ["Match mode", p.match_mode === "all" ? "All conditions (AND)" : "Any condition (OR)"],
            ["Priority", <span className="font-mono">{p.priority}</span>],
            ["Created", fmtDate(p.created_at)],
            ["Last updated", fmtDate(p.updated_at)],
          ]} />
          <div>
            <SectionLabel>Conditions</SectionLabel>
            <div className="rounded-lg border border-line bg-surface/40 p-3"><ConditionList conditions={p.conditions} matchMode={p.match_mode} catalogue={catalogue} /></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Matches · 30d" value={fmtNum(p.stats.matches_30d)} icon={<History className="h-3.5 w-3.5" />} />
            <StatCard label="Deciding · 30d" value={fmtNum(p.stats.deciding_30d)} icon={<History className="h-3.5 w-3.5" />} tone="lavender" />
            <StatCard label="Last match" value={<span className="text-base">{p.stats.last_matched_at ? timeAgo(p.stats.last_matched_at) : "never"}</span>} icon={<History className="h-3.5 w-3.5" />} tone="cyan" />
          </div>

          <Tabs value={tab} onChange={setTab} tabs={[
            { value: "executions", label: "Decision history", count: p.executions.length },
            { value: "history", label: "Change history", count: p.change_history.length },
          ]} />

          {tab === "executions" && (p.executions.length === 0 ? (
            <EmptyState title="No recorded matches yet" description="Decisions in which this policy matched appear here (last 50)." />
          ) : (
            <ul className="divide-y divide-line/60 rounded-lg border border-line">
              {p.executions.map((e) => (
                <li key={e.decision_id} className={cn("flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3", e.was_deciding && "bg-accent/[0.04]")}>
                  <div className="flex items-center gap-1.5">
                    <DecisionBadge decision={e.final_decision} />
                    {e.was_deciding ? <Badge tone="accent">deciding</Badge> : <span className="text-2xs text-subtle">via {e.policy_action}</span>}
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="truncate text-fg">{e.user ?? "unknown user"} <span className="text-subtle">→</span> {e.resource ?? "—"}</p>
                    <p className="text-2xs text-subtle">{titleCase(e.source)}</p>
                  </div>
                  <time className="shrink-0 text-2xs text-muted" title={fmtDate(e.evaluated_at)}>{timeAgo(e.evaluated_at)}</time>
                </li>
              ))}
            </ul>
          ))}

          {tab === "history" && (p.change_history.length === 0 ? (
            <EmptyState title="No changes recorded" description="Creation, edits, enable/disable and deletion are audited." />
          ) : (
            <ol className="relative space-y-0">
              {p.change_history.map((c, i) => (
                <li key={c.id} className="relative flex gap-3 pb-4">
                  {i < p.change_history.length - 1 && <span className="absolute left-[5px] top-4 h-[calc(100%-8px)] w-px bg-line" />}
                  <span className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-accent/60 bg-card" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="font-mono text-xs text-fg">{c.action}</p>
                      <time className="text-2xs text-subtle" title={fmtDate(c.created_at)}>{timeAgo(c.created_at)}</time>
                    </div>
                    <p className="text-2xs text-muted">by {c.actor ?? "system"}</p>
                    <ChangeDetails change={c} catalogue={catalogue} />
                  </div>
                </li>
              ))}
            </ol>
          ))}
        </div>
      )}
    </Drawer>
  );
}
