import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FilterX, FolderSearch, Plus, RefreshCw, Search, UserCheck } from "lucide-react";
import { Avatar, Card, PageHeader, Toolbar } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Form";
import { DataTable, EmptyState, Pagination, Tabs, type Column } from "@/components/ui/Data";
import { DemoTag, SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { api, apiError, cleanParams } from "@/services/api";
import { cn, fmtDate, timeAgo } from "@/utils/format";
import { SEVERITIES, SEVERITY_LABEL, useDebounced } from "@/features/threats/shared";
import { CreateIncidentModal } from "@/features/incidents/CreateIncidentModal";
import type { Incident, Page, Severity } from "@/types/api";

const PAGE_SIZE = 15;
type StatusTab = "active" | "open" | "investigating" | "contained" | "resolved" | "closed" | "all";
const TABS: { value: StatusTab; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "contained", label: "Contained" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

export default function Incidents() {
  const { can, user } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState<StatusTab>("active");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; order: "asc" | "desc" }>({ key: "updated_at", order: "desc" });
  const [creating, setCreating] = useState(false);

  const filters = {
    status: status === "all" ? "" : status, severity, q, assignee_id: mine ? user?.id : "", sort: sort.key, order: sort.order,
  };
  const list = useQuery({
    queryKey: ["incidents", "list", filters, page],
    queryFn: async () => (await api.get<Page<Incident>>("/incidents", { params: cleanParams({ ...filters, page, page_size: PAGE_SIZE }) })).data,
    placeholderData: keepPreviousData,
  });

  const filtered = !!(severity || q || mine || status !== "active");
  const reset = () => { setStatus("active"); setSeverity(""); setMine(false); setSearch(""); setPage(1); };
  const onSort = (key: string) => {
    setSort((s) => (s.key === key ? { key, order: s.order === "desc" ? "asc" : "desc" } : { key, order: "desc" }));
    setPage(1);
  };

  const columns: Column<Incident>[] = [
    {
      key: "created_at", header: "Reference", sortable: true,
      render: (i) => (
        <div className="flex items-center gap-1.5 whitespace-nowrap" title={`Opened ${fmtDate(i.created_at)}`}>
          <span className="font-mono text-xs font-medium text-fg">{i.reference}</span>
          {i.is_demo && <DemoTag />}
        </div>
      ),
    },
    { key: "title", header: "Title", render: (i) => <p className="max-w-[260px] truncate font-medium text-fg 2xl:max-w-[420px]" title={i.title}>{i.title}</p> },
    { key: "severity", header: "Severity", render: (i) => <SeverityBadge severity={i.severity} /> },
    { key: "status", header: "Status", render: (i) => <StatusBadge status={i.status} /> },
    {
      key: "assignee", header: "Investigator", hideBelow: "md",
      render: (i) => i.assignee ? (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={i.assignee.full_name} size={22} />
          <span className="truncate text-xs text-fg">{i.assignee.full_name}{i.assignee.id === user?.id && <span className="text-subtle"> (you)</span>}</span>
        </span>
      ) : <span className="text-xs italic text-subtle">Unassigned</span>,
    },
    { key: "alerts", header: "Alerts", hideBelow: "xl", render: (i) => <span className={cn("num text-xs", i.alert_count ? "text-fg" : "text-subtle")}>{i.alert_count}</span> },
    { key: "notes", header: "Notes", hideBelow: "xl", render: (i) => <span className={cn("num text-xs", i.note_count ? "text-fg" : "text-subtle")}>{i.note_count}</span> },
    {
      key: "updated_at", header: "Updated", sortable: true,
      render: (i) => <span className="whitespace-nowrap text-xs text-muted" title={fmtDate(i.updated_at, { dateStyle: "medium", timeStyle: "medium" })}>{timeAgo(i.updated_at)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Security Incidents"
        description="Track investigations from triage to closure. Escalated alerts stay linked, and every status change, assignment and analyst note is recorded on the incident timeline and in the audit log."
        actions={can("incidents:write") && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Open incident</Button>
        )}
      />

      <Card>
        <div className="border-b border-line/70 px-4 pt-3">
          <Tabs tabs={TABS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} className="mb-3 w-full sm:w-fit" />
        </div>
        <Toolbar>
          <div className="md:w-72">
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search title or reference"
              leading={<Search className="h-4 w-4" />} aria-label="Search incidents" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[10rem] flex-1 md:flex-none">
              <Select value={severity} onChange={(e) => { setSeverity(e.target.value as Severity | ""); setPage(1); }} aria-label="Severity" className="md:w-40">
                <option value="">All severities</option>
                {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
              </Select>
            </div>
            <Button size="md" variant={mine ? "subtle" : "outline"} aria-pressed={mine} icon={<UserCheck className="h-4 w-4" />}
              onClick={() => { setMine((m) => !m); setPage(1); }}
              className={cn(mine && "border border-accent/30")}>
              Assigned to me
            </Button>
          </div>
          <div className="flex items-center gap-2 md:ml-auto">
            {filtered && <Button size="sm" variant="ghost" icon={<FilterX className="h-3.5 w-3.5" />} onClick={reset}>Reset</Button>}
            <Button size="icon" variant="ghost" aria-label="Refresh incidents" title="Refresh" onClick={() => list.refetch()}>
              <RefreshCw className={cn("h-4 w-4", list.isFetching && "animate-spin")} />
            </Button>
          </div>
        </Toolbar>

        {list.isError ? (
          <EmptyState title="Could not load incidents" description={apiError(list.error).message}
            action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>} />
        ) : (
          <DataTable
            columns={columns}
            rows={list.data?.items}
            loading={list.isLoading}
            rowKey={(i) => i.id}
            onRowClick={(i) => nav(`/incidents/${i.id}`)}
            sort={sort}
            onSort={onSort}
            empty={filtered ? (
              <EmptyState icon={<FilterX className="h-5 w-5" />} title="No incidents match these filters"
                description={mine ? "Nothing in this view is assigned to you." : "Try another status tab or clear the search."}
                action={<Button size="sm" onClick={reset}>Reset filters</Button>} />
            ) : (
              <EmptyState icon={<FolderSearch className="h-5 w-5" />} title="No active incidents"
                description="Open an incident manually or escalate a threat alert to start an investigation."
                action={can("incidents:write") ? <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>Open incident</Button> : undefined} />
            )}
          />
        )}
        {list.data && list.data.total > 0 && (
          <div className="border-t border-line/70">
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
          </div>
        )}
      </Card>

      <CreateIncidentModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
