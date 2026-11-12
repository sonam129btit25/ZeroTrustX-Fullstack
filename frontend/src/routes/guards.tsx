import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { LogoMark } from "@/components/brand/Logo";
import { useAuth } from "@/context/AuthContext";
import { Unauthorized } from "@/pages/auth/StatusPages";

export function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-base">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-4">
        <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1.6 }}><LogoMark size={44} /></motion.div>
        <p className="text-xs text-muted">Verifying session…</p>
      </motion.div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, sessionLostReason } = useAuth();
  const loc = useLocation();
  if (status === "loading") return <Splash />;
  if (status === "anonymous") {
    if (sessionLostReason) return <Navigate to="/session-expired" replace />;
    return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  }
  return <>{children}</>;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === "loading") return <Splash />;
  if (status === "authenticated") return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** UX-level guard. The API independently enforces every permission. */
export function RequirePermission({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  const perms = Array.isArray(perm) ? perm : [perm];
  return can(...perms) ? <>{children}</> : <Unauthorized />;
}
