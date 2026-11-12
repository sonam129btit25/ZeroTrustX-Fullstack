import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Bot, CheckCheck, LogOut, Menu, Monitor, Moon, MousePointer2, Search, Settings, ShieldCheck, Sun, UserRound } from "lucide-react";
import { api } from "@/services/api";
import type { Notification, Page } from "@/types/api";
import { useAuth } from "@/context/AuthContext";
import { usePreferences, type ThemePref } from "@/context/PreferencesContext";
import { useRealtime } from "@/context/RealtimeContext";
import { Avatar } from "@/components/ui/Page";
import { SeverityBadge } from "@/components/ui/Badge";
import { cn, timeAgo } from "@/utils/format";

function Popover({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("mousedown", h), 0);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div ref={ref} initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.16 }} className={cn("card-elevated absolute right-0 top-11 z-50 origin-top-right", className)}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["notifications", "menu"],
    queryFn: async () => (await api.get<Page<Notification> & { unread: number }>("/notifications", { params: { page_size: 8 } })).data,
    refetchInterval: 120_000,
  });
  const readAll = useMutation({ mutationFn: () => api.post("/notifications/read-all"), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const readOne = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label={`Notifications (${unread} unread)`}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-elevated/70 hover:text-fg">
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white num">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-[min(380px,calc(100vw-1.5rem))]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-[13px] font-semibold">Notifications</p>
          <button onClick={() => readAll.mutate()} disabled={!unread} className="flex items-center gap-1 text-xs text-accent disabled:text-subtle">
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {q.data?.items.length === 0 && <p className="px-4 py-10 text-center text-xs text-muted">You're all caught up.</p>}
          {q.data?.items.map((n) => (
            <button key={n.id} onClick={() => { if (!n.read_at) readOne.mutate(n.id); setOpen(false); if (n.link) nav(n.link); }}
              className="flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left hover:bg-card">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[13px] font-medium text-fg">{n.title}</p>
                  {(n.severity === "critical" || n.severity === "high") && <SeverityBadge severity={n.severity} />}
                </div>
                {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p>}
                <p className="mt-1 text-2xs text-subtle">{timeAgo(n.created_at)}</p>
              </div>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

function SystemStatus() {
  const { state } = useRealtime();
  const q = useQuery({ queryKey: ["system-status"], queryFn: async () => (await api.get("/system/status")).data, refetchInterval: 60_000 });
  const ok = q.data?.status === "operational";
  const live = state === "live";
  const tone = !q.data ? "bg-subtle" : ok && live ? "bg-success" : ok ? "bg-warning" : "bg-danger";
  return (
    <div className="hidden items-center gap-2 rounded-lg border border-line bg-surface/60 px-2.5 py-1.5 text-xs text-muted md:flex"
      title={`API ${q.data?.status ?? "unknown"} · Realtime ${state}`}>
      <span className="relative flex h-2 w-2">
        {live && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", tone)} />}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", tone)} />
      </span>
      {live ? "Live" : state === "connecting" ? "Connecting" : "Offline"}
      <span className="text-subtle">·</span>
      <span>{ok ? "All systems normal" : q.data ? "Degraded" : "Checking…"}</span>
    </div>
  );
}

function ProfileMenu() {
  const { user, logout } = useAuth();
  const { theme, setTheme, cursor, setCursor } = usePreferences();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const themes: { v: ThemePref; icon: typeof Sun; label: string }[] = [
    { v: "dark", icon: Moon, label: "Dark" }, { v: "light", icon: Sun, label: "Light" }, { v: "system", icon: Monitor, label: "System" },
  ];
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-elevated/70" aria-label="Account menu">
        <Avatar name={user.full_name} size={28} />
        <span className="hidden text-left xl:block">
          <span className="block max-w-[140px] truncate text-xs font-medium text-fg">{user.full_name}</span>
          <span className="block text-2xs text-subtle">{user.roles[0]?.display_name}</span>
        </span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-72 p-1.5">
        <div className="px-3 py-2.5">
          <p className="truncate text-[13px] font-medium">{user.full_name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
          <div className="mt-2 flex items-center gap-1.5 text-2xs">
            <ShieldCheck className={cn("h-3.5 w-3.5", user.session.mfa_verified ? "text-success" : "text-warning")} />
            <span className="text-muted">{user.session.mfa_verified ? "MFA-verified session" : "Session not MFA-verified"}</span>
          </div>
        </div>
        <div className="hairline my-1" />
        <Link to="/settings?tab=profile" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-muted hover:bg-card hover:text-fg"><UserRound className="h-4 w-4" /> Profile</Link>
        <Link to="/settings?tab=security" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-muted hover:bg-card hover:text-fg"><Settings className="h-4 w-4" /> Security settings</Link>
        <div className="hairline my-1" />
        <p className="label px-3 pb-1 pt-2">Theme</p>
        <div className="mx-2 mb-1 grid grid-cols-3 gap-1 rounded-lg border border-line bg-surface p-1">
          {themes.map((t) => (
            <button key={t.v} onClick={() => setTheme(t.v)} className={cn("flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs", theme === t.v ? "bg-elevated text-fg" : "text-muted hover:text-fg")}>
              <t.icon className="h-3.5 w-3.5" />{t.label}
            </button>
          ))}
        </div>
        <button onClick={() => setCursor(!cursor)} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-muted hover:bg-card hover:text-fg">
          <MousePointer2 className="h-4 w-4" /> Fluid cursor <span className="ml-auto text-2xs text-subtle">{cursor ? "On" : "Off"}</span>
        </button>
        <div className="hairline my-1" />
        <button onClick={() => void logout()} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-muted hover:bg-card hover:text-fg"><LogOut className="h-4 w-4" /> Sign out</button>
        <button onClick={() => void logout(true)} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-danger/90 hover:bg-danger/10"><LogOut className="h-4 w-4" /> Sign out of all devices</button>
      </Popover>
    </div>
  );
}

export function Topbar({ onSearch, onMenu, onAssistant }: { onSearch: () => void; onMenu: () => void; onAssistant: () => void }) {
  const { can } = useAuth();
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-line/80 bg-base/80 px-3 backdrop-blur-xl sm:px-5">
      <button onClick={onMenu} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-elevated lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
      <button onClick={onSearch} className="group flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-line bg-surface/60 px-3 text-left text-[13px] text-subtle transition-colors hover:border-line-strong sm:max-w-md"
        aria-label="Open global search">
        <Search className="h-4 w-4 shrink-0" />
        <span className="truncate">Search or jump to…</span>
        <kbd className="ml-auto hidden rounded border border-line px-1.5 py-0.5 font-mono text-2xs sm:block">Ctrl K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1.5">
        <SystemStatus />
        {can("assistant:use") && (
          <button onClick={onAssistant} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-elevated/70 hover:text-lavender" aria-label="Open Security Assistant">
            <Bot className="h-4 w-4" />
          </button>
        )}
        <Notifications />
        <ProfileMenu />
      </div>
    </header>
  );
}
