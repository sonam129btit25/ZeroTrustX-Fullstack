import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, Laptop, Server, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { PageHeader } from "@/components/ui/Page";
import { Tabs } from "@/components/ui/Data";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/utils/format";
import { ProfileTab } from "@/features/settings/ProfileTab";
import { SecurityTab } from "@/features/settings/SecurityTab";
import { SessionsTab } from "@/features/settings/SessionsTab";
import { PreferencesTab } from "@/features/settings/PreferencesTab";
import { OrganizationTab } from "@/features/settings/OrganizationTab";
import { SystemTab } from "@/features/settings/SystemTab";

type TabKey = "profile" | "security" | "sessions" | "preferences" | "organization" | "system";

const ALL_TABS: { value: TabKey; label: string; hint: string; icon: typeof UserRound; perm?: string }[] = [
  { value: "profile", label: "Profile", hint: "Your identity details", icon: UserRound },
  { value: "security", label: "Security", hint: "Password & MFA", icon: ShieldCheck },
  { value: "sessions", label: "Sessions & devices", hint: "Where you're signed in", icon: Laptop },
  { value: "preferences", label: "Preferences", hint: "Theme & notifications", icon: SlidersHorizontal },
  { value: "organization", label: "Organization", hint: "Policies for everyone", icon: Building2, perm: "settings:read" },
  { value: "system", label: "System", hint: "Status & API", icon: Server },
];

export default function Settings() {
  const { can, user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tabs = useMemo(() => ALL_TABS.filter((t) => !t.perm || can(t.perm)), [can]);
  const requested = sp.get("tab") as TabKey | null;
  const tab: TabKey = tabs.some((t) => t.value === requested) ? requested! : "profile";

  // Normalise unknown / forbidden ?tab= values.
  useEffect(() => {
    if (requested && requested !== tab) setSp((p) => { const n = new URLSearchParams(p); n.set("tab", tab); return n; }, { replace: true });
  }, [requested, tab, setSp]);

  const go = (t: TabKey) => setSp(t === "profile" ? {} : { tab: t }, { replace: true });

  const current = tabs.find((t) => t.value === tab)!;

  return (
    <div>
      <PageHeader title="Settings" description={<>Manage your account, security and preferences{can("settings:read") ? ", and organization-wide controls" : ""}. Signed in as <span className="text-fg">{user?.email}</span>.</>} />

      <div className="lg:hidden">
        <Tabs tabs={tabs.map((t) => ({ value: t.value, label: t.label }))} value={tab} onChange={go} className="mb-4" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-20 space-y-0.5">
            {tabs.map((t) => {
              const on = t.value === tab;
              return (
                <li key={t.value}>
                  <button type="button" onClick={() => go(t.value)} aria-current={on ? "page" : undefined} data-cursor="hover"
                    className={cn("relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors", on ? "text-fg" : "text-muted hover:bg-elevated/50 hover:text-fg")}>
                    {on && <motion.span layoutId="settings-nav" className="absolute inset-0 rounded-lg border border-line-strong/70 bg-elevated" transition={{ type: "spring", stiffness: 450, damping: 36 }} />}
                    <t.icon className={cn("relative h-4 w-4 shrink-0", on ? "text-accent" : "text-subtle")} />
                    <span className="relative min-w-0">
                      <span className="block text-[13px] font-medium">{t.label}</span>
                      <span className="block truncate text-2xs text-subtle">{t.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section aria-label={current.label} className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
              {tab === "profile" && <ProfileTab />}
              {tab === "security" && <SecurityTab />}
              {tab === "sessions" && <SessionsTab />}
              {tab === "preferences" && <PreferencesTab />}
              {tab === "organization" && <OrganizationTab />}
              {tab === "system" && <SystemTab />}
            </motion.div>
          </AnimatePresence>
        </section>
      </div>
    </div>
  );
}
