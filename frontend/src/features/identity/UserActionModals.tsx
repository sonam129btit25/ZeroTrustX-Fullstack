import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { ConfirmDialog, Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/Form";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import type { UserSummary } from "@/types/api";
import { useRoles } from "./hooks";
import { RoleChecklist } from "./CreateUserModal";
import type { ResetAccessResult } from "./types";

function useInvalidateUser() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["users"] });
    void qc.invalidateQueries({ queryKey: ["sessions"] });
  };
}

const opt = (s?: string) => (s && s.trim() ? s.trim() : null);

/* ------------------------------------------------------------------ edit profile */
const profileSchema = z.object({
  full_name: z.string().trim().min(2, "At least 2 characters").max(150),
  department: z.string().trim().max(100).optional(),
  job_title: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(40).optional(),
});
type ProfileValues = z.infer<typeof profileSchema>;

export function EditProfileModal({ user, open, onClose }: { user: UserSummary; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateUser();
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema) });
  useEffect(() => {
    if (open) reset({ full_name: user.full_name, department: user.department ?? "", job_title: user.job_title ?? "", phone: user.phone ?? "" });
  }, [open, user, reset]);
  const m = useMutation({
    mutationFn: async (f: ProfileValues) => (await api.patch<UserSummary>(`/users/${user.id}`, {
      full_name: f.full_name.trim(), department: opt(f.department), job_title: opt(f.job_title), phone: opt(f.phone),
    })).data,
    onSuccess: () => { toast.success("Profile updated"); invalidate(); onClose(); },
    onError: (e) => toast.error("Could not update profile", apiError(e).message),
  });
  return (
    <Modal open={open} onClose={onClose} title="Edit profile" description={user.email}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="edit-profile" loading={m.isPending} disabled={!isDirty}>Save changes</Button></>}>
      <form id="edit-profile" className="space-y-4" noValidate onSubmit={handleSubmit((f) => m.mutate(f))}>
        <Field label="Full name" required error={errors.full_name?.message}><Input invalid={!!errors.full_name} {...register("full_name")} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" error={errors.department?.message}><Input {...register("department")} /></Field>
          <Field label="Job title" error={errors.job_title?.message}><Input {...register("job_title")} /></Field>
        </div>
        <Field label="Phone" error={errors.phone?.message}><Input {...register("phone")} /></Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ change roles */
export function ChangeRolesModal({ user, open, onClose }: { user: UserSummary; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateUser();
  const roles = useRoles(open);
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => { if (open) setSel(user.roles.map((r) => r.id)); }, [open, user]);
  const changed = sel.length !== user.roles.length || sel.some((id) => !user.roles.find((r) => r.id === id));
  const m = useMutation({
    mutationFn: async () => (await api.put<UserSummary>(`/users/${user.id}/roles`, { role_ids: sel })).data,
    onSuccess: (u) => { toast.success("Roles updated", `${u.full_name}'s sessions were revoked; they must sign in again.`); invalidate(); onClose(); },
    onError: (e) => toast.error("Could not change roles", apiError(e).message),
  });
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 5 ? s : [...s, id]));
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Change roles" description={`${user.full_name} · ${user.email}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={m.isPending} disabled={!changed || sel.length === 0} onClick={() => m.mutate()}>Apply roles</Button>
      </>}>
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-warning">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Changing roles revokes all of this user's active sessions so the new privileges take effect on next sign-in. You can only assign roles below your own privilege level.</span>
      </div>
      <RoleChecklist roles={roles.data} loading={roles.isLoading} error={roles.isError ? apiError(roles.error).message : null} selected={sel} onToggle={toggle} />
      {sel.length === 0 && <p className="mt-3 text-xs text-danger">Select at least one role.</p>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ status changes */
export type StatusAction = "suspend" | "deactivate" | "activate";
const STATUS_COPY: Record<StatusAction, { title: string; confirm: string; desc: string; done: string; tone: "danger" | "primary" }> = {
  suspend: { title: "Suspend user", confirm: "Suspend", tone: "danger", done: "User suspended",
    desc: "The user is blocked from signing in and every active session is revoked immediately. You can reactivate them later." },
  deactivate: { title: "Deactivate user", confirm: "Deactivate", tone: "danger", done: "User deactivated",
    desc: "Use for offboarding. The account can no longer sign in and every active session is revoked." },
  activate: { title: "Activate user", confirm: "Activate", tone: "primary", done: "User activated",
    desc: "Restores sign-in. Failed-login counters and any lockout are cleared." },
};

export function StatusChangeDialog({ user, action, onClose }: { user: UserSummary; action: StatusAction | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateUser();
  const [reason, setReason] = useState("");
  useEffect(() => { if (action) setReason(""); }, [action]);
  const m = useMutation({
    mutationFn: async (a: StatusAction) => (await api.post<UserSummary>(`/users/${user.id}/${a}`, { reason: reason.trim() || null })).data,
    onSuccess: (_u, a) => { toast.success(STATUS_COPY[a].done, user.email); invalidate(); onClose(); },
    onError: (e) => toast.error("Action failed", apiError(e).message),
  });
  const c = action ? STATUS_COPY[action] : STATUS_COPY.suspend;
  return (
    <ConfirmDialog open={!!action} onClose={onClose} onConfirm={() => action && m.mutate(action)} loading={m.isPending}
      title={c.title} confirmLabel={c.confirm} tone={c.tone} description={<><span className="text-fg">{user.full_name}</span> — {c.desc}</>}>
      <Field label="Reason (recorded in the audit log)">
        <Textarea maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[72px]" placeholder="e.g. Pending security investigation INC-1042" />
      </Field>
    </ConfirmDialog>
  );
}

/* ------------------------------------------------------------------ reset access */
export function ResetAccessModal({ user, open, onClose }: { user: UserSummary; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateUser();
  const [opts, setOpts] = useState({ revoke_sessions: true, reset_mfa: false, revoke_grants: false, force_password_reset: false });
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ResetAccessResult | null>(null);
  useEffect(() => {
    if (open) { setOpts({ revoke_sessions: true, reset_mfa: false, revoke_grants: false, force_password_reset: false }); setReason(""); setResult(null); }
  }, [open]);
  const m = useMutation({
    mutationFn: async () => (await api.post<ResetAccessResult>(`/users/${user.id}/reset-access`, { ...opts, reason: reason.trim() || null })).data,
    onSuccess: (r) => { setResult(r); toast.success("Access reset completed", user.email); invalidate(); },
    onError: (e) => toast.error("Access reset failed", apiError(e).message),
  });
  const any = Object.values(opts).some(Boolean);
  const set = (k: keyof typeof opts) => (v: boolean) => setOpts((o) => ({ ...o, [k]: v }));
  const s = result?.summary;
  return (
    <Modal open={open} onClose={onClose} title="Reset access" description={`Emergency containment for ${user.full_name}. Lockouts are always cleared and risk is recomputed.`}
      footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={m.isPending} disabled={!any} onClick={() => m.mutate()}>Reset access</Button>
      </>}>
      {result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[13px] font-medium text-success"><CheckCircle2 className="h-4 w-4" />{result.message}</div>
          <ul className="divide-y divide-line/70 rounded-lg border border-line text-xs">
            <SummaryRow label="Sessions revoked" value={s?.sessions_revoked ?? "Not requested"} />
            <SummaryRow label="MFA reset" value={s?.mfa_reset ? "Yes — user must re-enroll" : "Not requested"} />
            <SummaryRow label="Access grants revoked" value={s?.grants_revoked ?? "Not requested"} />
            <SummaryRow label="Password reset" value={s?.password_reset_issued ? "Current password invalidated; reset link issued" : "Not requested"} />
          </ul>
          {s?.password_reset_issued && (
            <p className="text-2xs leading-relaxed text-subtle">This platform does not send email: the one-time reset link (valid 24h) is written to the backend log for an administrator to deliver out-of-band.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2.5 rounded-lg border border-line bg-surface/50 p-3">
            <Checkbox checked={opts.revoke_sessions} onChange={set("revoke_sessions")} label={<span>Revoke all active sessions</span>} />
            <Checkbox checked={opts.reset_mfa} onChange={set("reset_mfa")} label={<span>Reset MFA enrollment and recovery codes</span>} />
            <Checkbox checked={opts.revoke_grants} onChange={set("revoke_grants")} label={<span>Revoke approved access grants</span>} />
            <Checkbox checked={opts.force_password_reset} onChange={set("force_password_reset")} label={<span>Invalidate password and issue a reset link</span>} />
          </div>
          <Field label="Reason (recorded in the audit log)">
            <Textarea maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[72px]" placeholder="e.g. Credential compromise suspected" />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <li className="flex items-center justify-between gap-3 px-3 py-2"><span className="text-muted">{label}</span><span className="num text-right text-fg">{value}</span></li>;
}
