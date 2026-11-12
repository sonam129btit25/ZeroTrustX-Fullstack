import { Globe, Laptop, Monitor, Server, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import type { Decision, Device, TrustStatus } from "@/types/api";

export const DEVICE_TYPES = ["laptop", "desktop", "mobile", "tablet", "server", "browser"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const DEVICE_ICON: Record<string, LucideIcon> = {
  laptop: Laptop, desktop: Monitor, mobile: Smartphone, tablet: Tablet, server: Server, browser: Globe,
};

export function DeviceIcon({ type, className }: { type: string; className?: string }) {
  const Icon = DEVICE_ICON[type] ?? Laptop;
  return <Icon className={className ?? "h-4 w-4"} />;
}

export const TRUST_STATUSES: { value: TrustStatus; label: string }[] = [
  { value: "trusted", label: "Trusted" },
  { value: "pending_verification", label: "Pending verification" },
  { value: "untrusted", label: "Untrusted" },
  { value: "suspicious", label: "Suspicious" },
  { value: "blocked", label: "Blocked" },
];

export interface DeviceDetailResponse {
  device: Device;
  trust_history: { id: string; from_status: string | null; to_status: string; reason: string | null; changed_by: string; created_at: string }[];
  sessions: { id: string; user: string; ip_address: string | null; created_at: string; revoked_at: string | null; active: boolean }[];
  events: { id: string; event_type: string; ip_address: string | null; created_at: string; severity: string }[];
  decisions: { id: string; decision: Decision; resource: string | null; evaluated_at: string }[];
  posture_note: string;
}

export type DeviceSummary = Record<TrustStatus, number> & { total: number };
