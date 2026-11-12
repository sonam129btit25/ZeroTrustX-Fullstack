import { motion } from "framer-motion";
import {
  ArrowRight, Ban, Clock, Cpu, Gauge, KeyRound, Layers, ListOrdered, Network, ShieldCheck, ShieldOff, UserCheck,
  BadgeCheck, Server, MonitorX, Scale,
} from "lucide-react";
import type { Policy } from "@/types/api";
import { Card } from "@/components/ui/Page";
import { DecisionBadge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Data";
import { cn } from "@/utils/format";
import { DECISION_ORDER } from "./types";

const GUARDS = [
  { icon: UserCheck, title: "Account active", text: "Suspended, locked or deactivated identities stop here." },
  { icon: ShieldCheck, title: "Session valid", text: "Expired or revoked sessions are refused." },
  { icon: MonitorX, title: "Device not blocked", text: "Blocked devices never reach policies." },
  { icon: Server, title: "Resource active", text: "Disabled resources are unavailable to everyone." },
  { icon: BadgeCheck, title: "Entitlement", text: "Role permission, or an approved unexpired grant." },
  { icon: Network, title: "Network allowlist", text: "Source IP must sit inside the resource's CIDRs, if set." },
  { icon: Clock, title: "Access window", text: "Hour of day must fall inside the resource window, if set." },
  { icon: Gauge, title: "Risk block threshold", text: "User risk at or above the threshold is denied." },
];

function Stage({ n, title, subtitle, icon: Icon, children, tone = "accent", delay = 0 }: {
  n: number; title: string; subtitle: string; icon: typeof Layers; children?: React.ReactNode; tone?: string; delay?: number;
}) {
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="group relative flex gap-4 pb-6 last:pb-0">
      <span className="absolute left-[17px] top-10 h-[calc(100%-40px)] w-px bg-gradient-to-b from-line-strong to-line/30 group-last:hidden" />
      <span className={cn("relative z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-xl border bg-card", tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-2xs text-subtle">0{n}</span>
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{subtitle}</p>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </motion.li>
  );
}

export function HowItWorks({ policies, loading }: { policies?: Policy[]; loading: boolean }) {
  const enabled = (policies ?? []).filter((p) => p.is_enabled);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
      <Card className="p-5 sm:p-6">
        <div className="mb-6 flex flex-col gap-1">
          <p className="label">Deterministic pipeline</p>
          <h2 className="text-base font-semibold text-fg">How every access decision is made</h2>
          <p className="max-w-2xl text-xs leading-relaxed text-muted">
            Each access attempt, access request and simulation runs the same pure function of
            <span className="font-mono text-fg"> (context, policies, organisation settings)</span>. Identical inputs always produce
            the identical decision, and every step is written to the decision trace you see in the simulator and audit log.
          </p>
        </div>
        <ol className="relative">
          <Stage n={1} icon={ShieldOff} title="Baseline guards" tone="border-danger/30 text-danger" delay={0}
            subtitle="Non-overridable checks, evaluated in order. The first failure stops evaluation with DENY — no policy can override them.">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {GUARDS.map((g, i) => (
                <div key={g.title} className="flex items-start gap-2.5 rounded-lg border border-line bg-surface/50 px-3 py-2.5">
                  <span className="num mt-0.5 font-mono text-[10px] text-subtle">{i + 1}</span>
                  <g.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-fg">{g.title}</p>
                    <p className="text-2xs leading-relaxed text-muted">{g.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </Stage>
          <Stage n={2} icon={KeyRound} title="Adaptive risk step-up" tone="border-lavender/30 text-lavender" delay={0.05}
            subtitle="If the user's risk score is at or above the organisation's MFA threshold and the session is not MFA-verified, a REQUIRE_MFA candidate is added." />
          <Stage n={3} icon={ListOrdered} title="Administrator policies by priority" tone="border-accent/30 text-accent" delay={0.1}
            subtitle="Every enabled policy is evaluated in ascending priority (lower number first). A policy matches when all (or any) of its conditions hold; each match contributes its action as a candidate." />
          <Stage n={4} icon={Scale} title="Deny-overrides combination" tone="border-warning/30 text-warning" delay={0.15}
            subtitle="Among all candidates the most restrictive outcome wins. Ties keep priority order, and that policy is recorded as deciding.">
            <div className="flex flex-wrap items-center gap-1.5">
              {DECISION_ORDER.map((d, i) => (
                <span key={d} className="inline-flex items-center gap-1.5">
                  <DecisionBadge decision={d} />
                  {i < DECISION_ORDER.length - 1 && <span className="font-mono text-xs text-subtle">&gt;</span>}
                </span>
              ))}
            </div>
          </Stage>
          <Stage n={5} icon={Ban} title="Organisation default action" tone="border-line-strong text-muted" delay={0.2}
            subtitle="If no administrator policy matched, the organisation default applies (DENY unless changed in settings) — a default-deny posture. ALLOW must always be earned explicitly." />
        </ol>
      </Card>

      <div className="space-y-4">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-success/30 bg-success/10 text-success"><Cpu className="h-4 w-4" /></span>
            <div>
              <h3 className="text-[13px] font-semibold text-fg">No AI in the decision path</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                No machine-learning or language model participates in access decisions. The Security Assistant can
                <i> explain</i> a decision after the fact, but it is advisory only and cannot change the outcome.
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <p className="label mb-3">Live evaluation order</p>
          {loading ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7" />)}</div> : enabled.length === 0 ? (
            <p className="text-xs text-muted">No enabled policies — every entitled request falls through to the organisation default.</p>
          ) : (
            <ol className="space-y-1.5">
              {enabled.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-xs">
                  <span className="num w-10 shrink-0 font-mono text-2xs text-subtle">P{p.priority}</span>
                  <span className="min-w-0 flex-1 truncate text-fg">{p.name}</span>
                  <DecisionBadge decision={p.action} />
                </li>
              ))}
              <li className="flex items-center gap-2 pt-1 text-xs text-muted">
                <ArrowRight className="h-3 w-3" /> then combine · fallback to default
              </li>
            </ol>
          )}
        </Card>
        <Card className="p-5">
          <p className="label mb-2">Example</p>
          <p className="text-xs leading-relaxed text-muted">
            An entitled employee opens a confidential resource from an untrusted laptop without MFA. Baseline guards pass;
            a policy requiring MFA matches, and no ALLOW policy matches an untrusted device. Result:
          </p>
          <div className="mt-2"><DecisionBadge decision="REQUIRE_MFA" /></div>
        </Card>
      </div>
    </div>
  );
}
