import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Download, FilterX, Link2, Lock, RefreshCw, ScrollText, Search, ShieldCheck, UserRound } from "lucide-react";
import { Card, PageHeader, Toolbar } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Input, Select, Switch } from "@/components/ui/Form";
import { DataTable, EmptyState, Pagination, type Column } from "@/components/ui/Data";
import { DemoTag, SeverityBadge, StatusBadge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, apiError, downloadFile } from "@/services/api";
import type { AuditLog, Page } from "@/types/api";
import { cn, fmtDate, timeAgo, titleCase } from "@/utils/format";
import { AUDIT_PAGE_SIZE, toLocalInput, useAuditFilters, type AuditSortKey } from "@/features/audit/useAuditFilters";
import { AuditDetailDrawer } from "@/features/audit/AuditDetailDrawer";
import { VerifyIntegrityModal, type VerifyResult } from "@/features/audit/VerifyIntegrityModal";

const SEVERITIES = ["critical", "high", "medium", "low", "informational"] as const;
const QUICK_RANGES = [
  { key: "24h", label: "24h", ms: 24 * 3600_000 },
  { key: "7d", label: "7d", ms: 7 * 86400_000 },
  { key: "30d", label: "30d", ms: 30 * 86400_000 },
] as const;

/** Debounced text input that commits to the URL after the user pauses typing. */
function useDebouncedParam(value: string, commit: (v: string) => void, delay = 350) {
  const [local, setLocal] = useState(value);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => { setLocal(value); }, [value]);
  useEffect(() => {
    if (local === value) return;
    const t = window.setTimeout(() => commitRef.current(local), delay);
    return () => window.clearTimeout(t);
  }, [local, value, delay]);
  return [local, setLocal] as const;
}

export default function AuditLogs() {
  const { can } = useAuth();
  const toast = useToast();
  const { state: f, update, clear, apiParams, activeCount } = useAuditFilters();
  const [sp, setSp] = useSearchParams();
  const [exporting, setExporting] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifiedAt, setVerifiedAt] = useState<Date | null>(null);

  const [q, setQ] = useDebouncedParam(f.q, (v) => update({ q: v }));
  const [actor, setActor] = useDebouncedParam(f.actor, (v) => update({ actor: v }));

  const facets = useQuery({
    queryKey: ["audit-logs", "facets"],
    queryFn: async () => (await api.get<{ categories: string[]; actions: string[] }>("/audit-logs/facets")).data,
    staleTime: 60_000,
  });

  const list = useQuery({
    queryKey: ["audit-logs", "list", apiParams, f.page],
    queryFn: async () => (await api.get<Page<AuditLog>>("/audit-logs", { params: { ...apiParams, page: f.page, page_size: AUDIT_PAGE_SIZE } })).data,
    placeholderData: keepPreviousData,
  });

  // Selected record lives in the URL (?log=<id>) so it can be deep-linked.
  const selectedId = sp.get("log") ? Number(sp.get("log")) : null;
  const fromList = list.data?.items.find((r) => r.id === selectedId) ?? null;
  const single = useQuery({
    queryKey: ["audit-logs", "detail", selectedId],
    queryFn: async () => (await api.get<AuditLog>(`/audit-logs/${selectedId}`)).data,
    enabled: selectedId !== null && Number.isFinite(selectedId) && !fromList,
  });
  const selected = fromList ?? single.data ?? null;
  const openLog = (id: number | null) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    if (id === null) n.delete("log"); else n.set("log", String(id));
    return n;
  }, { replace: true });
  useEffect(() => {
    if (single.isError) { toast.error("Audit record not found", apiError(single.error).message); openLog(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single.isError]);

  const verify = useMutation({
    mutationFn: async () => (await api.get<VerifyResult>("/audit-logs/verify")).data,
    onSuccess: () => setVerifiedAt(new Date()),
  });

  const runExport = async () => {
    setExporting(true);
    const date = new Date().toISOString().slice(0, 10);
    try {
      await downloadFile("/audit-logs/export", apiParams, `zerotrustx-audit-${date}.csv`);
      toast.success("Export ready", `Downloaded the ${list.data ? Math.min(list.data.total, 10000).toLocaleString() : "matching"} records that match your filters. The export itself was recorded in the audit trail.`);
    } catch (e) {
      toast.error("Export failed", apiError(e).message);
    } finally {
      setExporting(false);
    }
  };

  const onSort = (key: string) => {
    const k = key as AuditSortKey;
    if (f.sort === k) update({ order: f.order === "desc" ? "asc" : "desc" });
    else update({ sort: k === "created_at" ? null : k, order: k === "action" ? "asc" : null });
  };

  const applyRange = (ms: number) => update({ from: toLocalInput(new Date(Date.now() - ms)), to: null });
  const activeRange = useMemo(() => {
    if (!f.from || f.to) return null;
    const diff = Date.now() - new Date(f.from).getTime();
    return QUICK_RANGES.find((r) => Math.abs(diff - r.ms) < 5 * 60_000)?.key ?? null;
  }, [f.from, f.to]);

  const columns: Column<AuditLog>[] = [
    {
      key: "created_at", header: "Timestamp", sortable: true, className: "whitespace-nowrap",
      render: (r) => (
        <div>
          <p className="num text-[13px] text-fg">{fmtDate(r.created_at, { dateStyle: "medium", timeStyle: "medium" })}</p>
          <p className="text-2xs text-subtle">{timeAgo(r.created_at)}</p>
        </div>
      ),
    },
    {
      key: "actor", header: "Actor",
      render: (r) => r.actor_email
        ? <span className="block max-w-[170px] truncate" title={r.actor_email}>{r.actor_email}</span>
        : <span className="text-subtle">System</span>,
    },
    {
      key: "action", header: "Action", sortable: true,
      render: (r) => (
        <div>
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono text-xs text-fg">{r.action}</span>
            {r.is_demo && <DemoTag />}
          </span>
          <p className="text-2xs text-subtle 2xl:hidden">{titleCase(r.category)}</p>
        </div>
      ),
    },
    { key: "category", header: "Category", className: "hidden 2xl:table-cell", headerClassName: "hidden 2xl:table-cell", render: (r) => <span className="whitespace-nowrap text-xs text-muted">{titleCase(r.category)}</span> },
    {
      key: "target", header: "Target", hideBelow: "md",
      render: (r) => r.target_type || r.target_label ? (
        <div className="max-w-[150px]">
          {r.target_type && <p className="font-mono text-2xs text-subtle">{r.target_type}</p>}
          <p className="truncate text-xs" title={r.target_label ?? r.target_id ?? ""}>{r.target_label ?? r.target_id ?? "—"}</p>
        </div>
      ) : <span className="text-subtle">—</span>,
    },
    { key: "severity", header: "Severity", sortable: true, render: (r) => <SeverityBadge severity={r.severity} /> },
    { key: "outcome", header: "Outcome", render: (r) => <StatusBadge status={r.outcome} /> },
    { key: "ip", header: "IP", hideBelow: "xl", render: (r) => <span className="font-mono text-xs text-muted">{r.ip_address ?? "—"}</span> },
  ];

  const facetsLoading = facets.isLoading;

  return (
    <div>
      <PageHeader
        title="Audit logs"
        breadcrumbs={[{ label: "Governance" }, { label: "Audit logs" }]}
        description={<>
          A tamper-evident record of every security-relevant action. The trail is append-only — a PostgreSQL trigger rejects
          UPDATE, DELETE and TRUNCATE — and each entry is SHA-256 hash-chained to the one before it.
        </>}
        actions={<>
          <Button variant="outline" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => { setVerifyOpen(true); verify.mutate(); }}>
            Verify integrity
          </Button>
          {can("audit:export") && (
            <Button variant="primary" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={runExport}
              disabled={list.data?.total === 0}>Export CSV</Button>
          )}
        </>}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { icon: <Lock className="h-4 w-4" />, title: "Append-only", body: "Database trigger blocks modification and deletion." },
          { icon: <Link2 className="h-4 w-4" />, title: "Hash-chained", body: "SHA-256 over each record and its predecessor." },
          {
            icon: <ShieldCheck className="h-4 w-4" />, title: "Last verification",
            body: verify.data && verifiedAt
              ? (verify.data.valid ? `Intact · ${verify.data.checked.toLocaleString()} records at ${verifiedAt.toLocaleTimeString()}` : `Broken at record #${verify.data.broken_at_id}`)
              : "Not run in this session.",
            tone: verify.data ? (verify.data.valid ? "text-success" : "text-danger") : "text-subtle",
          },
        ].map((c) => (
          <div key={c.title} className="flex items-start gap-3 rounded-xl border border-line/80 bg-card/60 px-4 py-3">
            <span className="mt-0.5 text-accent">{c.icon}</span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-fg">{c.title}</p>
              <p className={cn("mt-0.5 truncate text-2xs", "tone" in c && c.tone ? c.tone : "text-muted")}>{c.body}</p>
            </div>
          </div>
        ))}
      </div>

      <Card>
        <Toolbar className="gap-2">
          <div className="w-full md:w-64">
            <Input aria-label="Search audit logs" placeholder="Search action, actor, target, IP…" value={q} onChange={(e) => setQ(e.target.value)}
              leading={<Search className="h-4 w-4" />} />
          </div>
          <div className="w-full md:w-52">
            <Input aria-label="Actor email" placeholder="Actor email" value={actor} onChange={(e) => setActor(e.target.value)}
              leading={<UserRound className="h-4 w-4" />} />
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 md:w-auto md:flex md:flex-wrap">
            <Select aria-label="Category" value={f.category} onChange={(e) => update({ category: e.target.value })} disabled={facetsLoading} className="md:w-40">
              <option value="">All categories</option>
              {facets.data?.categories.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </Select>
            <Select aria-label="Action" value={f.action} onChange={(e) => update({ action: e.target.value })} disabled={facetsLoading} className="font-mono md:w-48">
              <option value="">All actions</option>
              {facets.data?.actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
            <Select aria-label="Severity" value={f.severity} onChange={(e) => update({ severity: e.target.value })} className="md:w-36">
              <option value="">All severities</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s === "informational" ? "Info" : titleCase(s)}</option>)}
            </Select>
            <Select aria-label="Outcome" value={f.outcome} onChange={(e) => update({ outcome: e.target.value })} className="md:w-32">
              <option value="">Any outcome</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
            </Select>
          </div>
        </Toolbar>
        <Toolbar className="gap-3 md:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex items-center gap-1 rounded-lg border border-line bg-surface/60 p-1" role="group" aria-label="Quick time range">
              {QUICK_RANGES.map((r) => (
                <button key={r.key} type="button" onClick={() => applyRange(r.ms)} data-cursor="hover"
                  className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    activeRange === r.key ? "border border-line-strong/70 bg-elevated text-fg" : "text-muted hover:text-fg")}>
                  {r.label}
                </button>
              ))}
              <button type="button" onClick={() => update({ from: null, to: null })} data-cursor="hover"
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  !f.from && !f.to ? "border border-line-strong/70 bg-elevated text-fg" : "text-muted hover:text-fg")}>All time</button>
            </div>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="audit-from">From</label>
              <Input id="audit-from" type="datetime-local" value={f.from} max={f.to || undefined} onChange={(e) => update({ from: e.target.value })}
                className="h-8 min-w-0 text-xs sm:w-[190px]" aria-label="From date" />
              <span className="text-xs text-subtle">to</span>
              <label className="sr-only" htmlFor="audit-to">To</label>
              <Input id="audit-to" type="datetime-local" value={f.to} min={f.from || undefined} onChange={(e) => update({ to: e.target.value })}
                className="h-8 min-w-0 text-xs sm:w-[190px]" aria-label="To date" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 md:justify-end">
            <div className="w-auto"><Switch checked={f.includeDemo} onChange={(v) => update({ demo: v ? null : "0" })} label="Include demo data" /></div>
            {activeCount > 0 && (
              <Button size="sm" variant="ghost" icon={<FilterX className="h-3.5 w-3.5" />} onClick={() => { clear(); setQ(""); setActor(""); }}>
                Clear ({activeCount})
              </Button>
            )}
          </div>
        </Toolbar>

        {list.isError ? (
          <EmptyState icon={<ScrollText className="h-5 w-5" />} title="Couldn't load audit logs" description={apiError(list.error).message}
            action={<Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => list.refetch()}>Retry</Button>} />
        ) : (
          <div className={cn("transition-opacity", list.isFetching && list.isPlaceholderData && "opacity-60")}>
            <DataTable
              columns={columns}
              rows={list.data?.items}
              loading={list.isLoading}
              rowKey={(r) => r.id}
              onRowClick={(r) => openLog(r.id)}
              sort={{ key: f.sort, order: f.order }}
              onSort={onSort}
              skeletonRows={10}
              empty={<EmptyState icon={<ScrollText className="h-5 w-5" />} title="No audit events match"
                description={activeCount ? "Try widening the time range or clearing some filters." : "No events have been recorded yet."}
                action={activeCount ? <Button size="sm" onClick={() => { clear(); setQ(""); setActor(""); }}>Clear filters</Button> : undefined} />}
            />
          </div>
        )}
        {list.data && list.data.total > 0 && (
          <div className="border-t border-line/70">
            <Pagination page={f.page} pageSize={AUDIT_PAGE_SIZE} total={list.data.total} onPage={(p) => update({ page: p === 1 ? null : String(p) })} />
          </div>
        )}
      </Card>

      <AuditDetailDrawer log={selectedId !== null ? selected : null} onClose={() => openLog(null)} />
      <VerifyIntegrityModal open={verifyOpen} onClose={() => setVerifyOpen(false)} m={verify} checkedAt={verifiedAt}
        onOpenRecord={(id) => { setVerifyOpen(false); openLog(id); }} />
    </div>
  );
}
