import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Ban, Building2, Calendar, Clock, KeyRound, Laptop, Lock, LockOpen, Pencil, Power, RefreshCw, RotateCcw,
  ShieldAlert, ShieldCheck, ShieldOff, UserCheck, UserCog, UserX, MonitorSmartphone, Timer, Info,
} from "lucide-react";
import { Avatar, Card, CardHeader, PageHeader } from "@/components/ui/Page";
import { Badge, DemoTag, StatusBadge, TrustBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, EmptyState, Skeleton, type Column } from "@/components/ui/Data";
import { RiskMeter, RiskRing } from "@/components/security/Risk";
import { ExplainButton } from "@/components/security/Assistant";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import type { Page, SessionRow } from "@/types/api";
import { cn, fmtDate, timeAgo, titleCase } from "@/utils/format";
import { groupBy, isLocked } from "@/features/identity/hooks";
import type { RecalcRiskResult, UserDetailResponse } from "@/features/identity/types";
import { AuthTimeline } from "@/features/identity/AuthTimeline";
import { ChangeRolesModal, EditProfileModal, ResetAccessModal, StatusChangeDialog, type StatusAction } from "@/features/identity/UserActionModals";
import { TerminateSessionDialog, type TerminateTarget } from "@/features/sessions/TerminateSessionDialog";

export default function UserDetail() {
  const { id = "" } = useParams();
  const { user: me, can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [modal, setModal] = useState<"edit" | "roles" | "reset" | null>(null);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);

  const q = useQuery({
    queryKey: ["users", "detail", id],
    queryFn: async () => (await api.get<UserDetailResponse>(`/users/${id}`)).data,
    retry: (n, e) => apiError(e).status !== 404 && apiError(e).status !== 422 && n < 2,
  });

  const unlock = useMutation({
    mutationFn: async () => (await api.post(`/users/${id}/unlock`)).data,
    onSuccess: () => { toast.success("Account unlocked", "Failed sign-in counter reset."); void qc.invalidateQueries({ queryKey: ["users"] }); },
    onError: (e) => toast.error("Could not unlock", apiError(e).message),
  });
  const recalc = useMutation({
    mutationFn: async () => (await api.post<RecalcRiskResult>(`/users/${id}/recalculate-risk`)).data,
    onSuccess: (r) => {
      const delta = r.score - r.previous;
      toast.success("Risk recalculated", `Score ${r.previous} → ${r.score}${delta ? ` (${delta > 0 ? "+" : ""}${delta})` : " (unchanged)"} · ${titleCase(r.level)}`);
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error("Could not recalculate risk", apiError(e).message),
  });

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError || !q.data) {
    const err = apiError(q.error);
    const missing = err.status === 404 || err.status === 422;
    return (
      <>
        <PageHeader title="User" breadcrumbs={[{ label: "Identity", to: "/identity" }, { label: "User" }]} />
        <Card>
          <EmptyState icon={<UserX className="h-5 w-5" />} title={missing ? "User not found" : "Could not load user"}
            description={missing ? "This identity does not exist or was removed." : err.message}
            action={<div className="flex gap-2">
              {!missing && <Button size="sm" onClick={() => q.refetch()}>Retry</Button>}
              <Button size="sm" variant="outline" icon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => nav("/identity")}>Back to Identity</Button>
            </div>} />
        </Card>
      </>
    );
  }

  const { user: u, permissions, risk, devices, active_grants } = q.data;
  const self = me?.id === u.id;
  const locked = isLocked(u);
  const myLevel = Math.max(0, ...(me?.roles.map((r) => r.level) ?? []));
  const theirLevel = Math.max(0, ...u.roles.map((r) => r.level));
  const isSuper = me?.roles.some((r) => r.name === "super_admin") ?? false;
  const outranked = !self && !isSuper && theirLevel >= myLevel;
  const canWrite = can("users:write");
  const manage = canWrite && !self;

  return (
    <>
      <PageHeader title={u.full_name} breadcrumbs={[{ label: "Identity", to: "/identity" }, { label: "Users", to: "/identity" }, { label: u.full_name }]} />

      {/* ------------------------------------------------------------ header card */}
      <Card className="mb-4">
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Avatar name={u.full_name} size={56} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[17px] font-semibold text-fg">{u.full_name}</h2>
                {locked ? <Badge tone="danger" dot><Lock className="h-2.5 w-2.5" />Locked</Badge> : <StatusBadge status={u.status} />}
                {self && <Badge tone="accent">You</Badge>}
                {u.is_demo && <DemoTag />}
              </div>
              <p className="mt-0.5 truncate text-[13px] text-muted">{u.email}</p>
              <div className="mt-2.5 flex flex-wrap gap-1">
                {u.roles.map((r) => <Badge key={r.id} tone={r.level >= 80 ? "lavender" : r.level >= 50 ? "accent" : "neutral"}>{r.display_name}</Badge>)}
              </div>
              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
                <Meta icon={<Building2 className="h-3.5 w-3.5" />} label="Department" value={[u.department, u.job_title].filter(Boolean).join(" · ") || "—"} />
                <Meta icon={u.mfa_enabled ? <ShieldCheck className="h-3.5 w-3.5 text-success" /> : <ShieldOff className="h-3.5 w-3.5 text-warning" />} label="MFA"
                  value={u.mfa_enabled ? "Enrolled (TOTP)" : "Not enrolled"} />
                <Meta icon={<Clock className="h-3.5 w-3.5" />} label="Last login"
                  value={u.last_login_at ? <span title={fmtDate(u.last_login_at)}>{timeAgo(u.last_login_at)}{u.last_login_ip && <span className="ml-1.5 font-mono text-2xs text-subtle">{u.last_login_ip}</span>}</span> : "Never"} />
                <Meta icon={<Calendar className="h-3.5 w-3.5" />} label="Created" value={fmtDate(u.created_at, { dateStyle: "medium" })} />
                <Meta icon={<MonitorSmartphone className="h-3.5 w-3.5" />} label="Active sessions" value={<span className="num">{u.active_sessions}</span>} />
                <Meta icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Failed sign-ins" value={<span className="num">{u.failed_login_count}{locked && u.locked_until ? ` · locked until ${fmtDate(u.locked_until, { timeStyle: "short" })}` : ""}</span>} />
              </dl>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:max-w-[340px] lg:justify-end">
            {canWrite && !outranked && <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setModal("edit")}>Edit profile</Button>}
            {can("users:manage_roles") && !self && <Button size="sm" icon={<UserCog className="h-3.5 w-3.5" />} onClick={() => setModal("roles")}>Change roles</Button>}
            {manage && locked && <Button size="sm" icon={<LockOpen className="h-3.5 w-3.5" />} loading={unlock.isPending} onClick={() => unlock.mutate()}>Unlock</Button>}
            {manage && u.status === "active" && <Button size="sm" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setStatusAction("suspend")}>Suspend</Button>}
            {manage && u.status !== "deactivated" && <Button size="sm" icon={<Power className="h-3.5 w-3.5" />} onClick={() => setStatusAction("deactivate")}>Deactivate</Button>}
            {manage && u.status !== "active" && <Button size="sm" variant="subtle" icon={<UserCheck className="h-3.5 w-3.5" />} onClick={() => setStatusAction("activate")}>Activate</Button>}
            {manage && <Button size="sm" variant="danger" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setModal("reset")}>Reset access</Button>}
          </div>
        </div>
        {(self || outranked) && canWrite && (
          <div className="flex items-start gap-2 border-t border-line/70 px-5 py-2.5 text-xs text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            {self
              ? "This is your own account. Status, role and access-reset actions are blocked for self-management; another administrator must perform them."
              : "This user holds equal or higher privileges than you. The server will reject management actions against them."}
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ------------------------------------------------------------ left column */}
        <div className="space-y-4 xl:col-span-1">
          <Card>
            <CardHeader title="Risk posture" description="Rule-based score from sign-in, device and behaviour signals."
              actions={<ExplainButton endpoint={`/assistant/users/${id}/risk`} label="Interpret risk" />} />
            <div className="p-5">
              <div className="flex items-center gap-5">
                <RiskRing score={risk.score} size={84} />
                <div className="min-w-0 text-xs text-muted">
                  <p>Stored score <span className="num font-medium text-fg">{risk.score}</span></p>
                  <p className="mt-0.5">Live computation <span className="num font-medium text-fg">{risk.computed_score}</span></p>
                  {risk.computed_score !== risk.score && <p className="mt-1 text-warning">Stored score is out of date.</p>}
                  {can("users:write") && <Button className="mt-2.5" size="xs" variant="outline" icon={<RefreshCw className="h-3 w-3" />} loading={recalc.isPending} onClick={() => recalc.mutate()}>Recalculate</Button>}
                </div>
              </div>
              <div className="mt-5">
                <p className="label mb-2">Contributing factors</p>
                {risk.factors.length === 0 ? <p className="text-xs text-subtle">No risk factors present.</p> : (
                  <ul className="space-y-2">
                    {[...risk.factors].sort((a, b) => b.points - a.points).map((f) => (
                      <li key={f.factor} className="text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-fg">{f.label}</span>
                          <span className="num shrink-0 font-medium text-warning">+{f.points}</span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-elevated">
                          <motion.div className="h-full rounded-full bg-warning/70" initial={{ width: 0 }} animate={{ width: `${Math.min(100, f.points * 2.5)}%` }} transition={{ duration: 0.6 }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Effective permissions" description={`${permissions.length} permissions via ${u.roles.length} role${u.roles.length === 1 ? "" : "s"}`} />
            <div className="space-y-2.5 p-5">
              {permissions.length === 0 && <p className="text-xs text-subtle">No permissions.</p>}
              {groupBy(permissions, (p) => p.split(":")[0]).map(([cat, ps]) => (
                <div key={cat}>
                  <p className="label mb-1">{titleCase(cat)}</p>
                  <div className="flex flex-wrap gap-1">{ps.map((p) => <span key={p} className="rounded-md border border-line bg-elevated/60 px-1.5 py-0.5 font-mono text-2xs text-muted">{p}</span>)}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ------------------------------------------------------------ right column */}
        <div className="space-y-4 xl:col-span-2">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Devices" description="Browser identifier or manual registration; posture is not agent-verified." />
              {devices.length === 0 ? <EmptyState icon={<Laptop className="h-5 w-5" />} title="No devices" description="No devices are associated with this user." /> : (
                <ul className="divide-y divide-line/60">
                  {devices.map((d) => (
                    <li key={d.id}>
                      <Link to={`/devices?id=${d.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-elevated/50">
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-fg">{d.name}</span>
                          <span className="block truncate text-xs text-muted">{d.os ?? "Unknown OS"} · {d.last_seen_at ? timeAgo(d.last_seen_at) : "never seen"}{d.ip_address && <span className="ml-1 font-mono text-2xs text-subtle">{d.ip_address}</span>}</span>
                        </span>
                        <TrustBadge status={d.trust_status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Active access grants" description="Approved just-in-time access that has not expired." />
              {active_grants.length === 0 ? <EmptyState icon={<KeyRound className="h-5 w-5" />} title="No active grants" /> : (
                <ul className="divide-y divide-line/60">
                  {active_grants.map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <Link to="/access-requests" className="min-w-0 truncate text-[13px] font-medium text-fg hover:text-accent">{g.resource}</Link>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted" title={fmtDate(g.expires_at)}><Timer className="h-3 w-3" />expires {timeAgo(g.expires_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {can("sessions:read_all") && <UserSessions userId={u.id} email={u.email} />}

          <Card>
            <CardHeader title="Authentication history" description="Sign-ins, MFA challenges and sign-outs. Select an event for details." />
            <AuthTimeline userId={u.id} />
          </Card>
        </div>
      </div>

      <EditProfileModal user={u} open={modal === "edit"} onClose={() => setModal(null)} />
      <ChangeRolesModal user={u} open={modal === "roles"} onClose={() => setModal(null)} />
      <ResetAccessModal user={u} open={modal === "reset"} onClose={() => setModal(null)} />
      <StatusChangeDialog user={u} action={statusAction} onClose={() => setStatusAction(null)} />
    </>
  );
}

function Meta({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-subtle">{icon}</span>
      <dt className="shrink-0 text-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-fg">{value}</dd>
    </div>
  );
}

function UserSessions({ userId, email }: { userId: string; email: string }) {
  const { can } = useAuth();
  const [target, setTarget] = useState<TerminateTarget | null>(null);
  const q = useQuery({
    queryKey: ["sessions", "by-user", userId],
    queryFn: async () => (await api.get<Page<SessionRow>>("/sessions", { params: { user_id: userId, status: "active", page_size: 50 } })).data,
  });
  const columns: Column<SessionRow>[] = [
    {
      key: "id", header: "Session", render: (s) => (
        <div className="flex items-center gap-1.5"><span className="font-mono text-xs text-fg">{s.id.slice(0, 8)}</span>{s.is_current && <Badge tone="accent">This session</Badge>}{s.is_demo && <DemoTag />}</div>
      ),
    },
    { key: "device", header: "Device", render: (s) => s.device ? <div className="flex items-center gap-2"><span className="max-w-[140px] truncate text-xs">{s.device.name}</span><TrustBadge status={s.device.trust_status} /></div> : <span className="text-xs text-subtle">Unregistered</span> },
    { key: "ip", header: "IP", render: (s) => <div className="leading-tight"><p className="font-mono text-xs">{s.ip_address ?? "—"}</p><p className="text-2xs text-subtle">{s.location ?? "Unknown (no GeoIP)"}</p></div> },
    { key: "last", header: "Last activity", hideBelow: "md", render: (s) => <span className="text-xs text-muted">{timeAgo(s.last_activity_at)}</span> },
    { key: "mfa", header: "MFA", hideBelow: "lg", render: (s) => s.mfa_verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">No</Badge> },
    { key: "risk", header: "Risk", render: (s) => <RiskMeter score={s.risk_score} /> },
    {
      key: "actions", header: <span className="sr-only">Actions</span>, className: "text-right", render: (s) => can("sessions:terminate") && !s.is_current
        ? <Button size="xs" variant="ghost" className="text-danger hover:text-danger" onClick={() => setTarget({ id: s.id, email, ip: s.ip_address })}>Terminate</Button> : null,
    },
  ];
  return (
    <Card>
      <CardHeader title="Active sessions" description={q.data ? `${q.data.total} active` : "Live sessions for this identity"}
        actions={<Link to={`/sessions`} className="text-xs text-accent hover:underline">All sessions</Link>} />
      {q.isError ? <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="Could not load sessions" description={apiError(q.error).message} /> : (
        <DataTable columns={columns} rows={q.data?.items} loading={q.isLoading} rowKey={(s) => s.id} skeletonRows={2}
          empty={<EmptyState icon={<MonitorSmartphone className="h-5 w-5" />} title="No active sessions" description="This user is not currently signed in anywhere." />} />
      )}
      <TerminateSessionDialog target={target} onClose={() => setTarget(null)} />
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-2 h-3 w-40" />
      <Skeleton className="mb-6 h-7 w-56" />
      <Card className="mb-4 p-5">
        <div className="flex gap-4"><Skeleton className="h-14 w-14 rounded-full" /><div className="flex-1 space-y-2.5"><Skeleton className="h-5 w-48" /><Skeleton className="h-3.5 w-64" /><Skeleton className="h-3.5 w-80 max-w-full" /></div></div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-xl" />
        <div className={cn("space-y-4 xl:col-span-2")}><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>
      </div>
    </div>
  );
}
