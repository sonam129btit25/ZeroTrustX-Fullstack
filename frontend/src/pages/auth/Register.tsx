import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle } from "lucide-react";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { PasswordStrength, passwordChecks, usePasswordPolicy } from "@/components/security/PasswordStrength";
import { api, apiError } from "@/services/api";
import { useToast } from "@/context/ToastContext";

const schema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(150),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(1, "Password is required").max(128),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Passwords do not match" });
type Form = z.infer<typeof schema>;

export default function Register() {
  const nav = useNavigate();
  const toast = useToast();
  const policy = usePasswordPolicy();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setError: setFieldError, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema) });
  const pw = watch("password") ?? "";

  const onSubmit = async (f: Form) => {
    setError(null);
    if (passwordChecks(f.password, policy.data).some((c) => !c.ok)) {
      setFieldError("password", { message: "Password does not meet the policy" });
      return;
    }
    try {
      await api.post("/auth/register", { email: f.email, full_name: f.full_name, password: f.password });
      toast.success("Account created", "Sign in to continue. An administrator can grant additional roles.");
      nav("/login");
    } catch (e) {
      setError(apiError(e).message);
    }
  };

  if (policy.data && !policy.data.allow_self_registration) {
    return (
      <AuthLayout title="Registration disabled" subtitle="Self-service registration is turned off for this organisation.">
        <Link to="/login" className="text-sm text-accent hover:underline">Back to sign in</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" subtitle="New accounts start with the Guest role until an administrator assigns access.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger"><AlertCircle className="mt-0.5 h-3.5 w-3.5" />{error}</div>}
        <Field label="Full name" error={errors.full_name?.message}><Input autoComplete="name" invalid={!!errors.full_name} {...register("full_name")} /></Field>
        <Field label="Work email" error={errors.email?.message}><Input type="email" autoComplete="email" invalid={!!errors.email} {...register("email")} /></Field>
        <Field label="Password" error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" invalid={!!errors.password} {...register("password")} />
        </Field>
        <PasswordStrength password={pw} />
        <Field label="Confirm password" error={errors.confirm?.message}><Input type="password" autoComplete="new-password" invalid={!!errors.confirm} {...register("confirm")} /></Field>
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={isSubmitting}>Create account</Button>
      </form>
      <p className="mt-5 text-center text-xs text-muted">Already have an account? <Link to="/login" className="text-accent hover:underline">Sign in</Link></p>
    </AuthLayout>
  );
}
