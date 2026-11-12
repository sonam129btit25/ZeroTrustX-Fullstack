import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FilePlus2, Pencil, ShieldCheck } from "lucide-react";
import { api, apiError } from "@/services/api";
import type { Resource } from "@/types/api";
import { useAuth } from "@/context/AuthContext";
import { Drawer } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { DecisionBadge, DemoTag, StatusBadge } from "@/components/ui/Badge";
import { EmptyState, KeyValue, Skeleton } from "@/components/ui/Data";
import { fmtDate, timeAgo, titleCase } from "@/utils/format";
import { SectionLabel } from "@/features/policies/ui";
import { SensitivityBadge, TypeIcon, entitlementState, windowLabel, type ResourceDetail } from "./meta";

export function ResourceDetailDrawer({ resourceId, onClose, onAccess, onEdit }: {
  resourceId: string | null; onClose: () => void; onAccess: (r: Resource) => void; onEdit: (r: Resource) => void;
}) {
  const { can } = useAuth();
  const q = useQuery({
    queryKey: ["resources", "detail", resourceId], enabled: !!resourceId,
    queryFn: async () => (await api.get<ResourceDetail>(`/resources/${resourceId}`)).data,
  });
  const r = q.data;
  const ent = r ? entitlementState(r) : "none";
  return (
    <Drawer open={!!resourceId} onClose={onClose} width="max-w-xl"
      title={r ? <span className="flex items-center gap-2"><TypeIcon type={r.resource_type} className="h-4 w-4 text-muted" />{r.name}{r.is_demo && <DemoTag />}</span> : "Resource"}
      subtitle={r && <span className="flex flex-wrap items-center gap-2"><SensitivityBadge sensitivity={r.sensitivity} /><span className="font-mono">{r.slug}</span></span>}
      footer={r && <>
        {can("resources:write") && <Button variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(r)}>Edit</Button>}
        {ent === "none" && r.sensitivity !== "public" && (
          <Link to={`/access-requests?new=1&resource=${r.id}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3.5 text-[13px] font-medium text-fg hover:border-line-strong hover:bg-elevated/60">
            <FilePlus2 className="h-3.5 w-3.5" /> Request access
          </Link>
        )}
        <Button variant="primary" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => onAccess(r)} disabled={!r.is_active}>Access</Button>
      </>}>
      {q.isLoading && <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>}
      {q.isError && <EmptyState title="Could not load resource" description={apiError(q.error).message} />}
      {r && (
        <div className="space-y-5">
          {r.description && <p className="text-[13px] leading-relaxed text-muted">{r.description}</p>}
          <KeyValue items={[
            ["Type", titleCase(r.resource_type)],
            ["State", <StatusBadge status={r.is_active ? "active" : "deactivated"} />],
            ["Owner", r.owner ? r.owner.full_name : "Unassigned"],
            ["Required permission", <span className="font-mono text-xs">{r.required_permission ?? "none (public)"}</span>],
            ["Approval", r.requires_approval ? "Manual review required" : "Automatic when policy allows"],
            ["Max grant", `${r.max_grant_hours} h`],
            ["Allowed networks", r.allowed_ip_ranges.length ? <span className="font-mono text-xs">{r.allowed_ip_ranges.join(", ")}</span> : "Any network"],
            ["Access window", windowLabel(r) ?? "Any time"],
            ["Your entitlement", ent === "permission" ? "Via role permission" : ent === "grant" ? "Active approved grant" : "Not entitled"],
            ["URL", r.url ? <span className="font-mono text-xs">{r.url}</span> : "—"],
          ]} />

          {r.active_grants && (
            <div>
              <SectionLabel>Active grants · {r.active_grants.length}</SectionLabel>
              {r.active_grants.length === 0 ? <p className="text-xs text-muted">No approved grants are currently active.</p> : (
                <ul className="divide-y divide-line/60 rounded-lg border border-line">
                  {r.active_grants.map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                      <Link to={`/access-requests?id=${g.id}`} className="truncate text-fg hover:text-accent">{g.user}</Link>
                      <span className="shrink-0 text-muted">expires {g.expires_at ? timeAgo(g.expires_at) : "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {r.access_history && (
            <div>
              <SectionLabel>Access history · last {r.access_history.length}</SectionLabel>
              {r.access_history.length === 0 ? <p className="text-xs text-muted">No access decisions recorded for this resource yet.</p> : (
                <ul className="divide-y divide-line/60 rounded-lg border border-line">
                  {r.access_history.map((d) => (
                    <li key={d.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                      <DecisionBadge decision={d.decision} />
                      <div className="min-w-0 flex-1 text-xs">
                        <p className="truncate text-fg">{d.user ?? "unknown"} <span className="text-subtle">· {titleCase(d.source)}</span></p>
                        <p className="truncate text-2xs text-muted" title={d.reasons.join("; ")}>{d.reasons[0] ?? "—"}</p>
                      </div>
                      <div className="shrink-0 text-right text-2xs text-subtle">
                        <span className="font-mono">{d.ip_address ?? "—"}</span>
                        <span className="block" title={fmtDate(d.evaluated_at)}>{timeAgo(d.evaluated_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
