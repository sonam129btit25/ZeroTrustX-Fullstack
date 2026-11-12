import { motion } from "framer-motion";
import { cn, riskLevel } from "@/utils/format";

const COLOR: Record<string, string> = { minimal: "bg-success", low: "bg-accent", medium: "bg-warning", high: "bg-danger", critical: "bg-danger" };
const TEXT: Record<string, string> = { minimal: "text-success", low: "text-accent", medium: "text-warning", high: "text-danger", critical: "text-danger" };

export function RiskMeter({ score, showLabel = true, className }: { score: number; showLabel?: boolean; className?: string }) {
  const lvl = riskLevel(score);
  return (
    <div className={cn("flex items-center gap-2", className)} title={`Risk ${score}/100 (${lvl})`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-elevated">
        <motion.div className={cn("h-full rounded-full", COLOR[lvl])} initial={{ width: 0 }} animate={{ width: `${Math.max(3, score)}%` }}
          transition={{ duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }} />
      </div>
      {showLabel && <span className={cn("num w-7 text-xs font-medium", TEXT[lvl])}>{score}</span>}
    </div>
  );
}

export function RiskRing({ score, size = 72 }: { score: number; size?: number }) {
  const lvl = riskLevel(score);
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const stroke = { minimal: "rgb(var(--success))", low: "rgb(var(--accent))", medium: "rgb(var(--warning))", high: "rgb(var(--danger))", critical: "rgb(var(--danger))" }[lvl];
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--elevated))" strokeWidth="5" fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={stroke} strokeWidth="5" fill="none" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c - (c * score) / 100 }}
          transition={{ duration: 0.9, ease: [0.2, 0.7, 0.2, 1] }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><p className="num text-lg font-semibold leading-none">{score}</p><p className="mt-0.5 text-[10px] uppercase tracking-wider text-subtle">{lvl}</p></div>
      </div>
    </div>
  );
}
