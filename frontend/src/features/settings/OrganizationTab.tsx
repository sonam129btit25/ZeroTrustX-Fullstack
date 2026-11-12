import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Building2, Clock, Gauge, KeyRound, Lock, Bell, Scale, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select, Switch } from "@/components/ui/Form";
import { DECISION_LABEL } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import type { Decision, OrgSettings } from "@/types/api";
import { cn, fmtDate, titleCase } from "@/utils/format";
import { ErrorCard, Notice, Section, SectionSkeleton } from "./shared";

type Draft = Omit<OrgSettings, "updated_at">;

const ROLES: { value: string; label: string }[] = [
  { value: "super_admin", label: "Super admin" },
  { value: "security_admin", label: "Security admin" },
  { value: "analyst", label: "Analyst" },
  { value: "employee", label: "Employee" },
  { value: "guest", label: "Guest" },
];
const ACTIONS: Decision[] = ["DENY", "REQUIRE_MFA", "RESTRICTED_ACCESS", "ALLOW"];

const WEIGHT_LABELS: Record<string, [string, string]> = {
  failed_login: ["Failed sign-in", "Points per failed sign-in in the last 24 hours"],
  failed_login_cap: ["Failed sign-in cap", "Maximum points from failed sign-ins"],
  access_denied: ["Access denied", "Points per denied access decision in the last 24 hours"],
  access_denied_cap: ["Access denied cap", "Maximum points from denials"],
  untrusted_device: ["Untrusted device", "Last sign-in came from a non-trusted device"],
  no_mfa: ["MFA not enrolled", "User has not enabled multi-factor authentication"],
  open_alert_high: ["Open high/critical alert", "Per open high or critical threat alert"],
  open_alert_medium: ["Open medium alert", "Per open medium threat alert"],
  off_hours_login: ["Off-hours sign-in", "Sign-in outside business hours"],
  new_ip: ["New IP address", "Sign-in from an IP not seen before"],
};

const NOTIFY_LABELS: Record<string, [string, string]> = {
  notify_admins_on_high_alerts: ["High-severity alerts", "Notify security administrators when a high or critical alert is raised."],
  notify_user_on_request_decision: ["Access request decisions", "Notify requesters when their access request is decided."],
  notify_user_on_new_device: ["New device sign-ins", "Notify users when their account signs in from a new device (users can opt out)."],
  notify_admins_on_pending_requests: ["Pending access requests", "Notify approvers when a new access request is waiting."],
};

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

function strip(s: OrgSettings): Draft {
  const { updated_at: _u, ...rest } = s;
  return rest;
}

function validate(d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  const int = (k: keyof Draft, min: number, max: number, label: string) => {
    const v = d[k] as number;
    if (!Number.isInteger(v) || v < min || v > max) e[k] = `${label} must be a whole number between ${min} and ${max}`;
  };
  if (d.org_name.trim().length < 2) e.org_name = "Organization name must be at least 2 characters";
  if (d.org_name.length > 150) e.org_name = "At most 150 characters";
  if ((d.domain ?? "").length > 150) e.domain = "At most 150 characters";
  int("session_timeout_minutes", 15, 10080, "Session lifetime");
  int("idle_timeout_minutes", 5, 1440, "Idle timeout");
  if (!e.idle_timeout_minutes && !e.session_timeout_minutes && d.idle_timeout_minutes > d.session_timeout_minutes)
    e.idle_timeout_minutes = "Idle timeout cannot exceed the session lifetime";
  int("password_min_length", 8, 64, "Minimum length");
  int("max_failed_logins", 3, 20, "Failed attempts");
  int("lockout_minutes", 1, 1440, "Lockout duration");
  int("risk_block_threshold", 1, 100, "Block threshold");
  int("risk_mfa_threshold", 0, 100, "MFA threshold");
  if (!e.risk_block_threshold && !e.risk_mfa_threshold && d.risk_mfa_threshold >= d.risk_block_threshold)
    e.risk_mfa_threshold = "MFA step-up threshold must be lower than the block threshold";
  if (d.business_hours_start >= d.business_hours_end) e.business_hours_end = "Business hours must end after they start";
  for (const [k, v] of Object.entries(d.risk_weights)) {
    if (!Number.isInteger(v) || v < 0 || v > 100) e[`risk_weights.${k}`] = "0–100";
  }
  return e;
}

function NumberInput({ value, onChange, min, max, suffix, invalid, disabled, id, ariaLabel }: {
  value: number; onChange: (v: number) => void; min: number; max: number; suffix?: string; invalid?: boolean; disabled?: boolean; id?: string; ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <Input id={id} aria-label={ariaLabel} type="number" inputMode="numeric" min={min} max={max} step={1} disabled={disabled} invalid={invalid}
        value={Number.isNaN(value) ? "" : value} onChange={(e) => onChange(e.target.value === "" ? Number.NaN : e.target.valueAsNumber)}
        className={cn("num", suffix && "pr-14")} />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-2xs text-subtle">{suffix}</span>}
    </div>
  );
}

function Group({ icon, title, description, children }: { icon: ReactNode; title: string; description?: string; children: ReactNode }) {
  return <Section title={<span className="flex items-center gap-2"><span className="text-accent">{icon}</span>{title}</span>} description={description}>{children}</Section>;
}

export function OrganizationTab() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const editable = can("settings:write");
  const q = useQuery({ queryKey: ["settings", "organization"], queryFn: async () => (await api.get<OrgSettings>("/settings/organization")).data });
  const tz = useQuery({ queryKey: ["settings", "timezones"], queryFn: async () => (await api.get<string[]>("/settings/timezones")).data, staleTime: Infinity });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const original = useMemo(() => (q.data ? strip(q.data) : null), [q.data]);
  useEffect(() => { if (original && !draft) setDraft(structuredClone(original)); }, [original, draft]);

  const dirty = !!draft && !!original && JSON.stringify(draft) !== JSON.stringify(original);
  const errors = useMemo(() => (draft ? validate(draft) : {}), [draft]);
  const errorCount = Object.keys(errors).length;
  const err = (k: string) => (showErrors || dirty ? errors[k] : undefined);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async (d: Draft) => (await api.put<OrgSettings>("/settings/organization", d)).data,
    onSuccess: (d) => {
      qc.setQueryData(["settings", "organization"], d);
      setDraft(structuredClone(strip(d)));
      setServerError(null);
      setShowErrors(false);
      void qc.invalidateQueries({ queryKey: ["password-policy"] });
      toast.success("Organization settings saved", "Changes apply to new evaluations immediately and were recorded in the audit trail.");
    },
    onError: (e) => {
      const x = apiError(e);
      setServerError(x.message);
      toast.error("Settings not saved", x.message);
    },
  });

  if (q.isLoading || (q.data && !draft)) return <div className="space-y-4"><SectionSkeleton rows={3} /><SectionSkeleton rows={2} /></div>;
  if (q.isError || !draft || !original) return <ErrorCard title="Couldn't load organization settings" message={apiError(q.error).message} onRetry={() => q.refetch()} />;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setDraft((d) => (d ? { ...d, [k]: v } : d)); setServerError(null); };
  const ro = !editable;
  const onSave = () => {
    setShowErrors(true);
    if (errorCount) { toast.error("Fix the highlighted fields", Object.values(errors)[0]); return; }
    save.mutate({ ...draft, org_name: draft.org_name.trim(), domain: draft.domain?.trim() || null });
  };
  const tzList = tz.data ?? [draft.timezone];

  return (
    <div className="space-y-4">
      {ro ? (
        <Notice tone="info" icon={<Lock className="h-3.5 w-3.5" />}>
          You have read-only access to organization settings. Changes require the <span className="font-mono text-fg">settings:write</span> permission.
        </Notice>
      ) : (
        <Notice tone="info">
          These settings apply to every user. Each save is recorded in the audit trail with a before/after diff.
          {q.data?.updated_at && <> Last updated {fmtDate(q.data.updated_at)}.</>}
        </Notice>
      )}
      {serverError && <Notice tone="danger">{serverError}</Notice>}

      <fieldset disabled={ro} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <Group icon={<Building2 className="h-4 w-4" />} title="General">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Organization name" required error={err("org_name")}>
              <Input value={draft.org_name} onChange={(e) => set("org_name", e.target.value)} invalid={!!err("org_name")} maxLength={150} />
            </Field>
            <Field label="Primary domain" hint="Used for display and email matching." error={err("domain")}>
              <Input value={draft.domain ?? ""} onChange={(e) => set("domain", e.target.value)} placeholder="example.com" className="font-mono" maxLength={150} />
            </Field>
            <Field label="Timezone" hint="Used for business-hours evaluation.">
              <Select value={draft.timezone} onChange={(e) => set("timezone", e.target.value)} disabled={ro || tz.isLoading}>
                {!tzList.includes(draft.timezone) && <option value={draft.timezone}>{draft.timezone}</option>}
                {tzList.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
              </Select>
            </Field>
          </div>
        </Group>

        <Group icon={<Clock className="h-4 w-4" />} title="Sessions" description="Applies to sessions created after saving.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Session lifetime" hint="15 minutes to 7 days. Users must sign in again after this." error={err("session_timeout_minutes")}>
              <NumberInput value={draft.session_timeout_minutes} onChange={(v) => set("session_timeout_minutes", v)} min={15} max={10080} suffix="min" invalid={!!err("session_timeout_minutes")} />
            </Field>
            <Field label="Idle timeout" hint="Sessions without activity for this long expire." error={err("idle_timeout_minutes")}>
              <NumberInput value={draft.idle_timeout_minutes} onChange={(v) => set("idle_timeout_minutes", v)} min={5} max={1440} suffix="min" invalid={!!err("idle_timeout_minutes")} />
            </Field>
          </div>
        </Group>

        <Group icon={<KeyRound className="h-4 w-4" />} title="Password policy" description="Enforced on registration, password change and reset.">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[220px_1fr]">
            <Field label="Minimum length" error={err("password_min_length")}>
              <NumberInput value={draft.password_min_length} onChange={(v) => set("password_min_length", v)} min={8} max={64} suffix="chars" invalid={!!err("password_min_length")} />
            </Field>
            <div>
              <p className="mb-2 text-xs font-medium text-muted">Required character classes</p>
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                <Checkbox checked={draft.password_require_upper} onChange={(v) => set("password_require_upper", v)} label="Uppercase letter (A–Z)" />
                <Checkbox checked={draft.password_require_lower} onChange={(v) => set("password_require_lower", v)} label="Lowercase letter (a–z)" />
                <Checkbox checked={draft.password_require_digit} onChange={(v) => set("password_require_digit", v)} label="Digit (0–9)" />
                <Checkbox checked={draft.password_require_symbol} onChange={(v) => set("password_require_symbol", v)} label="Symbol (!@#…)" />
              </div>
            </div>
          </div>
        </Group>

        <Group icon={<ShieldAlert className="h-4 w-4" />} title="Login security">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Failed attempts before lockout" error={err("max_failed_logins")}>
                <NumberInput value={draft.max_failed_logins} onChange={(v) => set("max_failed_logins", v)} min={3} max={20} suffix="tries" invalid={!!err("max_failed_logins")} />
              </Field>
              <Field label="Lockout duration" error={err("lockout_minutes")}>
                <NumberInput value={draft.lockout_minutes} onChange={(v) => set("lockout_minutes", v)} min={1} max={1440} suffix="min" invalid={!!err("lockout_minutes")} />
              </Field>
            </div>
            <div className="border-t border-line/60 pt-4">
              <Switch checked={draft.allow_self_registration} onChange={(v) => set("allow_self_registration", v)} disabled={ro}
                label="Allow self-registration" description="Anyone can create an account. New accounts receive the least-privileged Guest role." />
            </div>
            <div className="border-t border-line/60 pt-4">
              <p className="text-[13px] font-medium">Require MFA for roles</p>
              <p className="mt-0.5 text-xs text-muted">Users in these roles are prompted to enrol and are stepped-up on sensitive resources until they do.</p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                {ROLES.map((r) => (
                  <Checkbox key={r.value} label={r.label} checked={draft.mfa_required_roles.includes(r.value)}
                    onChange={(v) => set("mfa_required_roles", v ? [...draft.mfa_required_roles, r.value] : draft.mfa_required_roles.filter((x) => x !== r.value))} />
                ))}
              </div>
            </div>
          </div>
        </Group>

        <Group icon={<Gauge className="h-4 w-4" />} title="Risk & policy" description="Adaptive thresholds evaluated before policies, and the fallback when no policy matches.">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Block threshold" hint="Risk score at or above which access is denied." error={err("risk_block_threshold")}>
                <NumberInput value={draft.risk_block_threshold} onChange={(v) => set("risk_block_threshold", v)} min={1} max={100} suffix="/ 100" invalid={!!err("risk_block_threshold")} />
              </Field>
              <Field label="MFA step-up threshold" hint="Must be lower than the block threshold." error={err("risk_mfa_threshold")}>
                <NumberInput value={draft.risk_mfa_threshold} onChange={(v) => set("risk_mfa_threshold", v)} min={0} max={100} suffix="/ 100" invalid={!!err("risk_mfa_threshold")} />
              </Field>
            </div>
            <RiskScale mfa={draft.risk_mfa_threshold} block={draft.risk_block_threshold} />
            <div className="grid grid-cols-1 gap-4 border-t border-line/60 pt-4 md:grid-cols-3">
              <Field label="Default action (no policy matched)">
                <Select value={draft.default_policy_action} onChange={(e) => set("default_policy_action", e.target.value as Decision)} className="font-mono">
                  {ACTIONS.map((a) => <option key={a} value={a}>{a} — {DECISION_LABEL[a]}</option>)}
                </Select>
              </Field>
              <Field label="Business hours start">
                <Select value={draft.business_hours_start} onChange={(e) => set("business_hours_start", Number(e.target.value))} className="num">
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hour(h)}</option>)}
                </Select>
              </Field>
              <Field label="Business hours end" error={err("business_hours_end")}>
                <Select value={draft.business_hours_end} onChange={(e) => set("business_hours_end", Number(e.target.value))} className="num" invalid={!!err("business_hours_end")}>
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{hour(h)}</option>)}
                </Select>
              </Field>
            </div>
            {draft.default_policy_action !== "DENY" && (
              <Notice tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
                <span className="font-medium">Default-deny is recommended.</span>{" "}
                With <span className="font-mono">{draft.default_policy_action}</span>, requests that match no policy are {draft.default_policy_action === "ALLOW" ? "allowed" : "not denied"}. Zero Trust assumes explicit allow rules only.
              </Notice>
            )}
          </div>
        </Group>

        <Group icon={<Scale className="h-4 w-4" />} title="Risk scoring weights" description="Points added to a user's 0–100 risk score for each signal. Rule-based and fully transparent.">
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full min-w-[460px] text-left">
              <thead>
                <tr className="text-2xs uppercase tracking-[0.07em] text-subtle">
                  <th className="border-b border-line px-5 py-2.5 font-medium">Signal</th>
                  <th className="border-b border-line px-5 py-2.5 font-medium">Key</th>
                  <th className="w-36 border-b border-line px-5 py-2.5 text-right font-medium">Points</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(draft.risk_weights).map(([k, v]) => {
                  const [label, hint] = WEIGHT_LABELS[k] ?? [titleCase(k), ""];
                  const changed = original.risk_weights[k] !== v;
                  return (
                    <tr key={k} className="align-middle">
                      <td className="border-b border-line/60 px-5 py-2.5">
                        <label htmlFor={`w-${k}`} className="text-[13px] font-medium">{label}{changed && <span className="ml-1.5 text-2xs text-accent">edited</span>}</label>
                        {hint && <p className="text-2xs text-muted">{hint}</p>}
                      </td>
                      <td className="border-b border-line/60 px-5 py-2.5 font-mono text-2xs text-subtle">{k}</td>
                      <td className="border-b border-line/60 px-5 py-2">
                        <NumberInput id={`w-${k}`} value={v} min={0} max={100} invalid={!!err(`risk_weights.${k}`)}
                          onChange={(n) => set("risk_weights", { ...draft.risk_weights, [k]: n })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Group>

        <Group icon={<Bell className="h-4 w-4" />} title="Notifications" description="Organization-wide in-app notification rules.">
          <div className="space-y-4">
            {Object.entries(draft.notification_settings).map(([k, v]) => {
              const [label, desc] = NOTIFY_LABELS[k] ?? [titleCase(k.replace(/^notify_/, "")), undefined];
              return <Switch key={k} label={label} description={desc} checked={v} disabled={ro}
                onChange={(nv) => set("notification_settings", { ...draft.notification_settings, [k]: nv })} />;
            })}
            {Object.keys(draft.notification_settings).length === 0 && <p className="text-xs text-subtle">No notification rules configured.</p>}
          </div>
        </Group>
      </fieldset>

      {editable && (
        <AnimatePresence>
          {dirty && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.2 }}
              className="sticky bottom-3 z-30">
              <div className="card-elevated flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
                  <span className="font-medium">Unsaved changes</span>
                  {showErrors && errorCount > 0 && <span className="text-xs text-danger">· {errorCount} field{errorCount === 1 ? "" : "s"} need attention</span>}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => { setDraft(structuredClone(original)); setServerError(null); setShowErrors(false); }} disabled={save.isPending}>Discard</Button>
                  <Button variant="primary" onClick={onSave} loading={save.isPending}>Save changes</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

function RiskScale({ mfa, block }: { mfa: number; block: number }) {
  const m = Math.max(0, Math.min(100, Number.isNaN(mfa) ? 0 : mfa));
  const b = Math.max(0, Math.min(100, Number.isNaN(block) ? 100 : block));
  const valid = m < b;
  return (
    <div aria-hidden>
      <div className="relative h-2 overflow-hidden rounded-full bg-elevated">
        <div className="absolute inset-y-0 left-0 bg-success/50" style={{ width: `${valid ? m : 0}%` }} />
        <div className="absolute inset-y-0 bg-lavender/60" style={{ left: `${valid ? m : 0}%`, width: `${valid ? b - m : 0}%` }} />
        <div className="absolute inset-y-0 right-0 bg-danger/60" style={{ width: `${100 - b}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-2xs text-muted">
        <span><span className="text-success">●</span> 0–{Math.max(0, m - 1)} evaluate policies</span>
        <span><span className="text-lavender">●</span> {m}–{Math.max(m, b - 1)} require MFA</span>
        <span><span className="text-danger">●</span> {b}–100 block</span>
      </div>
    </div>
  );
}
