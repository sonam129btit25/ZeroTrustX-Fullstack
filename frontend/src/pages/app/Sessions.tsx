import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Eraser, Fingerprint, MonitorSmartphone, Radar, Search, ShieldAlert, ShieldCheck, Users, X } from "lucide-react";
import { Card, CardHeader, PageHeader, Toolbar } from "@/components/ui/Page";
import { Badge, DemoTag, StatusBadge, TrustBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Form";
import { DataTable, EmptyState, Pagination, Skeleton, Tabs, type Column } from "@/components/ui/Data";
import { StatCard } from "@/components/ui/StatCard";
import { RiskMeter } from "@/components/security/Risk";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useRealtime, useRealtimeEvent } from "@/context/RealtimeContext";
import { api, apiError, cleanParams } from "@/services/api";
import type { Page, SessionRow } from "@/types/api";
import { cn, fmtDate, fmtNum, timeAgo } from "@/utils/format";
import { useDebounced, useTick } from "@/features/identity/hooks";
import { TerminateSessionDialog, type TerminateTarget } from "@/features/sessions/TerminateSessionDialog";

type StatusFilter = "active" | "revoked" | "expired" | "all";
const PAGE_SIZE = 20;

interface SessionStats {
  active: number; high_risk: number; without_mfa: number; distinct_users: number;
  unusual_patterns: { user_id: string; email: string | null; distinct_ips: number; pattern: string }[];
}

export default function Sessions() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [riskMin, setRiskMin] = useState("");
  const [sort, setSort] = useState<{ key: string; order: "asc" | "desc" }>({ key: "last_activity_at", order: "desc" });
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<TerminateTarget | null>(null);
  const [flash, setFlash] = useState<Record<string, "created" | "revoked">>({});
  const [pulse, setPulse] = useState<{ n: number; kind: "created" | "revoked" } | null>(null);
  const pulseTimer = useRef<number>();
  useTick(30_000);

  useRealtimeEvent(["session.created", "session.revoked"], (e) => {
    const id = e.data?.id as string | undefined;
    const kind = e.type === "session.created" ? "created" : "revoked";
    if (id) {
      setFlash((f) => ({ ...f, [id]: kind }));
      window.setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[id]; return n; }), 4000);
    }
    setPulse((p) => ({ n: (p?.n ?? 0) + 1, kind }));
    window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setPulse(null), 5000);
  });
  useEffect(() => () => window.clearTimeout(pulseTimer.current), []);

  const stats = useQuery({
    queryKey: ["sessions", "stats"],
    queryFn: async () => (await api.get<SessionStats>("/sessions/stats")).data,
  });
  const list = useQuery({
    queryKey: ["sessions", "list", { status, q, riskMin, sort, page }],
    queryFn: async () => (await api.get<Page<SessionRow>>("/sessions", {
      params: cleanParams({ status: status === "all" ? "" : status, q, risk_min: riskMin, sort: sort.key, order: sort.order, page, page_size: PAGE_SIZE }),
    })).data,
    placeholderData: keepPreviousData,
  });

  const expire = useMutation({
    mutationFn: async () => (await api.post<{ expired: number }>("/sessions/expire-stale")).data,
    onSuccess: (r) => {
      if (r.expired) toast.success(`Expired ${r.expired} stale session${r.expired === 1 ? "" : "s"}`, "Sessions past their absolute or idle timeout were closed.");
      else toast.info("No stale sessions", "Every active session is within its timeout window.");
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (e) => toast.error("Could not expire sessions", apiError(e).message),
  });

  const onSort = (key: string) => { setSort((x) => ({ key, order: x.key === key && x.order === "desc" ? "asc" : "desc" })); setPage(1); };
  const filtered = !!(q || riskMin);
  const canTerminate = can("sessions:terminate");
  const st = stats.data;

  const columns: Column<SessionRow>[] = [
    {
      key: "id", header: "Session", render: (s) => (
        <div className="flex items-center gap-1.5">
          <AnimatePresence>
            {flash[s.id] && (
              <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
                className={cn("relative h-1.5 w-1.5 rounded-full", flash[s.id] === "created" ? "bg-success" : "bg-danger")}
                title={flash[s.id] === "created" ? "Just started" : "Just revoked"}>
                <span className={cn("absolute inset-0 animate-ping rounded-full", flash[s.id] === "created" ? "bg-success/60" : "bg-danger/60")} />
              </motion.span>
            )}
          </AnimatePresence>
          <span className="font-mono text-xs text-fg" title={s.id}>{s.id.slice(0, 8)}</span>
          {s.is_current && <Badge tone="accent">This session</Badge>}
          {s.is_demo && <DemoTag />}
        </div>
      ),
    },
    {
      key: "user", header: "User", render: (s) => (
        <Link to={`/identity/users/${s.user.id}`} onClick={(e) => e.stopPropagation()} className="block min-w-0 leading-tight hover:text-accent">
          <p className="max-w-[150px] truncate text-xs font-medium text-fg">{s.user.full_name}</p>
          <p className="max-w-[150px] truncate text-2xs text-muted">{s.user.email}</p>
        </Link>
      ),
    },
    {
      key: "device", header: "Device", hideBelow: "lg", render: (s) => s.device ? (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <Link to={`/devices?id=${s.device.id}`} className="max-w-[120px] truncate text-xs text-fg hover:text-accent">{s.device.name}</Link>
          <TrustBadge status={s.device.trust_status} />
        </div>
      ) : <span className="text-xs text-subtle">Unregistered</span>,
    },
    {
      key: "ip", header: "IP / location", render: (s) => (
        <div className="leading-tight">
          <p className="font-mono text-xs text-fg">{s.ip_address ?? "—"}</p>
          <p className={cn("text-2xs", s.location ? "text-muted" : "text-subtle")}>{s.location ?? "Unknown (no GeoIP)"}</p>
        </div>
      ),
    },
    {
      key: "last_activity_at", header: "Activity", sortable: true, hideBelow: "md", render: (s) => (
        <div className="leading-tight">
          <p className="whitespace-nowrap text-xs text-fg" title={`Last activity ${fmtDate(s.last_activity_at)}`}>{timeAgo(s.last_activity_at)}</p>
          <p className="whitespace-nowrap text-2xs text-subtle" title={`Started ${fmtDate(s.created_at)}`}>started {timeAgo(s.created_at)}</p>
        </div>
      ),
    },
    { key: "risk_score", header: "Risk", sortable: true, render: (s) => <RiskMeter score={s.risk_score} /> },
    {
      key: "status", header: "Status / MFA", render: (s) => (
        <div className="flex flex-col items-start gap-1">
          <span title={s.revoked_reason ? `Reason: ${s.revoked_reason}` : undefined}><StatusBadge status={s.status} /></span>
          <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-2xs", s.mfa_verified ? "text-success" : "text-warning")}>
            {s.mfa_verified ? <ShieldCheck className="h-3 w-3" /> : <Fingerprint className="h-3 w-3" />}{s.mfa_verified ? "MFA verified" : "No MFA"}
          </span>
        </div>
      ),
    },
    {
      key: "actions", header: <span className="sr-only">Actions</span>, className: "text-right", render: (s) =>
        canTerminate && s.status === "active" && !s.is_current ? (
          <Button size="xs" variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger"
            onClick={(e) => { e.stopPropagation(); setTarget({ id: s.id, email: s.user.email, ip: s.ip_address }); }}>Terminate</Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title="Sessions" breadcrumbs={[{ label: "Overview", to: "/" }, { label: "Sessions" }]}
        description="Every authenticated session across the organisation, continuously re-evaluated. Terminate anything that looks wrong."
        actions={<>
          <LiveIndicator />
          {canTerminate && <Button icon={<Eraser className="h-4 w-4" />} loading={expire.isPending} onClick={() => expire.mutate()}>Expire stale sessions</Button>}
        </>} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Active sessions" value={fmtNum(st?.active)} icon={<Activity className="h-3.5 w-3.5" />} loading={stats.isLoading}
          onClick={() => { setStatus("active"); setRiskMin(""); setPage(1); }} />
        <StatCard label="Distinct users" value={fmtNum(st?.distinct_users)} icon={<Users className="h-3.5 w-3.5" />} tone="lavender" loading={stats.isLoading} />
        <StatCard label="High risk (≥ 60)" value={fmtNum(st?.high_risk)} icon={<ShieldAlert className="h-3.5 w-3.5" />} tone="danger" loading={stats.isLoading}
          onClick={() => { setStatus("active"); setRiskMin("60"); setPage(1); }} hint={st?.high_risk ? "Click to filter" : undefined} />
        <StatCard label="Without MFA" value={fmtNum(st?.without_mfa)} icon={<Fingerprint className="h-3.5 w-3.5" />} tone="warning" loading={stats.isLoading} />
      </div>

      <Card className="mb-4">
        <CardHeader title={<span className="flex items-center gap-2"><Radar className="h-4 w-4 text-lavender" />Unusual patterns</span>}
          description="Rule-based checks across active sessions (e.g. concurrent sessions from several IP addresses)." />
        {stats.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
          : stats.isError ? <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="Could not load session statistics" description={apiError(stats.error).message} action={<Button size="sm" onClick={() => stats.refetch()}>Retry</Button>} />
          : !st?.unusual_patterns.length ? <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No unusual patterns detected" description="No user currently has concurrent sessions from multiple IP addresses." />
          : (
            <ul className="divide-y divide-line/60">
              {st.unusual_patterns.map((p) => (
                <li key={p.user_id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-fg">{p.email ?? p.user_id}</p>
                      <p className="text-xs text-muted">{p.pattern} · <span className="num">{p.distinct_ips}</span> distinct IPs</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2 pl-6 sm:pl-0">
                    <Button size="xs" variant="outline" onClick={() => { setSearch(p.email ?? ""); setStatus("active"); setPage(1); }}>Show sessions</Button>
                    {can("users:read") && <Link to={`/identity/users/${p.user_id}`}><span className="inline-flex h-7 items-center rounded-md px-2.5 text-xs text-accent hover:bg-accent/10">View user</span></Link>}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Tabs className="mb-4 w-fit max-w-full" value={status} onChange={(v) => { setStatus(v); setPage(1); }}
        tabs={[{ value: "active", label: "Active", count: st?.active }, { value: "revoked", label: "Revoked" }, { value: "expired", label: "Expired" }, { value: "all", label: "All" }]} />

      <Card>
        <Toolbar>
          <div className="md:w-72">
            <Input placeholder="Search user email or IP…" value={search} leading={<Search className="h-4 w-4" />}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search sessions" />
          </div>
          <Select value={riskMin} onChange={(e) => { setRiskMin(e.target.value); setPage(1); }} aria-label="Minimum risk" className="md:w-40">
            <option value="">Any risk</option>
            <option value="15">Risk ≥ 15 (low)</option>
            <option value="35">Risk ≥ 35 (medium)</option>
            <option value="60">Risk ≥ 60 (high)</option>
            <option value="80">Risk ≥ 80 (critical)</option>
          </Select>
          <Select value={`${sort.key}:${sort.order}`} aria-label="Sort sessions" className="md:w-48"
            onChange={(e) => { const [key, order] = e.target.value.split(":"); setSort({ key, order: order as "asc" | "desc" }); setPage(1); }}>
            <option value="last_activity_at:desc">Most recent activity</option>
            <option value="last_activity_at:asc">Least recent activity</option>
            <option value="created_at:desc">Newest started</option>
            <option value="created_at:asc">Oldest started</option>
            <option value="risk_score:desc">Highest risk</option>
            <option value="risk_score:asc">Lowest risk</option>
          </Select>
          {filtered && <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => { setSearch(""); setRiskMin(""); setPage(1); }}>Clear</Button>}
          <div className="flex items-center gap-3 md:ml-auto">
            <AnimatePresence>
              {pulse && (
                <motion.button type="button" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  onClick={() => { setPulse(null); void list.refetch(); }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-2xs font-medium text-accent">
                  <span className="relative h-1.5 w-1.5 rounded-full bg-accent"><span className="absolute inset-0 animate-ping rounded-full bg-accent/60" /></span>
                  New activity{pulse.n > 1 ? ` · ${pulse.n}` : ""}
                </motion.button>
              )}
            </AnimatePresence>
            <span className="num text-xs text-subtle">{list.data ? `${list.data.total.toLocaleString()} sessions` : ""}</span>
          </div>
        </Toolbar>
        {list.isError ? (
          <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="Could not load sessions" description={apiError(list.error).message}
            action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>} />
        ) : (
          <DataTable columns={columns} rows={list.data?.items} loading={list.isLoading} rowKey={(s) => s.id} sort={sort} onSort={onSort}
            empty={<EmptyState icon={<MonitorSmartphone className="h-5 w-5" />} title={filtered ? "No sessions match" : `No ${status === "all" ? "" : status + " "}sessions`}
              description={filtered ? "Try a different search or risk threshold." : status === "active" ? "Nobody is signed in right now." : undefined} />} />
        )}
        {list.data && list.data.total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
      </Card>

      <TerminateSessionDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}

function LiveIndicator() {
  const { state } = useRealtime();
  const meta = {
    live: { dot: "bg-success", ping: "bg-success/50", label: "Live" },
    connecting: { dot: "bg-warning", ping: "bg-warning/50", label: "Connecting" },
    offline: { dot: "bg-subtle", ping: "", label: "Offline" },
  }[state];
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface/60 px-3 text-xs text-muted"
      title={state === "live" ? "Receiving real-time session events" : state === "connecting" ? "Connecting to the event stream" : "Real-time updates unavailable; data refreshes on navigation"}>
      <span className={cn("relative h-2 w-2 rounded-full", meta.dot)}>{meta.ping && <span className={cn("absolute inset-0 animate-ping rounded-full", meta.ping)} />}</span>
      {meta.label}
    </span>
  );
}
