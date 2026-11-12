import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Crown, Plus, X } from "lucide-react";
import type { Decision, PolicyFields } from "@/types/api";
import { DecisionBadge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/utils/format";
import { describeCondition } from "./conditions";

/** Compact segmented control (radio group). */
export function Segmented<T extends string>({ value, onChange, options, size = "md", className, ariaLabel }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: "sm" | "md"; className?: string; ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex flex-wrap rounded-lg border border-line bg-surface/60 p-0.5", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} data-cursor="hover"
          className={cn("rounded-md font-medium transition-colors", size === "sm" ? "px-2 py-1 text-2xs" : "px-2.5 py-1.5 text-xs",
            value === o.value ? "bg-elevated text-fg shadow-sm ring-1 ring-line-strong/70" : "text-muted hover:text-fg")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Disclosure section. */
export function Collapsible({ title, children, defaultOpen = false, meta }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; meta?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-line bg-surface/40">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-cursor="hover"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
        <span className="text-xs font-medium text-fg">{title}</span>
        <span className="flex items-center gap-2 text-2xs text-subtle">{meta}<ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} /></span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="border-t border-line/70 px-3 py-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** "Field · operator · value" condition chip. */
export function ConditionChip({ condition, catalogue, className }: {
  condition: { field: string; operator: string; value: unknown }; catalogue?: PolicyFields; className?: string;
}) {
  const [label, op, value] = describeCondition(condition, catalogue);
  return (
    <span className={cn("inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-md border border-line bg-surface/70 px-2 py-1 text-2xs leading-4", className)}>
      <span className="font-medium text-fg">{label}</span>
      <span className="text-subtle">·</span>
      <span className="text-muted">{op}</span>
      {value && <><span className="text-subtle">·</span><span className="break-all font-mono text-accent">{value}</span></>}
    </span>
  );
}

export function ConditionList({ conditions, matchMode, catalogue }: {
  conditions: { field: string; operator: string; value: unknown }[]; matchMode: "all" | "any"; catalogue?: PolicyFields;
}) {
  if (!conditions.length) return <span className="text-2xs italic text-subtle">No conditions — matches every request</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {conditions.map((c, i) => (
        <span key={i} className="inline-flex max-w-full items-center gap-1.5">
          {i > 0 && <span className="font-mono text-[10px] font-semibold uppercase text-subtle">{matchMode === "all" ? "and" : "or"}</span>}
          <ConditionChip condition={c} catalogue={catalogue} />
        </span>
      ))}
    </div>
  );
}

/** Matched policies of an evaluation, deciding one highlighted. */
export function MatchedPolicies({ items, empty = "No administrator policy matched this request." }: {
  items: { policy_id: string; name: string; action: Decision; deciding: boolean; priority?: number }[]; empty?: string;
}) {
  const { can } = useAuth();
  if (!items.length) return <p className="rounded-lg border border-dashed border-line px-3 py-3 text-xs text-muted">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((m) => {
        const linkable = can("policies:read") && m.policy_id !== "draft";
        const name = linkable
          ? <Link to={`/policies?policy=${m.policy_id}`} className="truncate hover:text-accent hover:underline">{m.name}</Link>
          : <span className="truncate">{m.name}</span>;
        return (
          <li key={m.policy_id}
            className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px]",
              m.deciding ? "border-accent/40 bg-accent/[0.07]" : "border-line bg-surface/50")}>
            {m.priority !== undefined && <span className="num shrink-0 font-mono text-2xs text-subtle">P{m.priority}</span>}
            <span className="flex min-w-0 flex-1 items-center gap-2 text-fg">{name}</span>
            {m.deciding && <span className="hidden items-center gap-1 text-2xs font-medium text-accent sm:inline-flex"><Crown className="h-3 w-3" />Deciding</span>}
            <DecisionBadge decision={m.action} />
          </li>
        );
      })}
    </ul>
  );
}

/** Multi-value chip input. With `options`, toggles predefined values; otherwise free-form entry (Enter / comma). */
export function ChipInput({ value, onChange, options, optionLabel, placeholder = "Type and press Enter", invalid, numeric }: {
  value: (string | number)[]; onChange: (v: (string | number)[]) => void; options?: (string | number)[];
  optionLabel?: (v: string | number) => string; placeholder?: string; invalid?: boolean; numeric?: boolean;
}) {
  const [text, setText] = useState("");
  const label = optionLabel ?? ((v: string | number) => String(v));
  if (options) {
    return (
      <div className={cn("flex flex-wrap gap-1.5 rounded-lg border bg-surface/50 p-1.5", invalid ? "border-danger/70" : "border-line")}>
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button key={String(o)} type="button" aria-pressed={on} data-cursor="hover"
              onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
              className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-2xs transition-colors",
                on ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-muted hover:border-line-strong hover:text-fg")}>
              {on && <Check className="h-3 w-3" />}{label(o)}
            </button>
          );
        })}
      </div>
    );
  }
  const commit = () => {
    const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
    const vals = numeric ? parts.map(Number).filter((n) => !Number.isNaN(n)) : parts;
    const next = [...value];
    vals.forEach((v) => { if (!next.includes(v)) next.push(v); });
    onChange(next);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
    else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className={cn("flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-surface/70 px-1.5 py-1 focus-within:border-accent/70 focus-within:shadow-focus",
      invalid ? "border-danger/70" : "border-line")}>
      {value.map((v) => (
        <span key={String(v)} className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 py-0.5 pl-2 pr-1 font-mono text-2xs text-accent">
          {label(v)}
          <button type="button" aria-label={`Remove ${label(v)}`} onClick={() => onChange(value.filter((x) => x !== v))} className="rounded p-0.5 hover:bg-accent/20"><X className="h-3 w-3" /></button>
        </span>
      ))}
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={() => text && commit()}
        placeholder={value.length ? "" : placeholder} inputMode={numeric ? "numeric" : undefined}
        className="h-7 min-w-[120px] flex-1 bg-transparent px-1 text-[13px] text-fg placeholder:text-subtle focus:outline-none" />
      {text && <button type="button" onClick={commit} aria-label="Add value" className="rounded p-1 text-subtle hover:text-fg"><Plus className="h-3.5 w-3.5" /></button>}
    </div>
  );
}

/** Range slider with numeric readout. */
export function Slider({ value, onChange, min = 0, max = 100, label, disabled, tone }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label: string; disabled?: boolean; tone?: string;
}) {
  return (
    <div className={cn("space-y-1.5", disabled && "opacity-50")}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className={cn("num rounded bg-elevated px-1.5 py-0.5 font-mono text-2xs", tone ?? "text-fg")}>{value}</span>
      </div>
      <input type="range" min={min} max={max} value={value} disabled={disabled} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-elevated accent-[rgb(var(--accent))]" />
    </div>
  );
}

export function riskTone(n: number) {
  return n >= 80 ? "text-danger" : n >= 50 ? "text-warning" : n >= 25 ? "text-accent" : "text-success";
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="label">{children}</p>
      {action}
    </div>
  );
}
