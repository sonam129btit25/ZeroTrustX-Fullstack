import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ShieldAlert, X } from "lucide-react";
import { Sidebar, SidebarNav } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { AssistantPanel } from "@/components/layout/AssistantPanel";
import { Logo } from "@/components/brand/Logo";
import { Modal } from "@/components/ui/Overlay";
import { NAV } from "@/components/layout/nav";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

export function AppLayout() {
  const [palette, setPalette] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [help, setHelp] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const { user, can } = useAuth();
  const { sidebarCollapsed, setSidebarCollapsed } = usePreferences();
  const chord = useRef<string | null>(null);

  useEffect(() => { setMobile(false); }, [loc.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") { setHelp(true); return; }
      if (e.key === "/") { e.preventDefault(); setPalette(true); return; }
      if (e.key === "[") { setSidebarCollapsed(!sidebarCollapsed); return; }
      if (chord.current === "g") {
        const item = NAV.find((n) => n.shortcut === `g ${e.key}` && (!n.perm || can(n.perm)));
        chord.current = null;
        if (item) nav(item.to);
        return;
      }
      if (e.key === "g") { chord.current = "g"; setTimeout(() => { chord.current = null; }, 900); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [can, nav, setSidebarCollapsed, sidebarCollapsed]);

  const openAssistant = useCallback(() => setAssistant(true), []);
  const closePalette = useCallback(() => setPalette(false), []);

  return (
    <div className="flex min-h-screen bg-base">
      <Sidebar />
      <AnimatePresence>
        {mobile && (
          <div className="fixed inset-0 z-[60] lg:hidden">
            <motion.div className="absolute inset-0 bg-black/50" onClick={() => setMobile(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.aside initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", stiffness: 360, damping: 36 }}
              className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-line bg-surface">
              <div className="flex h-14 items-center justify-between border-b border-line px-4">
                <Logo />
                <button aria-label="Close navigation" onClick={() => setMobile(false)} className="rounded-md p-1 text-subtle hover:text-fg"><X className="h-4 w-4" /></button>
              </div>
              <SidebarNav collapsed={false} onNavigate={() => setMobile(false)} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onSearch={() => setPalette(true)} onMenu={() => setMobile(true)} onAssistant={openAssistant} />
        {user?.mfa_required_by_policy && (
          <div className="flex items-center gap-3 border-b border-warning/20 bg-warning/[0.07] px-5 py-2 text-xs text-warning">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span className="flex-1">Your role requires multi-factor authentication. Sensitive resources will require step-up verification until you enrol.</span>
            <Link to="/settings?tab=security" className="font-medium underline-offset-2 hover:underline">Enable MFA</Link>
          </div>
        )}
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}>
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
        <footer className="border-t border-line/60 px-6 py-3 text-2xs text-subtle">
          ZeroTrustX · Never Trust. Always Verify. · Press <kbd className="font-mono">?</kbd> for shortcuts
        </footer>
      </div>

      <CommandPalette open={palette} onClose={closePalette} onOpenAssistant={openAssistant} />
      <AssistantPanel open={assistant} onClose={() => setAssistant(false)} />
      <Modal open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts" size="sm">
        <ul className="space-y-2 text-[13px]">
          {[["Ctrl / ⌘ + K", "Command palette & global search"], ["/", "Open search"], ["?", "Show this help"], ["[", "Collapse / expand sidebar"],
            ...NAV.filter((n) => n.shortcut && (!n.perm || can(n.perm))).map((n) => [n.shortcut!, `Go to ${n.label}`])].map(([k, d]) => (
            <li key={k} className="flex items-center justify-between gap-4">
              <span className="text-muted">{d}</span><kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-2xs">{k}</kbd>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
