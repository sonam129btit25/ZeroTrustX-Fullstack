import type { Decision, EvaluationResult, Policy } from "@/types/api";

export interface PolicyExecution {
  decision_id: string; final_decision: Decision; policy_action: Decision; was_deciding: boolean;
  user: string | null; resource: string | null; evaluated_at: string; source: string;
}
export interface PolicyChange { id: number; action: string; actor: string | null; created_at: string; details: Record<string, unknown> }
export interface PolicyDetail extends Policy { executions: PolicyExecution[]; change_history: PolicyChange[] }

export interface PolicyPayload {
  name: string; description: string; priority: number; action: Decision; match_mode: "all" | "any"; is_enabled: boolean;
  conditions: { field: string; operator: string; value: unknown }[];
}

export interface SimulationContext {
  user: Record<string, unknown>; session: Record<string, unknown>; device: Record<string, unknown> | null;
  request: Record<string, unknown>; resource: Record<string, unknown>; entitlement: Record<string, unknown>;
}
export type SimulationResult = EvaluationResult & { context: SimulationContext };

export interface SimulateBody {
  user_id?: string | null; resource_id: string; roles?: string[] | null; user_status?: string | null; risk_score?: number | null;
  department?: string | null; mfa_enabled?: boolean | null; mfa_verified: boolean; session_valid: boolean;
  device_trust_status: string; device_risk_score: number; ip_address: string; hour?: number | null; weekday?: number | null;
  has_entitlement?: boolean | null; draft_policy?: PolicyPayload | null;
}

/** Decision precedence used by the engine's deny-overrides combination (most restrictive first). */
export const DECISION_ORDER: Decision[] = ["DENY", "REQUIRE_DEVICE_VERIFICATION", "REQUIRE_MFA", "RESTRICTED_ACCESS", "ALLOW"];

export const ROLE_OPTIONS = ["super_admin", "security_admin", "analyst", "employee", "guest"];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const TRUST_OPTIONS = ["trusted", "pending_verification", "untrusted", "suspicious", "blocked", "unknown"];
