import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { apiError } from "@/services/api";
import { fmtNum } from "@/utils/format";

export interface VerifyResult { valid: boolean; checked: number; broken_at_id: number | null }

export function VerifyIntegrityModal({ open, onClose, m, onOpenRecord, checkedAt }: {
  open: boolean; onClose: () => void; m: UseMutationResult<VerifyResult, unknown, void>;
  onOpenRecord: (id: number) => void; checkedAt: Date | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Audit trail integrity"
      description="Recomputes the SHA-256 chain over every record, oldest first, and compares each stored hash and previous-hash link."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="secondary" loading={m.isPending} onClick={() => m.mutate()}>Re-run check</Button>
      </>}
    >
      {m.isPending && (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface/60 p-4 text-[13px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-accent" /> Verifying hash chain…
        </div>
      )}
      {m.isError && !m.isPending && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-xs text-danger">{apiError(m.error).message}</div>
      )}
      {m.data && !m.isPending && (m.data.valid ? (
        <div className="flex items-start gap-3 rounded-lg border border-success/25 bg-success/[0.07] p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <div>
            <p className="text-[13px] font-semibold text-fg">Chain intact</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              <span className="num font-medium text-fg">{fmtNum(m.data.checked)}</span> records verified. No record has been altered, removed or re-ordered.
            </p>
          </div>
        </div>
      ) : (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div>
            <p className="text-[13px] font-semibold text-danger">Chain broken</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Verification failed at record <span className="font-mono text-danger">#{m.data.broken_at_id}</span> after{" "}
              <span className="num text-fg">{fmtNum(m.data.checked)}</span> valid records. Treat entries from this point as untrusted and open an incident.
            </p>
            {m.data.broken_at_id !== null && (
              <Button size="xs" variant="outline" className="mt-3" onClick={() => onOpenRecord(m.data!.broken_at_id!)}>Inspect record #{m.data.broken_at_id}</Button>
            )}
          </div>
        </div>
      ))}
      {checkedAt && m.data && !m.isPending && <p className="mt-3 text-2xs text-subtle">Checked at {checkedAt.toLocaleTimeString()}</p>}
    </Modal>
  );
}
