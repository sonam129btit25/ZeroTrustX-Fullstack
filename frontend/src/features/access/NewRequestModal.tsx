import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock3, XCircle } from "lucide-react";
import { api, apiError } from "@/services/api";
import type { AccessRequest } from "@/types/api";
import { useToast } from "@/context/ToastContext";
import { Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Form";
import { StatusBadge } from "@/components/ui/Badge";
import { DecisionSummary, DecisionTrace } from "@/components/security/DecisionView";
import { cn } from "@/utils/format";
import { useResourceCatalogue } from "@/features/policies/api";
import { Collapsible, MatchedPolicies, SectionLabel } from "@/features/policies/ui";
import { SensitivityBadge, entitlementState } from "@/features/resources/meta";

const DURATIONS = [1, 4, 8, 24, 72, 168];
const durLabel = (h: number) => (h < 24 ? `${h} hour${h > 1 ? "s" : ""}` : h === 168 ? "7 days" : `${h / 24} day${h > 24 ? "s" : ""}`);

const schema = z.object({
  resource_id: z.string().min(1, "Choose a resource"),
  justification: z.string().trim().min(20, "Provide a business justification of at least 20 characters").max(2000, "At most 2000 characters"),
  duration_hours: z.coerce.number().int().min(1).max(720),
});
type Values = z.infer<typeof schema>;

function Outcome({ req }: { req: AccessRequest }) {
  const meta = req.status === "approved"
    ? { icon: CheckCircle2, tone: "border-success/30 bg-success/[0.06] text-success", title: "Automatically approved", text: `The engine allowed this request and the resource does not require manual review. Access expires ${req.expires_at ? new Date(req.expires_at).toLocaleString() : "soon"}.` }
    : req.status === "rejected"
      ? { icon: XCircle, tone: "border-danger/30 bg-danger/[0.06] text-danger", title: "Automatically rejected", text: "The policy engine denied this request based on your current security posture. Address the reasons below and submit again." }
      : { icon: Clock3, tone: "border-accent/30 bg-accent/[0.06] text-accent", title: "Pending manual approval", text: "A reviewer with approval rights has been notified. You'll get a notification once it's decided." };
  return (
    <div className="space-y-4">
      <div className={cn("flex items-start gap-3 rounded-lg border p-3.5", meta.tone)}>
        <meta.icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><p className="text-[13px] font-semibold text-fg">{meta.title}</p><StatusBadge status={req.status} /></div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{meta.text}</p>
        </div>
      </div>
      {req.decision && (
        <>
          <div>
            <SectionLabel>Engine evaluation</SectionLabel>
            <p className="mb-3 text-2xs text-subtle">Entitlement is assumed for the evaluation so the engine can judge your security posture (session, device, network, risk) for the request.</p>
            <DecisionSummary result={{ decision: req.decision.decision, reasons: req.decision.reasons, required_actions: [] }} />
          </div>
          <div><SectionLabel>Matched policies</SectionLabel><MatchedPolicies items={req.decision.matched_policies} /></div>
          <Collapsible title="Evaluation trace" meta={`${req.decision.trace.length} steps`} defaultOpen={req.status === "rejected"}>
            <DecisionTrace trace={req.decision.trace} />
          </Collapsible>
        </>
      )}
    </div>
  );
}

export function NewRequestModal({ open, onClose, initialResource, onView }: {
  open: boolean; onClose: () => void; initialResource?: string | null; onView: (id: string) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const resources = useResourceCatalogue(open);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema), defaultValues: { resource_id: initialResource ?? "", justification: "", duration_hours: 8 },
  });
  const submit = useMutation({
    mutationFn: async (v: Values) => (await api.post<AccessRequest>("/access-requests", v)).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["access-requests"] });
      qc.invalidateQueries({ queryKey: ["resources"] });
      toast[r.status === "rejected" ? "warning" : "success"](`Request ${r.status === "pending" ? "submitted" : r.status}`, r.resource.name);
    },
    onError: (e) => setServerError(apiError(e).message),
  });
  const { reset: resetMutation } = submit;

  useEffect(() => {
    if (open) { reset({ resource_id: initialResource ?? "", justification: "", duration_hours: 8 }); setServerError(null); resetMutation(); }
  }, [open, initialResource, reset, resetMutation]);

  const active = (resources.data ?? []).filter((r) => r.is_active);
  useEffect(() => {
    if (open && !watch("resource_id") && active.length) {
      const first = active.find((r) => entitlementState(r) === "none") ?? active[0];
      setValue("resource_id", first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active.length]);

  const rid = watch("resource_id");
  const just = watch("justification") ?? "";
  const selected = active.find((r) => r.id === rid);
  const done = submit.data;

  return (
    <Modal open={open} onClose={onClose} size="lg" title={done ? "Request outcome" : "Request access"}
      description={done ? <>{done.resource.name} · {durLabel(done.requested_duration_hours)}</> : "Requests are evaluated by the Zero Trust engine immediately, then routed for approval when required."}
      footer={done ? <>
        <Button variant="ghost" onClick={onClose}>Done</Button>
        <Button variant="primary" onClick={() => onView(done.id)}>View request</Button>
      </> : <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={submit.isPending} onClick={handleSubmit((v) => { setServerError(null); submit.mutate(v); })}>Submit request</Button>
      </>}>
      {done ? <Outcome req={done} /> : (
        <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => submit.mutate(v))}>
          {serverError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{serverError}</div>}
          <Field label="Resource" required error={errors.resource_id?.message}>
            <Select {...register("resource_id")} invalid={!!errors.resource_id} disabled={resources.isLoading} aria-label="Resource">
              {resources.isLoading && <option value="">Loading resources…</option>}
              {!resources.isLoading && !active.length && <option value="">No resources available</option>}
              {active.map((r) => {
                const ent = entitlementState(r);
                return <option key={r.id} value={r.id}>{r.name} · {r.sensitivity}{ent === "permission" ? " (already entitled)" : ent === "grant" ? " (active grant)" : ""}</option>;
              })}
            </Select>
          </Field>
          {selected && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/50 px-3 py-2 text-2xs text-muted">
              <SensitivityBadge sensitivity={selected.sensitivity} />
              <span>{selected.requires_approval ? "Manual approval required" : "Auto-approved when policy allows"}</span>
              <span>· max {selected.max_grant_hours}h</span>
              {entitlementState(selected) !== "none" && <span className="text-warning">· you already have access</span>}
            </div>
          )}
          <Field label="Business justification" required error={errors.justification?.message}
            hint={<span className="flex justify-between"><span>Explain what you need and why. Reviewers see this verbatim.</span><span className={cn("num", just.trim().length < 20 ? "text-warning" : "text-success")}>{just.trim().length}/20+</span></span>}>
            <Textarea {...register("justification")} invalid={!!errors.justification} rows={4} maxLength={2000} placeholder="e.g. Quarter-end reconciliation for the EMEA ledger, ticket FIN-2231." />
          </Field>
          <Field label="Duration" hint={selected && selected.max_grant_hours < 168 ? `Grants are capped at ${selected.max_grant_hours}h for this resource.` : undefined}>
            <Select {...register("duration_hours")} aria-label="Duration">
              {DURATIONS.map((h) => <option key={h} value={h}>{durLabel(h)}</option>)}
            </Select>
          </Field>
          <button type="submit" hidden aria-hidden />
        </form>
      )}
    </Modal>
  );
}

export { durLabel };
