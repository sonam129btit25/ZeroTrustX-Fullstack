import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { api, apiError } from "@/services/api";

const schema = z.object({ email: z.string().trim().email("Enter a valid email") });

export default function ForgotPassword() {
  const [sent, setSent] = useState<{ message: string; dev_reset_url?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ email: string }>({ resolver: zodResolver(schema) });
  const onSubmit = async (f: { email: string }) => {
    setError(null);
    try { setSent((await api.post("/auth/forgot-password", f)).data); } catch (e) { setError(apiError(e).message); }
  };
  return (
    <AuthLayout title="Reset your password" subtitle="We'll send a single-use link that expires in 30 minutes.">
      {sent ? (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-success/25 bg-success/10 p-3 text-xs text-fg"><MailCheck className="h-4 w-4 shrink-0 text-success" />{sent.message}</div>
          <p className="text-xs leading-relaxed text-muted">No email provider is configured in this deployment, so the reset link is written to the API server log.</p>
          {sent.dev_reset_url && (
            <a href={sent.dev_reset_url.replace(/^https?:\/\/[^/]+/, "")} className="block rounded-lg border border-dashed border-line-strong p-3 text-xs text-accent hover:underline">
              Development only: open reset link
            </a>
          )}
          <Link to="/login" className="block text-center text-xs text-accent hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && <p className="text-xs text-danger">{error}</p>}
          <Field label="Work email" error={errors.email?.message}><Input type="email" autoComplete="email" {...register("email")} /></Field>
          <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={isSubmitting}>Send reset link</Button>
          <Link to="/login" className="block text-center text-xs text-muted hover:text-fg">Back to sign in</Link>
        </form>
      )}
    </AuthLayout>
  );
}
