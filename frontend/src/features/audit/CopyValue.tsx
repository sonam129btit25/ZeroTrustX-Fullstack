import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/utils/format";

/** Copy text to the clipboard with a graceful fallback for non-secure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Small icon button that copies `value` and briefly confirms. */
export function CopyButton({ value, label = "Copy", className, toastTitle }: { value: string; label?: string; className?: string; toastTitle?: string }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-cursor="hover"
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyText(value);
        if (ok) {
          setDone(true);
          if (toastTitle) toast.success(toastTitle);
        } else toast.error("Could not copy", "Your browser blocked clipboard access.");
      }}
      className={cn("inline-grid h-6 w-6 shrink-0 place-items-center rounded-md text-subtle transition-colors hover:bg-elevated hover:text-fg", className)}
    >
      {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Monospace value truncated in the middle, with a copy button. */
export function MonoCopy({ value, head = 10, tail = 8, className }: { value: string | null | undefined; head?: number; tail?: number; className?: string }) {
  if (!value) return <span className="text-subtle">—</span>;
  const short = value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <code title={value} className="truncate rounded border border-line bg-surface/70 px-1.5 py-0.5 font-mono text-2xs text-fg/90">{short}</code>
      <CopyButton value={value} label="Copy full value" />
    </span>
  );
}
