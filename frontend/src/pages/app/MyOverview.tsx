import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AppWindow, ArrowRight, KeyRound, MonitorSmartphone, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "@/services/api";
import type { AccessRequest, Device, Page, Resource } from "@/types/api";
import { useAuth } from "@/context/AuthContext";
import { Card, CardHeader, PageHeader } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Badge, DecisionBadge, StatusBadge, TrustBadge } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/Data";
import { RiskRing } from "@/components/security/Risk";
import { cn, timeAgo } from "@/utils/format";

const SENS_TONE = { public: "neutral", internal: "accent", confidential: "warning", restricted: "danger" } as const;

export default function MyOverview() {
  const { user, can } = useAuth();
  const summary = useQuery({ queryKey: ["access-requests", "summary", "mine"], queryFn: async () => (await api.get<Record<string, number>>("/access-requests/summary")).data });
  const requests = useQuery({ queryKey: ["access-requests", "mine", "recent"], queryFn: async () => (await api.get<Page<AccessRequest>>("/access-requests", { params: { page_size: 5 } })).data });
  const devices = useQuery({ queryKey: ["devices", "mine"], queryFn: async () => (await api.get<Device[]>("/devices/mine")).data });
  const resources = useQuery({
    queryKey: ["resources", "overview"], enabled: can("resources:read"),
    queryFn: async () => (await api.get<Page<Resource>>("/resources", { params: { page_size: 6 } })).data,
  });
  if (!user) return null;
  const s = user.session;
  const checks = [
    { ok: user.mfa_enabled, label: "Multi-factor authentication", detail: user.mfa_enabled ? "Enrolled" : "Not enrolled", to: "/settings?tab=security" },
    { ok: s.mfa_verified, label: "This session", detail: s.mfa_verified ? "MFA-verified" : "Password only", to: "/settings?tab=security" },
    { ok: s.device?.trust_status === "trusted", label: "This device", detail: s.device ? (s.device.trust_status === "trusted" ? "Trusted" : "Awaiting administrator verification") : "Unregistered", to: "/settings?tab=sessions" },
  ];
  return (
    <div>
      <PageHeader title={`Welcome, ${user.full_name.split(" ")[0]}`} description="Your personal Zero Trust posture. Every access attempt is evaluated against your identity, device, session and risk."
        breadcrumbs={[{ label: "ZeroTrustX" }, { label: "Overview" }]}
        actions={<Link to="/access-requests?new=1"><Button variant="primary" icon={<KeyRound className="h-4 w-4" />}>Request access</Button></Link>} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Security posture" description="What the policy engine sees when you request access" />
          <div className="grid gap-5 p-5 sm:grid-cols-[auto_1fr]">
            <div className="flex flex-col items-center justify-center gap-2">
              <RiskRing score={user.risk_score} size={96} />
              <p className="text-2xs text-subtle">Your risk score</p>
            </div>
            <ul className="space-y-2.5">
              {checks.map((c, i) => (
                <motion.li key={c.label} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                  <Link to={c.to} className="flex items-center gap-3 rounded-lg border border-line bg-surface/50 px-3.5 py-3 hover:border-line-strong">
                    {c.ok ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldAlert className="h-4 w-4 text-warning" />}
                    <span className="text-[13px] font-medium">{c.label}</span>
                    <span className={cn("ml-auto text-xs", c.ok ? "text-success" : "text-warning")}>{c.detail}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-subtle" />
                  </Link>
                </motion.li>
              ))}
            </ul>
          </div>
        </Card>
        <Card>
          <CardHeader title="My access requests" actions={<Link to="/access-requests" className="text-xs text-accent hover:underline">View all</Link>} />
          <div className="grid grid-cols-3 gap-2 p-4">
            {(["pending", "approved", "rejected"] as const).map((k) => (
              <div key={k} className="rounded-lg border border-line bg-surface/50 p-3 text-center">
                {summary.isLoading ? <Skeleton className="mx-auto h-6 w-8" /> : <p className="num text-xl font-semibold">{summary.data?.[k] ?? 0}</p>}
                <p className="mt-0.5 text-2xs capitalize text-subtle">{k}</p>
              </div>
            ))}
          </div>
          <ul className="divide-y divide-line/60 border-t border-line/60">
            {requests.data?.items.map((r) => (
              <li key={r.id}>
                <Link to={`/access-requests?id=${r.id}`} className="flex items-center gap-2 px-4 py-2.5 hover:bg-elevated/40">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{r.resource.name}</span>
                  {r.engine_decision && <DecisionBadge decision={r.engine_decision} />}
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
            {requests.data?.items.length === 0 && <li><EmptyState title="No requests yet" description="Request access to protected resources when you need it." /></li>}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {can("resources:read") && (
          <Card className="lg:col-span-2">
            <CardHeader title="Protected resources" description="Access is evaluated in real time on every attempt" actions={<Link to="/resources" className="text-xs text-accent hover:underline">Open catalogue</Link>} />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {resources.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
              {resources.data?.items.map((r) => {
                const ent = r.entitlement?.has_permission || r.entitlement?.has_active_grant;
                return (
                  <Link key={r.id} to={ent ? "/resources" : `/access-requests?new=1&resource=${r.id}`}
                    className="flex items-center gap-3 rounded-lg border border-line bg-surface/50 p-3 hover:border-line-strong">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-elevated text-subtle"><AppWindow className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{r.name}</p><p className="text-2xs text-subtle">{ent ? "Entitled" : "Request required"}</p></div>
                    <Badge tone={SENS_TONE[r.sensitivity]}>{r.sensitivity}</Badge>
                  </Link>
                );
              })}
            </div>
          </Card>
        )}
        <Card className={can("resources:read") ? "" : "lg:col-span-3"}>
          <CardHeader title="My devices" description="Trust is granted by security administrators" />
          <ul className="divide-y divide-line/60">
            {devices.isLoading && <li className="p-4"><Skeleton className="h-8" /></li>}
            {devices.data?.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <MonitorSmartphone className="h-4 w-4 text-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{d.name} {d.is_current && <span className="ml-1 text-2xs text-accent">· this device</span>}</p>
                  <p className="text-2xs text-subtle">Last seen {timeAgo(d.last_seen_at)}</p>
                </div>
                <TrustBadge status={d.trust_status} />
              </li>
            ))}
            {devices.data?.length === 0 && <li><EmptyState title="No registered devices" /></li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
