import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Fingerprint, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { NetworkCanvas } from "@/components/brand/NetworkCanvas";

const PILLARS = [
  { icon: Fingerprint, title: "Verify identity", text: "Argon2 credentials, TOTP MFA and continuous risk scoring." },
  { icon: MonitorSmartphone, title: "Verify device", text: "Every session is bound to a device with an explicit trust state." },
  { icon: ShieldCheck, title: "Verify every request", text: "A deterministic policy engine evaluates each access attempt." },
];

export function AuthLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-base">
      <div className="pointer-events-none absolute inset-0">
        <div className="bg-grid absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />
        <div className="absolute -left-40 top-[-20%] h-[620px] w-[620px] rounded-full bg-accent/[0.09] blur-[120px]" />
        <div className="absolute -right-40 bottom-[-25%] h-[560px] w-[560px] rounded-full bg-lavender/[0.08] blur-[120px]" />
      </div>
      <NetworkCanvas className="absolute inset-0 h-full w-full opacity-70" />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl grid-cols-1 items-center gap-12 px-4 py-10 sm:px-8 lg:grid-cols-[1.1fr_1fr]">
        <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }} className="hidden lg:block">
          <Link to="/login"><Logo className="scale-110 origin-left" /></Link>
          <h1 className="mt-10 text-[40px] font-semibold leading-[1.1] tracking-tight">
            <span className="text-gradient">Never Trust.</span><br />Always Verify.
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
            Zero Trust Network Access and identity security for organisations that treat every request as hostile until proven otherwise.
          </p>
          <ul className="mt-10 space-y-5">
            {PILLARS.map((p, i) => (
              <motion.li key={p.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.1 }} className="flex gap-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-card/80 text-accent"><p.icon className="h-4 w-4" /></span>
                <div><p className="text-sm font-medium">{p.title}</p><p className="text-[13px] text-muted">{p.text}</p></div>
              </motion.li>
            ))}
          </ul>
          <p className="mt-12 flex items-center gap-2 text-xs text-subtle"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Every authentication event is recorded in a tamper-evident audit trail.</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 14, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 220, damping: 26 }}
          className="mx-auto w-full max-w-[420px]">
          <div className="mb-8 flex justify-center lg:hidden"><Logo /></div>
          <div className="card-elevated rounded-2xl border-line/90 bg-card/85 p-7 backdrop-blur-xl sm:p-8">
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="mt-1.5 text-[13px] text-muted">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          <p className="mt-6 text-center text-2xs text-subtle">Protected by ZeroTrustX · All access is monitored and audited</p>
        </motion.div>
      </div>
    </div>
  );
}
