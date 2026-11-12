import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, FlaskConical, ListChecks, Plus, ShieldCheck, ShieldOff, Activity, Layers } from "lucide-react";
import type { Policy } from "@/types/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Data";
import { StatCard } from "@/components/ui/StatCard";
import { fmtNum } from "@/utils/format";
import { usePolicies, usePolicyFields, useResourceCatalogue } from "@/features/policies/api";
import { PolicyList } from "@/features/policies/PolicyList";
import { PolicyEditor, type EditorSeed } from "@/features/policies/PolicyEditor";
import { PolicyDetailDrawer } from "@/features/policies/PolicyDetail";
import { Simulator } from "@/features/policies/Simulator";
import { HowItWorks } from "@/features/policies/HowItWorks";

type Tab = "policies" | "simulator" | "how";

export default function Policies() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const canSim = can("policies:simulate");
  const canWrite = can("policies:write");
  const raw = params.get("tab");
  const tab: Tab = raw === "simulator" && canSim ? "simulator" : raw === "how" ? "how" : "policies";
  const detailId = params.get("policy");

  const policies = usePolicies();
  const fields = usePolicyFields();
  const resources = useResourceCatalogue();
  const [seed, setSeed] = useState<EditorSeed | null>(null);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null) next.delete(k); else next.set(k, v);
    setParams(next, { replace: k === "policy" ? false : true });
  };
  const setTab = (t: Tab) => setParam("tab", t === "policies" ? null : t);

  const stats = useMemo(() => {
    const ps = policies.data ?? [];
    return {
      total: ps.length,
      enabled: ps.filter((p) => p.is_enabled).length,
      deny: ps.filter((p) => p.is_enabled && p.action === "DENY").length,
      deciding: ps.reduce((a, p) => a + p.stats.deciding_30d, 0),
    };
  }, [policies.data]);

  const nextPriority = useMemo(() => {
    const ps = policies.data ?? [];
    return Math.min(10000, (ps.length ? Math.max(...ps.map((p) => p.priority)) : 0) + 10);
  }, [policies.data]);

  const openCreate = () => setSeed({ mode: "create", priority: nextPriority });
  const openEdit = (p: Policy) => { setParam("policy", null); setSeed({ mode: "edit", policy: p }); };
  const openDuplicate = (p: Policy) => setSeed({ mode: "duplicate", policy: p, priority: Math.min(10000, p.priority + 1) });

  return (
    <div>
      <PageHeader title="Policies"
        description="Attribute-based Zero Trust policies evaluated deterministically for every access attempt. The most restrictive matching outcome wins."
        actions={<>
          {canSim && tab !== "simulator" && <Button variant="outline" icon={<FlaskConical className="h-3.5 w-3.5" />} onClick={() => setTab("simulator")}>Simulate</Button>}
          {canWrite && <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate} disabled={!fields.data}>New policy</Button>}
        </>} />

      <Tabs className="mb-5 w-full sm:w-fit" value={tab} onChange={setTab} tabs={[
        { value: "policies", label: <span className="flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" />Policies</span>, count: policies.data?.length },
        ...(canSim ? [{ value: "simulator" as Tab, label: <span className="flex items-center gap-1.5"><FlaskConical className="h-3.5 w-3.5" />Simulator</span> }] : []),
        { value: "how", label: <span className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" />How evaluation works</span> },
      ]} />

      {tab === "policies" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Policies" value={fmtNum(stats.total)} icon={<Layers className="h-3.5 w-3.5" />} loading={policies.isLoading} />
            <StatCard label="Enabled" value={fmtNum(stats.enabled)} icon={<ShieldCheck className="h-3.5 w-3.5" />} tone="success" loading={policies.isLoading}
              hint={stats.total - stats.enabled ? `${stats.total - stats.enabled} disabled` : "all active"} />
            <StatCard label="Deny policies" value={fmtNum(stats.deny)} icon={<ShieldOff className="h-3.5 w-3.5" />} tone="danger" loading={policies.isLoading} hint="enabled, DENY outcome" />
            <StatCard label="Deciding · 30 days" value={fmtNum(stats.deciding)} icon={<Activity className="h-3.5 w-3.5" />} tone="lavender" loading={policies.isLoading} hint="decisions settled by a policy" />
          </div>
          <PolicyList policies={policies.data} loading={policies.isLoading} error={policies.error} catalogue={fields.data}
            onOpen={(p) => setParam("policy", p.id)} onEdit={openEdit} onDuplicate={openDuplicate} onCreate={openCreate} />
        </div>
      )}

      {tab === "simulator" && canSim && <Simulator resources={resources.data ?? []} resourcesLoading={resources.isLoading} />}
      {tab === "how" && <HowItWorks policies={policies.data} loading={policies.isLoading} />}

      <PolicyDetailDrawer policyId={detailId} onClose={() => setParam("policy", null)} catalogue={fields.data}
        onEdit={openEdit} onSimulate={canSim ? () => { const n = new URLSearchParams(params); n.delete("policy"); n.set("tab", "simulator"); setParams(n); } : undefined} />

      {fields.data && canWrite && (
        <PolicyEditor open={!!seed} seed={seed} onClose={() => setSeed(null)} catalogue={fields.data} resources={resources.data ?? []} />
      )}
    </div>
  );
}
