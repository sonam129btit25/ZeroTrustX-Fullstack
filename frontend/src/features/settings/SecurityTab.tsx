import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { PasswordStrength, passwordChecks, usePasswordPolicy } from "@/components/security/PasswordStrength";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import { MfaCard } from "./MfaCard";
import { Notice, Section } from "./shared";

const schema = z.object({
  current_password: z.string().min(1, "Enter your current password").max(128),
  new_password: z.string().min(1, "Enter a new password").max(128, "At most 128 characters"),
  confirm: z.string().min(1, "Confirm the new password"),
}).refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "Passwords don't match" })
  .refine((v) => v.new_password !== v.current_password || !v.new_password, { path: ["new_password"], message: "New password must differ from the current one" });
type Form = z.infer<typeof schema>;

function ChangePasswordCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const policy = usePasswordPolicy();
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [serverErr, setServerErr] = useState<string[] | null>(null);
  const { register, handleSubmit, control, reset, setError, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema), defaultValues: { current_password: "", new_password: "", confirm: "" },
  });
  const pw = useWatch({ control, name: "new_password" }) ?? "";

  const onSubmit = async (f: Form) => {
    setResult(null);
    setServerErr(null);
    const failing = passwordChecks(f.new_password, policy.data).filter((c) => !c.ok);
    if (failing.length) {
      setError("new_password", { message: `Doesn't meet policy: ${failing.map((c) => c.label.toLowerCase()).join(", ")}` });
      return;
    }
    try {
      const r = await api.post<{ message: string }>("/auth/change-password", { current_password: f.current_password, new_password: f.new_password });
      setResult(r.data.message);
      reset();
      toast.success("Password changed", "Other signed-in sessions were signed out.");
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    } catch (e) {
      const err = apiError(e);
      if (err.code === "invalid_password") setError("current_password", { message: err.message });
      else if (err.code === "weak_password") setServerErr((err.errors as string[] | undefined)?.length ? (err.errors as string[]) : [err.message]);
      else toast.error("Could not change password", err.message);
    }
  };

  const type = show ? "text" : "password";
  return (
    <Section
      title={<span className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-accent" />Password</span>}
      description="Changing your password signs out every other session on your account. This session stays signed in."
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-xl space-y-4">
        {result && <Notice tone="success">{result}</Notice>}
        {serverErr && <Notice tone="danger"><ul className="space-y-0.5">{serverErr.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
        {/* Hidden username helps password managers associate the credential. */}
        <input type="text" autoComplete="username" hidden readOnly value="" />
        <Field label="Current password" error={errors.current_password?.message}>
          <Input type={type} autoComplete="current-password" leading={<KeyRound className="h-4 w-4" />} invalid={!!errors.current_password} {...register("current_password")} />
        </Field>
        <Field label="New password" error={errors.new_password?.message}>
          <div className="relative">
            <Input type={type} autoComplete="new-password" invalid={!!errors.new_password} className="pr-10" {...register("new_password")} />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide passwords" : "Show passwords"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-subtle hover:text-fg">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <PasswordStrength password={pw} />
        <Field label="Confirm new password" error={errors.confirm?.message}>
          <Input type={type} autoComplete="new-password" invalid={!!errors.confirm} {...register("confirm")} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line/60 pt-4">
          <Button variant="ghost" onClick={() => { reset(); setServerErr(null); }} disabled={isSubmitting}>Clear</Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>Update password</Button>
        </div>
      </form>
    </Section>
  );
}

export function SecurityTab() {
  return (
    <div className="space-y-4">
      <ChangePasswordCard />
      <MfaCard />
    </div>
  );
}
