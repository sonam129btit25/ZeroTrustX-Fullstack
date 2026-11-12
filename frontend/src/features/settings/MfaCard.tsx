import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, KeyRound, Lock, QrCode, RefreshCw, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { Skeleton } from "@/components/ui/Data";
import { Modal } from "@/components/ui/Overlay";
import { OtpInput } from "@/pages/auth/MfaVerify";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import { cn, fmtDate, timeAgo } from "@/utils/format";
import { CopyButton } from "@/features/audit/CopyValue";
import { RecoveryCodes } from "./RecoveryCodes";
import { Notice, Section } from "./shared";

interface MfaStatus {
  enabled: boolean; enabled_at: string | null; last_used_at: string | null; recovery_codes_remaining: number;
  pending_setup: boolean; required_by_policy: boolean; session_mfa_verified: boolean;
}
interface MfaSetup { otpauth_uri: string; secret: string; qr_svg_data_url: string }

const MFA_KEY = ["mfa-status"];

function InlineError({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{msg}
    </div>
  );
}

function Step({ n, title, children, active, done }: { n: number; title: string; children?: React.ReactNode; active?: boolean; done?: boolean }) {
  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      <span className="absolute left-[11px] top-7 h-[calc(100%-1.75rem)] w-px bg-line last:hidden" aria-hidden />
      <span className={cn("relative z-[1] grid h-6 w-6 shrink-0 place-items-center rounded-full border text-2xs font-semibold",
        done ? "border-success/40 bg-success/15 text-success" : active ? "border-accent/50 bg-accent/15 text-accent" : "border-line bg-elevated text-subtle")}>
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className={cn("text-[13px] font-medium", active || done ? "text-fg" : "text-muted")}>{title}</p>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </li>
  );
}

export function MfaCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const status = useQuery({ queryKey: MFA_KEY, queryFn: async () => (await api.get<MfaStatus>("/mfa/status")).data });

  // Enrolment flow
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState("");
  const [enrollErr, setEnrollErr] = useState<string | null>(null);
  const [codes, setCodes] = useState<{ list: string[]; reason: "enabled" | "regenerated" } | null>(null);

  // Management modals
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState("");
  const [regenErr, setRegenErr] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disPw, setDisPw] = useState("");
  const [disCode, setDisCode] = useState("");
  const [disErr, setDisErr] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: async () => (await api.post<MfaSetup>("/mfa/setup")).data,
    onSuccess: (d) => { setSetup(d); setCode(""); setEnrollErr(null); },
    onError: (e) => toast.error("Could not start MFA setup", apiError(e).message),
  });

  const enable = useMutation({
    mutationFn: async (c: string) => (await api.post<{ recovery_codes: string[] }>("/mfa/enable", { code: c })).data,
    onSuccess: (d) => {
      setCodes({ list: d.recovery_codes, reason: "enabled" });
      setSetup(null);
      setCode("");
      toast.success("Multi-factor authentication enabled", "Save your recovery codes before leaving this page.");
      void qc.invalidateQueries({ queryKey: MFA_KEY });
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (e) => { setEnrollErr(apiError(e).message); setCode(""); },
  });

  const regen = useMutation({
    mutationFn: async (c: string) => (await api.post<{ recovery_codes: string[] }>("/mfa/recovery-codes", { code: c })).data,
    onSuccess: (d) => {
      setRegenOpen(false);
      setRegenCode("");
      setCodes({ list: d.recovery_codes, reason: "regenerated" });
      toast.success("New recovery codes issued", "Your previous codes no longer work.");
      void qc.invalidateQueries({ queryKey: MFA_KEY });
    },
    onError: (e) => { setRegenErr(apiError(e).message); setRegenCode(""); },
  });

  const disable = useMutation({
    mutationFn: async () => (await api.post("/mfa/disable", { password: disPw, code: disCode.trim() })).data,
    onSuccess: async () => {
      setDisableOpen(false);
      setDisPw(""); setDisCode(""); setDisErr(null);
      toast.warning("Multi-factor authentication disabled", "Your account is now protected by password only.");
      await qc.invalidateQueries({ queryKey: MFA_KEY });
      await refreshUser().catch(() => undefined);
    },
    onError: (e) => setDisErr(apiError(e).message),
  });

  const finishCodes = async () => {
    setCodes(null);
    await refreshUser().catch(() => undefined);
    void qc.invalidateQueries({ queryKey: MFA_KEY });
  };

  const s = status.data;
  const headerBadge = s ? (s.enabled ? <Badge tone="success" dot>Enabled</Badge> : s.required_by_policy ? <Badge tone="warning" dot>Required</Badge> : <Badge dot>Off</Badge>) : null;

  return (
    <Section
      title={<span className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-lavender" />Multi-factor authentication</span>}
      description="Time-based one-time passwords (TOTP, RFC 6238) from an authenticator app such as 1Password, Authy or Google Authenticator."
      actions={headerBadge}
    >
      {status.isLoading && <div className="space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-16 w-full" /><Skeleton className="h-9 w-48" /></div>}
      {status.isError && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-danger">{apiError(status.error).message}</p>
          <Button size="sm" onClick={() => status.refetch()}>Retry</Button>
        </div>
      )}

      {s && codes && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[13px] font-medium text-success">
            <CheckCircle2 className="h-4 w-4" />
            {codes.reason === "enabled" ? "Authenticator verified — MFA is now active" : "Recovery codes regenerated"}
          </div>
          <RecoveryCodes codes={codes.list} email={user?.email ?? ""} onDone={finishCodes} doneLabel="I've saved these" />
        </div>
      )}

      {s && !codes && !s.enabled && (
        <div className="space-y-5">
          {s.required_by_policy && (
            <Notice tone="warning">
              Your organization requires MFA for one of your roles. Until you enrol, sensitive resources will require step-up verification or be denied.
            </Notice>
          )}
          {!setup ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-elevated text-subtle"><ShieldOff className="h-5 w-5" /></div>
                <div>
                  <p className="text-[13px] font-medium">MFA is not enabled</p>
                  <p className="mt-0.5 max-w-md text-xs text-muted">Add a second factor so a stolen password alone can't be used to sign in. Setup takes about a minute.</p>
                </div>
              </div>
              <Button variant="primary" icon={<QrCode className="h-4 w-4" />} loading={start.isPending} onClick={() => start.mutate()}>Set up authenticator</Button>
            </div>
          ) : (
            <ol className="relative">
              <Step n={1} title="Scan the QR code with your authenticator app" active done>
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                  <div className="shrink-0 self-center rounded-xl bg-white p-3 shadow-card sm:self-start">
                    <img src={setup.qr_svg_data_url} alt="QR code for authenticator enrolment" width={168} height={168} className="h-[168px] w-[168px]" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-xs text-muted">Can't scan? Enter this setup key manually (time-based, 6 digits, 30-second period):</p>
                    <div className="flex items-center gap-2 rounded-lg border border-line bg-base/60 px-3 py-2">
                      <code className="min-w-0 flex-1 break-all font-mono text-[13px] tracking-[0.12em] text-fg">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                      <CopyButton value={setup.secret} label="Copy setup key" toastTitle="Setup key copied" />
                    </div>
                    <p className="flex items-start gap-1.5 text-2xs text-subtle"><Lock className="mt-0.5 h-3 w-3 shrink-0" />Treat this key like a password. It is encrypted at rest and won't be shown again after setup.</p>
                  </div>
                </div>
              </Step>
              <Step n={2} title="Enter the 6-digit code to confirm" active>
                <form className="max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) enable.mutate(code); }}>
                  <OtpInput value={code} onChange={(v) => { setCode(v); setEnrollErr(null); }} onComplete={(v) => enable.mutate(v)} disabled={enable.isPending} />
                  <InlineError msg={enrollErr} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" variant="primary" loading={enable.isPending} disabled={code.length !== 6}>Verify & enable</Button>
                    <Button variant="ghost" onClick={() => { setSetup(null); setCode(""); setEnrollErr(null); }}>Cancel</Button>
                  </div>
                </form>
              </Step>
              <Step n={3} title="Save your recovery codes" />
            </ol>
          )}
        </div>
      )}

      {s && !codes && s.enabled && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Enabled", s.enabled_at ? <span title={fmtDate(s.enabled_at)}>{fmtDate(s.enabled_at, { dateStyle: "medium" })}</span> : "—"],
              ["Last used", s.last_used_at ? <span title={fmtDate(s.last_used_at)}>{timeAgo(s.last_used_at)}</span> : "Never"],
              ["Recovery codes", <span className={cn("num", s.recovery_codes_remaining <= 3 && "text-warning")}>{s.recovery_codes_remaining} of 10 left</span>],
              ["This session", s.session_mfa_verified ? <span className="text-success">MFA verified</span> : <span className="text-warning">Password only</span>],
            ].map(([k, v], i) => (
              <div key={i} className="rounded-lg border border-line/70 bg-surface/50 px-3 py-2.5">
                <p className="label">{k}</p>
                <p className="mt-1 text-[13px]">{v}</p>
              </div>
            ))}
          </div>
          {s.recovery_codes_remaining <= 3 && (
            <Notice tone="warning">You're running low on recovery codes. Regenerate a fresh set to avoid being locked out.</Notice>
          )}
          <div className="flex flex-wrap gap-2">
            <Button icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => { setRegenOpen(true); setRegenErr(null); setRegenCode(""); }}>Regenerate recovery codes</Button>
            <Button variant="ghost" className="text-danger hover:text-danger" icon={<ShieldOff className="h-3.5 w-3.5" />}
              onClick={() => { setDisableOpen(true); setDisErr(null); }}>Disable MFA</Button>
          </div>
        </div>
      )}

      {s && (
        <p className="mt-5 flex items-start gap-2 border-t border-line/60 pt-4 text-2xs leading-relaxed text-subtle">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          TOTP secrets are encrypted at rest (Fernet: AES-128 with HMAC-SHA256) and never returned after enrolment. Recovery codes are stored only as keyed
          HMAC-SHA256 hashes and each works once. A code that has already been accepted cannot be replayed.
        </p>
      )}

      <Modal open={regenOpen} onClose={() => setRegenOpen(false)} size="sm" title="Regenerate recovery codes"
        description="Enter a current code from your authenticator. Your existing recovery codes will stop working immediately."
        footer={<>
          <Button variant="ghost" onClick={() => setRegenOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={regen.isPending} disabled={regenCode.length !== 6} onClick={() => regen.mutate(regenCode)}>Generate new codes</Button>
        </>}>
        <div className="space-y-3">
          <OtpInput value={regenCode} onChange={(v) => { setRegenCode(v); setRegenErr(null); }} onComplete={(v) => regen.mutate(v)} disabled={regen.isPending} />
          <InlineError msg={regenErr} />
        </div>
      </Modal>

      <Modal open={disableOpen} onClose={() => setDisableOpen(false)} size="sm"
        title={<span className="flex items-center gap-2"><ShieldOff className="h-4 w-4 text-danger" />Disable multi-factor authentication</span>}
        description="Confirm your identity with your password and either an authenticator code or an unused recovery code."
        footer={<>
          <Button variant="ghost" onClick={() => setDisableOpen(false)}>Cancel</Button>
          <Button variant="danger" loading={disable.isPending} disabled={!disPw || disCode.trim().length < 6} onClick={() => disable.mutate()}>Disable MFA</Button>
        </>}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (disPw && disCode.trim().length >= 6) disable.mutate(); }}>
          {s?.required_by_policy && (
            <Notice tone="warning">
              Your role requires MFA by organization policy. After disabling, sensitive access will be stepped-up or denied and administrators may be alerted.
            </Notice>
          )}
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={disPw} onChange={(e) => { setDisPw(e.target.value); setDisErr(null); }} data-autofocus />
          </Field>
          <Field label="Authenticator or recovery code" hint="6-digit code, or a recovery code like XXXXX-XXXXX.">
            <Input value={disCode} onChange={(e) => { setDisCode(e.target.value.slice(0, 20)); setDisErr(null); }} autoComplete="one-time-code"
              className="font-mono tracking-wider" leading={<KeyRound className="h-4 w-4" />} placeholder="123456" />
          </Field>
          <InlineError msg={disErr} />
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      </Modal>
    </Section>
  );
}
