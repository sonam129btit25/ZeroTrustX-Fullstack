import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Copy, Pencil, Plus, Search, ShieldQuestion, Trash2 } from "lucide-react";
import { api, apiError } from "@/services/api";
import type { Decision, Policy, PolicyFields } from "@/types/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Card, Toolbar } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Input, Select, Switch } from "@/components/ui/Form";
import { Badge, DECISION_LABEL, DecisionBadge, DemoTag } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/Data";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { cn, fmtDate, fmtNum, timeAgo } from "@/utils/format";
import { policyKeys } from "./api";
import { DECISION_ORDER } from "./types";
import { ConditionList } from "./ui";

export function PolicyList({ policies, loading, error, catalogue, onOpen, onEdit, onDuplicate, onCreate }: {
  policies?: Policy[]; loading: boolean; error?: unknown; catalogue?: PolicyFields;
  onOpen: (p: Policy) => void; onEdit: (p: Policy) => void; onDuplicate: (p: Policy) => void; onCreate: () => void;
}) {
  const { can } = useAuth();
  const canWrite = can("policies:write");
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [action, setAction] = useState<"" | Decision>("");
  const [toDelete, setToDelete] = useState<Policy | null>(null);
  const [busyToggle, setBusyToggle] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (policies ?? []).filter((p) => (!action || p.action === action) &&
      (!s || p.name.toLowerCase().includes(s) || p.description.toLowerCase().includes(s)));
  }, [policies, q, action]);
  const filtering = !!q.trim() || !!action;

  const toggle = useMutation({
    mutationFn: async (p: Policy) => (await api.post<Policy>(`/policies/${p.id}/toggle`)).data,
    onMutate: (p) => setBusyToggle(p.id),
    onSuccess: (p) => {
      qc.setQueryData<Policy[]>(policyKeys.list, (old) => old?.map((x) => (x.id === p.id ? { ...x, ...p, stats: x.stats } : x)));
      qc.invalidateQueries({ queryKey: ["policies"] });
      toast.success(p.is_enabled ? "Policy enabled" : "Policy disabled", p.name);
    },
    onError: (e) => toast.error("Could not change policy state", apiError(e).message),
    onSettled: () => setBusyToggle(null),
  });

  const reorder = useMutation({
    mutationFn: async (ids: string[]) => (await api.post<Policy[]>("/policies/reorder", { policy_ids: ids })).data,
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: policyKeys.list });
      const prev = qc.getQueryData<Policy[]>(policyKeys.list);
      if (prev) {
        const byId = new Map(prev.map((p) => [p.id, p]));
        qc.setQueryData<Policy[]>(policyKeys.list, ids.map((id, i) => ({ ...byId.get(id)!, priority: (i + 1) * 10 })));
      }
      return { prev };
    },
    onSuccess: (data) => { qc.setQueryData(policyKeys.list, data); toast.success("Evaluation order updated", "Priorities renumbered in steps of 10."); },
    onError: (e, _ids, ctx) => { if (ctx?.prev) qc.setQueryData(policyKeys.list, ctx.prev); toast.error("Reorder failed", apiError(e).message); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["policies"] }),
  });

  const del = useMutation({
    mutationFn: async (p: Policy) => { await api.delete(`/policies/${p.id}`); return p; },
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ["policies"] }); toast.success("Policy deleted", p.name); setToDelete(null); },
    onError: (e) => toast.error("Could not delete policy", apiError(e).message),
  });

  const move = (p: Policy, dir: -1 | 1) => {
    const list = [...(policies ?? [])];
    const i = list.findIndex((x) => x.id === p.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    reorder.mutate(list.map((x) => x.id));
  };

  const all = policies ?? [];
  return (
    <Card>
      <Toolbar>
        <div className="md:w-72"><Input leading={<Search className="h-3.5 w-3.5" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search policies" aria-label="Search policies" /></div>
        <div className="md:w-52">
          <Select value={action} onChange={(e) => setAction(e.target.value as "" | Decision)} aria-label="Filter by outcome">
            <option value="">All outcomes</option>
            {DECISION_ORDER.map((d) => <option key={d} value={d}>{DECISION_LABEL[d]}</option>)}
          </Select>
        </div>
        <p className="text-2xs text-subtle md:ml-auto">
          {canWrite && filtering ? "Clear filters to reorder" : "Evaluated top to bottom · lower priority number runs first"}
        </p>
      </Toolbar>

      {loading && !policies && (
        <div className="divide-y divide-line/60">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex gap-4 p-4"><Skeleton className="h-10 w-10" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-6 w-1/2" /></div></div>)}</div>
      )}
      {!!error && !policies && <EmptyState title="Could not load policies" description={apiError(error).message} />}
      {policies && filtered.length === 0 && (
        <EmptyState icon={<ShieldQuestion className="h-5 w-5" />} title={filtering ? "No policies match your filters" : "No policies yet"}
          description={filtering ? "Try a different search term or outcome." : "Without policies every entitled request falls through to the organisation default action (deny by default)."}
          action={!filtering && canWrite ? <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={onCreate}>New policy</Button> : undefined} />
      )}

      <ul className="divide-y divide-line/60">
        {filtered.map((p) => {
          const idx = all.findIndex((x) => x.id === p.id);
          return (
            <motion.li layout="position" key={p.id} transition={{ type: "spring", stiffness: 500, damping: 40 }}
              className="group relative flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-elevated/30 lg:flex-row lg:items-start">
              <div className="flex items-center gap-2 lg:w-[68px] lg:flex-col lg:items-start lg:gap-1">
                <span className="num rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-xs text-fg" title="Priority">{p.priority}</span>
                {canWrite && !filtering && (
                  <span className="flex gap-0.5">
                    <button type="button" aria-label={`Move ${p.name} up`} disabled={idx <= 0 || reorder.isPending} onClick={() => move(p, -1)}
                      className="rounded p-1 text-subtle hover:bg-elevated hover:text-fg disabled:opacity-30" data-cursor="hover"><ChevronUp className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label={`Move ${p.name} down`} disabled={idx >= all.length - 1 || reorder.isPending} onClick={() => move(p, 1)}
                      className="rounded p-1 text-subtle hover:bg-elevated hover:text-fg disabled:opacity-30" data-cursor="hover"><ChevronDown className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </div>

              <div className={cn("min-w-0 flex-1 space-y-2", !p.is_enabled && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => onOpen(p)} className="text-left text-[13px] font-semibold text-fg hover:text-accent" data-cursor="hover">{p.name}</button>
                  <span className="font-mono text-2xs text-subtle">v{p.version}</span>
                  {p.is_demo && <DemoTag />}
                  {!p.is_enabled && <Badge>disabled</Badge>}
                </div>
                {p.description && <p className="line-clamp-2 text-xs leading-relaxed text-muted">{p.description}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label !text-[10px]">{p.match_mode === "all" ? "Match all" : "Match any"}</span>
                  <ConditionList conditions={p.conditions} matchMode={p.match_mode} catalogue={catalogue} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:w-[360px] lg:justify-end">
                <div className="flex items-center gap-2"><span className="text-2xs text-subtle">then</span><DecisionBadge decision={p.action} /></div>
                <div className="text-2xs leading-4 text-muted lg:text-right" title={p.stats.last_matched_at ? `Last matched ${fmtDate(p.stats.last_matched_at)}` : "No matches in the last 30 days"}>
                  <span className="num text-fg">{fmtNum(p.stats.matches_30d)}</span> matches · <span className="num text-fg">{fmtNum(p.stats.deciding_30d)}</span> deciding
                  <span className="block text-subtle">{p.stats.last_matched_at ? `last ${timeAgo(p.stats.last_matched_at)}` : "no matches · 30d"}</span>
                </div>
                <div className="flex items-center gap-1">
                  {canWrite ? (
                    <span title={p.is_enabled ? "Disable policy" : "Enable policy"} className="mr-1">
                      <Switch checked={p.is_enabled} disabled={busyToggle === p.id} onChange={() => toggle.mutate(p)} />
                    </span>
                  ) : (
                    <Badge tone={p.is_enabled ? "success" : "neutral"} dot>{p.is_enabled ? "Enabled" : "Disabled"}</Badge>
                  )}
                  {canWrite && <>
                    <Button size="icon" variant="ghost" aria-label={`Edit ${p.name}`} title="Edit" onClick={() => onEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Duplicate ${p.name}`} title="Duplicate" onClick={() => onDuplicate(p)}><Copy className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete ${p.name}`} title="Delete" onClick={() => setToDelete(p)} className="hover:!text-danger"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </>}
                </div>
              </div>
            </motion.li>
          );
        })}
      </ul>

      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && del.mutate(toDelete)} loading={del.isPending}
        title="Delete policy?" confirmLabel="Delete policy"
        description={toDelete && <>“{toDelete.name}” will stop participating in access decisions immediately. Historical decisions keep their record; the deletion is audited.</>}>
        {toDelete && (
          <div className="rounded-lg border border-line bg-surface/50 p-3">
            <div className="mb-2 flex items-center gap-2"><span className="font-mono text-2xs text-subtle">P{toDelete.priority}</span><DecisionBadge decision={toDelete.action} /></div>
            <ConditionList conditions={toDelete.conditions} matchMode={toDelete.match_mode} catalogue={catalogue} />
          </div>
        )}
      </ConfirmDialog>
    </Card>
  );
}
