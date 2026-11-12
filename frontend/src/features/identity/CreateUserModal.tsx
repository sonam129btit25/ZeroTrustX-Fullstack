import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { Skeleton } from "@/components/ui/Data";
import { PasswordStrength, passwordChecks, usePasswordPolicy } from "@/components/security/PasswordStrength";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import type { UserSummary } from "@/types/api";
import { cn } from "@/utils/format";
import { useRoles } from "./hooks";
import type { RoleFull } from "./types";

const schema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  full_name: z.string().trim().min(2, "At least 2 characters").max(150),
  password: z.string().min(1, "A temporary password is required").max(128),
  department: z.string().trim().max(100).optional(),
  job_title: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(40).optional(),
});
type FormValues = z.infer<typeof schema>;

const opt = (s?: string) => (s && s.trim() ? s.trim() : null);

export function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (u: UserSummary) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useRoles(open);
  const policy = usePasswordPolicy();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [show, setShow] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, watch, reset, setError, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const pw = watch("password") ?? "";

  useEffect(() => {
    if (open) { reset({ email: "", full_name: "", password: "", department: "", job_title: "", phone: "" }); setRoleIds([]); setServerError(null); }
  }, [open, reset]);

  const m = useMutation({
    mutationFn: async (f: FormValues) => (await api.post<UserSummary>("/users", {
      email: f.email.trim(), full_name: f.full_name.trim(), password: f.password,
      department: opt(f.department), job_title: opt(f.job_title), phone: opt(f.phone), role_ids: roleIds,
    })).data,
    onSuccess: (u) => {
      toast.success("User created", `${u.full_name} can now sign in with the temporary password.`);
      void qc.invalidateQueries({ queryKey: ["users"] });
      onCreated?.(u);
      onClose();
    },
    onError: (e) => {
      const err = apiError(e);
      setServerError(err.message);
      if (Array.isArray(err.errors)) {
        for (const x of err.errors) {
          if (typeof x === "object" && x.field && ["email", "full_name", "password", "department", "job_title", "phone"].includes(x.field)) {
            setError(x.field as keyof FormValues, { message: x.message.replace(/^Value error, /, "") });
          }
        }
      }
      if (err.code === "weak_password") setError("password", { message: err.message });
    },
  });

  const onSubmit = (f: FormValues) => {
    setServerError(null);
    const failed = passwordChecks(f.password, policy.data).filter((c) => !c.ok);
    if (failed.length) { setError("password", { message: `Password does not meet policy: ${failed[0].label.toLowerCase()}` }); return; }
    m.mutate(f);
  };

  const toggle = (id: string) => setRoleIds((r) => (r.includes(id) ? r.filter((x) => x !== id) : r.length >= 5 ? r : [...r, id]));

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Create user"
      description="Provision a new identity. The user signs in with the temporary password and should change it immediately."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" form="create-user-form" loading={m.isPending}>Create user</Button>
      </>}>
      <form id="create-user-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {serverError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{serverError}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Work email" required error={errors.email?.message}>
            <Input type="email" autoComplete="off" placeholder="jane.doe@company.com" invalid={!!errors.email} {...register("email")} data-autofocus />
          </Field>
          <Field label="Full name" required error={errors.full_name?.message}>
            <Input placeholder="Jane Doe" invalid={!!errors.full_name} {...register("full_name")} />
          </Field>
        </div>
        <Field label="Temporary password" required error={errors.password?.message}>
          <div className="relative">
            <Input type={show ? "text" : "password"} autoComplete="new-password" leading={<Lock className="h-4 w-4" />} className="pr-10"
              invalid={!!errors.password} {...register("password")} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-fg">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
          </div>
        </Field>
        <PasswordStrength password={pw} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Department" error={errors.department?.message}><Input placeholder="Engineering" {...register("department")} /></Field>
          <Field label="Job title" error={errors.job_title?.message}><Input placeholder="Staff Engineer" {...register("job_title")} /></Field>
          <Field label="Phone" error={errors.phone?.message}><Input placeholder="+1 555 0100" {...register("phone")} /></Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted">Roles</p>
            <p className="text-2xs text-subtle">{roleIds.length ? `${roleIds.length} selected` : "Defaults to Employee"}</p>
          </div>
          <RoleChecklist roles={roles.data} loading={roles.isLoading} error={roles.isError ? apiError(roles.error).message : null} selected={roleIds} onToggle={toggle} />
        </div>
      </form>
    </Modal>
  );
}

export function RoleChecklist({ roles, loading, error, selected, onToggle }: {
  roles?: RoleFull[]; loading?: boolean; error?: string | null; selected: string[]; onToggle: (id: string) => void;
}) {
  if (loading) return <div className="grid gap-2 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (error) return <p className="text-xs text-danger">{error}</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {roles?.map((r) => {
        const on = selected.includes(r.id);
        return (
          <label key={r.id} data-cursor={r.assignable ? "hover" : undefined}
            title={r.assignable ? undefined : "You cannot assign a role at or above your own privilege level"}
            className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
              !r.assignable ? "cursor-not-allowed border-line/60 opacity-50" : on ? "cursor-pointer border-accent/50 bg-accent/[0.06]" : "cursor-pointer border-line hover:border-line-strong")}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={on} disabled={!r.assignable} onChange={() => onToggle(r.id)} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                {r.display_name}
                {!r.assignable && <ShieldCheck className="h-3 w-3 text-subtle" />}
              </span>
              <span className="block truncate font-mono text-2xs text-subtle">{r.name} · level {r.level}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
