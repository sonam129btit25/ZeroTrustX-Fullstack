import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/utils/format";

type Kind = "success" | "error" | "info" | "warning";
interface Toast { id: number; kind: Kind; title: string; description?: string }
interface ToastApi {
  push: (t: Omit<Toast, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let seq = 0;

const ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const TONE = { success: "text-success", error: "text-danger", info: "text-accent", warning: "text-warning" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq;
    setToasts((all) => [...all.slice(-4), { ...t, id }]);
    window.setTimeout(() => dismiss(id), t.kind === "error" ? 7000 : 4500);
  }, [dismiss]);
  const api = useMemo<ToastApi>(() => ({
    push,
    success: (title, description) => push({ kind: "success", title, description }),
    error: (title, description) => push({ kind: "error", title, description }),
    info: (title, description) => push({ kind: "info", title, description }),
    warning: (title, description) => push({ kind: "warning", title, description }),
  }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const Icon = ICON[t.kind];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="card-elevated pointer-events-auto flex items-start gap-3 p-3.5"
                role="status"
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TONE[t.kind])} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-fg">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{t.description}</p>}
                </div>
                <button aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-subtle hover:text-fg">
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return c;
}
