import type { TrustStatus, UserSummary } from "@/types/api";

export interface RolePermissionRef { id: string; code: string; category: string }

export interface RoleFull {
  id: string; name: string; display_name: string; description: string | null; level: number; is_system: boolean;
  user_count: number; permissions: RolePermissionRef[]; assignable: boolean;
}

export interface PermissionDef { id: string; code: string; description: string | null; category: string }

export interface RiskFactor { factor: string; label: string; points: number }

export interface UserDetailResponse {
  user: UserSummary;
  permissions: string[];
  risk: { score: number; computed_score: number; level: string; factors: RiskFactor[] };
  devices: { id: string; name: string; trust_status: TrustStatus; os: string | null; last_seen_at: string | null; ip_address: string | null }[];
  active_grants: { id: string; resource: string; expires_at: string | null }[];
}

export interface ResetAccessResult {
  message: string;
  summary: { sessions_revoked?: number; mfa_reset?: boolean; grants_revoked?: number; password_reset_issued?: boolean };
}

export interface RecalcRiskResult { previous: number; score: number; level: string; factors: RiskFactor[] }
