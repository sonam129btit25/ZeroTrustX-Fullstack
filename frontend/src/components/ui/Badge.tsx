import type { ReactNode } from "react";
import { cn, titleCase } from "@/utils/format";
import type { Decision, Severity, TrustStatus } from "@/types/api";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "lavender" | "cyan";
const TONES: Record<Tone, string> = {
  neutral: "bg-elevated text-muted border-line",
  accent: "bg-accent/10 text-accent border-accent/25",
  success: "bg-success/10 text-success border-success/25",
  warning: "bg-warning/10 text-warning border-warning/25",
  danger: "bg-danger/10 text-danger border-danger/25",
  lavender: "bg-lavender/10 text-lavender border-lavender/25",
  cyan: "bg-cyan/10 text-cyan border-cyan/25",
};

export function Badge({ tone = "neutral", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-2xs font-medium", TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const SEVERITY_TONE: Record<string, Tone> = { critical: "danger", high: "danger", medium: "warning", low: "accent", informational: "neutral" };
export function SeverityBadge({ severity }: { severity: Severity | string }) {
  return (
    <Badge tone={SEVERITY_TONE[severity] ?? "neutral"} dot className={severity === "critical" ? "bg-danger/20" : undefined}>
      {severity === "informational" ? "Info" : titleCase(severity)}
    </Badge>
  );
}

export const TRUST_TONE: Record<string, Tone> = { trusted: "success", pending_verification: "accent", untrusted: "warning", suspicious: "warning", blocked: "danger", unknown: "neutral" };
const TRUST_LABEL: Record<string, string> = { pending_verification: "Pending verification" };
export function TrustBadge({ status }: { status: TrustStatus | string }) {
  return <Badge tone={TRUST_TONE[status] ?? "neutral"} dot>{TRUST_LABEL[status] ?? titleCase(status)}</Badge>;
}

export const DECISION_TONE: Record<Decision, Tone> = {
  ALLOW: "success", DENY: "danger", REQUIRE_MFA: "lavender", REQUIRE_DEVICE_VERIFICATION: "warning", RESTRICTED_ACCESS: "cyan",
};
export const DECISION_LABEL: Record<Decision, string> = {
  ALLOW: "Allow", DENY: "Deny", REQUIRE_MFA: "Require MFA", REQUIRE_DEVICE_VERIFICATION: "Verify device", RESTRICTED_ACCESS: "Restricted",
};
export function DecisionBadge({ decision }: { decision: Decision }) {
  return <Badge tone={DECISION_TONE[decision] ?? "neutral"} className="font-mono tracking-tight">{DECISION_LABEL[decision] ?? decision}</Badge>;
}

const STATUS_TONE: Record<string, Tone> = {
  active: "success", approved: "success", resolved: "success", closed: "neutral", pending: "accent", open: "warning",
  investigating: "lavender", contained: "cyan", rejected: "danger", revoked: "danger", expired: "neutral", suspended: "warning",
  deactivated: "neutral", locked: "danger", dismissed: "neutral", success: "success", failure: "danger",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"} dot>{titleCase(status)}</Badge>;
}

export function DemoTag() {
  return <span title="Seeded demonstration record" className="rounded border border-line px-1 text-[10px] font-medium uppercase tracking-wider text-subtle">demo</span>;
}
