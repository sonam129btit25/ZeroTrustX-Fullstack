import type { ReactNode } from "react";
import { Link2, Lock } from "lucide-react";
import { Drawer } from "@/components/ui/Overlay";
import { DemoTag, SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { ExplainButton } from "@/components/security/Assistant";
import type { AuditLog } from "@/types/api";
import { fmtDate, timeAgo, titleCase } from "@/utils/format";
import { CopyButton, MonoCopy } from "./CopyValue";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-3 py-2 sm:grid-cols-[130px_minmax(0,1fr)]">
      <dt className="label pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words text-[13px] text-fg">{children}</dd>
    </div>
  );
}

export function AuditDetailDrawer({ log, onClose }: { log: AuditLog | null; onClose: () => void }) {
  const json = log ? JSON.stringify(log.details ?? {}, null, 2) : "";
  const hasDetails = !!log && Object.keys(log.details ?? {}).length > 0;
  return (
    <Drawer
      open={!!log}
      onClose={onClose}
      width="max-w-2xl"
      title={log ? <span className="font-mono text-[14px]">{log.action}</span> : ""}
      subtitle={log && (
        <span className="flex flex-wrap items-center gap-2">
          <span className="num">#{log.id}</span>
          <span aria-hidden>·</span>
          <span>{fmtDate(log.created_at, { dateStyle: "medium", timeStyle: "medium" })}</span>
          <span className="text-subtle">({timeAgo(log.created_at)})</span>
          {log.is_demo && <DemoTag />}
        </span>
      )}
      footer={log && <ExplainButton endpoint={`/assistant/audit/${log.id}`} label="Explain this event" title="Audit event explanation" />}
    >
      {log && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={log.severity} />
            <StatusBadge status={log.outcome} />
            <span className="rounded-md border border-line bg-surface/70 px-1.5 py-0.5 text-2xs text-muted">{titleCase(log.category)}</span>
          </div>

          <section>
            <h3 className="label mb-1">Event</h3>
            <dl className="divide-y divide-line/60">
              <Row label="Timestamp"><span className="num">{log.created_at}</span></Row>
              <Row label="Actor">{log.actor_email ?? <span className="text-subtle">System</span>}
                {log.actor_id && <span className="mt-0.5 block font-mono text-2xs text-subtle">{log.actor_id}</span>}
              </Row>
              <Row label="Action"><span className="font-mono">{log.action}</span></Row>
              <Row label="Category">{titleCase(log.category)}</Row>
              <Row label="Target">
                {log.target_type || log.target_label || log.target_id ? (
                  <span>
                    {log.target_type && <span className="mr-1.5 rounded border border-line px-1 font-mono text-2xs text-muted">{log.target_type}</span>}
                    {log.target_label ?? <span className="font-mono text-xs">{log.target_id}</span>}
                    {log.target_label && log.target_id && <span className="mt-0.5 block font-mono text-2xs text-subtle">{log.target_id}</span>}
                  </span>
                ) : <span className="text-subtle">—</span>}
              </Row>
              <Row label="IP address"><span className="font-mono text-xs">{log.ip_address ?? "—"}</span></Row>
              <Row label="User agent"><span className="font-mono text-2xs leading-relaxed text-muted">{log.user_agent ?? "—"}</span></Row>
            </dl>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="label">Details</h3>
              {hasDetails && <CopyButton value={json} label="Copy details JSON" toastTitle="Details copied" />}
            </div>
            {hasDetails ? (
              <pre className="max-h-80 overflow-auto rounded-lg border border-line bg-base/60 p-3 font-mono text-2xs leading-relaxed text-fg/90">{json}</pre>
            ) : (
              <p className="rounded-lg border border-dashed border-line px-3 py-3 text-xs text-subtle">No additional details were recorded for this event.</p>
            )}
          </section>

          <section className="rounded-xl border border-line bg-surface/60 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-accent" />
              <h3 className="text-[13px] font-semibold">Hash chain</h3>
            </div>
            <dl className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="label">SHA-256 hash</dt>
                <dd><MonoCopy value={log.hash} head={14} tail={10} /></dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="label">Previous hash</dt>
                <dd>{log.prev_hash ? <MonoCopy value={log.prev_hash} head={14} tail={10} /> : <span className="text-xs text-subtle">Genesis record</span>}</dd>
              </div>
            </dl>
            <p className="mt-3 flex items-start gap-2 text-2xs leading-relaxed text-subtle">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              Each record's hash covers its canonical contents plus the previous record's hash. Altering any earlier record breaks every hash after it.
            </p>
          </section>
        </div>
      )}
    </Drawer>
  );
}
