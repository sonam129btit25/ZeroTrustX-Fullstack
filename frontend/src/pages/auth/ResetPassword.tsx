import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { PasswordStrength, passwordChecks, usePasswordPolicy } from "@/components/security/PasswordStrength";
import { api, apiError } from "@/services/api";
import { useToast } from "@/context/ToastContext";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const nav = useNavigate();
  const toast = useToast();
  const policy = usePasswordPolicy();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = passwordChecks(pw, policy.data).every((c) => c.ok) && pw === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post("/auth/reset-password", { token, new_password: pw });
      toast.success("Password reset", "All existing sessions were signed out. Sign in with your new password.");
      nav("/login");
    } catch (err) { setError(apiError(err).message); } finally { setBusy(false); }
  };

  if (!token) return (
    <AuthLayout title="Invalid reset link" subtitle="The link is missing its token.">
      <Link to="/forgot-password" className="text-sm text-accent hover:underline">Request a new link</Link>
    </AuthLayout>
  );
  return (
    <AuthLayout title="Choose a new password" subtitle="All active sessions will be revoked after the reset.">
      <form onSubmit={submit} className="space-y-4">
        {error && <div role="alert" className="flex gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger"><AlertCircle className="h-3.5 w-3.5" />{error}</div>}
        <Field label="New password"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <PasswordStrength password={pw} />
        <Field label="Confirm password" error={confirm && pw !== confirm ? "Passwords do not match" : undefined}>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" disabled={!valid} loading={busy}>Reset password</Button>
      </form>
    </AuthLayout>
  );
}
