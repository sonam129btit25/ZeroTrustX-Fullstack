import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { z } from "zod";
import { AlertCircle, CheckCircle2, CircleSlash, FlaskConical, GripVertical, Play, Plus, Trash2 } from "lucide-react";
import { api, apiError } from "@/services/api";
import type { Decision, FieldMeta, Policy, PolicyFields, Resource } from "@/types/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Drawer } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/Form";
import { DECISION_LABEL, DecisionBadge } from "@/components/ui/Badge";
import { cn } from "@/utils/format";
import {
  emptyValue, newKey, toDraftValue, toPayloadValue, validatePayloadValue, valueKind, weekdayLabel,
  type DraftCondition, type ValueKind,
} from "./conditions";
import { simulate } from "./api";
import { DECISION_ORDER, type PolicyPayload, type SimulationResult } from "./types";
import { ChipInput, Segmented, SectionLabel } from "./ui";
import { SimContextFields, defaultSimForm, toSimulateBody, type SimForm } from "./Simulator";
import { SimulationResultView } from "./SimulationResultView";

const MAX_CONDITIONS = 20;
const ACTIONS = DECISION_ORDER;

export interface EditorSeed { mode: "create" | "edit" | "duplicate"; policy?: Policy; priority?: number }

function makeSchema(cat: PolicyFields) {
  return z.object({
    name: z.string().trim().min(3, "Name must be at least 3 characters").max(150, "Name must be at most 150 characters"),
    description: z.string().max(2000, "Description must be at most 2000 characters"),
    priority: z.number({ invalid_type_error: "Priority must be a number" }).int("Priority must be a whole number").min(1, "Priority must be between 1 and 10000").max(10000, "Priority must be between 1 and 10000"),
    action: z.enum(ACTIONS as [Decision, ...Decision[]]),
    match_mode: z.enum(["all", "any"]),
    is_enabled: z.boolean(),
    conditions: z.array(z.object({ field: z.string(), operator: z.string(), value: z.unknown() })).max(MAX_CONDITIONS, `At most ${MAX_CONDITIONS} conditions`),
  }).superRefine((v, ctx) => {
    v.conditions.forEach((c, i) => {
      const meta = cat.fields[c.field];
      if (!meta) return ctx.addIssue({ code: "custom", path: ["conditions", i], message: "Choose a field" });
      if (!meta.operators.includes(c.operator)) return ctx.addIssue({ code: "custom", path: ["conditions", i], message: "Choose a valid operator" });
      const err = validatePayloadValue(valueKind(meta, c.operator), c.value, meta);
      if (err) ctx.addIssue({ code: "custom", path: ["conditions", i], message: err });
    });
  });
}

function ValueInput({ kind, meta, field, value, onChange, invalid, slugs }: {
  kind: ValueKind; meta?: FieldMeta; field: string; value: unknown; onChange: (v: unknown) => void; invalid?: boolean; slugs: string[];
}) {
  const slugField = field === "resource.slug" && slugs.length > 0;
  switch (kind) {
    case "none":
      return <div className="flex h-9 items-center rounded-lg border border-dashed border-line px-3 text-xs text-subtle">No value needed</div>;
    case "chips":
      return <ChipInput value={value as string[]} onChange={onChange} invalid={invalid}
        options={slugField ? slugs : meta?.options} placeholder={field === "user.department" ? "e.g. Finance, Engineering" : undefined} />;
    case "numberList":
      return field === "request.weekday"
        ? <ChipInput value={value as number[]} onChange={(v) => onChange([...(v as number[])].sort())} invalid={invalid} options={[0, 1, 2, 3, 4, 5, 6]} optionLabel={(n) => weekdayLabel(Number(n))} />
        : <ChipInput value={value as number[]} onChange={onChange} invalid={invalid} numeric placeholder="Numbers, press Enter" />;
    case "range": {
      const [a, b] = value as string[];
      return (
        <div className="flex items-center gap-2">
          <Input type="number" value={a} onChange={(e) => onChange([e.target.value, b])} placeholder="min" invalid={invalid} aria-label="Minimum" className="num" />
          <span className="text-xs text-subtle">and</span>
          <Input type="number" value={b} onChange={(e) => onChange([a, e.target.value])} placeholder="max" invalid={invalid} aria-label="Maximum" className="num" />
        </div>
      );
    }
    case "number":
      return <Input type="number" value={value as string} onChange={(e) => onChange(e.target.value)} invalid={invalid} aria-label="Value" className="num"
        placeholder={field.endsWith("risk_score") ? "0–100" : field === "request.hour" ? "0–23" : "Number"} />;
    case "cidr":
      return <Input value={value as string} onChange={(e) => onChange(e.target.value)} invalid={invalid} aria-label="Networks" className="font-mono"
        placeholder="10.0.0.0/8, 192.168.0.0/16" />;
    case "select":
      return (
        <Select value={value as string} onChange={(e) => onChange(e.target.value)} invalid={invalid} aria-label="Value">
          {meta?.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      );
    default:
      if (slugField) {
        return (
          <Select value={value as string} onChange={(e) => onChange(e.target.value)} invalid={invalid} aria-label="Value">
            <option value="">Select a resource…</option>
            {slugs.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        );
      }
      return <Input value={value as string} onChange={(e) => onChange(e.target.value)} invalid={invalid} aria-label="Value"
        className={meta?.type === "ip" ? "font-mono" : undefined} placeholder={meta?.type === "ip" ? "203.0.113.10" : "Value"} />;
  }
}

function seedState(seed: EditorSeed, cat: PolicyFields) {
  const p = seed.policy;
  return {
    name: p ? (seed.mode === "duplicate" ? `Copy of ${p.name}`.slice(0, 150) : p.name) : "",
    description: p?.description ?? "",
    priority: String(seed.mode === "edit" ? p!.priority : seed.priority ?? 100),
    action: (p?.action ?? "REQUIRE_MFA") as Decision,
    match_mode: (p?.match_mode ?? "all") as "all" | "any",
    is_enabled: seed.mode === "duplicate" ? false : p?.is_enabled ?? true,
    conditions: (p?.conditions ?? []).map<DraftCondition>((c) => {
      const kind = valueKind(cat.fields[c.field], c.operator);
      return { key: newKey(), field: c.field, operator: c.operator, value: toDraftValue(kind, c.value) };
    }),
  };
}

export function PolicyEditor({ open, onClose, seed, catalogue, resources, onSaved }: {
  open: boolean; onClose: () => void; seed: EditorSeed | null; catalogue: PolicyFields; resources: Resource[]; onSaved?: (p: Policy) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [st, setSt] = useState(() => seedState(seed ?? { mode: "create" }, catalogue));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [showTest, setShowTest] = useState(false);
  const [testForm, setTestForm] = useState<SimForm>(() => ({ ...defaultSimForm(resources[0]?.id ?? ""), trust: "untrusted" }));
  const testRef = useRef<HTMLDivElement>(null);
  const fieldEntries = useMemo(() => Object.entries(catalogue.fields), [catalogue]);
  const slugs = useMemo(() => resources.map((r) => r.slug), [resources]);

  useEffect(() => {
    if (open && seed) {
      setSt(seedState(seed, catalogue));
      setErrors({}); setServerError(null); setShowTest(false); test.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed]);

  useEffect(() => {
    if (!testForm.resourceId && resources.length) setTestForm((f) => ({ ...f, resourceId: resources[0].id }));
  }, [resources, testForm.resourceId]);

  const set = (p: Partial<typeof st>) => setSt((s) => ({ ...s, ...p }));
  const setRow = (key: string, p: Partial<DraftCondition>) =>
    setSt((s) => ({ ...s, conditions: s.conditions.map((c) => (c.key === key ? { ...c, ...p } : c)) }));

  const addRow = () => {
    if (st.conditions.length >= MAX_CONDITIONS) return;
    const [field, meta] = fieldEntries.find(([f]) => f === "resource.sensitivity") ?? fieldEntries[0];
    const operator = meta.operators.includes("in") ? "in" : meta.operators[0];
    set({ conditions: [...st.conditions, { key: newKey(), field, operator, value: emptyValue(valueKind(meta, operator), meta) }] });
  };
  const changeField = (c: DraftCondition, field: string) => {
    const meta = catalogue.fields[field];
    const operator = meta.operators.includes(c.operator) ? c.operator : meta.operators[0];
    setRow(c.key, { field, operator, value: emptyValue(valueKind(meta, operator), meta) });
  };
  const changeOperator = (c: DraftCondition, operator: string) => {
    const meta = catalogue.fields[c.field];
    const before = valueKind(meta, c.operator), after = valueKind(meta, operator);
    setRow(c.key, { operator, value: before === after ? c.value : emptyValue(after, meta) });
  };

  const buildPayload = (): PolicyPayload | null => {
    const raw = {
      name: st.name, description: st.description, priority: st.priority.trim() === "" ? NaN : Number(st.priority),
      action: st.action, match_mode: st.match_mode, is_enabled: st.is_enabled,
      conditions: st.conditions.map((c) => ({ field: c.field, operator: c.operator, value: toPayloadValue(valueKind(catalogue.fields[c.field], c.operator), c.value) })),
    };
    const parsed = makeSchema(catalogue).safeParse(raw);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => {
        const k = i.path[0] === "conditions" && typeof i.path[1] === "number" ? `row:${st.conditions[i.path[1]]?.key}` : String(i.path[0]);
        if (!errs[k]) errs[k] = i.message;
      });
      setErrors(errs);
      return null;
    }
    setErrors({});
    return { ...parsed.data, name: parsed.data.name.trim() } as PolicyPayload;
  };

  const save = useMutation({
    mutationFn: async (body: PolicyPayload) => {
      const id = seed?.mode === "edit" ? seed.policy!.id : null;
      return id ? (await api.put<Policy>(`/policies/${id}`, body)).data : (await api.post<Policy>("/policies", body)).data;
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["policies"] });
      toast.success(seed?.mode === "edit" ? "Policy updated" : "Policy created", `${p.name} · v${p.version}`);
      onSaved?.(p);
      onClose();
    },
    onError: (e) => setServerError(apiError(e).message),
  });

  const test = useMutation({
    mutationFn: (draft: PolicyPayload) => simulate(toSimulateBody(testForm, draft)),
    onError: (e) => setServerError(apiError(e).message),
  });

  const submit = () => {
    setServerError(null);
    const body = buildPayload();
    if (body) save.mutate(body);
  };
  const runTest = () => {
    setServerError(null);
    setShowTest(true);
    setTimeout(() => testRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    const body = buildPayload();
    if (body && testForm.resourceId) test.mutate(body);
  };

  const title = seed?.mode === "edit" ? "Edit policy" : seed?.mode === "duplicate" ? "Duplicate policy" : "New policy";
  const draftStep = test.data?.trace.find((t) => t.policy_id === "draft");
  const draftMatch = test.data?.matched_policies.find((m) => m.policy_id === "draft");

  return (
    <Drawer open={open} onClose={onClose} width="max-w-2xl" title={title}
      subtitle={seed?.mode === "edit" ? <>Saving creates version <span className="font-mono">v{(seed.policy?.version ?? 0) + 1}</span>. Changes apply to the next evaluation.</>
        : seed?.mode === "duplicate" ? "The copy starts disabled so it cannot affect live decisions until you enable it." : "Policies are evaluated in priority order; the most restrictive matching outcome wins."}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {can("policies:simulate") && <Button variant="outline" icon={<FlaskConical className="h-3.5 w-3.5" />} onClick={runTest} loading={test.isPending}>Test draft in simulator</Button>}
        <Button variant="primary" onClick={submit} loading={save.isPending}>{seed?.mode === "edit" ? "Save changes" : "Create policy"}</Button>
      </>}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        {serverError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{serverError}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_120px]">
          <Field label="Name" required error={errors.name}>
            <Input value={st.name} onChange={(e) => set({ name: e.target.value })} invalid={!!errors.name} placeholder="e.g. Require MFA for finance data" maxLength={150} />
          </Field>
          <Field label="Priority" required error={errors.priority} hint="Lower runs first">
            <Input type="number" min={1} max={10000} value={st.priority} onChange={(e) => set({ priority: e.target.value })} invalid={!!errors.priority} className="num font-mono" />
          </Field>
        </div>
        <Field label="Description" error={errors.description}>
          <Textarea value={st.description} onChange={(e) => set({ description: e.target.value })} rows={2} className="min-h-[64px]" placeholder="Why this policy exists and what it protects." maxLength={2000} />
        </Field>

        <div>
          <SectionLabel>Outcome when matched</SectionLabel>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-5">
            {ACTIONS.map((a) => (
              <button key={a} type="button" onClick={() => set({ action: a })} aria-pressed={st.action === a} data-cursor="hover"
                className={cn("flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors sm:flex-col sm:items-start",
                  st.action === a ? "border-accent/50 bg-accent/[0.07]" : "border-line hover:border-line-strong")}>
                <DecisionBadge decision={a} />
                <span className="text-2xs text-subtle">{a === "DENY" ? "Block" : a === "ALLOW" ? "Permit" : a === "RESTRICTED_ACCESS" ? "Read-only" : "Step-up"}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface/40 p-3">
          <div>
            <p className="text-[13px] font-medium text-fg">Match when</p>
            <p className="text-xs text-muted">{st.match_mode === "all" ? "Every condition is true (AND)" : "At least one condition is true (OR)"}</p>
          </div>
          <Segmented ariaLabel="Match mode" value={st.match_mode} onChange={(v) => set({ match_mode: v })}
            options={[{ value: "all", label: "All conditions" }, { value: "any", label: "Any condition" }]} />
        </div>

        <div>
          <SectionLabel action={<span className="num text-2xs text-subtle">{st.conditions.length}/{MAX_CONDITIONS}</span>}>Conditions</SectionLabel>
          {st.conditions.length === 0 && (
            <p className="mb-2 rounded-lg border border-dashed border-warning/40 bg-warning/[0.05] px-3 py-2.5 text-xs text-warning">
              A policy without conditions matches every request that passes the baseline guards.
            </p>
          )}
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {st.conditions.map((c, i) => {
                const meta = catalogue.fields[c.field];
                const kind = valueKind(meta, c.operator);
                const err = errors[`row:${c.key}`];
                return (
                  <motion.li key={c.key} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                    className={cn("rounded-lg border bg-surface/40 p-2.5", err ? "border-danger/50" : "border-line")}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-2xs text-subtle">
                        <GripVertical className="h-3 w-3" />
                        {i === 0 ? "If" : st.match_mode === "all" ? "And" : "Or"}
                      </span>
                      <Button size="xs" variant="ghost" aria-label={`Remove condition ${i + 1}`} icon={<Trash2 className="h-3 w-3" />}
                        onClick={() => set({ conditions: st.conditions.filter((x) => x.key !== c.key) })}>Remove</Button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_150px]">
                      <Select value={c.field} onChange={(e) => changeField(c, e.target.value)} aria-label="Field">
                        {fieldEntries.map(([f, m]) => <option key={f} value={f}>{m.label}</option>)}
                      </Select>
                      <Select value={c.operator} onChange={(e) => changeOperator(c, e.target.value)} aria-label="Operator">
                        {meta?.operators.map((o) => <option key={o} value={o}>{catalogue.operators[o] ?? o}</option>)}
                      </Select>
                    </div>
                    <div className="mt-2">
                      <ValueInput kind={kind} meta={meta} field={c.field} value={c.value} onChange={(v) => setRow(c.key, { value: v })} invalid={!!err} slugs={slugs} />
                    </div>
                    {err && <p className="mt-1.5 text-xs text-danger" role="alert">{err}</p>}
                    <p className="mt-1.5 font-mono text-[10px] text-subtle">{c.field}</p>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
          {errors.conditions && <p className="mt-1.5 text-xs text-danger">{errors.conditions}</p>}
          <Button size="sm" variant="outline" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={addRow} disabled={st.conditions.length >= MAX_CONDITIONS}>
            Add condition
          </Button>
        </div>

        <div className="rounded-lg border border-line bg-surface/40 p-3">
          <Switch checked={st.is_enabled} onChange={(v) => set({ is_enabled: v })} label="Enabled"
            description="Disabled policies are kept but skipped by the engine." />
        </div>
        <button type="submit" hidden aria-hidden />
      </form>

      {showTest && can("policies:simulate") && (
        <div ref={testRef} className="mt-6 scroll-mt-4 border-t border-line pt-5">
          <SectionLabel action={<span className="text-2xs text-subtle">Draft is evaluated alongside live policies</span>}>Test draft</SectionLabel>
          <p className="mb-3 text-xs text-muted">
            The unsaved policy is injected as <span className="font-mono text-fg">(draft)</span> into a simulation; nothing is saved.
            {seed?.mode === "edit" && " The currently saved version of this policy still participates."}
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-line bg-card p-3">
              <SimContextFields compact form={testForm} set={(p) => setTestForm((f) => ({ ...f, ...p }))} resources={resources} />
              <Button className="mt-4 w-full justify-center" variant="secondary" icon={<Play className="h-3.5 w-3.5" />} loading={test.isPending} onClick={runTest}>Run test</Button>
            </div>
            <div className="min-w-0">
              {test.data ? (
                <div className="space-y-3">
                  <DraftVerdict matched={!!draftMatch} deciding={!!draftMatch?.deciding} action={st.action} ran={!!draftStep} />
                  <SimulationResultView result={test.data as SimulationResult} compact />
                </div>
              ) : (
                <div className="grid h-full min-h-[160px] place-items-center rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">
                  {test.isPending ? "Evaluating…" : "Set a context and run the test to see how the draft behaves."}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function DraftVerdict({ matched, deciding, action, ran }: { matched: boolean; deciding: boolean; action: Decision; ran: boolean }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs",
      matched ? "border-accent/40 bg-accent/[0.06] text-fg" : "border-line bg-surface/50 text-muted")}>
      {matched ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /> : <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>
        {matched
          ? <>Draft <b>matched</b> ({DECISION_LABEL[action]}){deciding ? " and decided the outcome." : ", but a more restrictive result won."}</>
          : <>Draft did <b>not</b> match{ran ? "" : " — evaluation stopped at a baseline guard before policies ran"}.</>}
      </span>
    </div>
  );
}

