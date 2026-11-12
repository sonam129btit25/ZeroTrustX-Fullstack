export type Decision = "ALLOW" | "DENY" | "REQUIRE_MFA" | "REQUIRE_DEVICE_VERIFICATION" | "RESTRICTED_ACCESS";
export type Severity = "critical" | "high" | "medium" | "low" | "informational";
export type TrustStatus = "trusted" | "untrusted" | "suspicious" | "blocked" | "pending_verification";
export type Sensitivity = "public" | "internal" | "confidential" | "restricted";
export type RequestStatus = "pending" | "approved" | "rejected" | "expired" | "revoked";

export interface Page<T> { items: T[]; total: number; page: number; page_size: number }

export interface Role { id: string; name: string; display_name: string; level: number }

export interface Me {
  id: string; email: string; full_name: string; department: string | null; job_title: string | null; phone: string | null;
  status: string; risk_score: number; mfa_enabled: boolean; roles: Role[]; permissions: string[];
  preferences: Record<string, unknown>; last_login_at: string | null; created_at: string; mfa_required_by_policy: boolean;
  session: { id: string | null; mfa_verified: boolean; expires_at: string | null;
    device: { id: string; name: string; trust_status: TrustStatus } | null };
}

export interface TokenResponse { access_token: string; token_type: string; expires_in: number; user: Me }
export interface LoginResponse { mfa_required: boolean; mfa_token: string | null; auth: TokenResponse | null }

export interface UserSummary {
  id: string; email: string; full_name: string; status: string; department: string | null; job_title: string | null;
  phone: string | null; risk_score: number; risk_level: string; mfa_enabled: boolean; roles: Role[];
  last_login_at: string | null; last_login_ip: string | null; failed_login_count: number; locked_until: string | null;
  created_at: string; is_demo: boolean; active_sessions: number;
}

export interface TraceStep {
  stage: "baseline" | "adaptive" | "policy" | "result"; check: string; result: string; detail: string;
  policy_id?: string; conditions?: { condition: string; actual: unknown; matched: boolean }[];
}

export interface EvaluationResult {
  decision: Decision; reasons: string[]; trace: TraceStep[];
  matched_policies: { policy_id: string; name: string; priority: number; action: Decision; deciding: boolean }[];
  deciding_policy_id: string | null; required_actions: string[]; duration_ms: number;
}

export interface Device {
  id: string; device_identifier: string; name: string; device_type: string; os: string | null; os_version: string | null;
  browser: string | null; ip_address: string | null; last_seen_at: string | null; trust_status: TrustStatus; risk_score: number;
  registered_via: string; approved_at: string | null; notes: string | null; created_at: string; is_demo: boolean;
  user: { id: string; email: string; full_name: string } | null; is_current?: boolean;
}

export interface SessionRow {
  id: string; user: { id: string; email: string; full_name: string };
  device: { id: string; name: string; trust_status: TrustStatus } | null; ip_address: string | null; user_agent: string | null;
  location: string | null; created_at: string; last_activity_at: string; expires_at: string; revoked_at: string | null;
  revoked_reason: string | null; mfa_verified: boolean; risk_score: number; risk_level: string;
  status: "active" | "revoked" | "expired"; refresh_count: number; is_current: boolean; is_demo: boolean;
}

export interface PolicyCondition { id?: string; field: string; operator: string; value: unknown }
export interface Policy {
  id: string; name: string; description: string; priority: number; action: Decision; match_mode: "all" | "any";
  is_enabled: boolean; version: number; is_demo: boolean; created_at: string; updated_at: string;
  conditions: PolicyCondition[]; stats: { matches_30d: number; deciding_30d: number; last_matched_at: string | null };
}
export interface FieldMeta { label: string; type: "list" | "number" | "string" | "boolean" | "ip"; operators: string[]; options?: string[] }
export interface PolicyFields { fields: Record<string, FieldMeta>; operators: Record<string, string>; actions: Decision[] }

export interface Resource {
  id: string; name: string; slug: string; description: string; resource_type: string; sensitivity: Sensitivity;
  required_permission: string | null; url: string | null; requires_approval: boolean; max_grant_hours: number;
  allowed_ip_ranges: string[]; access_hours_start: number | null; access_hours_end: number | null; is_active: boolean;
  created_at: string; updated_at: string; is_demo: boolean; owner: { id: string; email: string; full_name: string } | null;
  entitlement?: { has_permission: boolean; has_active_grant: boolean };
}

export interface AccessRequest {
  id: string; status: RequestStatus; engine_decision: Decision | null; justification: string; requested_duration_hours: number;
  created_at: string; updated_at: string; reviewed_at: string | null; review_comment: string | null; expires_at: string | null;
  revoked_at: string | null; is_demo: boolean;
  requester: { id: string; email: string; full_name: string; risk_score: number };
  resource: { id: string; name: string; sensitivity: Sensitivity; requires_approval: boolean };
  reviewer: { id: string; email: string } | null; decision_id: string | null;
  decision?: { decision: Decision; reasons: string[]; trace: TraceStep[]; context: Record<string, any>; evaluated_at: string;
    matched_policies: { policy_id: string; name: string; action: Decision; deciding: boolean }[] };
  audit_trail?: { id: number; action: string; actor: string | null; created_at: string; details: Record<string, unknown>; outcome: string }[];
}

export interface ThreatAlert {
  id: string; rule_key: string; title: string; description: string; category: string; severity: Severity;
  status: "open" | "investigating" | "resolved" | "dismissed"; ip_address: string | null; risk_score: number;
  recommended_action: string; evidence: Record<string, unknown>; detected_at: string; updated_at: string;
  incident_id: string | null; is_demo: boolean;
  user: { id: string; email: string; full_name: string; risk_score: number } | null;
  device: { id: string; name: string; trust_status: TrustStatus } | null;
  related_events?: { id: string; event_type: string; ip_address: string | null; created_at: string; severity: string }[];
}

export interface Incident {
  id: string; reference: string; title: string; description: string; severity: Severity;
  status: "open" | "investigating" | "contained" | "resolved" | "closed"; created_at: string; updated_at: string;
  resolved_at: string | null; closed_at: string | null; resolution_summary: string | null; is_demo: boolean;
  assignee: { id: string; email: string; full_name: string } | null; created_by: { id: string; email: string } | null;
  alert_count: number; note_count: number;
  notes?: { id: string; note_type: string; body: string; created_at: string; author: { email: string; full_name: string } | null }[];
  alerts?: ThreatAlert[];
}

export interface AuditLog {
  id: number; created_at: string; actor_id: string | null; actor_email: string | null; action: string; category: string;
  severity: Severity; outcome: "success" | "failure"; target_type: string | null; target_id: string | null;
  target_label: string | null; ip_address: string | null; user_agent: string | null; details: Record<string, unknown>;
  is_demo: boolean; hash: string; prev_hash: string | null;
}

export interface Notification {
  id: string; title: string; body: string; category: string; severity: Severity; link: string | null;
  read_at: string | null; created_at: string;
}

export interface AssistantResponse {
  title: string; summary: string; findings: string[]; recommendations: string[]; advisory: true; provider: string;
  disclaimer: string; score?: number; level?: string;
}

export interface OrgSettings {
  org_name: string; domain: string | null; timezone: string; session_timeout_minutes: number; idle_timeout_minutes: number;
  password_min_length: number; password_require_upper: boolean; password_require_lower: boolean;
  password_require_digit: boolean; password_require_symbol: boolean; max_failed_logins: number; lockout_minutes: number;
  mfa_required_roles: string[]; risk_block_threshold: number; risk_mfa_threshold: number; default_policy_action: Decision;
  business_hours_start: number; business_hours_end: number; risk_weights: Record<string, number>;
  notification_settings: Record<string, boolean>; allow_self_registration: boolean; updated_at: string;
}

export interface LoginEvent {
  id: string; event_type: string; ip_address: string | null; user_agent: string | null; location: string | null;
  severity: string; details: Record<string, unknown>; created_at: string; is_demo: boolean; email: string | null;
}
