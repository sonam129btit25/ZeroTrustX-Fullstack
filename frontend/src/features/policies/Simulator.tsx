import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { FlaskConical, Laptop, Moon, Play, RotateCcw, Search, ShieldAlert, UserRound, UserX, X } from "lucide-react";
import { api, apiError } from "@/services/api";
import type { Page, Resource, UserSummary } from "@/types/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Switch } from "@/components/ui/Form";
import { Card, CardHeader, Avatar } from "@/components/ui/Page";
import { EmptyState, Skeleton } from "@/components/ui/Data";
import { cn } from "@/utils/format";
import { simulate } from "./api";
import { ROLE_OPTIONS, TRUST_OPTIONS, WEEKDAYS, type PolicyPayload, type SimulateBody, type SimulationResult } from "./types";
import { SimulationResultView } from "./SimulationResultView";
import { ChipInput, Slider, riskTone } from "./ui";

export type Tri = "auto" | "yes" | "no";
export interface SimForm {
  resourceId: string; user: { id: string; name: string; email: string } | null; roles: string[];
  userStatus: string; riskOverride: boolean; risk: number; department: string; mfaEnabled: Tri; mfaVerified: boolean;
  sessionValid: boolean; trust: string; deviceRisk: number; ip: string; hour: string; weekday: string; entitlement: Tri;
}

export const defaultSimForm = (resourceId = ""): SimForm => ({
  resourceId, user: null, roles: ["employee"], userStatus: "", riskOverride: true, risk: 10, department: "", mfaEnabled: "auto",
  mfaVerified: false, sessionValid: true, trust: "trusted", deviceRisk: 0, ip: "10.0.0.10", hour: "", weekday: "", entitlement: "yes",
});

const tri = (t: Tri) => (t === "auto" ? null : t === "yes");

export function toSimulateBody(f: SimForm, draft?: PolicyPayload | null): SimulateBody {
  return {
    resource_id: f.resourceId,
    user_id: f.user?.id ?? null,
    roles: f.user && f.roles.length === 0 ? null : f.roles,
    user_status: f.userStatus || null,
    risk_score: !f.user || f.riskOverride ? f.risk : null,
    department: f.department.trim() || null,
    mfa_enabled: tri(f.mfaEnabled),
    mfa_verified: f.mfaVerified,
    session_valid: f.sessionValid,
    device_trust_status: f.trust,
    device_risk_score: f.deviceRisk,
    ip_address: f.ip.trim() || "10.0.0.10",
    hour: f.hour === "" ? null : Number(f.hour),
    weekday: f.weekday === "" ? null : Number(f.weekday),
    has_entitlement: tri(f.entitlement),
    draft_policy: draft ?? null,
  };
}

interface Preset { id: string; title: string; hint: string; icon: typeof Laptop; slug: string; apply: (f: SimForm) => Partial<SimForm> }
const PRESETS: Preset[] = [
  { id: "laptop", title: "Employee on untrusted laptop", hint: "→ Financial Records", icon: Laptop, slug: "financial-records",
    apply: () => ({ user: null, roles: ["employee"], risk: 20, riskOverride: true, trust: "untrusted", deviceRisk: 35, mfaVerified: false, entitlement: "yes", hour: "10", weekday: "1", ip: "203.0.113.24" }) },
  { id: "night", title: "Analyst at 02:00 on restricted data", hint: "→ Employee Database", icon: Moon, slug: "employee-database",
    apply: () => ({ user: null, roles: ["analyst"], risk: 15, riskOverride: true, trust: "trusted", deviceRisk: 5, mfaVerified: true, entitlement: "yes", hour: "2", weekday: "2", ip: "10.20.4.18" }) },
  { id: "suspicious", title: "Suspicious device", hint: "→ Research Documents", icon: ShieldAlert, slug: "research-documents",
    apply: () => ({ user: null, roles: ["employee"], risk: 30, riskOverride: true, trust: "suspicious", deviceRisk: 70, mfaVerified: true, entitlement: "yes", hour: "", weekday: "", ip: "198.51.100.7" }) },
  { id: "risky", title: "Risky user without MFA", hint: "→ Analytics Dashboard", icon: UserX, slug: "internal-analytics-dashboard",
    apply: () => ({ user: null, roles: ["employee"], risk: 65, riskOverride: true, trust: "trusted", deviceRisk: 10, mfaVerified: false, entitlement: "yes", hour: "", weekday: "", ip: "10.0.0.10" }) },
];

function UserPicker({ value, onChange }: { value: SimForm["user"]; onChange: (u: SimForm["user"]) => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const users = useQuery({
    queryKey: ["users", "picker", debounced], enabled: open,
    queryFn: async () => (await api.get<Page<UserSummary>>("/users", { params: { q: debounced || undefined, page_size: 8 } })).data.items,
  });
  if (value) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface/70 px-2.5 py-2">
        <Avatar name={value.name} size={24} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-fg">{value.name}</p>
          <p className="truncate text-2xs text-muted">{value.email}</p>
        </div>
        <button type="button" aria-label="Clear user" onClick={() => onChange(null)} className="rounded p-1 text-subtle hover:bg-elevated hover:text-fg"><X className="h-3.5 w-3.5" /></button>
      </div>
    );
  }
  return (
    <div ref={box} className="relative">
      <Input leading={<Search className="h-3.5 w-3.5" />} placeholder="Search a real user (optional)" value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} aria-label="Search users" />
      {open && (
        <div className="card-elevated absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto p-1">
          {users.isLoading && <div className="space-y-1 p-1">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}</div>}
          {users.isError && <p className="p-2 text-xs text-danger">{apiError(users.error).message}</p>}
          {users.data?.length === 0 && <p className="p-2 text-xs text-muted">No users match “{debounced}”.</p>}
          {users.data?.map((u) => (
            <button key={u.id} type="button" data-cursor="hover"
              onClick={() => { onChange({ id: u.id, name: u.full_name, email: u.email }); setOpen(false); setQ(""); }}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-card">
              <Avatar name={u.full_name} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-fg">{u.full_name}</span>
                <span className="block truncate text-2xs text-muted">{u.email} · {u.roles.map((r) => r.name).join(", ")}</span>
              </span>
              <span className={cn("num font-mono text-2xs", riskTone(u.risk_score))}>{u.risk_score}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Context fields shared by the full simulator and the editor's quick test. */
export function SimContextFields({ form, set, resources, compact }: {
  form: SimForm; set: (p: Partial<SimForm>) => void; resources: Resource[]; compact?: boolean;
}) {
  const { can } = useAuth();
  const selectedRes = resources.find((r) => r.id === form.resourceId);
  return (
    <div className="space-y-4">
      <Field label="Resource" required>
        <Select value={form.resourceId} onChange={(e) => set({ resourceId: e.target.value })} aria-label="Resource">
          {resources.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.sensitivity}</option>)}
        </Select>
      </Field>
      {selectedRes && !compact && (
        <p className="-mt-2 text-2xs text-subtle">
          Requires <span className="font-mono text-muted">{selectedRes.required_permission ?? "no permission (public)"}</span>
          {selectedRes.allowed_ip_ranges.length > 0 && <> · networks <span className="font-mono text-muted">{selectedRes.allowed_ip_ranges.join(", ")}</span></>}
          {selectedRes.access_hours_start !== null && <> · window {selectedRes.access_hours_start}:00–{selectedRes.access_hours_end}:00</>}
        </p>
      )}

      {!compact && can("users:read") && (
        <Field label="Subject" hint={form.user ? "Profile attributes are used unless overridden below." : "Leave empty to simulate a synthetic identity."}>
          <UserPicker value={form.user} onChange={(u) => set({ user: u, roles: u ? [] : ["employee"], riskOverride: !u, userStatus: "", mfaEnabled: "auto" })} />
        </Field>
      )}

      <Field label="Roles" hint={form.user && form.roles.length === 0 ? "Using the selected user's roles." : undefined}>
        <ChipInput value={form.roles} options={ROLE_OPTIONS} onChange={(v) => set({ roles: v as string[] })} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Device trust">
          <Select value={form.trust} onChange={(e) => set({ trust: e.target.value })} aria-label="Device trust">
            {TRUST_OPTIONS.map((t) => <option key={t} value={t}>{t === "unknown" ? "unknown (no device)" : t.replace("_", " ")}</option>)}
          </Select>
        </Field>
        <Field label="Entitlement">
          <Select value={form.entitlement} onChange={(e) => set({ entitlement: e.target.value as Tri })} aria-label="Entitlement">
            <option value="auto">Auto (from user)</option>
            <option value="yes">Entitled</option>
            <option value="no">Not entitled</option>
          </Select>
        </Field>
      </div>

      {form.user && (
        <Switch checked={form.riskOverride} onChange={(v) => set({ riskOverride: v })} label="Override user risk score" description="Otherwise the user's live risk score is used." />
      )}
      <Slider label="User risk score" value={form.risk} onChange={(v) => set({ risk: v })} disabled={!!form.user && !form.riskOverride} tone={riskTone(form.risk)} />
      {!compact && <Slider label="Device risk score" value={form.deviceRisk} onChange={(v) => set({ deviceRisk: v })} disabled={form.trust === "unknown"} tone={riskTone(form.deviceRisk)} />}

      <div className="space-y-3 rounded-lg border border-line bg-surface/40 p-3">
        <Switch checked={form.mfaVerified} onChange={(v) => set({ mfaVerified: v })} label="Session MFA verified" />
        {!compact && <Switch checked={form.sessionValid} onChange={(v) => set({ sessionValid: v })} label="Session valid" />}
      </div>

      {!compact && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="User status">
              <Select value={form.userStatus} onChange={(e) => set({ userStatus: e.target.value })} aria-label="User status">
                <option value="">{form.user ? "From profile" : "active"}</option>
                {["active", "suspended", "deactivated", "locked"].map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="MFA enrolled">
              <Select value={form.mfaEnabled} onChange={(e) => set({ mfaEnabled: e.target.value as Tri })} aria-label="MFA enrolled">
                <option value="auto">{form.user ? "From profile" : "Auto (no)"}</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </Field>
          </div>
          <Field label="Department">
            <Input value={form.department} onChange={(e) => set({ department: e.target.value })} placeholder={form.user ? "From profile" : "e.g. Finance"} />
          </Field>
          <Field label="Source IP address">
            <Input value={form.ip} onChange={(e) => set({ ip: e.target.value })} className="font-mono" placeholder="10.0.0.10" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hour">
              <Select value={form.hour} onChange={(e) => set({ hour: e.target.value })} aria-label="Hour">
                <option value="">Current time</option>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </Select>
            </Field>
            <Field label="Weekday">
              <Select value={form.weekday} onChange={(e) => set({ weekday: e.target.value })} aria-label="Weekday">
                <option value="">Today</option>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </Select>
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

export function Simulator({ resources, resourcesLoading }: { resources: Resource[]; resourcesLoading: boolean }) {
  const toast = useToast();
  const [form, setForm] = useState<SimForm>(() => defaultSimForm());
  const [preset, setPreset] = useState<string | null>(null);
  const set = (p: Partial<SimForm>) => { setForm((f) => ({ ...f, ...p })); setPreset(null); };
  useEffect(() => {
    if (!form.resourceId && resources.length) setForm((f) => ({ ...f, resourceId: resources[0].id }));
  }, [resources, form.resourceId]);

  const run = useMutation({
    mutationFn: (f: SimForm) => simulate(toSimulateBody(f)),
    onError: (e) => toast.error("Simulation failed", apiError(e).message),
  });
  const [last, setLast] = useState<SimulationResult | null>(null);
  useEffect(() => { if (run.data) setLast(run.data); }, [run.data]);

  const applyPreset = (p: Preset) => {
    const res = resources.find((r) => r.slug === p.slug) ?? resources[0];
    const next = { ...defaultSimForm(res?.id ?? ""), ...p.apply(form) };
    setForm(next);
    setPreset(p.id);
    if (res) run.mutate(next);
  };

  if (resourcesLoading) return <div className="grid gap-4 lg:grid-cols-[380px_1fr]"><Skeleton className="h-[620px]" /><Skeleton className="h-[420px]" /></div>;
  if (!resources.length) return <Card><EmptyState title="No resources to simulate against" description="Add a protected resource first, then return to the simulator." /></Card>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => applyPreset(p)} data-cursor="hover"
            className={cn("group flex items-start gap-3 rounded-xl border bg-card px-3.5 py-3 text-left transition-colors",
              preset === p.id ? "border-accent/50 bg-accent/[0.06]" : "border-line hover:border-line-strong")}>
            <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", preset === p.id ? "bg-accent/15 text-accent" : "bg-elevated text-muted group-hover:text-fg")}>
              <p.icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-fg">{p.title}</span>
              <span className="block text-2xs text-muted">{p.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
        <Card className="lg:sticky lg:top-4">
          <CardHeader title="Request context" description="Every attribute the engine evaluates. Nothing is persisted except an audit entry."
            actions={<Button size="xs" variant="ghost" icon={<RotateCcw className="h-3 w-3" />} onClick={() => { setForm(defaultSimForm(resources[0]?.id)); setPreset(null); run.reset(); setLast(null); }}>Reset</Button>} />
          <form className="p-4" onSubmit={(e) => { e.preventDefault(); run.mutate(form); }}>
            <SimContextFields form={form} set={set} resources={resources} />
            <Button type="submit" variant="primary" className="mt-5 w-full justify-center" loading={run.isPending} icon={<Play className="h-3.5 w-3.5" />} disabled={!form.resourceId}>
              Run simulation
            </Button>
          </form>
        </Card>

        <div className="min-w-0">
          <AnimatePresence mode="wait">
            {last ? (
              <motion.div key="r" initial={{ opacity: 0 }} animate={{ opacity: run.isPending ? 0.55 : 1 }} exit={{ opacity: 0 }}>
                <SimulationResultView result={last} />
              </motion.div>
            ) : (
              <motion.div key="e" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Card>
                  <EmptyState icon={<FlaskConical className="h-5 w-5" />} title="Run a what-if evaluation"
                    description="Pick a preset or describe a request on the left. The simulator runs the exact production engine against your live policies — deterministically, with no AI involved." />
                  <div className="flex items-center justify-center gap-2 pb-10 text-2xs text-subtle"><UserRound className="h-3 w-3" /> Simulations are audited as <span className="font-mono">policy.simulated</span></div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

