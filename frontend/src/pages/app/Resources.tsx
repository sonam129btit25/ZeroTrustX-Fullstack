import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { Boxes, Plus, Search } from "lucide-react";
import { api, apiError } from "@/services/api";
import type { Resource, Sensitivity } from "@/types/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Card, PageHeader } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { EmptyState, Skeleton, Tabs } from "@/components/ui/Data";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { titleCase } from "@/utils/format";
import { useResourceCatalogue } from "@/features/policies/api";
import { ResourceCard } from "@/features/resources/ResourceCard";
import { AccessCheckModal } from "@/features/resources/AccessCheckModal";
import { ResourceEditor } from "@/features/resources/ResourceEditor";
import { ResourceDetailDrawer } from "@/features/resources/ResourceDetail";
import { SENSITIVITIES, SensitivityBadge } from "@/features/resources/meta";

type Filter = "all" | Sensitivity;

export default function Resources() {
  const { can } = useAuth();
  const canWrite = can("resources:write");
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const list = useResourceCatalogue();
  const [q, setQ] = useState("");
  const filter = (SENSITIVITIES as string[]).includes(params.get("sensitivity") ?? "") ? (params.get("sensitivity") as Sensitivity) : "all";
  const detailId = params.get("id");
  const [accessFor, setAccessFor] = useState<Resource | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; resource: Resource | null }>({ open: false, resource: null });
  const [toDelete, setToDelete] = useState<Resource | null>(null);

  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v === null) n.delete(k); else n.set(k, v);
    setParams(n, { replace: true });
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: list.data?.length ?? 0 };
    SENSITIVITIES.forEach((s) => { c[s] = list.data?.filter((r) => r.sensitivity === s).length ?? 0; });
    return c;
  }, [list.data]);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list.data ?? []).filter((r) => (filter === "all" || r.sensitivity === filter) &&
      (!s || r.name.toLowerCase().includes(s) || r.description.toLowerCase().includes(s) || (r.required_permission ?? "").includes(s)));
  }, [list.data, q, filter]);

  const del = useMutation({
    mutationFn: async (r: Resource) => { await api.delete(`/resources/${r.id}`); return r; },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["resources"] });
      toast.success("Resource deleted", r.name);
      setToDelete(null);
      if (detailId === r.id) setParam("id", null);
    },
    onError: (e) => toast.error("Could not delete resource", apiError(e).message),
  });

  return (
    <div>
      <PageHeader title="Resources"
        description="Protected applications and data. Every access goes through the Policy Enforcement Point and is evaluated against your identity, session, device and network."
        actions={canWrite && <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditor({ open: true, resource: null })}>Add resource</Button>} />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs value={filter} onChange={(v: Filter) => setParam("sensitivity", v === "all" ? null : v)} tabs={[
          { value: "all" as Filter, label: "All", count: counts.all },
          ...SENSITIVITIES.map((s) => ({ value: s as Filter, label: titleCase(s), count: counts[s] })),
        ]} />
        <div className="md:w-72">
          <Input leading={<Search className="h-3.5 w-3.5" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, description, permission" aria-label="Search resources" />
        </div>
      </div>

      {list.isLoading && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[248px] rounded-xl" />)}</div>}
      {list.isError && <Card><EmptyState title="Could not load resources" description={apiError(list.error).message}
        action={<Button onClick={() => list.refetch()}>Retry</Button>} /></Card>}
      {list.data && items.length === 0 && (
        <Card><EmptyState icon={<Boxes className="h-5 w-5" />} title={list.data.length ? "No resources match" : "No protected resources yet"}
          description={list.data.length ? "Try another sensitivity or search term." : "Add an application, database or document to protect it behind the Zero Trust engine."}
          action={!list.data.length && canWrite ? <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditor({ open: true, resource: null })}>Add resource</Button> : undefined} /></Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence>
          {items.map((r, i) => (
            <ResourceCard key={r.id} r={r} index={i} canWrite={canWrite}
              onOpen={() => setParam("id", r.id)} onAccess={() => setAccessFor(r)}
              onEdit={() => setEditor({ open: true, resource: r })} onDelete={() => setToDelete(r)} />
          ))}
        </AnimatePresence>
      </div>

      <ResourceDetailDrawer resourceId={detailId} onClose={() => setParam("id", null)} onAccess={(r) => setAccessFor(r)}
        onEdit={(r) => setEditor({ open: true, resource: r })} />
      <AccessCheckModal resource={accessFor} onClose={() => setAccessFor(null)} />
      {canWrite && <ResourceEditor open={editor.open} resource={editor.resource} onClose={() => setEditor({ open: false, resource: null })} />}
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && del.mutate(toDelete)} loading={del.isPending}
        title="Delete resource?" confirmLabel="Delete resource"
        description={toDelete && <>“{toDelete.name}” will be removed from the catalogue. Access requests and grants for it can no longer be used. This is audited and cannot be undone.</>}>
        {toDelete && <div className="flex items-center gap-2 rounded-lg border border-line bg-surface/50 p-3 text-xs"><SensitivityBadge sensitivity={toDelete.sensitivity} /><span className="font-mono text-muted">{toDelete.required_permission ?? "public"}</span></div>}
      </ConfirmDialog>
    </div>
  );
}
