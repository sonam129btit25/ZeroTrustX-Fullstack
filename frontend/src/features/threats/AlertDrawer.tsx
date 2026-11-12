import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowUpRight, CheckCircle2, CircleDot, Copy, FileSearch, Lightbulb, RotateCcw, Search, Siren, XCircle,
} from "lucide-react";
import { Drawer, Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Badge, DemoTag, SeverityBadge, StatusBadge, TrustBadge } from "@/components/ui/Badge";
import { EmptyState, KeyValue, Skeleton } from "@/components/ui/Data";
import { RiskMeter } from "@/components/security/Risk";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import { cn, fmtDate, timeAgo, titleCase } from "@/utils/format";
import { useAssignees } from "@/features/incidents/shared";
import { SEVERITY_FILL, type AlertStatus } from "@/features/threats/shared";
import type { Incident, ThreatAlert } from "@/types/api";

const STATUS_ACTION: Record<AlertStatus, { label: string; title: string; description: string; icon: typeof Search; confirm: string }> = {
  investigating: {
    label: "Investigate", title: "Mark alert as investigating", icon: Search, confirm: "Start investigating",
    description: "Signals to other analysts that this alert is being worked on.",
  },
  resolved: {
    label: "Resolve", title: "Resolve alert", icon: CheckCircle2, confirm: "Resolve alert",
    description: "Confirms the activity was handled. The affected user's risk score is recomputed.",
  },
  dismissed: {
    label: "Dismiss", title: "Dismiss alert", icon: XCircle, confirm: "Dismiss alert",
    description: "Marks the detection as a false positive or accepted activity. The user's risk score is recomputed.",
  },
  open: {
    label: "Reopen", title: "Reopen alert", icon: RotateCcw, confirm: "Reopen alert",
    description: "Returns the alert to the open queue.",
  },
};

export function AlertDrawer({ alertId, onClose }: { alertId: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [statusTarget, setStatusTarget] = useState<AlertStatus | null>(null);
  const [escalating, setEscalating] = useState(false);

  const q = useQuery({
    queryKey: ["threats", "detail", alertId],
    queryFn: async () => (await api.get<ThreatAlert>(`/threats/${alertId}`)).data,
    enabled: !!alertId,
    retry: (n, e) => apiError(e).status !== 404 && apiError(e).status !== 422 && n < 2,
  });
  const a = q.data;

  const incident = useQuery({
    queryKey: ["incidents", a?.incident_id],
    queryFn: async () => (await api.get<Incident>(`/incidents/${a!.incident_id}`)).data,
    enabled: !!a?.incident_id && can("incidents:read"),
  });

  useEffect(() => { setStatusTarget(null); setEscalating(false); }, [alertId]);

  const canWrite = can("threats:write");
  const actions: AlertStatus[] = a
    ? a.status === "resolved" || a.status === "dismissed"
      ? ["open"]
      : (["investigating", "resolved", "dismissed"] as AlertStatus[]).filter((s) => s !== a.status)
    : [];

  const notFound = q.isError && [404, 422].includes(apiError(q.error).status ?? 0);

  return (
    <>
      <Drawer
        open={!!alertId}
        onClose={() => { if (!statusTarget && !escalating) onClose(); }}
        width="max-w-2xl"
        title={a ? a.title : q.isError ? "Alert unavailable" : "Loading alert…"}
        subtitle={a && (
          <span className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={a.severity} />
            <StatusBadge status={a.status} />
            <Badge>{a.category}</Badge>
            {a.is_demo && <DemoTag />}
          </span>
        )}
        footer={a && (canWrite || (can("incidents:write") && !a.incident_id)) ? (
          <>
            {canWrite && actions.map((s) => {
              const cfg = STATUS_ACTION[s];
              const Icon = cfg.icon;
              return (
                <Button key={s} size="sm" variant={s === "dismissed" ? "ghost" : "outline"} icon={<Icon className="h-3.5 w-3.5" />}
                  onClick={() => setStatusTarget(s)}>{cfg.label}</Button>
              );
            })}
            {can("incidents:write") && !a.incident_id && (
              <Button size="sm" variant="primary" icon={<Siren className="h-3.5 w-3.5" />} onClick={() => setEscalating(true)}>
                Escalate to incident
              </Button>
            )}
          </>
        ) : undefined}
      >
        {q.isLoading && <DrawerSkeleton />}
        {q.isError && (
          <EmptyState icon={<FileSearch className="h-5 w-5" />}
            title={notFound ? "Alert not found" : "Could not load alert"}
            description={notFound ? "It may have been removed, or the link is incorrect." : apiError(q.error).message}
            action={notFound ? <Button size="sm" onClick={onClose}>Back to alerts</Button> : <Button size="sm" onClick={() => q.refetch()}>Retry</Button>} />
        )}
        {a && (
          <div className="space-y-6">
            <p className="text-[13px] leading-relaxed text-fg">{a.description}</p>

            {a.incident_id && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-lavender/25 bg-lavender/[0.06] px-3.5 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Siren className="h-4 w-4 shrink-0 text-lavender" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-fg">Linked to incident {incident.data && <span className="font-mono">{incident.data.reference}</span>}</p>
                    {incident.data && <p className="truncate text-xs text-muted">{incident.data.title} · {titleCase(incident.data.status)}</p>}
                  </div>
                </div>
                <Link to={`/incidents/${a.incident_id}`} onClick={onClose}
                  className="inline-flex items-center gap-1 text-xs font-medium text-lavender hover:underline">
                  Open incident <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}

            <KeyValue items={[
              ["Rule", <span className="font-mono text-xs">{a.rule_key}</span>],
              ["Category", a.category],
              ["Severity", <SeverityBadge severity={a.severity} />],
              ["Alert risk", <RiskMeter score={a.risk_score} />],
              ["Source IP", a.ip_address ? <span className="font-mono text-xs">{a.ip_address}</span> : "—"],
              ["Detected", <span title={fmtDate(a.detected_at, { dateStyle: "full", timeStyle: "long" })}>{fmtDate(a.detected_at)} · <span className="text-muted">{timeAgo(a.detected_at)}</span></span>],
              ["User", a.user ? (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{a.user.full_name}</span>
                  <span className="truncate text-xs text-muted">{a.user.email}</span>
                </span>
              ) : "No user attributed"],
              ["User risk", a.user ? <RiskMeter score={a.user.risk_score} /> : "—"],
              ["Device", a.device ? <span className="flex min-w-0 items-center gap-2"><span className="truncate">{a.device.name}</span><TrustBadge status={a.device.trust_status} /></span> : "No device attributed"],
              ["Last updated", timeAgo(a.updated_at)],
            ]} />

            <div className="flex gap-3 rounded-lg border border-accent/25 bg-accent/[0.06] px-3.5 py-3">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div>
                <p className="label text-accent">Recommended action</p>
                <p className="mt-1 text-[13px] leading-relaxed text-fg">{a.recommended_action}</p>
              </div>
            </div>

            <EvidenceBlock evidence={a.evidence} />

            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-[13px] font-semibold">Related security events</h3>
                <span className="text-xs text-subtle">Same user · from 6h before detection</span>
              </div>
              {!a.related_events?.length ? (
                <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
                  {a.user ? "No related events were recorded in this window." : "Related events are correlated by user; this alert has none attributed."}
                </p>
              ) : (
                <ol className="relative space-y-0.5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line">
                  {a.related_events.map((e, i) => (
                    <motion.li key={e.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}
                      className="relative flex items-start gap-3 py-1.5 pl-6">
                      <span className={cn("absolute left-0 top-[11px] h-[11px] w-[11px] rounded-full border-2 border-surface", SEVERITY_FILL[e.severity] ?? "bg-subtle")} />
                      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                        <span className="font-mono text-xs text-fg">{e.event_type}</span>
                        <span className="flex items-center gap-3 text-xs text-muted">
                          {e.ip_address && <span className="font-mono">{e.ip_address}</span>}
                          <span title={fmtDate(e.created_at, { dateStyle: "medium", timeStyle: "medium" })}>{timeAgo(e.created_at)}</span>
                        </span>
                      </div>
                    </motion.li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </Drawer>

      {a && statusTarget && (
        <StatusModal alert={a} target={statusTarget} onClose={() => setStatusTarget(null)}
          onDone={(updated) => {
            qc.setQueryData(["threats", "detail", a.id], (old: ThreatAlert | undefined) => old ? { ...old, ...updated } : old);
            qc.invalidateQueries({ queryKey: ["threats"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            toast.success(`Alert ${updated.status === "open" ? "reopened" : `marked ${updated.status}`}`, a.title);
            setStatusTarget(null);
          }} />
      )}
      {a && <EscalateModal alert={a} open={escalating} onClose={() => setEscalating(false)} onNavigate={onClose} />}
    </>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-4 w-11/12" />
      <div className="grid grid-cols-2 gap-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
      <Skeleton className="h-16" />
      <Skeleton className="h-32" />
    </div>
  );
}

function EvidenceBlock({ evidence }: { evidence: Record<string, unknown> }) {
  const toast = useToast();
  const json = JSON.stringify(evidence ?? {}, null, 2);
  const note = typeof evidence?.analyst_note === "string" ? evidence.analyst_note : null;
  return (
    <section className="space-y-3">
      {note && (
        <div className="rounded-lg border border-line bg-elevated/50 px-3.5 py-3">
          <p className="label">Latest analyst note</p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-fg">{note}</p>
        </div>
      )}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Evidence</h3>
          <Button size="xs" variant="ghost" icon={<Copy className="h-3 w-3" />}
            onClick={() => navigator.clipboard?.writeText(json).then(() => toast.info("Evidence copied"), () => toast.error("Clipboard unavailable"))}>
            Copy JSON
          </Button>
        </div>
        <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-base/60 p-3 font-mono text-[11.5px] leading-relaxed text-muted">{json}</pre>
      </div>
    </section>
  );
}

function StatusModal({ alert, target, onClose, onDone }: {
  alert: ThreatAlert; target: AlertStatus; onClose: () => void; onDone: (a: ThreatAlert) => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const cfg = STATUS_ACTION[target];
  const m = useMutation({
    mutationFn: async () => (await api.patch<ThreatAlert>(`/threats/${alert.id}`, { status: target, note: note.trim() || null })).data,
    onSuccess: onDone,
    onError: (e) => toast.error("Could not update alert", apiError(e).message),
  });
  return (
    <Modal open onClose={onClose} size="sm" title={cfg.title} description={cfg.description}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={target === "dismissed" ? "secondary" : "primary"} loading={m.isPending} onClick={() => m.mutate()}>{cfg.confirm}</Button>
      </>}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-elevated/40 px-3 py-2 text-xs">
          <SeverityBadge severity={alert.severity} />
          <span className="truncate text-fg">{alert.title}</span>
        </div>
        <Field label="Analyst note" hint={<span className="flex justify-between"><span>Optional. Stored with the alert evidence and in the audit log.</span><span className="num">{note.length}/1000</span></span>}>
          <Textarea value={note} maxLength={1000} rows={4} data-autofocus placeholder="What did you verify? Why this outcome?"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) m.mutate(); }} />
        </Field>
      </div>
    </Modal>
  );
}

function EscalateModal({ alert, open, onClose, onNavigate }: { alert: ThreatAlert; open: boolean; onClose: () => void; onNavigate: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const assignees = useAssignees(open);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setAssignee(assignees.data?.some((x) => x.id === user?.id) ? user!.id : "");
  }, [open, assignees.data, user]);

  const m = useMutation({
    mutationFn: async () => (await api.post<Incident>(`/threats/${alert.id}/escalate`, {
      title: title.trim() || null, assignee_id: assignee || null,
    })).data,
    onSuccess: (inc) => {
      qc.invalidateQueries({ queryKey: ["threats"] });
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Escalated to ${inc.reference}`, inc.assignee ? `Assigned to ${inc.assignee.full_name}` : "Incident is open and unassigned");
      onClose();
      onNavigate();
      nav(`/incidents/${inc.id}`);
    },
    onError: (e) => toast.error("Escalation failed", apiError(e).message),
  });

  const titleTooShort = title.trim().length > 0 && title.trim().length < 5;

  return (
    <Modal open={open} onClose={onClose} size="md"
      title={<span className="flex items-center gap-2"><Siren className="h-4 w-4 text-accent" />Escalate to incident</span>}
      description="Opens a new incident with this alert linked. The alert moves to Investigating and inherits the incident's lifecycle."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={m.isPending} disabled={titleTooShort} onClick={() => m.mutate()}>Create incident</Button>
      </>}>
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-elevated/40 px-3 py-2.5">
          <div className="flex items-center gap-2"><SeverityBadge severity={alert.severity} /><span className="truncate text-[13px] text-fg">{alert.title}</span></div>
          <p className="mt-1 line-clamp-2 text-xs text-muted">{alert.description}</p>
        </div>
        <Field label="Incident title" error={titleTooShort ? "Title must be at least 5 characters" : undefined}
          hint="Optional. Defaults to the alert title.">
          <Input value={title} maxLength={200} placeholder={alert.title} invalid={titleTooShort} data-autofocus onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Investigator" hint={assignee ? "The incident starts in Investigating." : "Unassigned incidents start in Open."}>
          <Select value={assignee} disabled={assignees.isLoading} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {assignees.data?.map((x) => <option key={x.id} value={x.id}>{x.full_name}{x.id === user?.id ? " (you)" : ""}</option>)}
          </Select>
        </Field>
        {assignees.isError && <p className="text-xs text-danger">Could not load investigators: {apiError(assignees.error).message}</p>}
        <p className="flex items-center gap-1.5 text-xs text-subtle"><CircleDot className="h-3 w-3" />Severity is inherited from the alert ({titleCase(alert.severity)}).</p>
      </div>
    </Modal>
  );
}
