import { NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";
import { NAV, SECTIONS } from "@/components/layout/nav";
import { cn } from "@/utils/format";

export function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { can } = useAuth();
  const items = NAV.filter((n) => !n.perm || can(n.perm));
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main navigation">
      {SECTIONS.map((section) => {
        const list = items.filter((i) => i.section === section);
        if (!list.length) return null;
        return (
          <div key={section}>
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="label mb-1.5 px-2.5">{section}</motion.p>
              )}
            </AnimatePresence>
            <ul className="space-y-0.5">
              {list.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) => cn(
                      "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                      isActive ? "text-fg" : "text-muted hover:bg-elevated/50 hover:text-fg",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg border border-line-strong/60 bg-elevated"
                            transition={{ type: "spring", stiffness: 500, damping: 40 }}>
                            <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-x-[3px] -translate-y-1/2 rounded-r bg-gradient-to-b from-accent to-lavender" />
                          </motion.span>
                        )}
                        <item.icon className={cn("relative h-4 w-4 shrink-0 transition-colors", isActive ? "text-accent" : "text-subtle group-hover:text-muted")} />
                        {!collapsed && <span className="relative truncate">{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  const { sidebarCollapsed: collapsed, setSidebarCollapsed } = usePreferences();
  return (
    <motion.aside
      animate={{ width: collapsed ? 68 : 248 }}
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
      className="sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line/80 bg-surface/80 backdrop-blur lg:flex"
    >
      <div className={cn("flex h-14 items-center border-b border-line/80 px-4", collapsed && "justify-center px-0")}>
        <NavLink to="/" aria-label="ZeroTrustX home"><Logo collapsed={collapsed} /></NavLink>
      </div>
      <SidebarNav collapsed={collapsed} />
      <div className="border-t border-line/80 p-3">
        <button
          onClick={() => setSidebarCollapsed(!collapsed)}
          className={cn("flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-xs text-subtle hover:bg-elevated/60 hover:text-fg", collapsed && "justify-center px-0")}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse <kbd className="ml-auto font-mono text-2xs">[</kbd></>}
        </button>
      </div>
    </motion.aside>
  );
}
