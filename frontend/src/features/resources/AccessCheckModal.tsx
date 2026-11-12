import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ExternalLink, Eye, FilePlus2, KeyRound, Loader2, MonitorSmartphone, RefreshCw, ShieldCheck } from "lucide-react";
import { api, apiError } from "@/services/api";
import type { Resource, TokenResponse } from "@/types/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Badge, TrustBadge } from "@/components/ui/Badge";
import { DecisionSummary, DecisionTrace } from "@/components/security/DecisionView";
import { ExplainButton } from "@/components/security/Assistant";
import { OtpInput } from "@/pages/auth/MfaVerify";
import { Collapsible, MatchedPolicies, SectionLabel } from "@/features/policies/ui";
import type { AccessResponse } from "./meta";
import { SensitivityBadge } from "./meta";

function StepUp({ onVerified }: { onVerified: () => void }) {
  const { applyTokens } = useAuth();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async (c: string) => (await api.post<TokenResponse>("/auth/step-up", { code: c })).data,
    onSuccess: (t) => { applyTokens(t); toast.success("Session MFA verified", "Re-evaluating access…"); onVerified(); },
    onError: (e) => { setError(apiError(e).message); setCode(""); },
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) m.mutate(code); }}>
      <p className="text-xs text-muted">Enter the 6-digit code from your authenticator app to upgrade this session to MFA-verified.</p>
      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
      <OtpInput value={code} onChange={(v) => { setCode(v); setError(null); }} onComplete={(v) => m.mutate(v)} disabled={m.isPending} />
      <Button type="submit" variant="primary" className="w-full justify-center" loading={m.isPending} disabled={code.length !== 6} icon={<KeyRound className="h-3.5 w-3.5" />}>
        Verify and retry
      </Button>
    </form>
  );
}

/** Policy Enforcement Point: evaluates POST /resources/{id}/access and explains the outcome. */
export function AccessCheckModal({ resource, onClose }: { resource: Resource | null; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const check = useMutation({
    mutationFn: async (id: string) => (await api.post<AccessResponse>(`/resources/${id}/access`)).data,
    onSettled: () => { qc.invalidateQueries({ queryKey: ["resources", "detail"] }); qc.invalidateQueries({ queryKey: ["policies"] }); },
  });
  const { mutate, reset } = check;
  const rid = resource?.id;
  useEffect(() => {
    if (rid) mutate(rid); else reset();
  }, [rid, mutate, reset]);

  const r = check.data;
  const notEntitled = r?.decision === "DENY" && resource && !resource.entitlement?.has_permission && !resource.entitlement?.has_active_grant;

  return (
    <Modal open={!!resource} onClose={onClose} size="lg"
      title={<span className="flex items-center gap-2">Access check · {resource?.name}</span>}
      description={resource && <span className="flex flex-wrap items-center gap-2"><SensitivityBadge sensitivity={resource.sensitivity} /> Evaluated by the Zero Trust engine against your current session, device and network.</span>}
      footer={<>
        {r && <ExplainButton endpoint={`/assistant/decisions/${r.decision_id}`} label="Explain decision" />}
        <span className="flex-1" />
        <Button variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => resource && check.mutate(resource.id)} disabled={check.isPending}>Re-evaluate</Button>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </>}>
      {check.isPending && (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-xs text-muted">
          <Loader2 className="h-6 w-6 animate-spin text-accent" /> Evaluating identity, session, device and policies…
        </div>
      )}
      {check.isError && !check.isPending && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{apiError(check.error).message}
        </div>
      )}
      {r && !check.isPending && (
        <div className="space-y-5">
          <DecisionSummary result={r} />

          {r.granted && (
            <div className="rounded-lg border border-success/30 bg-success/[0.06] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {r.access_mode === "read_only" ? <Eye className="h-4 w-4 text-cyan" /> : <ShieldCheck className="h-4 w-4 text-success" />}
                  <div>
                    <p className="text-[13px] font-medium text-fg">Access granted</p>
                    <p className="text-2xs text-muted">Mode: <Badge tone={r.access_mode === "read_only" ? "cyan" : "success"}>{r.access_mode === "read_only" ? "read-only" : "full"}</Badge></p>
                  </div>
                </div>
                {r.resource.url && (
                  <a href={r.resource.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 text-[13px] font-medium text-fg hover:border-line-strong" data-cursor="hover">
                    Open resource <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              {r.resource.url && (
                <p className="mt-2 break-all font-mono text-2xs text-subtle">
                  {r.resource.url} <span className="font-sans">· demo internal hostname, not reachable outside the demo network</span>
                </p>
              )}
            </div>
          )}

          {r.decision === "REQUIRE_MFA" && (
            <div className="rounded-lg border border-lavender/30 bg-lavender/[0.05] p-4">
              <p className="mb-2 flex items-center gap-2 text-[13px] font-medium text-fg"><KeyRound className="h-4 w-4 text-lavender" /> Step-up authentication</p>
              {user?.mfa_enabled ? (
                <StepUp onVerified={() => resource && check.mutate(resource.id)} />
              ) : (
                <div className="space-y-2 text-xs text-muted">
                  <p>Your account has no authenticator enrolled, so this session cannot be step-up verified yet.</p>
                  <Link to="/settings?tab=security" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">Set up MFA in security settings →</Link>
                </div>
              )}
            </div>
          )}

          {r.decision === "REQUIRE_DEVICE_VERIFICATION" && (
            <div className="rounded-lg border border-warning/30 bg-warning/[0.05] p-4 text-xs text-muted">
              <p className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-fg"><MonitorSmartphone className="h-4 w-4 text-warning" /> Device verification needed</p>
              <p>This browser is identified by a device identifier, not an endpoint agent. A security administrator must review and mark it as <b>trusted</b> before this resource can be reached.</p>
              <p className="mt-2 flex flex-wrap items-center gap-2">Current device:
                {user?.session.device ? <><span className="text-fg">{user.session.device.name}</span><TrustBadge status={user.session.device.trust_status} /></> : <TrustBadge status="unknown" />}
              </p>
            </div>
          )}

          {notEntitled && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface/60 p-3 text-xs text-muted">
              <span>You are not entitled to this resource. Request time-bound access with a business justification.</span>
              <Link to={`/access-requests?new=1&resource=${resource!.id}`} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
                <FilePlus2 className="h-3.5 w-3.5" /> Request access
              </Link>
            </div>
          )}

          <div>
            <SectionLabel>Matched policies</SectionLabel>
            <MatchedPolicies items={r.matched_policies} empty={r.trace.some((t) => t.stage === "policy") ? "No administrator policy matched; the organisation default applied." : "Evaluation stopped at a baseline guard before policies ran."} />
          </div>
          <Collapsible title="Evaluation trace" meta={`${r.trace.length} steps · ${r.duration_ms.toFixed(2)} ms`} defaultOpen={!r.granted}>
            <DecisionTrace trace={r.trace} />
          </Collapsible>
        </div>
      )}
    </Modal>
  );
}
