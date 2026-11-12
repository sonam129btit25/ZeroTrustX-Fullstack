import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { DecisionSummary, DecisionTrace } from "@/components/security/DecisionView";
import { Card, CardHeader } from "@/components/ui/Page";
import { TrustBadge } from "@/components/ui/Badge";
import { cn } from "@/utils/format";
import type { SimulationResult } from "./types";
import { weekdayLabel } from "./conditions";
import { Collapsible, MatchedPolicies, SectionLabel } from "./ui";

function V({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === "") return <span className="text-subtle">—</span>;
  if (typeof v === "boolean") return <span className={cn("font-mono", v ? "text-success" : "text-danger")}>{String(v)}</span>;
  if (Array.isArray(v)) return <span className="font-mono">{v.length ? v.join(", ") : "[]"}</span>;
  return <span className="font-mono">{String(v)}</span>;
}

function Group({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <div className="rounded-lg border border-line bg-surface/40 p-3">
      <p className="label mb-2">{title}</p>
      <dl className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="shrink-0 text-muted">{k}</dt>
            <dd className="min-w-0 truncate text-right text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function EvaluatedContext({ ctx }: { ctx: SimulationResult["context"] }) {
  const u = ctx.user, s = ctx.session, d = ctx.device, r = ctx.request, res = ctx.resource, e = ctx.entitlement;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      <Group title="User" rows={[["Email", <V v={u.email} />], ["Status", <V v={u.status} />], ["Roles", <V v={u.roles} />],
        ["Risk score", <V v={u.risk_score} />], ["MFA enrolled", <V v={u.mfa_enabled} />], ["Department", <V v={u.department} />]]} />
      <Group title="Session" rows={[["Valid", <V v={s.valid} />], ["MFA verified", <V v={s.mfa_verified} />], ["Age (min)", <V v={s.age_minutes} />]]} />
      <Group title="Device" rows={d ? [["Trust", <TrustBadge status={String(d.trust_status)} />], ["Risk score", <V v={d.risk_score} />], ["Name", <V v={d.name} />]]
        : [["Trust", <TrustBadge status="unknown" />], ["Note", <span className="text-muted">No registered device</span>]]} />
      <Group title="Request" rows={[["Source IP", <V v={r.ip} />], ["Hour", <V v={`${String(r.hour).padStart(2, "0")}:00`} />],
        ["Weekday", <V v={weekdayLabel(Number(r.weekday))} />], ["Business hours", <V v={r.is_business_hours} />]]} />
      <Group title="Resource" rows={[["Name", <V v={res.name} />], ["Sensitivity", <V v={res.sensitivity} />], ["Type", <V v={res.type} />],
        ["Permission", <V v={res.required_permission} />]]} />
      <Group title="Entitlement" rows={[["Has permission", <V v={e.has_permission} />], ["Active grant", <V v={e.has_active_grant} />]]} />
    </div>
  );
}

/** Full simulation outcome: summary, matched policies, trace and context. */
export function SimulationResultView({ result, compact }: { result: SimulationResult; compact?: boolean }) {
  const matched = result.matched_policies;
  if (compact) {
    return (
      <div className="space-y-4">
        <DecisionSummary result={result} />
        <div><SectionLabel>Matched policies</SectionLabel><MatchedPolicies items={matched} /></div>
        <Collapsible title="Evaluation trace" meta={`${result.trace.length} steps`}><DecisionTrace trace={result.trace} /></Collapsible>
      </div>
    );
  }
  return (
    <motion.div key={result.duration_ms + result.decision} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-5">
        <div className="space-y-4 2xl:col-span-2">
          <Card className="p-5"><DecisionSummary result={result} /></Card>
          <Card>
            <CardHeader title="Matched policies" description="Most restrictive outcome wins; the deciding policy is highlighted." />
            <div className="p-4"><MatchedPolicies items={matched} /></div>
          </Card>
        </div>
        <Card className="2xl:col-span-3">
          <CardHeader title="Evaluation trace" description="Every check in order, with the actual attribute values the engine saw." />
          <div className="p-5"><DecisionTrace trace={result.trace} /></div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Evaluated context" description="The exact attribute snapshot the engine evaluated." />
        <div className="p-4"><EvaluatedContext ctx={result.context} /></div>
      </Card>
    </motion.div>
  );
}
