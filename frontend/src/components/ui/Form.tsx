import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/utils/format";

const base =
  "w-full rounded-lg border border-line bg-surface/70 px-3 text-[13px] text-fg placeholder:text-subtle transition-colors hover:border-line-strong focus:border-accent/70 focus:bg-surface focus:outline-none focus:shadow-focus disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; leading?: ReactNode }>(
  function Input({ className, invalid, leading, ...rest }, ref) {
    if (leading) {
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle">{leading}</span>
          <input ref={ref} className={cn(base, "h-9 pl-9", invalid && "border-danger/70", className)} aria-invalid={invalid || undefined} {...rest} />
        </div>
      );
    }
    return <input ref={ref} className={cn(base, "h-9", invalid && "border-danger/70", className)} aria-invalid={invalid || undefined} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return <textarea ref={ref} className={cn(base, "min-h-[88px] py-2 leading-relaxed", invalid && "border-danger/70", className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select ref={ref} className={cn(base, "h-9 appearance-none pr-8", invalid && "border-danger/70", className)} {...rest}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
      </div>
    );
  },
);

export function Field({ label, hint, error, children, className, required }: {
  label?: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string; required?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label className="block text-xs font-medium text-muted">
          {label} {required && <span className="text-danger">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-danger" role="alert">{error}</p> : hint ? <p className="text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, description }: {
  checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; description?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      {(label || description) && (
        <label htmlFor={id} className="min-w-0">
          {label && <span className="block text-[13px] font-medium text-fg">{label}</span>}
          {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
        </label>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        data-cursor="hover"
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50",
          checked ? "border-accent/60 bg-accent" : "border-line-strong bg-elevated",
        )}
      >
        <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-[2px]")} />
      </button>
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-fg" data-cursor="hover">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-line-strong bg-surface accent-[rgb(var(--accent))]" />
      {label}
    </label>
  );
}
