import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Ban, CheckCircle2, Clock3, FilePlus2, Hourglass, Inbox, Search, XCircle } from "lucide-react";
import { api, apiError, cleanParams } from "@/services/api";
import type { AccessRequest, Page, RequestStatus } from "@/types/api";
import { useAuth } from "@/context/AuthContext";
import { Card, PageHeader, Toolbar, Avatar } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Form";
import { DataTable, EmptyState, Pagination, Tabs, type Column } from "@/components/ui/Data";
import { DecisionBadge, DemoTag, StatusBadge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { fmtDate, fmtNum, timeAgo } from "@/utils/format";
import { SensitivityBadge } from "@/features/resources/meta";
import { NewRequestModal } from "@/features/access/NewRequestModal";
import { RequestDetailDrawer } from "@/features/access/RequestDetail";

type Scope = "mine" | "all" | "review";
const STATUSES: RequestStatus[] = ["pending", "approved", "rejected", "expired", "revoked"];
const PAGE_SIZE = 20;

export default function AccessRequests() {
  const { can } = useAuth();
  const canAll = can("access_requests:read_all");
  const canReview = can("access_requests:review");
  const canCreate = can("access_requests:create");
  const [params, setParams] = useSearchParams();

  const rawTab = params.get("tab");
  const tab: Scope = rawTab === "all" && canAll ? "all" : rawTab === "review" && canReview && canAll ? "review" : "mine";
  const apiScope = tab === "mine" ? "mine" : "all";
  const statusParam = params.get("status") as RequestStatus | null;
  const status = tab === "review" ? "pending" : statusParam && STATUSES.includes(statusParam) ? statusParam : "";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; order: "asc" | "desc" }>({ key: "created_at", order: "desc" });

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [tab, status, debounced]);

  const update = (patch: Record<string, string | null>, replace = true) => {
    const n = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === null || v === "" ? n.delete(k) : n.set(k, v)));
    setParams(n, { replace });
  };

  const summary = useQuery({
    queryKey: ["access-requests", "summary", apiScope],
    queryFn: async () => (await api.get<Record<RequestStatus, number>>("/access-requests/summary", { params: { scope: apiScope } })).data,
  });
  const list = useQuery({
    queryKey: ["access-requests", "list", { apiScope, status, debounced, page, sort }],
    placeholderData: (prev) => prev,
    queryFn: async () => (await api.get<Page<AccessRequest>>("/access-requests", {
      params: cleanParams({ scope: apiScope, status, q: debounced, page, page_size: PAGE_SIZE, sort: sort.key, order: sort.order }),
    })).data,
  });

  const newOpen = params.get("new") === "1" && canCreate;
  const detailId = params.get("id");

  const columns = useMemo<Column<AccessRequest>[]>(() => {
    const cols: Column<AccessRequest>[] = [
      { key: "resource", header: "Resource", render: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5"><span className="truncate font-medium text-fg">{r.resource.name}</span>{r.is_demo && <DemoTag />}</div>
          <div className="mt-1"><SensitivityBadge sensitivity={r.resource.sensitivity} /></div>
        </div>
      ) },
    ];
    if (tab !== "mine") cols.push({ key: "requester", header: "Requester", hideBelow: "md", render: (r) => (
      <div className="flex min-w-0 items-center gap-2">
        <Avatar name={r.requester.full_name} size={24} />
        <div className="min-w-0"><p className="truncate text-[13px] text-fg">{r.requester.full_name}</p><p className="truncate text-2xs text-muted">{r.requester.email}</p></div>
      </div>
    ) });
    cols.push(
      { key: "justification", header: "Justification", hideBelow: "lg", className: "max-w-[260px]", render: (r) => <p className="truncate text-xs text-muted" title={r.justification}>{r.justification}</p> },
      { key: "engine", header: "Engine", render: (r) => (r.engine_decision ? <DecisionBadge decision={r.engine_decision} /> : <span className="text-subtle">—</span>) },
      { key: "status", header: "Status", sortable: true, render: (r) => <StatusBadge status={r.status} /> },
      { key: "created_at", header: "Requested", sortable: true, hideBelow: "sm", render: (r) => (
        <div className="text-xs"><p className="text-fg" title={fmtDate(r.created_at)}>{timeAgo(r.created_at)}</p><p className="text-2xs text-subtle">{r.requested_duration_hours}h requested</p></div>
      ) },
      { key: "expires", header: "Expires", hideBelow: "md", render: (r) => (r.status === "approved" && r.expires_at
        ? <span className="text-xs text-fg" title={fmtDate(r.expires_at)}>{timeAgo(r.expires_at)}</span>
        : <span className="text-xs text-subtle">—</span>) },
    );
    return cols;
  }, [tab]);

  const counters: { s: RequestStatus; label: string; icon: JSX.Element; tone: "accent" | "success" | "danger" | "cyan" | "warning" }[] = [
    { s: "pending", label: "Pending", icon: <Hourglass className="h-3.5 w-3.5" />, tone: "accent" },
    { s: "approved", label: "Approved", icon: <CheckCircle2 className="h-3.5 w-3.5" />, tone: "success" },
    { s: "rejected", label: "Rejected", icon: <XCircle className="h-3.5 w-3.5" />, tone: "danger" },
    { s: "expired", label: "Expired", icon: <Clock3 className="h-3.5 w-3.5" />, tone: "cyan" },
    { s: "revoked", label: "Revoked", icon: <Ban className="h-3.5 w-3.5" />, tone: "warning" },
  ];

  const tabs = [
    { value: "mine" as Scope, label: "My requests" },
    ...(canAll ? [{ value: "all" as Scope, label: "All requests" }] : []),
    ...(canReview && canAll ? [{ value: "review" as Scope, label: "Awaiting review", count: tab !== "mine" ? summary.data?.pending : undefined }] : []),
  ];

  return (
    <div>
      <PageHeader title="Access requests"
        description="Just-in-time, time-bound access. Every request is evaluated by the Zero Trust engine first, then auto-decided or routed to a reviewer."
        actions={canCreate && <Button variant="primary" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => update({ new: "1" }, false)}>New request</Button>} />

      {tabs.length > 1 && <Tabs className="mb-4 w-full sm:w-fit" value={tab} onChange={(v) => update({ tab: v === "mine" ? null : v, status: null })} tabs={tabs} />}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {counters.map((c) => (
          <StatCard key={c.s} label={c.label} value={fmtNum(summary.data?.[c.s] ?? 0)} icon={c.icon} tone={c.tone} loading={summary.isLoading}
            hint={tab === "mine" ? "your requests" : "organisation-wide"}
            onClick={tab === "review" ? undefined : () => update({ status: status === c.s ? null : c.s })} />
        ))}
      </div>

      <Card>
        <Toolbar>
          <div className="md:w-80"><Input leading={<Search className="h-3.5 w-3.5" />} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={tab === "mine" ? "Search resource or justification" : "Search requester, resource, justification"} aria-label="Search requests" /></div>
          {tab !== "review" && (
            <div className="md:w-48">
              <Select value={status} onChange={(e) => update({ status: e.target.value || null })} aria-label="Filter by status">
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
              </Select>
            </div>
          )}
          {list.data && <p className="num text-2xs text-subtle md:ml-auto">{fmtNum(list.data.total)} request{list.data.total === 1 ? "" : "s"}</p>}
        </Toolbar>
        {list.isError ? (
          <EmptyState title="Could not load requests" description={apiError(list.error).message} action={<Button onClick={() => list.refetch()}>Retry</Button>} />
        ) : (
          <DataTable columns={columns} rows={list.data?.items} loading={list.isLoading} rowKey={(r) => r.id}
            onRowClick={(r) => update({ id: r.id }, false)}
            sort={sort} onSort={(k) => setSort((s) => ({ key: k, order: s.key === k && s.order === "desc" ? "asc" : "desc" }))}
            empty={<EmptyState icon={<Inbox className="h-5 w-5" />}
              title={tab === "review" ? "Nothing awaiting review" : debounced || status ? "No requests match" : "No access requests yet"}
              description={tab === "review" ? "Pending requests that need a decision will appear here." : debounced || status ? "Try clearing the search or status filter." : "Request time-bound access to a protected resource with a business justification."}
              action={tab === "mine" && !debounced && !status && canCreate ? <Button variant="primary" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => update({ new: "1" }, false)}>New request</Button> : undefined} />} />
        )}
        {list.data && list.data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
      </Card>

      <NewRequestModal open={newOpen} initialResource={params.get("resource")} onClose={() => update({ new: null, resource: null })}
        onView={(id) => update({ new: null, resource: null, id })} />
      <RequestDetailDrawer requestId={detailId} onClose={() => update({ id: null })} />
    </div>
  );
}
