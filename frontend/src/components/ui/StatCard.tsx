import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Page";
import { Skeleton } from "@/components/ui/Data";
import { cn } from "@/utils/format";

export function StatCard({ label, value, icon, hint, tone = "accent", loading, onClick }: {
  label: string; value: ReactNode; icon: ReactNode; hint?: ReactNode; tone?: "accent" | "lavender" | "success" | "warning" | "danger" | "cyan";
  loading?: boolean; onClick?: () => void;
}) {
  const tones = { accent: "text-accent bg-accent/10", lavender: "text-lavender bg-lavender/10", success: "text-success bg-success/10",
    warning: "text-warning bg-warning/10", danger: "text-danger bg-danger/10", cyan: "text-cyan bg-cyan/10" };
  return (
    <Card interactive={!!onClick} className={cn("p-4", onClick && "cursor-pointer")} onClick={onClick} data-cursor={onClick ? "hover" : undefined}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted">{label}</p>
        <span className={cn("grid h-7 w-7 place-items-center rounded-lg", tones[tone])}>{icon}</span>
      </div>
      {loading ? <Skeleton className="mt-3 h-7 w-20" /> : (
        <motion.p key={String(value)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="num mt-2 text-[26px] font-semibold tracking-tight text-fg">
          {value}
        </motion.p>
      )}
      {hint && <div className="mt-1 text-xs text-subtle">{hint}</div>}
    </Card>
  );
}
