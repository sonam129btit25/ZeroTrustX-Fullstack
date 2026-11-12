import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Info, Undo2, X } from "lucide-react";
import { api, apiError } from "@/services/api";
import type { AccessRequest } from "@/types/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { ConfirmDialog, Drawer, Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Form";
import { Avatar } from "@/components/ui/Page";
import { DecisionBadge, DemoTag, StatusBadge } from "@/components/ui/Badge";
import { EmptyState, KeyValue, Skeleton } from "@/components/ui/Data";
import { DecisionSummary, DecisionTrace } from "@/components/security/DecisionView";
import { ExplainButton } from "@/components/security/Assistant";
import { cn, fmtDate, timeAgo, titleCase } from "@/utils/format";
import { Collapsible, MatchedPolicies, SectionLabel, riskTone } from "@/features/policies/ui";
import { SensitivityBadge } from "@/features/resources/meta";
import { durLabel } from "./NewRequestModal";

const ACTION_TONE: Record<string, string> = {
  "access_request.submitted": "border-accent/60", "access_request.approved": "border-success/70", "access_request.auto_approved": "border-success/70",
  "access_request.rejected": "border-danger/70", "access_request.auto_rejected": "border-danger/70", "access_request.revoked": "border-warning/70",
  "access_request.expired": "border-line-strong",
};

function detailLine(details: Record<string, unknown>) {
  const parts: string[] = [];
  if (details.engine_decision) parts.push(`engine ${String(details.engine_decision)}`);
  if (details.hours) parts.push(`${String(details.hours)}h grant`);
  if (details.duration_hours) parts.push(`${String(details.duration_hours)}h requested`);
  if (details.comment) parts.push(`“${String(details.comment)}”`);
  if (Array.isArray(details.reasons) && details.reasons.length) parts.push(String(details.reasons[0]));
  if (details.reason) parts.push(titleCase(String(details.reason)));
  if (details.by_requester) parts.push("withdrawn by requester");
  return parts.join(" · ");
}

export function RequestDetailDrawer({ requestId, onClose }: { requestId: string | null; onClose: () => void }) {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["access-requests", "detail", requestId], enabled: !!requestId,
    queryFn: async () => (await api.get<AccessRequest>(`/access-requests/${requestId}`)).data,
  });
  const r = q.data;
  const [dialog, setDialog] = useState<null | "approve" | "reject" | "revoke">(null);
  const [comment, setComment] = useState("");
  const [hours, setHours] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setDialog(null); }, [requestId]);
  const openDialog = (d: "approve" | "reject" | "revoke") => { setComment(""); setHours(""); setErr(null); setDialog(d); };

  const act = useMutation({
    mutationFn: async ({ kind, body }: { kind: "approve" | "reject" | "revoke"; body: Record<string, unknown> }) =>
      (await api.post<AccessRequest>(`/access-requests/${requestId}/${kind}`, body)).data,
    onSuccess: (res, { kind }) => {
      qc.invalidateQueries({ queryKey: ["access-requests"] });
      qc.invalidateQueries({ queryKey: ["resources"] });
      const own = res.requester.id === user?.id;
      toast.success(kind === "approve" ? "Request approved" : kind === "reject" ? "Request rejected" : own ? "Request withdrawn" : "Access revoked", res.resource.name);
      setDialog(null);
    },
    onError: (e) => setErr(apiError(e).message),
  });

  const isOwn = !!r && r.requester.id === user?.id;
  const reviewer = can("access_requests:review");
  const pending = r?.status === "pending";
  const engineDenied = r?.engine_decision === "DENY";
  const canRevoke = !!r && ((reviewer && r.status === "approved") || (isOwn && (r.status === "pending" || r.status === "approved")));
  const revokeLabel = isOwn ? "Withdraw" : "Revoke";

  return (
    <Drawer open={!!requestId} onClose={() => { if (!dialog) onClose(); }} width="max-w-2xl"
      title={r ? <span className="flex items-center gap-2">{r.resource.name}{r.is_demo && <DemoTag />}</span> : "Access request"}
      subtitle={r && <span className="flex flex-wrap items-center gap-2"><StatusBadge status={r.status} /><span>requested {timeAgo(r.created_at)}</span><span className="font-mono text-subtle">#{r.id.slice(0, 8)}</span></span>}
      footer={r && <>
        {r.decision_id && <ExplainButton endpoint={`/assistant/decisions/${r.decision_id}`} label="Explain decision" />}
        <span className="flex-1" />
        {canRevoke && <Button variant="outline" icon={isOwn ? <Undo2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />} onClick={() => openDialog("revoke")}>{revokeLabel}</Button>}
        {reviewer && pending && <>
          <Button variant="outline" icon={<X className="h-3.5 w-3.5" />} onClick={() => openDialog("reject")} className="hover:!text-danger">Reject</Button>
          <Button variant="primary" icon={<Check className="h-3.5 w-3.5" />} onClick={() => openDialog("approve")} disabled={isOwn || engineDenied}
            title={isOwn ? "Separation of duties: you cannot approve your own request" : engineDenied ? "The policy engine denied this request" : undefined}>Approve</Button>
        </>}
      </>}>
      {q.isLoading && <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-32" /><Skeleton className="h-48" /></div>}
      {q.isError && <EmptyState title="Could not load request" description={apiError(q.error).message} />}
      {r && (
        <div className="space-y-5">
          {reviewer && pending && (isOwn || engineDenied) && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2.5 text-xs text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              {isOwn
                ? <span><b className="text-fg">Separation of duties.</b> You cannot approve your own request; another reviewer must decide.</span>
                : <span><b className="text-fg">Engine denied.</b> The Zero Trust engine returned DENY for this request, so it cannot be manually approved. Reject it, or ask the requester to fix the posture issue and resubmit.</span>}
            </div>
          )}

          <div className="flex items-center gap-3 rounded-lg border border-line bg-surface/40 p-3">
            <Avatar name={r.requester.full_name} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-fg">{r.requester.full_name}{isOwn && <span className="ml-1.5 text-2xs text-subtle">(you)</span>}</p>
              <p className="truncate text-xs text-muted">{r.requester.email}</p>
            </div>
            <div className="text-right">
              <p className="label">Risk</p>
              <p className={cn("num font-mono text-sm font-semibold", riskTone(r.requester.risk_score))}>{r.requester.risk_score}</p>
            </div>
          </div>

          <KeyValue items={[
            ["Resource", <Link to={`/resources?id=${r.resource.id}`} className="hover:text-accent">{r.resource.name}</Link>],
            ["Sensitivity", <SensitivityBadge sensitivity={r.resource.sensitivity} />],
            ["Requested duration", durLabel(r.requested_duration_hours)],
            ["Engine decision", r.engine_decision ? <DecisionBadge decision={r.engine_decision} /> : "—"],
            ["Reviewer", r.reviewer?.email ?? (r.status === "pending" ? "Awaiting review" : r.reviewed_at ? "policy-engine" : "—")],
            ["Reviewed", fmtDate(r.reviewed_at)],
            ["Expires", r.status === "approved" ? <span title={fmtDate(r.expires_at)}>{fmtDate(r.expires_at)} · {timeAgo(r.expires_at)}</span> : fmtDate(r.expires_at)],
            ["Revoked", fmtDate(r.revoked_at)],
          ]} />

          <div>
            <SectionLabel>Justification</SectionLabel>
            <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface/40 p-3 text-[13px] leading-relaxed text-fg/90">{r.justification}</p>
          </div>
          {r.review_comment && (
            <div>
              <SectionLabel>Review comment</SectionLabel>
              <p className="rounded-lg border border-line bg-surface/40 p-3 text-xs leading-relaxed text-muted">{r.review_comment}</p>
            </div>
          )}

          {r.decision && (
            <div className="space-y-3">
              <SectionLabel action={<span className="text-2xs text-subtle">evaluated {fmtDate(r.decision.evaluated_at)}</span>}>Engine evaluation</SectionLabel>
              <DecisionSummary result={{ decision: r.decision.decision, reasons: r.decision.reasons, required_actions: [] }} />
              <MatchedPolicies items={r.decision.matched_policies} />
              <Collapsible title="Evaluation trace" meta={`${r.decision.trace.length} steps`}><DecisionTrace trace={r.decision.trace} /></Collapsible>
            </div>
          )}

          <div>
            <SectionLabel>Audit trail</SectionLabel>
            {!r.audit_trail?.length ? <p className="text-xs text-muted">No audit entries.</p> : (
              <ol>
                {r.audit_trail.map((a, i) => (
                  <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < r.audit_trail!.length - 1 && <span className="absolute left-[5px] top-4 h-[calc(100%-8px)] w-px bg-line" />}
                    <span className={cn("relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 bg-card", ACTION_TONE[a.action] ?? "border-line-strong")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="text-xs font-medium text-fg">{titleCase(a.action.replace("access_request.", ""))}</p>
                        <time className="text-2xs text-subtle" title={fmtDate(a.created_at)}>{fmtDate(a.created_at)}</time>
                      </div>
                      <p className="text-2xs text-muted">by {a.actor ?? "system"}{a.outcome === "failure" && <span className="text-danger"> · failed</span>}</p>
                      {detailLine(a.details) && <p className="mt-0.5 text-2xs text-subtle">{detailLine(a.details)}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      <Modal open={dialog === "approve"} onClose={() => setDialog(null)} size="sm" title="Approve access"
        description={r && <>Grant {r.requester.full_name} access to {r.resource.name}. The grant expires automatically.</>}
        footer={<>
          <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="primary" loading={act.isPending} onClick={() => act.mutate({ kind: "approve", body: { comment: comment.trim() || null, duration_hours: hours ? Number(hours) : null } })}>Approve</Button>
        </>}>
        <div className="space-y-4">
          {err && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{err}</p>}
          <Field label="Duration" hint="Capped at the resource's maximum grant.">
            <Select value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Duration override">
              <option value="">As requested ({r ? durLabel(r.requested_duration_hours) : "—"})</option>
              {[1, 4, 8, 24, 72, 168].map((h) => <option key={h} value={h}>{durLabel(h)}</option>)}
            </Select>
          </Field>
          <Field label="Comment (optional)"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} placeholder="Visible to the requester" /></Field>
        </div>
      </Modal>

      <Modal open={dialog === "reject"} onClose={() => setDialog(null)} size="sm" title="Reject request"
        description="The requester is notified with your comment."
        footer={<>
          <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="danger" loading={act.isPending} disabled={comment.trim().length < 5} onClick={() => act.mutate({ kind: "reject", body: { comment: comment.trim() } })}>Reject</Button>
        </>}>
        {err && <p role="alert" className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{err}</p>}
        <Field label="Reason" required hint={<span className="num">{comment.trim().length}/5 characters minimum</span>}
          error={comment.length > 0 && comment.trim().length < 5 ? "At least 5 characters" : undefined}>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} placeholder="Why is this request being rejected?" />
        </Field>
      </Modal>

      <ConfirmDialog open={dialog === "revoke"} onClose={() => setDialog(null)} loading={act.isPending}
        onConfirm={() => act.mutate({ kind: "revoke", body: { comment: comment.trim() || null } })}
        title={isOwn ? "Withdraw request?" : "Revoke access?"} confirmLabel={revokeLabel}
        description={isOwn ? "Your request will be withdrawn and any active grant ends immediately." : "The grant ends immediately and the requester is notified."}>
        {err && <p role="alert" className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{err}</p>}
        <Field label="Comment (optional)"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={2000} /></Field>
      </ConfirmDialog>
    </Drawer>
  );
}
