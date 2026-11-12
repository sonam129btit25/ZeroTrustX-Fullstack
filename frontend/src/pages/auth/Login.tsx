import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { useAuth } from "@/context/AuthContext";
import { apiError } from "@/services/api";
import { usePasswordPolicy } from "@/components/security/PasswordStrength";

const schema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required").max(128),
});
type Form = z.infer<typeof schema>;

const DEMO = [
  ["Super Admin", "admin@zerotrustx.dev", "SuperAdmin!2026"],
  ["Security Admin", "secadmin@zerotrustx.dev", "SecAdmin!2026"],
  ["Analyst", "analyst@zerotrustx.dev", "Analyst!2026x"],
  ["Employee", "employee@zerotrustx.dev", "Employee!2026"],
];

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const policy = usePasswordPolicy();
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema) });
  const from = (loc.state as { from?: string } | null)?.from ?? "/";

  const onSubmit = async (f: Form) => {
    setError(null);
    try {
      const r = await login(f.email, f.password);
      if (r.mfa_required && r.mfa_token) nav("/mfa", { state: { mfaToken: r.mfa_token, email: f.email, from } });
      else nav(from, { replace: true });
    } catch (e) {
      setError(apiError(e).message);
    }
  };

  return (
    <AuthLayout title="Sign in to ZeroTrustX" subtitle="Authenticate to continue. Every sign-in is evaluated for risk.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}
          </div>
        )}
        <Field label="Work email" error={errors.email?.message}>
          <Input type="email" autoComplete="username" placeholder="you@company.com" leading={<Mail className="h-4 w-4" />} invalid={!!errors.email} {...register("email")} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <div className="relative">
            <Input type={show ? "text" : "password"} autoComplete="current-password" placeholder="••••••••••••" leading={<Lock className="h-4 w-4" />}
              invalid={!!errors.password} className="pr-10" {...register("password")} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-fg">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
          </div>
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-xs text-accent hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={isSubmitting} iconRight={<ArrowRight className="h-4 w-4" />}>
          Sign in
        </Button>
      </form>
      {policy.data?.allow_self_registration !== false && (
        <p className="mt-5 text-center text-xs text-muted">New here? <Link to="/register" className="text-accent hover:underline">Create an account</Link></p>
      )}
      {import.meta.env.DEV && (
        <div className="mt-6 rounded-lg border border-dashed border-line-strong/70 p-3">
          <p className="label mb-2">Development demo accounts</p>
          <div className="grid grid-cols-2 gap-1.5">
            {DEMO.map(([role, email, pw]) => (
              <button key={email} type="button" onClick={() => { setValue("email", email); setValue("password", pw); }}
                className="rounded-md border border-line bg-surface/70 px-2 py-1.5 text-left text-2xs text-muted hover:border-line-strong hover:text-fg">
                <span className="block font-medium text-fg">{role}</span>{email}
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
