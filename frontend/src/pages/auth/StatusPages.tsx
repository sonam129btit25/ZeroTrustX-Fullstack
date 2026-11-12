import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Clock3, Compass, ShieldOff } from "lucide-react";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";

const REASONS: Record<string, string> = {
  session_expired: "Your session reached its time limit or was idle for too long.",
  session_revoked: "Your session was terminated — you signed out elsewhere, an administrator revoked it, or your privileges changed.",
  session_invalid: "Your session could not be validated.",
  invalid_token: "Your credentials could not be validated.",
  account_inactive: "Your account is no longer active. Contact your security administrator.",
};

export function SessionExpired() {
  const { sessionLostReason, clearSessionLost } = useAuth();
  const reason = sessionLostReason ?? new URLSearchParams(useLocation().search).get("reason") ?? "session_expired";
  return (
    <AuthLayout title="Session ended" subtitle="For your security, ZeroTrustX continuously re-validates every session.">
      <div className="mb-6 flex gap-3 rounded-lg border border-warning/25 bg-warning/[0.08] p-3.5 text-[13px] text-fg">
        <Clock3 className="h-5 w-5 shrink-0 text-warning" />{REASONS[reason] ?? REASONS.session_expired}
      </div>
      <Link to="/login" onClick={clearSessionLost}><Button variant="primary" size="lg" className="w-full justify-center">Sign in again</Button></Link>
    </AuthLayout>
  );
}

export function Unauthorized() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-md text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-danger/30 bg-danger/10 text-danger"><ShieldOff className="h-6 w-6" /></div>
        <p className="font-mono text-xs text-danger">403 · ACCESS DENIED</p>
        <h1 className="mt-2 text-xl font-semibold">You don't have access to this area</h1>
        <p className="mt-2 text-[13px] text-muted">Your role lacks the permission required for this page. Access is enforced by the API, not just hidden in the interface. Submit an access request if you need it.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/"><Button variant="secondary">Go to overview</Button></Link>
          <Link to="/access-requests?new=1"><Button variant="primary">Request access</Button></Link>
        </div>
      </motion.div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-line bg-card text-subtle"><Compass className="h-6 w-6" /></div>
        <p className="font-mono text-xs text-subtle">404</p>
        <h1 className="mt-2 text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-[13px] text-muted">The page you're looking for doesn't exist or was moved.</p>
        <Link to="/" className="mt-6 inline-block"><Button variant="primary">Back to overview</Button></Link>
      </div>
    </div>
  );
}
