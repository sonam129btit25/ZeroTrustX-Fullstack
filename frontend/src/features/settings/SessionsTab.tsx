import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Globe, Laptop, LogIn, LogOut, MapPin, Monitor, ShieldAlert, ShieldCheck, Smartphone, XCircle } from "lucide-react";
import { Badge, DemoTag, StatusBadge, TrustBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, Pagination, Skeleton } from "@/components/ui/Data";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import type { Device, LoginEvent, Page, SessionRow } from "@/types/api";
import { cn, fmtDate, timeAgo, titleCase } from "@/utils/format";
import { Notice, Section } from "./shared";

/** Lightweight, best-effort user agent summary ("Chrome on macOS"). */
export function describeUA(ua?: string | null): string {
  if (!ua) return "Unknown client";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /HeadlessChrome/.test(ua) ? "Headless Chrome" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari"
    : /curl|python|httpx|axios|node/i.test(ua) ? "API client" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : null;
  return os ? `${browser} on ${os}` : browser;
}

function deviceIcon(ua?: string | null, type?: string) {
  if (type === "mobile" || /iPhone|Android/.test(ua ?? "")) return Smartphone;
  if (type === "desktop" || /Windows|Macintosh|Linux/.test(ua ?? "")) return Monitor;
  return Laptop;
}

function SessionsCard() {
  const { logout } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [target, setTarget] = useState<SessionRow | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const q = useQuery({ queryKey: ["sessions", "mine"], queryFn: async () => (await api.get<SessionRow[]>("/sessions/mine")).data });

  const terminate = useMutation({
    mutationFn: async (id: string) => (await api.post<SessionRow>(`/sessions/${id}/terminate`, { reason: "terminated_by_user" })).data,
    onSuccess: () => {
      toast.success("Session terminated", "That device will need to sign in again.");
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (e) => toast.error("Could not terminate session", apiError(e).message),
  });

  const rows = q.data ?? [];
  const active = rows.filter((r) => r.status === "active");
  const others = active.filter((r) => !r.is_current);
  const ordered = [...rows].sort((a, b) => Number(b.is_current) - Number(a.is_current) || Number(b.status === "active") - Number(a.status === "active"));

  return (
    <Section
      title="Your sessions"
      description={q.data ? `${active.length} active · last ${rows.length} sessions shown` : "Where your account is signed in."}
      bodyClassName="p-0"
      actions={<Button size="sm" variant="ghost" className="text-danger hover:text-danger" icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => setAllOpen(true)}>Sign out of all devices</Button>}
    >
      {q.isLoading && <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}
      {q.isError && <div className="p-5"><Notice tone="danger">{apiError(q.error).message}</Notice></div>}
      {q.data && rows.length === 0 && <EmptyState title="No sessions" description="Sessions appear here when you sign in." />}
      {q.data && rows.length > 0 && (
        <ul className="divide-y divide-line/60">
          {ordered.map((s) => {
            const Icon = deviceIcon(s.user_agent);
            const live = s.status === "active";
            return (
              <li key={s.id} className={cn("flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center", !live && "opacity-70")}>
                <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border", s.is_current ? "border-accent/40 bg-accent/10 text-accent" : "border-line bg-elevated text-muted")}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium">{s.device?.name ?? describeUA(s.user_agent)}</span>
                    {s.is_current && <Badge tone="accent">This device</Badge>}
                    <StatusBadge status={s.status} />
                    {s.mfa_verified ? <Badge tone="lavender"><ShieldCheck className="h-3 w-3" />MFA</Badge> : <Badge><ShieldAlert className="h-3 w-3" />Password only</Badge>}
                    {s.is_demo && <DemoTag />}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-muted">
                    <span className="font-mono">{s.ip_address ?? "—"}</span>
                    {s.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{s.location}</span>}
                    <span title={s.user_agent ?? ""}>{describeUA(s.user_agent)}</span>
                    <span>Signed in {fmtDate(s.created_at)}</span>
                    <span>{live ? `Active ${timeAgo(s.last_activity_at)}` : s.revoked_at ? `Ended ${timeAgo(s.revoked_at)}${s.revoked_reason ? ` · ${titleCase(s.revoked_reason)}` : ""}` : `Expired ${timeAgo(s.expires_at)}`}</span>
                  </div>
                </div>
                {live && !s.is_current && (
                  <Button size="xs" variant="outline" className="self-start sm:self-center" onClick={() => setTarget(s)}>Terminate</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog open={!!target} onClose={() => setTarget(null)} onConfirm={() => target && terminate.mutate(target.id)} loading={terminate.isPending}
        title="Terminate this session?" confirmLabel="Terminate session"
        description={target ? <>The session from <span className="font-mono text-fg">{target.ip_address ?? "unknown IP"}</span> ({describeUA(target.user_agent)}) will be revoked immediately.</> : undefined} />
      <ConfirmDialog open={allOpen} onClose={() => setAllOpen(false)} loading={signingOut} confirmLabel="Sign out everywhere"
        title="Sign out of all devices?"
        description={`This revokes every session on your account${others.length ? `, including ${others.length} other active session${others.length === 1 ? "" : "s"}` : ""} — and signs you out here too.`}
        onConfirm={async () => { setSigningOut(true); await logout(true); }} />
    </Section>
  );
}

function DevicesCard() {
  const q = useQuery({ queryKey: ["devices", "mine"], queryFn: async () => (await api.get<Device[]>("/devices/mine")).data });
  return (
    <Section title="Your devices" bodyClassName="p-0"
      description="Browsers and machines that have signed in to your account. Identity is a per-browser identifier, not an endpoint agent.">
      {q.isLoading && <div className="space-y-3 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
      {q.isError && <div className="p-5"><Notice tone="danger">{apiError(q.error).message}</Notice></div>}
      {q.data && q.data.length === 0 && <EmptyState icon={<Laptop className="h-5 w-5" />} title="No devices yet" description="A device is recorded the first time you sign in from a browser." />}
      {q.data && q.data.length > 0 && (
        <ul className="divide-y divide-line/60">
          {q.data.map((d) => {
            const Icon = deviceIcon(null, d.device_type);
            return (
              <li key={d.id} className="flex items-start gap-3 px-5 py-3.5">
                <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border", d.is_current ? "border-accent/40 bg-accent/10 text-accent" : "border-line bg-elevated text-muted")}><Icon className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium">{d.name}</span>
                    {d.is_current && <Badge tone="accent">Current</Badge>}
                    <TrustBadge status={d.trust_status} />
                    {d.is_demo && <DemoTag />}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted">
                    <span>{[d.browser, d.os && `${d.os}${d.os_version ? ` ${d.os_version}` : ""}`].filter(Boolean).join(" · ") || titleCase(d.device_type)}</span>
                    {d.ip_address && <span className="font-mono">{d.ip_address}</span>}
                    <span>Last seen {timeAgo(d.last_seen_at)}</span>
                    <span>Registered via {titleCase(d.registered_via)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-line/60 px-5 py-3 text-2xs text-subtle">
        Device trust is granted by security administrators after verification. Untrusted or pending devices may be restricted from sensitive resources.
      </p>
    </Section>
  );
}

const EVENT_META: Record<string, { label: string; icon: typeof LogIn; tone: string }> = {
  login_success: { label: "Signed in", icon: CheckCircle2, tone: "text-success border-success/30 bg-success/10" },
  login_failure: { label: "Failed sign-in", icon: XCircle, tone: "text-danger border-danger/30 bg-danger/10" },
  mfa_challenge: { label: "MFA challenge issued", icon: ShieldCheck, tone: "text-lavender border-lavender/30 bg-lavender/10" },
  mfa_failure: { label: "MFA verification failed", icon: ShieldAlert, tone: "text-danger border-danger/30 bg-danger/10" },
  logout: { label: "Signed out", icon: LogOut, tone: "text-muted border-line bg-elevated" },
};

function LoginHistoryCard() {
  const [page, setPage] = useState(1);
  const size = 10;
  const q = useQuery({
    queryKey: ["login-history", page],
    queryFn: async () => (await api.get<Page<LoginEvent>>("/auth/me/login-history", { params: { page, page_size: size } })).data,
    placeholderData: keepPreviousData,
  });
  return (
    <Section title="Sign-in history" description="Authentication events for your account, newest first. Report anything you don't recognise to your security team." bodyClassName="p-0">
      {q.isLoading && <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
      {q.isError && <div className="p-5"><Notice tone="danger">{apiError(q.error).message}</Notice></div>}
      {q.data && q.data.items.length === 0 && <EmptyState icon={<Globe className="h-5 w-5" />} title="No sign-in events" />}
      {q.data && q.data.items.length > 0 && (
        <>
          <ol className={cn("px-5 py-4 transition-opacity", q.isPlaceholderData && "opacity-60")}>
            {q.data.items.map((e, i) => {
              const m = EVENT_META[e.event_type] ?? { label: titleCase(e.event_type), icon: LogIn, tone: "text-muted border-line bg-elevated" };
              const reason = typeof e.details?.reason === "string" ? e.details.reason : null;
              const method = typeof e.details?.method === "string" ? e.details.method : null;
              return (
                <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {i < q.data.items.length - 1 && <span className="absolute left-[13px] top-8 h-[calc(100%-2rem)] w-px bg-line" aria-hidden />}
                  <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border", m.tone)}><m.icon className="h-3.5 w-3.5" /></span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13px] font-medium">{m.label}</span>
                      {reason && <Badge tone="danger">{titleCase(reason)}</Badge>}
                      {method && <span className="font-mono text-2xs text-subtle">{method}</span>}
                      {e.is_demo && <DemoTag />}
                      <span className="ml-auto text-2xs text-subtle" title={fmtDate(e.created_at, { dateStyle: "medium", timeStyle: "medium" })}>{timeAgo(e.created_at)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted">
                      <span className="font-mono">{e.ip_address ?? "—"}</span>
                      {e.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{e.location}</span>}
                      <span title={e.user_agent ?? ""}>{describeUA(e.user_agent)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="border-t border-line/70"><Pagination page={page} pageSize={size} total={q.data.total} onPage={setPage} /></div>
        </>
      )}
    </Section>
  );
}

export function SessionsTab() {
  return (
    <div className="space-y-4">
      <SessionsCard />
      <DevicesCard />
      <LoginHistoryCard />
    </div>
  );
}
