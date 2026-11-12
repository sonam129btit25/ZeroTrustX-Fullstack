import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/format";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

function useFocusTrap(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select, button:not([aria-label='Close'])");
      el?.focus();
    }, 30);
    return () => { window.clearTimeout(t); prev?.focus?.(); };
  }, [open]);
  return ref;
}

export function Modal({ open, onClose, title, description, children, footer, size = "md" }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  useEscape(open, onClose);
  const ref = useFocusTrap(open);
  const width = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
          <motion.div className="absolute inset-0 bg-[rgb(5_8_18/0.62)] backdrop-blur-[3px]" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            ref={ref}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={cn("card-elevated relative flex max-h-[92vh] w-full flex-col rounded-b-none sm:rounded-2xl", width)}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
                {description && <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>}
              </div>
              <button aria-label="Close" onClick={onClose} className="rounded-md p-1 text-subtle hover:bg-card hover:text-fg"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = "max-w-xl" }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string;
}) {
  useEscape(open, onClose);
  const ref = useFocusTrap(open);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
          <motion.div className="absolute inset-0 bg-[rgb(5_8_18/0.5)] backdrop-blur-[2px]" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside
            ref={ref}
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%", transition: { duration: 0.2 } }}
            transition={{ type: "spring", stiffness: 340, damping: 36 }}
            className={cn("absolute right-0 top-0 flex h-full w-full flex-col border-l border-line bg-surface shadow-pop", width)}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-semibold">{title}</h2>
                {subtitle && <div className="mt-1 text-xs text-muted">{subtitle}</div>}
              </div>
              <button aria-label="Close" onClick={onClose} className="rounded-md p-1 text-subtle hover:bg-card hover:text-fg"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", tone = "danger", loading, children }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; description?: ReactNode; confirmLabel?: string;
  tone?: "danger" | "primary"; loading?: boolean; children?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} size="sm" title={
      <span className="flex items-center gap-2">
        {tone === "danger" && <AlertTriangle className="h-4 w-4 text-danger" />}{title}
      </span>
    } description={description}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading} data-autofocus>{confirmLabel}</Button>
      </>}>
      {children}
    </Modal>
  );
}
