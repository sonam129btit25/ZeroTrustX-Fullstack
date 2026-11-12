import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Info, Laptop, Plus, Search, ShieldAlert } from "lucide-react";
import { Card, PageHeader, Toolbar } from "@/components/ui/Page";
import { DemoTag, TrustBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { DataTable, EmptyState, Pagination, Tabs, type Column } from "@/components/ui/Data";
import { RiskMeter } from "@/components/security/Risk";
import { useAuth } from "@/context/AuthContext";
import { api, apiError, cleanParams } from "@/services/api";
import type { Device, Page, TrustStatus } from "@/types/api";
import { fmtDate, timeAgo } from "@/utils/format";
import { useDebounced, useTick } from "@/features/identity/hooks";
import { DeviceIcon, type DeviceSummary } from "@/features/devices/meta";
import { DeviceDrawer } from "@/features/devices/DeviceDrawer";
import { DeviceFormModal } from "@/features/devices/DeviceFormModal";

type Filter = "all" | TrustStatus;
const PAGE_SIZE = 20;

export default function Devices() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const openId = params.get("id");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [sort, setSort] = useState<{ key: string; order: "asc" | "desc" }>({ key: "last_seen_at", order: "desc" });
  const [page, setPage] = useState(1);
  const [registering, setRegistering] = useState(false);
  useTick(30_000);

  const setOpen = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set("id", id); else n.delete("id"); return n; }, { replace: !id });

  const summary = useQuery({
    queryKey: ["devices", "summary"],
    queryFn: async () => (await api.get<DeviceSummary>("/devices/summary")).data,
  });
  const list = useQuery({
    queryKey: ["devices", "list", { filter, q, sort, page }],
    queryFn: async () => (await api.get<Page<Device>>("/devices", {
      params: cleanParams({ trust_status: filter === "all" ? "" : filter, q, sort: sort.key, order: sort.order, page, page_size: PAGE_SIZE }),
    })).data,
    placeholderData: keepPreviousData,
  });

  const s = summary.data;
  const onSort = (key: string) => { setSort((x) => ({ key, order: x.key === key && x.order === "desc" ? "asc" : "desc" })); setPage(1); };

  const columns: Column<Device>[] = [
    {
      key: "name", header: "Device", sortable: true, render: (d) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-elevated text-muted"><DeviceIcon type={d.device_type} /></span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium text-fg"><span className="truncate">{d.name}</span>{d.is_demo && <DemoTag />}</p>
            <p className="max-w-[200px] truncate font-mono text-2xs text-subtle" title={d.device_identifier}>{d.device_identifier}</p>
          </div>
        </div>
      ),
    },
    {
      key: "user", header: "Assigned user", hideBelow: "md", render: (d) => d.user ? (
        <div className="min-w-0 leading-tight"><p className="truncate text-xs text-fg">{d.user.full_name}</p><p className="truncate text-2xs text-muted">{d.user.email}</p></div>
      ) : <span className="text-xs text-subtle">Unassigned</span>,
    },
    { key: "os", header: "OS", hideBelow: "sm", render: (d) => <span className="text-xs text-muted">{[d.os, d.os_version].filter(Boolean).join(" ") || "Unknown"}</span> },
    { key: "browser", header: "Browser", hideBelow: "lg", render: (d) => <span className="text-xs text-muted">{d.browser ?? "—"}</span> },
    { key: "ip", header: "IP", hideBelow: "xl", render: (d) => <span className="font-mono text-xs text-muted">{d.ip_address ?? "—"}</span> },
    { key: "last_seen_at", header: "Last seen", sortable: true, render: (d) => <span className="text-xs text-muted" title={fmtDate(d.last_seen_at)}>{d.last_seen_at ? timeAgo(d.last_seen_at) : "Never"}</span> },
    { key: "trust_status", header: "Trust", sortable: true, render: (d) => <TrustBadge status={d.trust_status} /> },
    { key: "risk_score", header: "Risk", sortable: true, render: (d) => <RiskMeter score={d.risk_score} /> },
  ];

  const tabs: { value: Filter; label: string; count?: number }[] = [
    { value: "all", label: "All", count: s?.total },
    { value: "trusted", label: "Trusted", count: s?.trusted },
    { value: "pending_verification", label: "Pending verification", count: s?.pending_verification },
    { value: "untrusted", label: "Untrusted", count: s?.untrusted },
    { value: "suspicious", label: "Suspicious", count: s?.suspicious },
    { value: "blocked", label: "Blocked", count: s?.blocked },
  ];

  return (
    <>
      <PageHeader title="Devices" breadcrumbs={[{ label: "Overview", to: "/" }, { label: "Devices" }]}
        description="Device trust feeds every access decision. Approve, quarantine or block endpoints and review their history."
        actions={can("devices:write") && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setRegistering(true)}>Register device</Button>} />

      <Tabs className="mb-4 max-w-full" value={filter} onChange={(v) => { setFilter(v); setPage(1); }} tabs={tabs} />

      <Card>
        <Toolbar>
          <div className="md:w-80">
            <Input placeholder="Search name, identifier, user email or IP…" value={search} leading={<Search className="h-4 w-4" />}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search devices" />
          </div>
          <p className="flex items-center gap-1.5 text-2xs text-subtle md:ml-auto">
            <Info className="h-3.5 w-3.5 shrink-0" />Identity via browser identifier or manual registration — no endpoint agent.
          </p>
        </Toolbar>
        {list.isError ? (
          <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="Could not load devices" description={apiError(list.error).message}
            action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>} />
        ) : (
          <DataTable columns={columns} rows={list.data?.items} loading={list.isLoading} rowKey={(d) => d.id} onRowClick={(d) => setOpen(d.id)} sort={sort} onSort={onSort}
            empty={<EmptyState icon={<Laptop className="h-5 w-5" />} title={q || filter !== "all" ? "No devices match" : "No devices registered"}
              description={q || filter !== "all" ? "Try another trust filter or search term." : "Devices register automatically at sign-in, or can be registered manually."}
              action={q || filter !== "all" ? <Button size="sm" onClick={() => { setSearch(""); setFilter("all"); setPage(1); }}>Reset filters</Button> : undefined} />} />
        )}
        {list.data && list.data.total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
      </Card>
      <p className="mt-3 text-2xs text-subtle">
        Blocking a device terminates its active sessions.{can("sessions:read_all") && <> See <Link to="/sessions" className="text-accent hover:underline">Sessions</Link> for live activity.</>}
      </p>

      <DeviceDrawer id={openId} onClose={() => setOpen(null)} />
      <DeviceFormModal open={registering} onClose={() => setRegistering(false)} onSaved={(d) => setOpen(d.id)} />
    </>
  );
}
