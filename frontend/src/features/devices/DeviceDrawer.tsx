import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Ban, CheckCircle2, Clock, Info, Pencil, RotateCcw, ShieldAlert, ShieldQuestion, ShieldX, Trash2 } from "lucide-react";
import { Drawer, ConfirmDialog } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Badge, DecisionBadge, DemoTag, SeverityBadge, TrustBadge } from "@/components/ui/Badge";
import { EmptyState, KeyValue, Skeleton, Tabs } from "@/components/ui/Data";
import { Field, Textarea } from "@/components/ui/Form";
import { RiskMeter } from "@/components/security/Risk";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import type { Device, TrustStatus } from "@/types/api";
import { fmtDate, timeAgo, titleCase } from "@/utils/format";
import { DeviceIcon, type DeviceDetailResponse } from "./meta";
import { DeviceFormModal } from "./DeviceFormModal";

type DrawerTab = "history" | "sessions" | "events" | "decisions";

const TRUST_ACTIONS: { status: TrustStatus; label: string; icon: typeof CheckCircle2; variant: "subtle" | "secondary" | "danger"; confirm: string; desc: string }[] = [
  { status: "trusted", label: "Trust / Approve", icon: CheckCircle2, variant: "subtle", confirm: "Trust device",
    desc: "Marks the device as trusted. Policies that require a trusted device will allow access from it." },
  { status: "untrusted", label: "Mark untrusted", icon: ShieldQuestion, variant: "secondary", confirm: "Mark untrusted",
    desc: "Access from this device will be evaluated as untrusted and may be denied or restricted by policy." },
  { status: "suspicious", label: "Mark suspicious", icon: ShieldAlert, variant: "secondary", confirm: "Mark suspicious",
    desc: "Flags the device for investigation. Policies may require verification or deny access from it." },
  { status: "blocked", label: "Block", icon: Ban, variant: "danger", confirm: "Block device",
    desc: "Blocks the device and immediately terminates every active session that originated from it." },
  { status: "pending_verification", label: "Reset to pending", icon: RotateCcw, variant: "secondary", confirm: "Reset to pending",
    desc: "Returns the device to pending verification. It will need to be approved again." },
];

export function DeviceDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<DrawerTab>("history");
  const [action, setAction] = useState<(typeof TRUST_ACTIONS)[number] | null>(null);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const canWrite = can("devices:write");

  useEffect(() => { setTab("history"); }, [id]);

  const q = useQuery({
    queryKey: ["devices", "detail", id],
    queryFn: async () => (await api.get<DeviceDetailResponse>(`/devices/${id}`)).data,
    enabled: !!id,
    retry: (n, e) => apiError(e).status !== 404 && apiError(e).status !== 422 && n < 2,
  });

  const trust = useMutation({
    mutationFn: async (v: { status: TrustStatus; reason: string }) => (await api.post<Device>(`/devices/${id}/trust`, { status: v.status, reason: v.reason || null })).data,
    onSuccess: (d, v) => {
      toast.success("Trust status updated", `${d.name} is now ${titleCase(v.status === "pending_verification" ? "pending verification" : v.status)}.`);
      void qc.invalidateQueries({ queryKey: ["devices"] });
      if (v.status === "blocked") void qc.invalidateQueries({ queryKey: ["sessions"] });
      setAction(null);
    },
    onError: (e) => toast.error("Could not change trust", apiError(e).message),
  });
  const del = useMutation({
    mutationFn: async () => { await api.delete(`/devices/${id}`); },
    onSuccess: () => {
      toast.success("Device deleted");
      qc.removeQueries({ queryKey: ["devices", "detail", id] });
      void qc.invalidateQueries({ queryKey: ["devices"] });
      setDeleting(false);
      onClose();
    },
    onError: (e) => toast.error("Could not delete device", apiError(e).message),
  });

  const d = q.data?.device;
  const notFound = q.isError && (apiError(q.error).status === 404 || apiError(q.error).status === 422);

  return (
    <>
      <Drawer open={!!id} onClose={onClose} width="max-w-2xl"
        title={d ? <span className="flex items-center gap-2"><DeviceIcon type={d.device_type} className="h-4 w-4 text-muted" />{d.name}</span> : q.isLoading ? "Loading device…" : "Device"}
        subtitle={d ? <span className="flex flex-wrap items-center gap-2"><TrustBadge status={d.trust_status} />{d.is_demo && <DemoTag />}<span className="font-mono text-2xs text-subtle">{d.device_identifier}</span></span> : undefined}
        footer={d && canWrite ? <>
          <Button variant="ghost" className="mr-auto text-danger hover:text-danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleting(true)}>Delete</Button>
          <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>Edit</Button>
        </> : undefined}>
        {q.isLoading && <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-40" /><Skeleton className="h-32" /></div>}
        {q.isError && (
          <EmptyState icon={<ShieldX className="h-5 w-5" />} title={notFound ? "Device not found" : "Could not load device"}
            description={notFound ? "It may have been deleted." : apiError(q.error).message}
            action={notFound ? <Button size="sm" onClick={onClose}>Close</Button> : <Button size="sm" onClick={() => q.refetch()}>Retry</Button>} />
        )}
        {q.data && d && (
          <div className="space-y-5">
            <div className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2.5 text-xs leading-relaxed text-muted" role="note">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span><span className="font-medium text-fg">Posture not verified.</span> {q.data.posture_note}</span>
            </div>

            {canWrite && (
              <div>
                <p className="label mb-2">Trust decision</p>
                <div className="flex flex-wrap gap-2">
                  {TRUST_ACTIONS.filter((a) => a.status !== d.trust_status).map((a) => (
                    <Button key={a.status} size="sm" variant={a.variant} icon={<a.icon className="h-3.5 w-3.5" />} onClick={() => { setReason(""); setAction(a); }}>{a.label}</Button>
                  ))}
                </div>
              </div>
            )}

            <KeyValue items={[
              ["Assigned user", d.user ? <Link to={`/identity/users/${d.user.id}`} className="text-accent hover:underline">{d.user.full_name}</Link> : <span className="text-subtle">Unassigned</span>],
              ["Type", titleCase(d.device_type)],
              ["Operating system", [d.os, d.os_version].filter(Boolean).join(" ") || "Unknown"],
              ["Browser", d.browser ?? "—"],
              ["Last IP", d.ip_address ? <span className="font-mono">{d.ip_address}</span> : "—"],
              ["Last seen", d.last_seen_at ? <span title={fmtDate(d.last_seen_at)}>{timeAgo(d.last_seen_at)}</span> : "Never"],
              ["Risk", <RiskMeter key="r" score={d.risk_score} />],
              ["Registered via", d.registered_via === "manual" ? "Manual registration" : d.registered_via === "login" ? "Browser identifier at sign-in" : titleCase(d.registered_via)],
              ["Approved", d.approved_at ? fmtDate(d.approved_at) : "—"],
              ["Created", fmtDate(d.created_at)],
            ]} />
            {d.notes && <div><p className="label">Notes</p><p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-fg">{d.notes}</p></div>}

            <div>
              <Tabs value={tab} onChange={setTab} className="mb-3" tabs={[
                { value: "history", label: "Trust history", count: q.data.trust_history.length },
                { value: "sessions", label: "Sessions", count: q.data.sessions.length },
                { value: "events", label: "Security events", count: q.data.events.length },
                { value: "decisions", label: "Access decisions", count: q.data.decisions.length },
              ]} />
              {tab === "history" && <TrustHistory items={q.data.trust_history} />}
              {tab === "sessions" && (
                q.data.sessions.length === 0 ? <EmptyState title="No sessions from this device" /> : (
                  <ul className="divide-y divide-line/60 rounded-lg border border-line">
                    {q.data.sessions.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs">
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] text-fg">{s.user}</span>
                          <span className="font-mono text-2xs text-subtle">{s.id.slice(0, 8)} · {s.ip_address ?? "—"}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <Badge tone={s.active ? "success" : "neutral"} dot>{s.active ? "Active" : s.revoked_at ? "Revoked" : "Expired"}</Badge>
                          <span className="text-2xs text-subtle">{timeAgo(s.created_at)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )
              )}
              {tab === "events" && (
                q.data.events.length === 0 ? <EmptyState title="No security events" /> : (
                  <ul className="divide-y divide-line/60 rounded-lg border border-line">
                    {q.data.events.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs">
                        <span className="min-w-0"><span className="block font-mono text-fg">{e.event_type}</span><span className="font-mono text-2xs text-subtle">{e.ip_address ?? "—"}</span></span>
                        <span className="flex shrink-0 items-center gap-2"><SeverityBadge severity={e.severity} /><span className="w-16 text-right text-2xs text-subtle">{timeAgo(e.created_at)}</span></span>
                      </li>
                    ))}
                  </ul>
                )
              )}
              {tab === "decisions" && (
                q.data.decisions.length === 0 ? <EmptyState title="No access decisions" description="No policy evaluations have referenced this device." /> : (
                  <ul className="divide-y divide-line/60 rounded-lg border border-line">
                    {q.data.decisions.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs">
                        <span className="min-w-0 truncate text-[13px] text-fg">{x.resource ?? "Sign-in / session evaluation"}</span>
                        <span className="flex shrink-0 items-center gap-2"><DecisionBadge decision={x.decision} /><span className="w-16 text-right text-2xs text-subtle">{timeAgo(x.evaluated_at)}</span></span>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog open={!!action} onClose={() => setAction(null)} loading={trust.isPending}
        onConfirm={() => action && trust.mutate({ status: action.status, reason: reason.trim() })}
        title={action?.confirm ?? ""} confirmLabel={action?.confirm} tone={action?.status === "blocked" ? "danger" : "primary"}
        description={action && d ? <><span className="text-fg">{d.name}</span> — {action.desc}</> : undefined}>
        <Field label="Reason (optional, recorded in trust history)">
          <Textarea maxLength={500} className="min-h-[72px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Verified with the user over a call" />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} loading={del.isPending} onConfirm={() => del.mutate()}
        title="Delete device" confirmLabel="Delete device"
        description={d ? <>Permanently removes <span className="text-fg">{d.name}</span> and its trust history. If the browser signs in again it will re-register as pending verification.</> : undefined} />
      {d && <DeviceFormModal open={editing} onClose={() => setEditing(false)} device={d} />}
    </>
  );
}

function TrustHistory({ items }: { items: DeviceDetailResponse["trust_history"] }) {
  if (!items.length) return <EmptyState title="No trust changes recorded" />;
  return (
    <ol className="relative space-y-0">
      {items.map((h, i) => (
        <motion.li key={h.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.2) }} className="relative flex gap-3 pb-4">
          {i < items.length - 1 && <span aria-hidden className="absolute bottom-0 left-[11px] top-7 w-px bg-line" />}
          <span className="relative z-[1] mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-elevated text-subtle"><Clock className="h-3 w-3" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {h.from_status ? <TrustBadge status={h.from_status} /> : <Badge>New</Badge>}
              <ArrowRight className="h-3 w-3 text-subtle" />
              <TrustBadge status={h.to_status} />
            </div>
            <p className="mt-1 text-xs text-muted"><span className="text-fg">{h.changed_by}</span> · <span title={fmtDate(h.created_at)}>{timeAgo(h.created_at)}</span></p>
            {h.reason && <p className="mt-1 text-xs leading-relaxed text-muted">“{h.reason}”</p>}
          </div>
        </motion.li>
      ))}
    </ol>
  );
}
