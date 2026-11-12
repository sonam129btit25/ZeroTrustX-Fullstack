import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, AlertOctagon, CheckCircle2, Cpu, Database, Globe2, LayoutGrid, MonitorCheck, Radio, RefreshCw, ShieldBan,
  ShieldX, Timer, Users, Zap,
} from "lucide-react";
import { api, apiError } from "@/services/api";
import { Card, CardHeader, PageHeader, Avatar } from "@/components/ui/Page";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { Tabs, Skeleton, EmptyState } from "@/components/ui/Data";
import { Input, Switch } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { DemoTag, SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { RiskMeter } from "@/components/security/Risk";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { useThemeColors, alpha } from "@/hooks/useThemeColors";
import { usePreferences } from "@/context/PreferencesContext";
import { useRealtime, useRealtimeEvent } from "@/context/RealtimeContext";
import { useAuth } from "@/context/AuthContext";
import { cn, fmtNum, timeAgo, titleCase } from "@/utils/format";
import type { Severity } from "@/types/api";

type Range = "today" | "7d" | "30d" | "custom";

interface Overview {
  range: { start: string; end: string; unit: "hour" | "day" };
  metrics: Record<string, number>;
  series: {
    security_activity: { bucket: string; events: number; high_severity: number }[];
    access_decisions: ({ bucket: string } & Record<string, number>)[];
    authentication: { bucket: string; success: number; failure: number; mfa_failure: number }[];
    threats: ({ bucket: string } & Record<string, number>)[];
  };
  auth_rates: { success: number; failure: number; success_rate: number | null };
  decision_totals: Record<string, number>;
  risk_distribution: { level: string; users: number }[];
  device_trust: { status: string; count: number }[];
  recent_events: { id: number; action: string; category: string; severity: Severity; actor_email: string | null; target_label: string | null; created_at: string; outcome: string; is_demo: boolean }[];
  high_risk_users: { id: string; email: string; full_name: string; risk_score: number; risk_level: string; department: string | null }[];
  geo_activity: { location: string; country_code: string | null; logins: number; failures: number }[];
  system_health: { api: string; database: string; database_latency_ms: number; realtime: string; websocket_clients: number; uptime_seconds: number; policy_engine: string };
}

const WIDGETS: [string, string][] = [
  ["activity", "Security activity"], ["health", "System health"], ["access", "Access decisions"], ["auth", "Authentication"],
  ["threats", "Threat detection"], ["risk", "Risk distribution"], ["devices", "Device trust"], ["events", "Recent security events"],
  ["riskyUsers", "High-risk users"], ["geo", "Geographic login activity"],
];

function fmtBucket(b: string, unit: "hour" | "day") {
  const d = new Date(unit === "hour" ? `${b}:00Z` : `${b}T00:00:00Z`);
  return unit === "hour" ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function uptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function Widget({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const { dashboardWidgets } = usePreferences();
  if (dashboardWidgets[id] === false) return null;
  return <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={className}>{children}</motion.div>;
}

export default function Dashboard() {
  const [range, setRange] = useState<Range>("7d");
  const [custom, setCustom] = useState({ start: "", end: "" });
  const [customize, setCustomize] = useState(false);
  const [pulse, setPulse] = useState(0);
  const nav = useNavigate();
  const c = useThemeColors();
  const { user } = useAuth();
  const { state } = useRealtime();
  const { dashboardWidgets, setWidget } = usePreferences();

  const customReady = range !== "custom" || (custom.start && custom.end && custom.start < custom.end);
  const q = useQuery({
    queryKey: ["dashboard", range, range === "custom" ? custom : null],
    queryFn: async () => (await api.get<Overview>("/dashboard/overview", {
      params: range === "custom" ? { range, start: new Date(custom.start).toISOString(), end: new Date(custom.end).toISOString() } : { range },
    })).data,
    enabled: !!customReady,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  useRealtimeEvent(["access.decision", "threat.created", "session.created", "audit.created"], () => setPulse((p) => p + 1));

  const d = q.data;
  // Animate charts on first paint only; live refetches update in place without replaying animations.
  const [anim, setAnim] = useState(true);
  useEffect(() => { if (d && anim) { const t = setTimeout(() => setAnim(false), 1500); return () => clearTimeout(t); } }, [d, anim]);
  const unit = d?.range.unit ?? "day";
  const decisionColors: Record<string, string> = { ALLOW: c.success, DENY: c.danger, REQUIRE_MFA: c.lavender, REQUIRE_DEVICE_VERIFICATION: c.warning, RESTRICTED_ACCESS: c.cyan };
  const sevColors: Record<string, string> = { critical: c.danger, high: alpha(c.danger, 0.6), medium: c.warning, low: c.accent, informational: c.subtle };
  const trustColors: Record<string, string> = { trusted: c.success, pending_verification: c.accent, untrusted: c.warning, suspicious: alpha(c.warning, 0.6), blocked: c.danger };
  const riskColors: Record<string, string> = { minimal: c.success, low: c.accent, medium: c.warning, high: alpha(c.danger, 0.7), critical: c.danger };
  const axis = { stroke: c.subtle, fontSize: 11, tickLine: false, axisLine: false } as const;

  const authPie = useMemo(() => d ? [
    { name: "Successful", value: d.auth_rates.success, fill: c.success },
    { name: "Failed", value: d.auth_rates.failure, fill: c.danger },
  ] : [], [d, c]);
  const m = d?.metrics;
  const loading = q.isLoading;

  return (
    <div>
      <PageHeader
        title="Security Overview"
        description={<>Command center for {user?.full_name?.split(" ")[0] ?? "you"} — live posture across identities, devices, sessions and access decisions.</>}
        breadcrumbs={[{ label: "ZeroTrustX" }, { label: "Overview" }]}
        actions={<>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span key={pulse} className={cn("relative flex h-2 w-2")}>
              {state === "live" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />}
              <span className={cn("relative inline-flex h-2 w-2 rounded-full", state === "live" ? "bg-success" : "bg-subtle")} />
            </span>
            {state === "live" ? "Streaming" : "Polling"} · updated {q.dataUpdatedAt ? timeAgo(new Date(q.dataUpdatedAt).toISOString()) : "—"}
          </span>
          <Button size="sm" variant="ghost" icon={<RefreshCw className={cn("h-3.5 w-3.5", q.isFetching && "animate-spin")} />} onClick={() => q.refetch()}>Refresh</Button>
          <Button size="sm" variant="secondary" icon={<LayoutGrid className="h-3.5 w-3.5" />} onClick={() => setCustomize(true)}>Customize</Button>
        </>}
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs<Range> value={range} onChange={setRange} tabs={[{ value: "today", label: "Today" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "custom", label: "Custom" }]} />
        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="datetime-local" aria-label="Start" value={custom.start} onChange={(e) => setCustom((s) => ({ ...s, start: e.target.value }))} className="w-auto" />
            <span className="text-xs text-subtle">to</span>
            <Input type="datetime-local" aria-label="End" value={custom.end} onChange={(e) => setCustom((s) => ({ ...s, end: e.target.value }))} className="w-auto" />
            {!customReady && <span className="text-xs text-subtle">Select a valid range</span>}
          </div>
        )}
      </div>

      {q.isError && <Card className="mb-4 p-4 text-xs text-danger">{apiError(q.error).message}</Card>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard loading={loading} label="Total users" value={fmtNum(m?.total_users)} icon={<Users className="h-4 w-4" />} hint={m && `${m.active_users} active · ${m.mfa_adoption}% MFA`} onClick={() => nav("/identity")} />
        <StatCard loading={loading} label="Active sessions" value={fmtNum(m?.active_sessions)} icon={<Activity className="h-4 w-4" />} tone="cyan" hint="Right now" onClick={() => nav("/sessions")} />
        <StatCard loading={loading} label="Trusted devices" value={fmtNum(m?.trusted_devices)} icon={<MonitorCheck className="h-4 w-4" />} tone="success" hint={m && `of ${m.total_devices} registered`} onClick={() => nav("/devices")} />
        <StatCard loading={loading} label="Blocked access" value={fmtNum(m?.blocked_requests)} icon={<ShieldBan className="h-4 w-4" />} tone="danger" hint={m && `of ${fmtNum(m.access_evaluations)} evaluations`} onClick={() => nav("/audit-logs?category=access")} />
        <StatCard loading={loading} label="Active threats" value={fmtNum(m?.active_threats)} icon={<AlertOctagon className="h-4 w-4" />} tone="warning" hint={m && `${m.threats_in_range} detected in range`} onClick={() => nav("/threats")} />
        <StatCard loading={loading} label="Policy violations" value={fmtNum(m?.policy_violations)} icon={<ShieldX className="h-4 w-4" />} tone="lavender" hint={m && `${m.pending_requests} requests pending`} onClick={() => nav("/policies")} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Widget id="activity" className="xl:col-span-2">
          <Card>
            <CardHeader title="Security activity" description="Audit events recorded per period, with high/critical severity overlay" />
            <div className="h-[260px] px-2 pb-3 pt-4">
              {loading ? <Skeleton className="mx-3 h-full" /> : (
                <ResponsiveContainer>
                  <AreaChart data={d?.series.security_activity} margin={{ left: -18, right: 8 }}>
                    <defs>
                      <linearGradient id="gEv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.accent} stopOpacity={0.35} /><stop offset="100%" stopColor={c.accent} stopOpacity={0} /></linearGradient>
                      <linearGradient id="gHi" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.lavender} stopOpacity={0.35} /><stop offset="100%" stopColor={c.lavender} stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke={alpha(c.line, 0.6)} strokeDasharray="3 4" />
                    <XAxis dataKey="bucket" tickFormatter={(b) => fmtBucket(b, unit)} {...axis} minTickGap={24} />
                    <YAxis allowDecimals={false} {...axis} />
                    <Tooltip content={<ChartTooltip labelFormatter={(l) => fmtBucket(l, unit)} />} cursor={{ stroke: c.line }} />
                    <Area isAnimationActive={anim} type="monotone" dataKey="events" name="All events" stroke={c.accent} strokeWidth={2} fill="url(#gEv)" animationDuration={700} />
                    <Area isAnimationActive={anim} type="monotone" dataKey="high_severity" name="High severity" stroke={c.lavender} strokeWidth={1.5} fill="url(#gHi)" animationDuration={900} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </Widget>
        <Widget id="health">
          <Card className="h-full">
            <CardHeader title="System health" description="Live component status" actions={<StatusBadge status={d?.system_health.api === "operational" ? "active" : "pending"} />} />
            <ul className="divide-y divide-line/60 px-5">
              {[
                [Zap, "API gateway", d?.system_health.api, null],
                [Database, "PostgreSQL", d?.system_health.database, d && `${d.system_health.database_latency_ms} ms`],
                [Cpu, "Policy engine", d?.system_health.policy_engine, "deterministic"],
                [Radio, "Realtime channel", state === "live" ? "operational" : state, d && `${d.system_health.websocket_clients} clients`],
                [Timer, "Uptime", "operational", d && uptime(d.system_health.uptime_seconds)],
              ].map(([Icon, label, st, extra]) => {
                const I = Icon as typeof Zap;
                const ok = st === "operational";
                return (
                  <li key={label as string} className="flex items-center gap-3 py-3">
                    <I className="h-4 w-4 text-subtle" />
                    <span className="text-[13px] text-fg">{label as string}</span>
                    <span className="ml-auto text-xs text-subtle">{(extra as string) ?? ""}</span>
                    <span className={cn("h-2 w-2 rounded-full", ok ? "bg-success" : st ? "bg-warning" : "bg-subtle")} title={String(st ?? "unknown")} />
                  </li>
                );
              })}
            </ul>
            {d && (
              <div className="mx-5 mb-4 mt-1 rounded-lg border border-line bg-surface/60 p-3">
                <div className="flex items-center justify-between text-xs"><span className="text-muted">MFA adoption</span><span className="num font-medium">{d.metrics.mfa_adoption}%</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-accent to-lavender" initial={{ width: 0 }} animate={{ width: `${d.metrics.mfa_adoption}%` }} transition={{ duration: 0.8 }} />
                </div>
                <p className="mt-2 text-2xs text-subtle">{d.metrics.enabled_policies} Zero Trust policies enforced</p>
              </div>
            )}
          </Card>
        </Widget>

        <Widget id="access" className="xl:col-span-2">
          <Card>
            <CardHeader title="Access requests & decisions" description="Policy engine outcomes per period (simulations excluded)"
              actions={d && <span className="hidden gap-3 text-2xs text-muted sm:flex">{Object.entries(decisionColors).map(([k, col]) => (
                <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: col }} />{titleCase(k.toLowerCase())}</span>))}</span>} />
            <div className="h-[260px] px-2 pb-3 pt-4">
              {loading ? <Skeleton className="mx-3 h-full" /> : (
                <ResponsiveContainer>
                  <BarChart data={d?.series.access_decisions} margin={{ left: -18, right: 8 }} barCategoryGap="22%">
                    <CartesianGrid vertical={false} stroke={alpha(c.line, 0.6)} strokeDasharray="3 4" />
                    <XAxis dataKey="bucket" tickFormatter={(b) => fmtBucket(b, unit)} {...axis} minTickGap={24} />
                    <YAxis allowDecimals={false} {...axis} />
                    <Tooltip content={<ChartTooltip labelFormatter={(l) => fmtBucket(l, unit)} />} cursor={{ fill: alpha(c.elevated, 0.5) }} />
                    {Object.entries(decisionColors).map(([k, col], i, arr) => (
                      <Bar isAnimationActive={anim} key={k} dataKey={k} stackId="a" fill={col} radius={i === arr.length - 1 ? [3, 3, 0, 0] : 0} animationDuration={600 + i * 100} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </Widget>
        <Widget id="auth">
          <Card className="h-full">
            <CardHeader title="Authentication" description="Sign-in success vs failure" />
            <div className="flex items-center gap-4 p-5">
              <div className="relative h-[150px] w-[150px] shrink-0">
                {loading ? <Skeleton className="h-full w-full rounded-full" /> : (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie isAnimationActive={anim} data={authPie.some((p) => p.value) ? authPie : [{ name: "No data", value: 1, fill: c.elevated }]} dataKey="value" innerRadius={52} outerRadius={70} paddingAngle={2} stroke="none" animationDuration={800}>
                        {(authPie.some((p) => p.value) ? authPie : [{ fill: c.elevated }]).map((p, i) => <Cell key={i} fill={p.fill} />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                  <div><p className="num text-xl font-semibold">{d?.auth_rates.success_rate ?? "—"}{d?.auth_rates.success_rate !== null && d ? "%" : ""}</p><p className="text-2xs text-subtle">success</p></div>
                </div>
              </div>
              <ul className="flex-1 space-y-3 text-xs">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-success" /><span className="text-muted">Successful</span><span className="num ml-auto font-medium">{fmtNum(d?.auth_rates.success)}</span></li>
                <li className="flex items-center gap-2"><ShieldX className="h-3.5 w-3.5 text-danger" /><span className="text-muted">Failed</span><span className="num ml-auto font-medium">{fmtNum(d?.auth_rates.failure)}</span></li>
                <li className="flex items-center gap-2"><AlertOctagon className="h-3.5 w-3.5 text-lavender" /><span className="text-muted">MFA failures</span><span className="num ml-auto font-medium">{fmtNum(d?.series.authentication.reduce((a, b) => a + b.mfa_failure, 0))}</span></li>
              </ul>
            </div>
            <div className="h-[70px] px-2 pb-3">
              {d && (
                <ResponsiveContainer>
                  <AreaChart data={d.series.authentication} margin={{ left: 0, right: 0, top: 4 }}>
                    <Tooltip content={<ChartTooltip labelFormatter={(l) => fmtBucket(l, unit)} />} />
                    <XAxis dataKey="bucket" hide />
                    <Area isAnimationActive={anim} type="monotone" dataKey="success" stroke={c.success} fill={alpha(c.success, 0.12)} strokeWidth={1.5} />
                    <Area isAnimationActive={anim} type="monotone" dataKey="failure" stroke={c.danger} fill={alpha(c.danger, 0.12)} strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </Widget>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Widget id="threats" className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader title="Threat detection" description="Rule-based detections by severity" actions={<Link to="/threats" className="text-xs text-accent hover:underline">View all</Link>} />
            <div className="h-[230px] px-2 pb-3 pt-4">
              {loading ? <Skeleton className="mx-3 h-full" /> : (
                <ResponsiveContainer>
                  <BarChart data={d?.series.threats} margin={{ left: -18, right: 8 }}>
                    <CartesianGrid vertical={false} stroke={alpha(c.line, 0.6)} strokeDasharray="3 4" />
                    <XAxis dataKey="bucket" tickFormatter={(b) => fmtBucket(b, unit)} {...axis} minTickGap={24} />
                    <YAxis allowDecimals={false} {...axis} />
                    <Tooltip content={<ChartTooltip labelFormatter={(l) => fmtBucket(l, unit)} />} cursor={{ fill: alpha(c.elevated, 0.5) }} />
                    {["informational", "low", "medium", "high", "critical"].map((k) => <Bar isAnimationActive={anim} key={k} dataKey={k} stackId="t" fill={sevColors[k]} />)}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </Widget>
        <Widget id="risk">
          <Card className="h-full">
            <CardHeader title="Risk distribution" description="Active users by risk level" />
            <div className="h-[230px] px-2 pb-3 pt-4">
              {loading ? <Skeleton className="mx-3 h-full" /> : (
                <ResponsiveContainer>
                  <BarChart data={d?.risk_distribution} layout="vertical" margin={{ left: 4, right: 16 }}>
                    <XAxis type="number" allowDecimals={false} {...axis} />
                    <YAxis type="category" dataKey="level" width={64} tickFormatter={titleCase} {...axis} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: alpha(c.elevated, 0.5) }} />
                    <Bar isAnimationActive={anim} dataKey="users" radius={[0, 4, 4, 0]} barSize={14} animationDuration={700}>
                      {d?.risk_distribution.map((r) => <Cell key={r.level} fill={riskColors[r.level]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </Widget>
        <Widget id="devices">
          <Card className="h-full">
            <CardHeader title="Device trust status" description="Registered devices" actions={<Link to="/devices" className="text-xs text-accent hover:underline">Manage</Link>} />
            <div className="flex flex-col items-center px-4 pb-4 pt-2">
              <div className="h-[130px] w-[130px]">
                {d && (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie isAnimationActive={anim} data={d.device_trust.filter((x) => x.count)} dataKey="count" nameKey="status" innerRadius={42} outerRadius={60} paddingAngle={2} stroke="none">
                        {d.device_trust.filter((x) => x.count).map((x) => <Cell key={x.status} fill={trustColors[x.status]} />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <ul className="mt-2 w-full space-y-1.5">
                {d?.device_trust.map((x) => (
                  <li key={x.status} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-sm" style={{ background: trustColors[x.status] }} />
                    <span className="text-muted">{x.status === "pending_verification" ? "Pending verification" : titleCase(x.status)}</span>
                    <span className="num ml-auto font-medium">{x.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </Widget>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Widget id="events" className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader title="Recent security events" description="Latest authentication, access and threat activity" actions={<Link to="/audit-logs" className="text-xs text-accent hover:underline">Audit log</Link>} />
            {loading ? <div className="space-y-3 p-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}</div> : !d?.recent_events.length ? <EmptyState title="No recent events" /> : (
              <ol className="max-h-[380px] overflow-y-auto px-5 py-3">
                {d.recent_events.map((e, i) => (
                  <motion.li key={e.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="relative flex gap-3 pb-3.5">
                    {i < d.recent_events.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-line" />}
                    <span className={cn("relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-card",
                      e.outcome === "failure" ? "bg-danger" : e.severity === "high" || e.severity === "critical" ? "bg-warning" : "bg-accent")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-fg">{e.action}</span>
                        <SeverityBadge severity={e.severity} />
                        {e.is_demo && <DemoTag />}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted">{e.actor_email ?? "system"}{e.target_label ? ` → ${e.target_label}` : ""}</p>
                    </div>
                    <span className="shrink-0 text-2xs text-subtle">{timeAgo(e.created_at)}</span>
                  </motion.li>
                ))}
              </ol>
            )}
          </Card>
        </Widget>
        <Widget id="riskyUsers">
          <Card className="h-full">
            <CardHeader title="High-risk users" description="Highest current risk scores" />
            <ul className="divide-y divide-line/60">
              {loading && [0, 1, 2, 3].map((i) => <li key={i} className="px-5 py-3"><Skeleton className="h-6" /></li>)}
              {d?.high_risk_users.map((u) => (
                <li key={u.id}>
                  <Link to={`/identity/users/${u.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-elevated/40">
                    <Avatar name={u.full_name} size={28} />
                    <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{u.full_name}</p><p className="truncate text-2xs text-subtle">{u.department ?? u.email}</p></div>
                    <RiskMeter score={u.risk_score} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </Widget>
        <Widget id="geo">
          <Card className="h-full">
            <CardHeader title="Geographic login activity" description="Sign-ins by recorded location" actions={<Globe2 className="h-4 w-4 text-subtle" />} />
            <ul className="space-y-2.5 px-5 py-4">
              {loading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5" />)}
              {d && !d.geo_activity.length && <p className="text-xs text-muted">No sign-ins in this range.</p>}
              {d?.geo_activity.slice(0, 8).map((g) => {
                const max = Math.max(...d.geo_activity.map((x) => x.logins));
                return (
                  <li key={g.location}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate text-fg">{g.location}</span>
                      <span className="num text-muted">{g.logins}{g.failures ? <span className="text-danger"> · {g.failures} failed</span> : null}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-elevated">
                      <motion.div className="h-full rounded-full bg-accent/70" initial={{ width: 0 }} animate={{ width: `${(g.logins / max) * 100}%` }} transition={{ duration: 0.7 }} />
                    </div>
                  </li>
                );
              })}
              <p className="pt-1 text-2xs leading-relaxed text-subtle">Locations come from recorded event metadata. No GeoIP database is bundled, so live sign-ins are only classified as localhost / private network.</p>
            </ul>
          </Card>
        </Widget>
      </div>

      <Modal open={customize} onClose={() => setCustomize(false)} title="Customize dashboard" description="Choose which widgets appear. Saved in this browser." size="sm">
        <div className="space-y-3">
          {WIDGETS.map(([k, label]) => <Switch key={k} label={label} checked={dashboardWidgets[k] !== false} onChange={(v) => setWidget(k, v)} />)}
        </div>
      </Modal>
    </div>
  );
}
