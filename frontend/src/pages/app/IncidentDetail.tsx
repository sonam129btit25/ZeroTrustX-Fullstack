import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, CheckCircle2, ClipboardCheck, FileSearch, History, Link2, Lock, Sparkles, UserMinus } from "lucide-react";
import { Avatar, Card, CardHeader, PageHeader } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Form";
import { ConfirmDialog, Modal } from "@/components/ui/Overlay";
import { DemoTag, SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/Data";
import { ExplainButton } from "@/components/security/Assistant";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import { fmtDate, timeAgo } from "@/utils/format";
import { SEVERITIES, SEVERITY_LABEL, UUID_RE } from "@/features/threats/shared";
import { StatusStepper } from "@/features/incidents/StatusStepper";
import { NotesTimeline } from "@/features/incidents/NotesTimeline";
import { STATUS_LABEL, TRANSITIONS, transitionLabel, useAssignees, type IncidentStatus } from "@/features/incidents/shared";
import type { Incident, Severity } from "@/types/api";

type Patch = { status?: IncidentStatus; resolution_summary?: string; assignee_id?: string; unassign?: boolean; severity?: Severity };

export default function IncidentDetail() {
  const { id = "" } = useParams();
  const { can, user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const canWrite = can("incidents:write");
  const validId = UUID_RE.test(id);

  const q = useQuery({
    queryKey: ["incidents", id],
    queryFn: async () => (await api.get<Incident>(`/incidents/${id}`)).data,
    enabled: validId,
    retry: (n, e) => ![404, 422].includes(apiError(e).status ?? 0) && n < 2,
  });
  const inc = q.data;
  const assignees = useAssignees(canWrite);

  const [resolving, setResolving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<IncidentStatus | null>(null);

  const patch = useMutation({
    mutationFn: async (body: Patch) => (await api.patch<Incident>(`/incidents/${id}`, body)).data,
    onSuccess: (data, body) => {
      qc.setQueryData(["incidents", id], data);
      qc.invalidateQueries({ queryKey: ["incidents"] });
      if (body.status === "resolved") qc.invalidateQueries({ queryKey: ["threats"] });
      if (body.status) toast.success(`${data.reference} moved to ${STATUS_LABEL[data.status]}`);
      else if (body.unassign) toast.success("Investigator unassigned");
      else if (body.assignee_id) toast.success(`Assigned to ${data.assignee?.full_name ?? "investigator"}`, data.status === "investigating" && inc?.status === "open" ? "Status moved to Investigating." : undefined);
      else if (body.severity) toast.success(`Severity set to ${SEVERITY_LABEL[data.severity]}`);
      setResolving(false); setClosing(false); setUnassigning(false);
    },
    onError: (e) => toast.error("Update failed", apiError(e).message),
    onSettled: () => setPendingTarget(null),
  });

  const transition = (to: IncidentStatus) => {
    if (to === "resolved") return setResolving(true);
    if (to === "closed") return setClosing(true);
    setPendingTarget(to);
    patch.mutate({ status: to });
  };

  const notFound = !validId || (q.isError && [404, 422].includes(apiError(q.error).status ?? 0));
  if (notFound) {
    return (
      <div>
        <PageHeader title="Incident not found" breadcrumbs={[{ label: "Incidents", to: "/incidents" }, { label: "Not found" }]} />
        <Card>
          <EmptyState icon={<FileSearch className="h-5 w-5" />} title="This incident does not exist"
            description="It may have been removed, or the link is incorrect."
            action={<Button size="sm" icon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => nav("/incidents")}>Back to incidents</Button>} />
        </Card>
      </div>
    );
  }
  if (q.isError) {
    return (
      <div>
        <PageHeader title="Incident" breadcrumbs={[{ label: "Incidents", to: "/incidents" }, { label: "Error" }]} />
        <Card><EmptyState title="Could not load incident" description={apiError(q.error).message}
          action={<Button size="sm" onClick={() => q.refetch()}>Retry</Button>} /></Card>
      </div>
    );
  }
  if (!inc) return <DetailSkeleton />;

  const allowed = TRANSITIONS[inc.status];
  const forward = allowed.filter((s) => ["investigating", "contained", "resolved", "closed"].indexOf(s) >= ["investigating", "contained", "resolved", "closed"].indexOf(inc.status));
  const ordered = [...allowed].sort((a, b) => (forward.includes(b) ? 1 : 0) - (forward.includes(a) ? 1 : 0));
  const primaryNext = ordered[0];
  const alerts = inc.alerts ?? [];

  return (
    <div>
      <PageHeader
        title={inc.title}
        breadcrumbs={[{ label: "Incidents", to: "/incidents" }, { label: inc.reference }]}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
            <span className="rounded-md border border-line bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-fg">{inc.reference}</span>
            <SeverityBadge severity={inc.severity} />
            <StatusBadge status={inc.status} />
            {inc.is_demo && <DemoTag />}
            <span className="text-subtle">
              Opened {inc.created_by ? <>by <span className="text-muted">{inc.created_by.email}</span> </> : ""}
              <span title={fmtDate(inc.created_at, { dateStyle: "full", timeStyle: "long" })}>{timeAgo(inc.created_at)}</span>
            </span>
            <span className="flex items-center gap-1.5 text-subtle">
              · {inc.assignee ? <><Avatar name={inc.assignee.full_name} size={16} /><span className="text-muted">{inc.assignee.full_name}</span></> : <span className="italic">Unassigned</span>}
            </span>
          </span>
        }
      />

      <Card className="mb-4">
        <CardHeader title="Workflow" description={`Current state: ${STATUS_LABEL[inc.status]}${inc.status === "resolved" && inc.resolved_at ? ` · resolved ${timeAgo(inc.resolved_at)}` : ""}${inc.status === "closed" && inc.closed_at ? ` · closed ${timeAgo(inc.closed_at)}` : ""}`} />
        <div className="px-3 pb-2 pt-5 sm:px-5">
          <StatusStepper status={inc.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line/70 px-5 py-3">
          {canWrite ? (
            <>
              <span className="mr-1 text-xs text-subtle">Move to</span>
              {ordered.map((s) => (
                <Button key={s} size="sm" variant={s === primaryNext ? "primary" : s === "closed" ? "outline" : "secondary"}
                  loading={pendingTarget === s && patch.isPending} disabled={patch.isPending}
                  icon={s === "resolved" ? <CheckCircle2 className="h-3.5 w-3.5" /> : s === "closed" ? <Lock className="h-3.5 w-3.5" /> : undefined}
                  onClick={() => transition(s)}>
                  {transitionLabel(inc.status, s)}
                </Button>
              ))}
            </>
          ) : (
            <p className="text-xs text-subtle">You have read-only access to this incident.</p>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Description" />
            <div className="px-5 py-4">
              {inc.description ? <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg">{inc.description}</p>
                : <p className="text-xs italic text-subtle">No description provided.</p>}
            </div>
          </Card>

          {inc.resolution_summary && (
            <Card className="border-success/25">
              <CardHeader title={<span className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-success" />Resolution summary</span>}
                description={inc.resolved_at ? `Resolved ${fmtDate(inc.resolved_at)}` : undefined}
                actions={canWrite && inc.status === "resolved" ? <Button size="xs" variant="ghost" onClick={() => setResolving(true)}>Edit</Button> : undefined} />
              <p className="whitespace-pre-wrap break-words px-5 py-4 text-[13px] leading-relaxed text-fg">{inc.resolution_summary}</p>
            </Card>
          )}

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><History className="h-4 w-4 text-muted" />Investigation timeline</span>}
              description="Analyst notes, status changes and assignments, in one audit-backed record" />
            <NotesTimeline incident={inc} canWrite={canWrite} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Ownership & severity" />
            <div className="space-y-4 px-5 py-4">
              <Field label="Investigator">
                {canWrite ? (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Select value={inc.assignee?.id ?? ""} disabled={patch.isPending || assignees.isLoading} aria-label="Investigator"
                        onChange={(e) => e.target.value && patch.mutate({ assignee_id: e.target.value })}>
                        {!inc.assignee && <option value="">Unassigned. Select investigator</option>}
                        {inc.assignee && !assignees.data?.some((a) => a.id === inc.assignee!.id) && <option value={inc.assignee.id}>{inc.assignee.full_name}</option>}
                        {assignees.data?.map((a) => <option key={a.id} value={a.id}>{a.full_name}{a.id === user?.id ? " (you)" : ""}</option>)}
                      </Select>
                    </div>
                    {inc.assignee && (
                      <Button size="icon" variant="ghost" aria-label="Unassign investigator" title="Unassign" onClick={() => setUnassigning(true)}>
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-[13px]">
                    {inc.assignee ? <><Avatar name={inc.assignee.full_name} size={22} />{inc.assignee.full_name}</> : <span className="italic text-subtle">Unassigned</span>}
                  </p>
                )}
              </Field>
              {canWrite && !inc.assignee && user && assignees.data?.some((a) => a.id === user.id) && (
                <Button size="xs" variant="subtle" className="-mt-2" disabled={patch.isPending} onClick={() => patch.mutate({ assignee_id: user.id })}>Assign to me</Button>
              )}
              {assignees.isError && <p className="text-xs text-danger">Could not load investigators.</p>}
              <Field label="Severity">
                {canWrite ? (
                  <Select value={inc.severity} disabled={patch.isPending} aria-label="Severity"
                    onChange={(e) => patch.mutate({ severity: e.target.value as Severity })}>
                    {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
                  </Select>
                ) : <SeverityBadge severity={inc.severity} />}
              </Field>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line/70 pt-4 text-xs">
                <Meta label="Opened" iso={inc.created_at} />
                <Meta label="Last updated" iso={inc.updated_at} />
                {inc.resolved_at && <Meta label="Resolved" iso={inc.resolved_at} />}
                {inc.closed_at && <Meta label="Closed" iso={inc.closed_at} />}
              </dl>
            </div>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Link2 className="h-4 w-4 text-muted" />Linked alerts</span>}
              description={alerts.length ? `${alerts.length} detection${alerts.length === 1 ? "" : "s"} attached` : undefined} />
            {alerts.length === 0 ? (
              <p className="px-5 py-6 text-center text-xs text-muted">No alerts linked. Escalate an alert from <Link to="/threats" className="text-accent hover:underline">Threat Detection</Link> to attach evidence.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {alerts.map((a) => (
                  <li key={a.id}>
                    <Link to={`/threats?alert=${a.id}`} className="group block px-5 py-3 transition-colors hover:bg-elevated/50" data-cursor="hover">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2"><SeverityBadge severity={a.severity} /><StatusBadge status={a.status} /></div>
                          <p className="mt-1.5 truncate text-[13px] font-medium text-fg">{a.title}</p>
                          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                            {a.user && <span className="truncate">{a.user.email}</span>}
                            {a.ip_address && <span className="font-mono">{a.ip_address}</span>}
                            <span className="text-subtle">{timeAgo(a.detected_at)}</span>
                          </p>
                        </div>
                        <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-subtle transition-colors group-hover:text-accent" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {can("assistant:use") && (
            <Card>
              <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-lavender" />Assistant briefing</span>}
                actions={<ExplainButton endpoint={`/assistant/incidents/${id}`} label="Summarize" title="Incident briefing" />} />
              <p className="px-5 py-3.5 text-xs leading-relaxed text-muted">
                Generates an advisory summary from this incident's record, notes and linked alerts. It is deterministic and
                does not change the incident.
              </p>
            </Card>
          )}
        </div>
      </div>

      <ResolveModal open={resolving} initial={inc.resolution_summary ?? ""} loading={patch.isPending}
        editOnly={inc.status === "resolved"}
        onClose={() => setResolving(false)}
        onSubmit={(summary) => patch.mutate(inc.status === "resolved" ? { resolution_summary: summary } : { status: "resolved", resolution_summary: summary })} />
      <ConfirmDialog open={closing} onClose={() => setClosing(false)} tone="primary" loading={patch.isPending}
        title={`Close ${inc.reference}?`} confirmLabel="Close incident"
        description="Closing marks the investigation and post-incident review as complete. It can be reopened for investigation later if new evidence appears."
        onConfirm={() => patch.mutate({ status: "closed" })} />
      <ConfirmDialog open={unassigning} onClose={() => setUnassigning(false)} tone="primary" loading={patch.isPending}
        title="Unassign investigator?" confirmLabel="Unassign"
        description={`${inc.assignee?.full_name ?? "The investigator"} will no longer own ${inc.reference}. The incident status is not changed.`}
        onConfirm={() => patch.mutate({ unassign: true })} />
    </div>
  );
}

function Meta({ label, iso }: { label: string; iso: string }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className="mt-1 text-fg" title={fmtDate(iso, { dateStyle: "full", timeStyle: "long" })}>{timeAgo(iso)}</dd>
    </div>
  );
}

function ResolveModal({ open, initial, loading, editOnly, onClose, onSubmit }: {
  open: boolean; initial: string; loading: boolean; editOnly: boolean; onClose: () => void; onSubmit: (s: string) => void;
}) {
  const [text, setText] = useState(initial);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setText(initial); setTouched(false); } }, [open, initial]);
  const tooShort = text.trim().length < 10;
  const submit = () => { setTouched(true); if (!tooShort) onSubmit(text.trim()); };
  return (
    <Modal open={open} onClose={onClose} size="md"
      title={<span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" />{editOnly ? "Edit resolution summary" : "Resolve incident"}</span>}
      description={editOnly ? undefined : "Document the root cause and remediation. Linked alerts are marked resolved at the same time."}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={loading} onClick={submit}>{editOnly ? "Save summary" : "Resolve incident"}</Button>
      </>}>
      <Field label="Resolution summary" required error={touched && tooShort ? "Describe the resolution in at least 10 characters" : undefined}
        hint={<span className="num">{text.length.toLocaleString()} / 5,000</span>}>
        <Textarea value={text} rows={6} maxLength={5000} data-autofocus invalid={touched && tooShort}
          placeholder="Root cause, actions taken (password reset, session revocation, device blocked…), and follow-ups."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); }} />
      </Field>
    </Modal>
  );
}

function DetailSkeleton() {
  return (
    <div>
      <Skeleton className="mb-3 h-3 w-40" />
      <Skeleton className="mb-2 h-7 w-2/3" />
      <Skeleton className="mb-6 h-4 w-1/2" />
      <Skeleton className="mb-4 h-36 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2"><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>
        <div className="space-y-4"><Skeleton className="h-56 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
      </div>
    </div>
  );
}
