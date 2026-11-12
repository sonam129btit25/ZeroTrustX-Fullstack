import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Bot, CornerDownLeft, LogOut, Moon, Search, Sun } from "lucide-react";
import { api } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";
import { NAV } from "@/components/layout/nav";
import { cn } from "@/utils/format";

interface Cmd { id: string; label: string; hint?: string; group: string; icon?: React.ReactNode; run: () => void }
type SearchResults = Record<string, { id: string; title: string; subtitle: string; link: string }[]>;

function useDebounced<T>(v: T, ms = 220) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function CommandPalette({ open, onClose, onOpenAssistant }: { open: boolean; onClose: () => void; onOpenAssistant: () => void }) {
  const nav = useNavigate();
  const { can, logout } = useAuth();
  const { theme, setTheme } = usePreferences();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q.trim());

  useEffect(() => { if (open) { setQ(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);

  const search = useQuery({
    queryKey: ["search", dq],
    queryFn: async () => (await api.get<SearchResults>("/search", { params: { q: dq } })).data,
    enabled: open && dq.length >= 2,
    staleTime: 10_000,
  });

  const commands = useMemo<Cmd[]>(() => {
    const go = (to: string) => () => { nav(to); onClose(); };
    const base: Cmd[] = NAV.filter((n) => !n.perm || can(n.perm)).map((n) => ({
      id: `nav-${n.to}`, label: n.label, hint: n.shortcut, group: "Navigate", icon: <n.icon className="h-4 w-4" />, run: go(n.to),
    }));
    const actions: Cmd[] = [
      { id: "new-request", label: "Request access to a resource", group: "Actions", icon: <ArrowRight className="h-4 w-4" />, run: go("/access-requests?new=1") },
      ...(can("policies:simulate") ? [{ id: "sim", label: "Open policy simulator", group: "Actions", icon: <ArrowRight className="h-4 w-4" />, run: go("/policies?tab=simulator") }] : []),
      ...(can("assistant:use") ? [{ id: "assistant", label: "Ask the Security Assistant", group: "Actions", icon: <Bot className="h-4 w-4" />, run: () => { onClose(); onOpenAssistant(); } }] : []),
      { id: "mfa", label: "Manage multi-factor authentication", group: "Actions", icon: <ArrowRight className="h-4 w-4" />, run: go("/settings?tab=security") },
      { id: "theme", label: theme === "light" ? "Switch to dark theme" : "Switch to light theme", group: "Preferences",
        icon: theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />, run: () => { setTheme(theme === "light" ? "dark" : "light"); onClose(); } },
      { id: "logout", label: "Sign out", group: "Account", icon: <LogOut className="h-4 w-4" />, run: () => { onClose(); void logout(); } },
    ];
    const results: Cmd[] = Object.entries(search.data ?? {}).flatMap(([group, rows]) =>
      rows.map((r) => ({ id: `${group}-${r.id}`, label: r.title, hint: r.subtitle, group: `Results · ${group}`, run: go(r.link) })));
    const ql = q.toLowerCase();
    const filtered = [...base, ...actions].filter((c) => !ql || c.label.toLowerCase().includes(ql));
    return [...results, ...filtered];
  }, [can, nav, onClose, onOpenAssistant, q, search.data, setTheme, theme, logout]);

  useEffect(() => { setIdx(0); }, [q, search.data]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, commands.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); commands[idx]?.run(); }
    if (e.key === "Escape") onClose();
  };

  let lastGroup = "";
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
          <motion.div className="absolute inset-0 bg-[rgb(5_8_18/0.55)] backdrop-blur-[3px]" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="card-elevated relative w-full max-w-xl overflow-hidden rounded-2xl">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-4 w-4 text-subtle" />
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
                placeholder="Search users, devices, policies, incidents… or type a command"
                className="h-12 flex-1 bg-transparent text-sm text-fg placeholder:text-subtle focus:outline-none focus-visible:!shadow-none" aria-label="Search" />
              <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-2xs text-subtle">esc</kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {commands.length === 0 && <p className="px-3 py-8 text-center text-xs text-muted">{search.isFetching ? "Searching…" : "No matches"}</p>}
              {commands.map((c, i) => {
                const header = c.group !== lastGroup ? c.group : null;
                lastGroup = c.group;
                return (
                  <div key={c.id}>
                    {header && <p className="label px-2.5 pb-1 pt-2.5">{header}</p>}
                    <button onMouseEnter={() => setIdx(i)} onClick={c.run}
                      className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px]", i === idx ? "bg-elevated text-fg" : "text-muted")}>
                      <span className="text-subtle">{c.icon ?? <ArrowRight className="h-4 w-4" />}</span>
                      <span className="flex-1 truncate">{c.label}</span>
                      {c.hint && <span className="font-mono text-2xs text-subtle">{c.hint}</span>}
                      {i === idx && <CornerDownLeft className="h-3.5 w-3.5 text-subtle" />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-2xs text-subtle">
              <span><kbd className="font-mono">↑↓</kbd> navigate</span><span><kbd className="font-mono">↵</kbd> select</span>
              <span className="ml-auto"><kbd className="font-mono">?</kbd> keyboard shortcuts</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
