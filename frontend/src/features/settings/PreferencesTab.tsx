import { useState } from "react";
import { Link } from "react-router-dom";
import { LayoutDashboard, Monitor, Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/Form";
import { usePreferences, type ThemePref } from "@/context/PreferencesContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import { cn } from "@/utils/format";
import { Section } from "./shared";

const THEMES: { value: ThemePref; label: string; icon: typeof Sun; hint: string }[] = [
  { value: "dark", label: "Dark", icon: Moon, hint: "Graphite & navy" },
  { value: "light", label: "Light", icon: Sun, hint: "High clarity" },
  { value: "system", label: "System", icon: Monitor, hint: "Follow your OS" },
];

const NOTIFY: { key: "notify_new_device" | "notify_access_decisions"; label: string; description: string }[] = [
  { key: "notify_new_device", label: "New device sign-ins", description: "Notify me when my account signs in from a device it hasn't seen before." },
  { key: "notify_access_decisions", label: "Access request decisions", description: "Notify me when an access request I submitted is approved, rejected or revoked." },
];

export function PreferencesTab() {
  const { theme, setTheme, cursor, setCursor } = usePreferences();
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const prefs = (user?.preferences ?? {}) as Record<string, unknown>;

  const setNotify = async (key: string, value: boolean) => {
    setPending(key);
    try {
      await api.patch("/auth/me", { preferences: { [key]: value } });
      await refreshUser();
      toast.success("Notification preference saved");
    } catch (e) {
      toast.error("Could not save preference", apiError(e).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      <Section title="Appearance" description="Stored in this browser only.">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
          {THEMES.map((t) => {
            const on = theme === t.value;
            return (
              <button key={t.value} type="button" role="radio" aria-checked={on} onClick={() => setTheme(t.value)} data-cursor="hover"
                className={cn("flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                  on ? "border-accent/60 bg-accent/[0.07]" : "border-line bg-surface/50 hover:border-line-strong")}>
                <span className={cn("grid h-8 w-8 place-items-center rounded-lg border", on ? "border-accent/40 text-accent" : "border-line text-muted")}><t.icon className="h-4 w-4" /></span>
                <span>
                  <span className="block text-[13px] font-medium">{t.label}</span>
                  <span className="block text-2xs text-muted">{t.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-5 border-t border-line/60 pt-4">
          <Switch checked={cursor} onChange={setCursor} label="Fluid cursor"
            description="A soft trailing pointer on desktop. Automatically disabled for touch devices and when reduced motion is requested." />
        </div>
      </Section>

      <Section title="Notifications" description="Personal in-app notifications. Saved to your account and applied on every device.">
        <div className="space-y-4">
          {NOTIFY.map((n) => (
            <Switch key={n.key} label={n.label} description={n.description}
              checked={prefs[n.key] !== false} disabled={pending === n.key}
              onChange={(v) => void setNotify(n.key, v)} />
          ))}
        </div>
        <p className="mt-4 border-t border-line/60 pt-3 text-2xs text-subtle">
          Security-critical notices (for example, account lockouts or administrator actions on your account) are always delivered.
        </p>
      </Section>

      <Section title="Dashboard" description="Choose which widgets appear on your overview.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <LayoutDashboard className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p className="text-xs leading-relaxed text-muted">Dashboard widgets are shown or hidden directly on the Overview page. Your layout is remembered in this browser.</p>
          </div>
          <Link to="/" className="shrink-0 text-xs font-medium text-accent hover:underline">Go to Overview →</Link>
        </div>
      </Section>
    </div>
  );
}
