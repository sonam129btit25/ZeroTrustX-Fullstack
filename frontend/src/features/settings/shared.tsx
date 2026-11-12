import type { ReactNode } from "react";
import { AlertCircle, Info } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Page";
import { Skeleton } from "@/components/ui/Data";
import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/format";

export function Section({ title, description, actions, children, className, bodyClassName }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} actions={actions} />
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </Card>
  );
}

export function Notice({ tone = "info", children, className, icon }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode; className?: string; icon?: ReactNode }) {
  const styles = {
    info: "border-accent/20 bg-accent/[0.06] text-muted",
    warning: "border-warning/25 bg-warning/[0.07] text-warning",
    danger: "border-danger/30 bg-danger/10 text-danger",
    success: "border-success/25 bg-success/[0.07] text-success",
  }[tone];
  const iconTone = { info: "text-accent", warning: "text-warning", danger: "text-danger", success: "text-success" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs leading-relaxed", styles, className)}>
      <span className={cn("mt-0.5 shrink-0", iconTone)}>{icon ?? (tone === "danger" || tone === "warning" ? <AlertCircle className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />)}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SectionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card>
      <div className="border-b border-line/70 px-5 py-4"><Skeleton className="h-4 w-40" /><Skeleton className="mt-2 h-3 w-64" /></div>
      <div className="space-y-4 p-5">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
    </Card>
  );
}

export function ErrorCard({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <Card>
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl border border-danger/30 bg-danger/10 text-danger"><AlertCircle className="h-5 w-5" /></div>
        <p className="text-[13px] font-medium">{title}</p>
        <p className="mt-1 max-w-sm text-xs text-muted">{message}</p>
        {onRetry && <Button size="sm" className="mt-4" onClick={onRetry}>Retry</Button>}
      </div>
    </Card>
  );
}

/** Label/value line for read-only facts. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className="mt-1 text-[13px] text-fg">{children}</dd>
    </div>
  );
}
