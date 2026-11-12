import { motion } from "framer-motion";
import { Ban, CheckCircle2, Circle, Eye, KeyRound, MonitorSmartphone, ShieldCheck, ShieldX, XCircle } from "lucide-react";
import type { Decision, EvaluationResult, TraceStep } from "@/types/api";
import { DECISION_LABEL } from "@/components/ui/Badge";
import { cn } from "@/utils/format";

const META: Record<Decision, { icon: typeof ShieldCheck; tone: string; ring: string; text: string }> = {
  ALLOW: { icon: ShieldCheck, tone: "text-success", ring: "bg-success", text: "Access granted — every control passed." },
  DENY: { icon: ShieldX, tone: "text-danger", ring: "bg-danger", text: "Access refused by the Zero Trust engine." },
  REQUIRE_MFA: { icon: KeyRound, tone: "text-lavender", ring: "bg-lavender", text: "Step-up multi-factor authentication required." },
  REQUIRE_DEVICE_VERIFICATION: { icon: MonitorSmartphone, tone: "text-warning", ring: "bg-warning", text: "This device must be verified by an administrator." },
  RESTRICTED_ACCESS: { icon: Eye, tone: "text-cyan", ring: "bg-cyan", text: "Read-only / limited access granted." },
};

/** Animated access-decision indicator. */
export function DecisionIndicator({ decision, size = "md" }: { decision: Decision; size?: "sm" | "md" | "lg" }) {
  const m = META[decision];
  const Icon = m.icon;
  const dim = { sm: "h-9 w-9", md: "h-12 w-12", lg: "h-16 w-16" }[size];
  return (
    <div className="flex items-center gap-3.5">
      <div className={cn("relative grid place-items-center", dim)}>
        <span className={cn("absolute inset-0 rounded-full opacity-30 animate-pulse-ring", m.ring)} />
        <motion.span
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 18 }}
          className={cn("relative grid h-full w-full place-items-center rounded-full border border-current/30 bg-current/10", m.tone)}
          style={{ backgroundColor: "color-mix(in srgb, currentColor 12%, transparent)" }}
        >
          <Icon className={size === "lg" ? "h-7 w-7" : "h-5 w-5"} />
        </motion.span>
      </div>
      <div>
        <motion.p initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
          className={cn("font-mono text-sm font-semibold tracking-tight", m.tone)}>{decision}</motion.p>
        <p className="text-xs text-muted">{m.text}</p>
      </div>
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = { baseline: "Baseline guard", adaptive: "Adaptive risk", policy: "Policy", result: "Outcome" };

function StepIcon({ s }: { s: TraceStep }) {
  if (s.result === "pass") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (s.result === "fail") return <XCircle className="h-4 w-4 text-danger" />;
  if (s.result === "match") return <CheckCircle2 className="h-4 w-4 text-accent" />;
  if (s.result === "no_match") return <Circle className="h-4 w-4 text-subtle" />;
  return <Ban className="h-4 w-4 text-lavender" />;
}

/** Explainable evaluation timeline. */
export function DecisionTrace({ trace, compact }: { trace: TraceStep[]; compact?: boolean }) {
  return (
    <ol className="relative space-y-0.5">
      {trace.map((s, i) => (
        <motion.li key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.6) }}
          className="relative flex gap-3 pb-2.5">
          {i < trace.length - 1 && <span className="absolute left-[7.5px] top-5 h-[calc(100%-12px)] w-px bg-line" />}
          <span className="relative mt-0.5 shrink-0 bg-card"><StepIcon s={s} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-medium text-fg">{s.check}</span>
              <span className="label !text-[10px]">{STAGE_LABEL[s.stage] ?? s.stage}</span>
            </div>
            <p className={cn("text-xs text-muted", s.result === "fail" && "text-danger/90")}>{s.detail}</p>
            {!compact && s.conditions && s.conditions.length > 0 && (
              <ul className="mt-1.5 space-y-1 rounded-lg border border-line/70 bg-surface/50 p-2">
                {s.conditions.map((c, j) => (
                  <li key={j} className="flex items-start gap-2 text-xs">
                    {c.matched ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" /> : <Circle className="mt-0.5 h-3 w-3 shrink-0 text-subtle" />}
                    <span className="text-muted">{c.condition}</span>
                    <span className="ml-auto shrink-0 font-mono text-2xs text-subtle">actual: {JSON.stringify(c.actual)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </motion.li>
      ))}
    </ol>
  );
}

export function DecisionSummary({ result }: { result: Pick<EvaluationResult, "decision" | "reasons" | "required_actions"> & { duration_ms?: number } }) {
  return (
    <div className="space-y-3">
      <DecisionIndicator decision={result.decision} />
      <div className="rounded-lg border border-line bg-surface/60 p-3">
        <p className="label mb-1.5">Why</p>
        <ul className="space-y-1">
          {result.reasons.map((r, i) => <li key={i} className="text-xs leading-relaxed text-fg/90">• {r}</li>)}
        </ul>
        {result.required_actions?.length > 0 && (
          <p className="mt-2 text-xs text-lavender">Next step: {result.required_actions.join("; ")}</p>
        )}
        {result.duration_ms !== undefined && <p className="mt-2 font-mono text-2xs text-subtle">evaluated in {result.duration_ms.toFixed(2)} ms · deterministic · no AI involved</p>}
      </div>
    </div>
  );
}

export { DECISION_LABEL };
