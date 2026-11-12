import {
  Activity, AppWindow, FileClock, Fingerprint, KeyRound, LayoutDashboard, MonitorSmartphone, Radar, Settings,
  ShieldAlert, Siren, Users, type LucideIcon,
} from "lucide-react";

export interface NavItem { to: string; label: string; icon: LucideIcon; perm?: string; shortcut?: string; section: string }

export const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, section: "Monitor", shortcut: "g o" },
  { to: "/identity", label: "Identity Management", icon: Users, perm: "users:read", section: "Identity", shortcut: "g u" },
  { to: "/devices", label: "Device Trust", icon: MonitorSmartphone, perm: "devices:read", section: "Identity", shortcut: "g d" },
  { to: "/access-requests", label: "Access Requests", icon: KeyRound, section: "Access", shortcut: "g a" },
  { to: "/policies", label: "Zero Trust Policies", icon: Fingerprint, perm: "policies:read", section: "Access", shortcut: "g p" },
  { to: "/resources", label: "Protected Resources", icon: AppWindow, perm: "resources:read", section: "Access", shortcut: "g r" },
  { to: "/sessions", label: "Active Sessions", icon: Activity, perm: "sessions:read_all", section: "Monitor", shortcut: "g s" },
  { to: "/threats", label: "Threat Detection", icon: Radar, perm: "threats:read", section: "Detect & Respond", shortcut: "g t" },
  { to: "/incidents", label: "Security Incidents", icon: Siren, perm: "incidents:read", section: "Detect & Respond", shortcut: "g i" },
  { to: "/audit-logs", label: "Audit Logs", icon: FileClock, perm: "audit:read", section: "Detect & Respond", shortcut: "g l" },
  { to: "/settings", label: "Settings", icon: Settings, section: "System", shortcut: "g ," },
];

export const SECTIONS = ["Monitor", "Identity", "Access", "Detect & Respond", "System"];
export { ShieldAlert };
