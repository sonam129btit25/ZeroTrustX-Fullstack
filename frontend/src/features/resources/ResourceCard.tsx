import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BadgeCheck, Clock, FilePlus2, KeyRound, Network, Pencil, ShieldCheck, Timer, Trash2, UserRound, Workflow } from "lucide-react";
import type { Resource } from "@/types/api";
import { Card } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Badge, DemoTag } from "@/components/ui/Badge";
import { cn } from "@/utils/format";
import { SensitivityBadge, TypeIcon, entitlementState, windowLabel } from "./meta";

const SENS_ICON_TONE = { public: "bg-elevated text-muted", internal: "bg-accent/10 text-accent", confidential: "bg-warning/10 text-warning", restricted: "bg-danger/10 text-danger" };

export function ResourceCard({ r, index, canWrite, onOpen, onAccess, onEdit, onDelete }: {
  r: Resource; index: number; canWrite: boolean; onOpen: () => void; onAccess: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const ent = entitlementState(r);
  const win = windowLabel(r);
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <motion.div className="h-full" layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(index * 0.03, 0.25) }}>
      <Card interactive className={cn("h-full cursor-pointer [&>div.relative]:h-full", !r.is_active && "opacity-70")} onClick={onOpen} data-cursor="hover"
        role="button" tabIndex={0} aria-label={`Open ${r.name}`} onKeyDown={(e) => { if (e.key === "Enter" && e.currentTarget === e.target) onOpen(); }}>
        <div className="flex h-full flex-col p-4">
          <div className="flex items-start gap-3">
            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", SENS_ICON_TONE[r.sensitivity])}>
              <TypeIcon type={r.resource_type} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="truncate text-[13px] font-semibold text-fg">{r.name}</h3>
                {r.is_demo && <DemoTag />}
                {!r.is_active && <Badge>inactive</Badge>}
              </div>
              <p className="mt-0.5 text-2xs capitalize text-subtle">{r.resource_type}</p>
            </div>
            <SensitivityBadge sensitivity={r.sensitivity} />
          </div>

          <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted">{r.description || "No description."}</p>

          <dl className="mt-3 space-y-1.5 text-2xs">
            <div className="flex items-center gap-2 text-muted"><UserRound className="h-3 w-3 shrink-0 text-subtle" /><dt className="sr-only">Owner</dt><dd className="truncate">{r.owner?.full_name ?? "No owner"}</dd></div>
            <div className="flex items-center gap-2 text-muted"><KeyRound className="h-3 w-3 shrink-0 text-subtle" /><dt className="sr-only">Required permission</dt><dd className="truncate font-mono">{r.required_permission ?? "no permission required"}</dd></div>
            <div className="flex items-center gap-2 text-muted"><Workflow className="h-3 w-3 shrink-0 text-subtle" /><dt className="sr-only">Approval</dt>
              <dd>{r.requires_approval ? "Manual approval" : "Auto-approve if policy allows"} · max {r.max_grant_hours}h</dd></div>
            {(r.allowed_ip_ranges.length > 0 || win) && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {r.allowed_ip_ranges.length > 0 && <Badge tone="lavender"><Network className="h-3 w-3" />{r.allowed_ip_ranges.length} network{r.allowed_ip_ranges.length > 1 ? "s" : ""}</Badge>}
                {win && <Badge tone="cyan"><Clock className="h-3 w-3" />{win}</Badge>}
              </div>
            )}
          </dl>

          <div className="mt-auto pt-4"><div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3">
            <span className="flex items-center gap-1.5 text-2xs font-medium">
              {ent === "permission" && <><BadgeCheck className="h-3.5 w-3.5 text-success" /><span className="text-success">{r.sensitivity === "public" ? "Open to everyone" : "Entitled via role"}</span></>}
              {ent === "grant" && <><Timer className="h-3.5 w-3.5 text-accent" /><span className="text-accent">Active grant</span></>}
              {ent === "none" && <span className="text-subtle">Not entitled</span>}
            </span>
            <span className="flex items-center gap-1">
              {canWrite && <>
                <Button size="icon" variant="ghost" aria-label={`Edit ${r.name}`} title="Edit" onClick={stop(onEdit)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" aria-label={`Delete ${r.name}`} title="Delete" onClick={stop(onDelete)} className="hover:!text-danger"><Trash2 className="h-3.5 w-3.5" /></Button>
              </>}
              {ent === "none" && (
                <Link to={`/access-requests?new=1&resource=${r.id}`} onClick={(e) => e.stopPropagation()}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-medium text-fg hover:border-line-strong hover:bg-elevated/60" data-cursor="hover">
                  <FilePlus2 className="h-3 w-3" />Request
                </Link>
              )}
              <Button size="xs" variant={ent === "none" ? "ghost" : "primary"} icon={<ShieldCheck className="h-3 w-3" />} onClick={stop(onAccess)} disabled={!r.is_active}>Access</Button>
            </span>
          </div></div>
        </div>
      </Card>
    </motion.div>
  );
}
