import { AppWindow, Braces, Database, FileText, LayoutDashboard, SquareTerminal } from "lucide-react";
import type { EvaluationResult, Resource, Sensitivity } from "@/types/api";
import { Badge, type Tone } from "@/components/ui/Badge";
import { titleCase } from "@/utils/format";

export const SENSITIVITY_TONE: Record<Sensitivity, Tone> = { public: "neutral", internal: "accent", confidential: "warning", restricted: "danger" };
export const SENSITIVITIES: Sensitivity[] = ["public", "internal", "confidential", "restricted"];
export const RESOURCE_TYPES = ["application", "database", "dashboard", "document", "console", "api"] as const;

export function SensitivityBadge({ sensitivity }: { sensitivity: Sensitivity }) {
  return <Badge tone={SENSITIVITY_TONE[sensitivity] ?? "neutral"} dot>{titleCase(sensitivity)}</Badge>;
}

const ICONS = { application: AppWindow, database: Database, dashboard: LayoutDashboard, document: FileText, console: SquareTerminal, api: Braces };
export function TypeIcon({ type, className }: { type: string; className?: string }) {
  const I = ICONS[type as keyof typeof ICONS] ?? AppWindow;
  return <I className={className} />;
}

export function windowLabel(r: Pick<Resource, "access_hours_start" | "access_hours_end">) {
  if (r.access_hours_start === null || r.access_hours_end === null) return null;
  const f = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${f(r.access_hours_start)}–${f(r.access_hours_end)}`;
}

export type EntitlementState = "permission" | "grant" | "none";
export function entitlementState(r: Resource): EntitlementState {
  if (r.entitlement?.has_permission) return "permission";
  if (r.entitlement?.has_active_grant) return "grant";
  return "none";
}

export interface AccessResponse extends EvaluationResult {
  decision_id: string; granted: boolean; access_mode: "full" | "read_only" | null;
  resource: { id: string; name: string; url: string | null };
}

export interface ResourceDetail extends Resource {
  access_history?: { id: string; decision: EvaluationResult["decision"]; user: string | null; source: string; ip_address: string | null; evaluated_at: string; reasons: string[] }[];
  active_grants?: { id: string; user: string; expires_at: string | null }[];
}
