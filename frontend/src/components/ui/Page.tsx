import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { cn } from "@/utils/format";

export function PageHeader({ title, description, breadcrumbs, actions }: {
  title: string; description?: ReactNode; breadcrumbs?: { label: string; to?: string }[]; actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs && (
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-subtle">
            {breadcrumbs.map((b, i) => (
              <Fragment key={i}>
                {i > 0 && <ChevronRight className="h-3 w-3" />}
                {b.to ? <Link to={b.to} className="hover:text-fg">{b.label}</Link> : <span className="text-muted">{b.label}</span>}
              </Fragment>
            ))}
          </nav>
        )}
        <h1 className="text-[22px] font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Card with a subtle pointer-tracking highlight. */
export function Card({ children, className, interactive, ...rest }: { children: ReactNode; className?: string; interactive?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);
  const bg = useMotionTemplate`radial-gradient(420px circle at ${x}px ${y}px, rgb(var(--accent) / 0.07), transparent 65%)`;
  return (
    <div
      className={cn("card group relative overflow-hidden", interactive && "transition-[border-color,transform] duration-200 hover:-translate-y-[1px] hover:border-line-strong", className)}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set(e.clientX - r.left);
        y.set(e.clientY - r.top);
      }}
      onMouseLeave={() => { x.set(-200); y.set(-200); }}
      {...rest}
    >
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: bg }} />
      <div className="relative">{children}</div>
    </div>
  );
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-line/70 px-5 py-3.5", className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-2 border-b border-line/70 px-4 py-3 md:flex-row md:flex-wrap md:items-center", className)}>{children}</div>;
}

export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 60;
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-full border border-white/10 font-semibold text-white/90", className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${220 + hue} 60% 52%), hsl(${250 + hue} 55% 45%))` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
