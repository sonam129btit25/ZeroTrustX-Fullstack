import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { Field, Textarea } from "@/components/ui/Form";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import type { SessionRow } from "@/types/api";

export interface TerminateTarget { id: string; email: string; ip?: string | null }

/** Confirm + reason dialog that terminates a session (POST /sessions/{id}/terminate). */
export function TerminateSessionDialog({ target, onClose, onDone }: { target: TerminateTarget | null; onClose: () => void; onDone?: (s: SessionRow) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState("");
  useEffect(() => { if (target) setReason(""); }, [target]);

  const m = useMutation({
    mutationFn: async (t: TerminateTarget) => (await api.post<SessionRow>(`/sessions/${t.id}/terminate`, { reason: reason.trim() || null })).data,
    onSuccess: (s) => {
      toast.success("Session terminated", `${s.user.email} must re-authenticate on that device.`);
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      void qc.invalidateQueries({ queryKey: ["users"] });
      onDone?.(s);
      onClose();
    },
    onError: (e) => toast.error("Could not terminate session", apiError(e).message),
  });

  return (
    <ConfirmDialog open={!!target} onClose={onClose} onConfirm={() => target && m.mutate(target)} loading={m.isPending}
      title="Terminate session" confirmLabel="Terminate session"
      description={target ? <>The session for <span className="text-fg">{target.email}</span>{target.ip ? <> from <span className="font-mono">{target.ip}</span></> : null} is revoked immediately and its refresh token invalidated.</> : undefined}>
      <Field label="Reason (recorded in the audit log)">
        <Textarea maxLength={255} placeholder="e.g. Suspicious concurrent login from a new location" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[72px]" />
      </Field>
    </ConfirmDialog>
  );
}
