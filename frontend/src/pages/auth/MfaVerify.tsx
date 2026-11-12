import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, KeyRound, ShieldCheck } from "lucide-react";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { useAuth } from "@/context/AuthContext";
import { apiError } from "@/services/api";

export function OtpInput({ value, onChange, onComplete, disabled }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
  const set = (i: number, d: string) => {
    const next = (value.slice(0, i) + d + value.slice(i + 1)).replace(/\D/g, "").slice(0, 6);
    onChange(next);
    if (d && i < 5) refs.current[i + 1]?.focus();
    if (next.length === 6) onComplete?.(next);
  };
  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit verification code">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} value={d} disabled={disabled} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`} maxLength={1} autoFocus={i === 0}
          onChange={(e) => set(i, e.target.value.replace(/\D/g, "").slice(-1))}
          onKeyDown={(e) => { if (e.key === "Backspace" && !d && i > 0) { refs.current[i - 1]?.focus(); onChange(value.slice(0, i - 1)); } }}
          onPaste={(e) => { const t = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6); if (t) { e.preventDefault(); onChange(t); refs.current[Math.min(t.length, 5)]?.focus(); if (t.length === 6) onComplete?.(t); } }}
          className="h-12 w-full min-w-0 rounded-lg border border-line bg-surface/70 text-center font-mono text-lg text-fg transition-colors focus:border-accent focus:shadow-focus focus:outline-none" />
      ))}
    </div>
  );
}

export default function MfaVerify() {
  const loc = useLocation();
  const nav = useNavigate();
  const { verifyMfa } = useAuth();
  const state = loc.state as { mfaToken?: string; email?: string; from?: string } | null;
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setError(null); }, [useRecovery]);
  if (!state?.mfaToken) return <Navigate to="/login" replace />;

  const submit = async (c = code) => {
    setBusy(true);
    setError(null);
    try {
      await verifyMfa(state.mfaToken!, useRecovery ? { recovery_code: recovery } : { code: c });
      nav(state.from ?? "/", { replace: true });
    } catch (e) {
      const err = apiError(e);
      setError(err.code === "mfa_token_expired" ? "This challenge expired. Please sign in again." : err.message);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Verify it's you" subtitle={<>Enter the 6-digit code from your authenticator app for <span className="text-fg">{state.email}</span>.</>}>
      <div className="mb-5 flex items-center gap-3 rounded-lg border border-lavender/20 bg-lavender/[0.06] p-3 text-xs text-muted">
        <ShieldCheck className="h-5 w-5 shrink-0 text-lavender" /> Multi-factor authentication is enabled on this account. Codes rotate every 30 seconds.
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4">
        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
        {useRecovery ? (
          <Field label="Recovery code" hint="Each recovery code can only be used once.">
            <Input value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="XXXXX-XXXXX" autoFocus leading={<KeyRound className="h-4 w-4" />} className="font-mono uppercase" />
          </Field>
        ) : (
          <OtpInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} disabled={busy} />
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={busy}
          disabled={useRecovery ? recovery.replace(/\W/g, "").length < 10 : code.length !== 6}>Verify</Button>
      </form>
      <div className="mt-5 flex items-center justify-between text-xs">
        <button onClick={() => setUseRecovery((u) => !u)} className="text-accent hover:underline">{useRecovery ? "Use authenticator code" : "Use a recovery code"}</button>
        <Link to="/login" className="text-muted hover:text-fg">Back to sign in</Link>
      </div>
    </AuthLayout>
  );
}
