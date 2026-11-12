import { Fragment } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/utils/format";
import { INCIDENT_FLOW, STATUS_HINT, STATUS_LABEL, type IncidentStatus } from "@/features/incidents/shared";

/** Linear visualisation of the incident lifecycle with the current state highlighted. */
export function StatusStepper({ status }: { status: IncidentStatus }) {
  const current = INCIDENT_FLOW.indexOf(status);
  return (
    <ol className="flex items-start" aria-label="Incident workflow">
      {INCIDENT_FLOW.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <Fragment key={s}>
            <li className="flex w-0 min-w-0 flex-1 flex-col items-center text-center" aria-current={active ? "step" : undefined}>
              <div className="relative">
                {active && (
                  <motion.span layoutId="incident-step-ring" className="absolute -inset-1.5 rounded-full border border-accent/40"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }} />
                )}
                <span className={cn(
                  "relative grid h-7 w-7 place-items-center rounded-full border text-2xs font-semibold transition-colors duration-300",
                  done && "border-accent/40 bg-accent/15 text-accent",
                  active && "border-accent bg-accent text-accent-fg",
                  !done && !active && "border-line-strong bg-elevated text-subtle",
                )}>
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
              </div>
              <p className={cn("mt-2 text-[11px] font-medium sm:text-xs", active ? "text-fg" : done ? "text-muted" : "text-subtle")}>{STATUS_LABEL[s]}</p>
              <p className="mt-0.5 hidden px-1 text-2xs leading-snug text-subtle md:block">{STATUS_HINT[s]}</p>
            </li>
            {i < INCIDENT_FLOW.length - 1 && (
              <li aria-hidden className="mt-[13px] h-px w-full min-w-[8px] flex-1 overflow-hidden bg-line-strong/60">
                <motion.span className="block h-full bg-accent/60" initial={false} animate={{ width: i < current ? "100%" : "0%" }} transition={{ duration: 0.5 }} />
              </li>
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
