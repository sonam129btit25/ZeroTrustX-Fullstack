import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemePref = "dark" | "light" | "system";
interface Prefs {
  theme: ThemePref; setTheme: (t: ThemePref) => void;
  cursor: boolean; setCursor: (v: boolean) => void;
  sidebarCollapsed: boolean; setSidebarCollapsed: (v: boolean) => void;
  dashboardWidgets: Record<string, boolean>; setWidget: (k: string, v: boolean) => void;
}
const Ctx = createContext<Prefs | null>(null);

function read<T>(k: string, d: T): T {
  try { const v = localStorage.getItem(k); return v === null ? d : (JSON.parse(v) as T); } catch { return d; }
}
function write(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePref>(() => {
    try { return (localStorage.getItem("ztx-theme") as ThemePref) || "dark"; } catch { return "dark"; }
  });
  const [cursor, setCursorState] = useState<boolean>(() => read("ztx-cursor", true));
  const [sidebarCollapsed, setCollapsed] = useState<boolean>(() => read("ztx-sidebar", false));
  const [dashboardWidgets, setWidgets] = useState<Record<string, boolean>>(() => read("ztx-widgets", {}));

  useEffect(() => {
    const apply = () => {
      const resolved = theme === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme;
      document.documentElement.setAttribute("data-theme", resolved);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#F4F6FB" : "#0B1020");
    };
    apply();
    const mq = matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, [theme]);

  const setTheme = useCallback((t: ThemePref) => { setThemeState(t); try { localStorage.setItem("ztx-theme", t); } catch { /* */ } }, []);
  const setCursor = useCallback((v: boolean) => { setCursorState(v); write("ztx-cursor", v); }, []);
  const setSidebarCollapsed = useCallback((v: boolean) => { setCollapsed(v); write("ztx-sidebar", v); }, []);
  const setWidget = useCallback((k: string, v: boolean) => setWidgets((w) => { const n = { ...w, [k]: v }; write("ztx-widgets", n); return n; }), []);

  return (
    <Ctx.Provider value={{ theme, setTheme, cursor, setCursor, sidebarCollapsed, setSidebarCollapsed, dashboardWidgets, setWidget }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePreferences() {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePreferences outside provider");
  return c;
}
