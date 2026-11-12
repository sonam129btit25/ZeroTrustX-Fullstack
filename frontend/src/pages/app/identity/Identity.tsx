import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Lock, Search, ShieldAlert, ShieldCheck, ShieldOff, UserPlus, Users, X } from "lucide-react";
import { Avatar, Card, PageHeader, Toolbar } from "@/components/ui/Page";
import { Badge, DemoTag, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Form";
import { DataTable, EmptyState, Pagination, Tabs, type Column } from "@/components/ui/Data";
import { RiskMeter } from "@/components/security/Risk";
import { useAuth } from "@/context/AuthContext";
import { api, apiError, cleanParams } from "@/services/api";
import type { Page, UserSummary } from "@/types/api";
import { timeAgo } from "@/utils/format";
import { isLocked, useDebounced, useRoles } from "@/features/identity/hooks";
import { CreateUserModal } from "@/features/identity/CreateUserModal";
import { RolesPanel } from "@/features/identity/RolesPanel";

type TabKey = "users" | "roles";
const PAGE_SIZE = 20;

export default function Identity() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const canRoles = can("roles:read");
  const tab: TabKey = params.get("tab") === "roles" && canRoles ? "roles" : "users";
  const setTab = (t: TabKey) => setParams((p) => { const n = new URLSearchParams(p); if (t === "users") n.delete("tab"); else n.set("tab", t); return n; }, { replace: true });
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();

  return (
    <>
      <PageHeader title="Identity & Access" breadcrumbs={[{ label: "Overview", to: "/" }, { label: "Identity" }]}
        description="Every identity is continuously evaluated. Manage users, their roles and the permissions those roles carry."
        actions={can("users:write") && <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>Create user</Button>} />
      {canRoles && (
        <Tabs className="mb-4 w-fit max-w-full" value={tab} onChange={setTab}
          tabs={[{ value: "users", label: <><Users className="h-3.5 w-3.5" />Users</> }, { value: "roles", label: <><ShieldCheck className="h-3.5 w-3.5" />Roles &amp; Permissions</> }]} />
      )}
      {tab === "users" ? <UsersTab /> : <RolesPanel />}
      <CreateUserModal open={creating} onClose={() => setCreating(false)} onCreated={(u) => nav(`/identity/users/${u.id}`)} />
    </>
  );
}

function UsersTab() {
  const { can } = useAuth();
  const nav = useNavigate();
  const roles = useRoles(can("roles:read"));
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [mfa, setMfa] = useState("");
  const [riskMin, setRiskMin] = useState("");
  const [sort, setSort] = useState<{ key: string; order: "asc" | "desc" }>({ key: "created_at", order: "desc" });
  const [page, setPage] = useState(1);

  const filters = { q, status, role, mfa, risk_min: riskMin };
  const list = useQuery({
    queryKey: ["users", "list", filters, sort, page],
    queryFn: async () => (await api.get<Page<UserSummary>>("/users", {
      params: cleanParams({ ...filters, sort: sort.key, order: sort.order, page, page_size: PAGE_SIZE }),
    })).data,
    placeholderData: keepPreviousData,
  });
  const active = !!(q || status || role || mfa || riskMin);
  const clear = () => { setSearch(""); setStatus(""); setRole(""); setMfa(""); setRiskMin(""); setPage(1); };
  const onSort = (key: string) => { setSort((s) => ({ key, order: s.key === key && s.order === "desc" ? "asc" : "desc" })); setPage(1); };
  const upd = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => { fn(e.target.value); setPage(1); };

  const columns: Column<UserSummary>[] = [
    {
      key: "full_name", header: "User", sortable: true, render: (u) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={u.full_name} size={30} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium text-fg">{u.full_name}{u.is_demo && <DemoTag />}</p>
            <p className="truncate text-xs text-muted">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "roles", header: "Roles", hideBelow: "sm", render: (u) => (
        <div className="flex max-w-[220px] flex-wrap gap-1">
          {u.roles.length ? u.roles.map((r) => <Badge key={r.id} tone={r.level >= 80 ? "lavender" : r.level >= 50 ? "accent" : "neutral"}>{r.display_name}</Badge>) : <span className="text-xs text-subtle">—</span>}
        </div>
      ),
    },
    { key: "status", header: "Status", render: (u) => (isLocked(u) ? <Badge tone="danger" dot><Lock className="h-2.5 w-2.5" />Locked</Badge> : <StatusBadge status={u.status} />) },
    {
      key: "mfa", header: "MFA", hideBelow: "md", render: (u) => u.mfa_enabled
        ? <Badge tone="success"><ShieldCheck className="h-3 w-3" />Enrolled</Badge>
        : <Badge tone="warning"><ShieldOff className="h-3 w-3" />None</Badge>,
    },
    { key: "risk_score", header: "Risk", sortable: true, render: (u) => <RiskMeter score={u.risk_score} /> },
    {
      key: "last_login_at", header: "Last login", sortable: true, hideBelow: "md", render: (u) => (
        <div className="leading-tight">
          <p className="text-xs text-fg" title={u.last_login_at ?? undefined}>{u.last_login_at ? timeAgo(u.last_login_at) : "Never"}</p>
          {u.last_login_ip && <p className="font-mono text-2xs text-subtle">{u.last_login_ip}</p>}
        </div>
      ),
    },
    {
      key: "active_sessions", header: "Sessions", hideBelow: "lg", headerClassName: "text-right", className: "text-right",
      render: (u) => <span className={u.active_sessions ? "num font-medium text-fg" : "num text-subtle"}>{u.active_sessions}</span>,
    },
    { key: "created_at", header: "Created", sortable: true, hideBelow: "xl", render: (u) => <span className="text-xs text-muted">{timeAgo(u.created_at)}</span> },
  ];

  return (
    <Card>
      <Toolbar>
        <div className="md:w-72">
          <Input placeholder="Search name, email or department…" value={search} leading={<Search className="h-4 w-4" />}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search users" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Select value={status} onChange={upd(setStatus)} aria-label="Status filter" className="sm:w-36">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deactivated">Deactivated</option>
            <option value="locked">Locked</option>
          </Select>
          {can("roles:read") && (
            <Select value={role} onChange={upd(setRole)} aria-label="Role filter" className="sm:w-40">
              <option value="">All roles</option>
              {roles.data?.map((r) => <option key={r.id} value={r.name}>{r.display_name}</option>)}
            </Select>
          )}
          <Select value={mfa} onChange={upd(setMfa)} aria-label="MFA filter" className="sm:w-32">
            <option value="">Any MFA</option>
            <option value="true">MFA enrolled</option>
            <option value="false">No MFA</option>
          </Select>
          <Select value={riskMin} onChange={upd(setRiskMin)} aria-label="Minimum risk" className="sm:w-36">
            <option value="">Any risk</option>
            <option value="15">Risk ≥ 15 (low)</option>
            <option value="35">Risk ≥ 35 (medium)</option>
            <option value="60">Risk ≥ 60 (high)</option>
            <option value="80">Risk ≥ 80 (critical)</option>
          </Select>
        </div>
        {active && <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={clear}>Clear</Button>}
        <span className="text-xs text-subtle md:ml-auto num">{list.data ? `${list.data.total.toLocaleString()} users` : ""}</span>
      </Toolbar>
      {list.isError ? (
        <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="Could not load users" description={apiError(list.error).message}
          action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>} />
      ) : (
        <DataTable columns={columns} rows={list.data?.items} loading={list.isLoading} rowKey={(u) => u.id}
          onRowClick={(u) => nav(`/identity/users/${u.id}`)} sort={sort} onSort={onSort}
          empty={<EmptyState icon={<Users className="h-5 w-5" />} title={active ? "No users match these filters" : "No users yet"}
            description={active ? "Try a broader search or clear the filters." : "Create the first user to get started."}
            action={active ? <Button size="sm" onClick={clear}>Clear filters</Button> : undefined} />} />
      )}
      {list.data && list.data.total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
    </Card>
  );
}
