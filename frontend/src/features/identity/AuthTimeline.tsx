import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, KeyRound, LogIn, LogOut, ShieldAlert, ShieldCheck, ShieldX, UserX, Activity, History } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DemoTag } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/Data";
import { api, apiError } from "@/services/api";
import type { LoginEvent, Page } from "@/types/api";
import { cn, fmtDate, timeAgo, titleCase } from "@/utils/format";

const PAGE_SIZE = 15;

type Tone = "success" | "danger" | "warning" | "lavender" | "accent" | "neutral";
const META: Record<string, { icon: typeof LogIn; tone: Tone; label: string }> = {
  login_success: { icon: LogIn, tone: "success", label: "Signed in" },
  login_failure: { icon: ShieldX, tone: "danger", label: "Failed sign-in" },
  mfa_failure: { icon: ShieldAlert, tone: "danger", label: "MFA verification failed" },
  mfa_challenge: { icon: KeyRound, tone: "lavender", label: "MFA challenge issued" },
  mfa_verified: { icon: ShieldCheck, tone: "success", label: "MFA verified" },
  mfa_enabled: { icon: ShieldCheck, tone: "accent", label: "MFA enrolled" },
  logout: { icon: LogOut, tone: "neutral", label: "Signed out" },
  logout_all: { icon: LogOut, tone: "neutral", label: "Signed out everywhere" },
  account_locked: { icon: UserX, tone: "danger", label: "Account locked" },
  password_changed: { icon: KeyRound, tone: "accent", label: "Password changed" },
};
const TONE_CLS: Record<Tone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  danger: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
  lavender: "border-lavender/30 bg-lavender/10 text-lavender",
  accent: "border-accent/30 bg-accent/10 text-accent",
  neutral: "border-line bg-elevated text-muted",
};

/** Paginated, expandable vertical timeline of a user's authentication / security events. */
export function AuthTimeline({ userId }: { userId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["users", userId, "login-history"],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => (await api.get<Page<LoginEvent>>(`/users/${userId}/login-history`, {
      params: { page: pageParam, page_size: PAGE_SIZE, sort: "created_at", order: "desc" },
    })).data,
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;

  if (q.isLoading) {
    return <div className="space-y-4 p-5">{[0, 1, 2, 3].map((i) => <div key={i} className="flex gap-3"><Skeleton className="h-8 w-8 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-3 w-1/2" /></div></div>)}</div>;
  }
  if (q.isError) return <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="Could not load history" description={apiError(q.error).message} action={<Button size="sm" onClick={() => q.refetch()}>Retry</Button>} />;
  if (!items.length) return <EmptyState icon={<History className="h-5 w-5" />} title="No authentication events" description="Sign-ins, MFA challenges and sign-outs for this identity appear here." />;

  return (
    <div className="px-3 py-4 sm:px-5">
      <ol className="relative">
        {items.map((e, i) => {
          const meta = META[e.event_type] ?? { icon: Activity, tone: (e.severity === "high" || e.severity === "critical" ? "warning" : "neutral") as Tone, label: titleCase(e.event_type) };
          const Icon = meta.icon;
          const expanded = open === e.id;
          const last = i === items.length - 1;
          const details = Object.entries(e.details ?? {}).filter(([k, v]) => k !== "demo" && v !== null && v !== "" && typeof v !== "object");
          return (
            <motion.li key={e.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min((i % PAGE_SIZE) * 0.02, 0.25) }} className="relative flex gap-3 pb-1">
              {!last && <span aria-hidden className="absolute left-[15px] top-9 bottom-0 w-px bg-line" />}
              <span className={cn("relative z-[1] grid h-8 w-8 shrink-0 place-items-center rounded-full border", TONE_CLS[meta.tone])}><Icon className="h-3.5 w-3.5" /></span>
              <div className="min-w-0 flex-1 pb-3">
                <button type="button" onClick={() => setOpen(expanded ? null : e.id)} aria-expanded={expanded} data-cursor="hover"
                  className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-1 text-left transition-colors hover:bg-elevated/50">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-fg">{meta.label}{e.is_demo && <DemoTag />}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                      {e.ip_address && <span className="font-mono text-2xs">{e.ip_address}</span>}
                      <span>{e.location ?? "Unknown location"}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-subtle" title={fmtDate(e.created_at)}>
                    {timeAgo(e.created_at)}<ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <dl className="mx-2 mt-1.5 grid gap-x-4 gap-y-2 rounded-lg border border-line/70 bg-surface/50 p-3 text-xs sm:grid-cols-2">
                        <div><dt className="label">Timestamp</dt><dd className="mt-0.5 text-fg">{fmtDate(e.created_at, { dateStyle: "medium", timeStyle: "medium" })}</dd></div>
                        <div><dt className="label">Event</dt><dd className="mt-0.5 font-mono text-fg">{e.event_type}</dd></div>
                        <div><dt className="label">Severity</dt><dd className="mt-0.5 text-fg">{titleCase(e.severity)}</dd></div>
                        {e.email && <div><dt className="label">Email attempted</dt><dd className="mt-0.5 truncate text-fg">{e.email}</dd></div>}
                        {details.map(([k, v]) => <div key={k}><dt className="label">{titleCase(k)}</dt><dd className="mt-0.5 truncate text-fg">{String(v)}</dd></div>)}
                        {e.user_agent && <div className="sm:col-span-2"><dt className="label">User agent</dt><dd className="mt-0.5 break-all font-mono text-2xs text-muted">{e.user_agent}</dd></div>}
                      </dl>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between gap-3 border-t border-line/70 pt-3 text-xs text-subtle">
        <span className="num">Showing {items.length} of {total}</span>
        {q.hasNextPage && <Button size="xs" variant="outline" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load older events</Button>}
      </div>
    </div>
  );
}
