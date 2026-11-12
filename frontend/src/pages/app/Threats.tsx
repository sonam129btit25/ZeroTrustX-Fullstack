import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpenCheck, FilterX, Radar, RefreshCw, Search, ShieldCheck, Siren, X } from "lucide-react";
import { Card, PageHeader, Toolbar } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Form";
import { DataTable, EmptyState, Pagination, type Column } from "@/components/ui/Data";
import { DemoTag, SeverityBadge, StatusBadge, TrustBadge } from "@/components/ui/Badge";
import { RiskMeter } from "@/components/security/Risk";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useRealtimeEvent } from "@/context/RealtimeContext";
import { api, apiError, cleanParams } from "@/services/api";
import { cn, fmtDate, timeAgo } from "@/utils/format";
import { AlertDrawer } from "@/features/threats/AlertDrawer";
import { RulesDrawer, useThreatRules } from "@/features/threats/RulesDrawer";
import { CategoryBreakdown, SeverityCards, StatusCounts } from "@/features/threats/ThreatSummary";
import {
  ALERT_STATUS_FILTERS, SEVERITIES, SEVERITY_LABEL, useDebounced, useMediaQuery, type AlertStatusFilter, type ThreatSummary,
} from "@/features/threats/shared";
import type { Page, Severity, ThreatAlert } from "@/types/api";

const PAGE_SIZE = 15;
interface FreshAlert { id: string; title: string; severity: Severity; user?: string }

export default function Threats() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const alertId = params.get("alert");

  const [severity, setSeverity] = useState<Severity | "">("");
  const [status, setStatus] = useState<AlertStatusFilter>("active");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; order: "asc" | "desc" }>({ key: "detected_at", order: "desc" });
  const [rulesOpen, setRulesOpen] = useState(false);
  const [fresh, setFresh] = useState<FreshAlert[]>([]);

  const filters = { severity, status: status === "all" ? "" : status, category, q, sort: sort.key, order: sort.order };

  const summary = useQuery({
    queryKey: ["threats", "summary"],
    queryFn: async () => (await api.get<ThreatSummary>("/threats/summary")).data,
  });
  const rules = useThreatRules();
  const list = useQuery({
    queryKey: ["threats", "list", filters, page],
    queryFn: async () => (await api.get<Page<ThreatAlert>>("/threats", {
      params: cleanParams({ ...filters, page, page_size: PAGE_SIZE }),
    })).data,
    placeholderData: keepPreviousData,
  });

  const categories = useMemo(() => {
    const s = new Set<string>([...(rules.data ?? []).map((r) => r.category), ...Object.keys(summary.data?.by_category ?? {})]);
    return [...s].sort();
  }, [rules.data, summary.data]);

  const update = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const setSev = update(setSeverity);
  const setStat = update(setStatus);
  const setCat = update(setCategory);
  const filtered = !!(severity || category || q || status !== "active");
  const clearFilters = () => { setSeverity(""); setStatus("active"); setCategory(""); setSearch(""); setPage(1); };

  const openAlert = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("alert", id); return n; });
  const closeAlert = () => setParams((p) => { const n = new URLSearchParams(p); n.delete("alert"); return n; }, { replace: true });

  useRealtimeEvent(["threat.created"], (e) => {
    const d = e.data as Partial<FreshAlert>;
    if (!d.id || !d.title) return;
    setFresh((f) => [{ id: d.id!, title: d.title!, severity: (d.severity ?? "informational") as Severity, user: d.user }, ...f.filter((x) => x.id !== d.id)].slice(0, 20));
  });

  const scan = useMutation({
    mutationFn: async () => (await api.post<{ new_alerts: number; users_rescored: number }>("/threats/scan")).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["threats"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      const title = r.new_alerts > 0 ? `Scan complete: ${r.new_alerts} new alert${r.new_alerts === 1 ? "" : "s"}` : "Scan complete: no new alerts";
      (r.new_alerts > 0 ? toast.warning : toast.success)(title, `${r.users_rescored} user risk score${r.users_rescored === 1 ? "" : "s"} recomputed from the last 30 minutes of telemetry.`);
    },
    onError: (e) => toast.error("Detection scan failed", apiError(e).message),
  });

  const onSort = (key: string) => {
    setSort((s) => (s.key === key ? { key, order: s.order === "desc" ? "asc" : "desc" } : { key, order: "desc" }));
    setPage(1);
  };

  // The device column only fits next to the others on very wide screens; the drawer always shows it.
  const wide = useMediaQuery("(min-width: 1536px)");
  const allColumns: Column<ThreatAlert>[] = [
    { key: "severity", header: "Severity", render: (a) => <SeverityBadge severity={a.severity} />, className: "w-[1%]" },
    {
      key: "title", header: "Alert",
      render: (a) => (
        <div className="min-w-[200px] max-w-[280px] 2xl:max-w-[400px]">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-fg">{a.title}</span>
            {a.is_demo && <DemoTag />}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted" title={a.description}>{a.description}</p>
        </div>
      ),
    },
    {
      key: "user", header: "User", hideBelow: "md",
      render: (a) => a.user ? (
        <div className="min-w-0 max-w-[160px]">
          <p className="truncate text-fg">{a.user.full_name}</p>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle"><span>Risk</span><RiskMeter score={a.user.risk_score} className="[&>div]:w-10" /></div>
        </div>
      ) : <span className="text-xs text-subtle">—</span>,
    },
    {
      key: "device", header: "Device",
      render: (a) => a.device ? (
        <div className="min-w-0 max-w-[150px]">
          <p className="truncate text-xs text-fg">{a.device.name}</p>
          <div className="mt-1"><TrustBadge status={a.device.trust_status} /></div>
        </div>
      ) : <span className="text-xs text-subtle">—</span>,
    },
    { key: "ip", header: "Source IP", hideBelow: "lg", render: (a) => a.ip_address ? <span className="whitespace-nowrap font-mono text-xs">{a.ip_address}</span> : <span className="text-xs text-subtle">—</span> },
    { key: "risk_score", header: "Risk", sortable: true, render: (a) => <RiskMeter score={a.risk_score} /> },
    {
      key: "detected_at", header: "Detected", sortable: true,
      render: (a) => <span className="whitespace-nowrap text-xs text-muted" title={fmtDate(a.detected_at, { dateStyle: "medium", timeStyle: "medium" })}>{timeAgo(a.detected_at)}</span>,
    },
    {
      key: "status", header: "Status",
      render: (a) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge status={a.status} />
          {a.incident_id && can("incidents:read") && (
            <Link to={`/incidents/${a.incident_id}`} onClick={(e) => e.stopPropagation()} title="Open linked incident" aria-label="Open linked incident"
              className="grid h-6 w-6 place-items-center rounded-md border border-lavender/25 bg-lavender/10 text-lavender hover:bg-lavender/20">
              <Siren className="h-3 w-3" />
            </Link>
          )}
        </div>
      ),
    },
  ];

  const columns = wide ? allColumns : allColumns.filter((c) => c.key !== "device");
  const latest = fresh[0];

  return (
    <div>
      <PageHeader
        title="Threat Detection"
        description="Explainable, rule-based anomaly detection over ZeroTrustX sign-in, session, device and access telemetry. Every alert traces back to a deterministic rule and its evidence; no ML models or external threat-intelligence feeds are integrated."
        actions={<>
          <Button variant="outline" icon={<BookOpenCheck className="h-4 w-4" />} onClick={() => setRulesOpen(true)}>Detection rules</Button>
          {can("threats:write") && (
            <Button variant="primary" icon={<Radar className="h-4 w-4" />} loading={scan.isPending} onClick={() => scan.mutate()}>Run detection scan</Button>
          )}
        </>}
      />

      {summary.isError ? (
        <Card className="mb-4 px-5 py-4 text-xs text-danger">Could not load the alert summary: {apiError(summary.error).message}
          <Button size="xs" variant="ghost" className="ml-2" onClick={() => summary.refetch()}>Retry</Button></Card>
      ) : (
        <>
          <SeverityCards data={summary.data} loading={summary.isLoading} selected={severity} onSelect={setSev} />
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <CategoryBreakdown data={summary.data} loading={summary.isLoading} selected={category} onSelect={setCat} />
            <StatusCounts data={summary.data} loading={summary.isLoading} selected={status} onSelect={setStat} />
          </div>
        </>
      )}

      <Card className="mt-4">
        <AnimatePresence initial={false}>
          {latest && (
            <motion.div key="fresh" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 32 }} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-accent/20 bg-accent/[0.06] px-4 py-2.5" role="status" aria-live="polite">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                <motion.button key={latest.id} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} type="button" data-cursor="hover"
                  onClick={() => { openAlert(latest.id); setFresh((f) => f.filter((x) => x.id !== latest.id)); }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs">
                  <span className="shrink-0 font-medium text-accent">New alert</span>
                  <SeverityBadge severity={latest.severity} />
                  <span className="truncate text-fg">{latest.title}</span>
                  {latest.user && <span className="hidden truncate text-muted sm:inline">· {latest.user}</span>}
                  {fresh.length > 1 && <span className="shrink-0 text-subtle">+{fresh.length - 1} more</span>}
                </motion.button>
                <div className="flex items-center gap-1">
                  <Button size="xs" variant="subtle" onClick={() => { openAlert(latest.id); setFresh((f) => f.filter((x) => x.id !== latest.id)); }}>View</Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Dismiss new alert notice" onClick={() => setFresh([])}><X className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Toolbar>
          <div className="md:w-72">
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search title, user email or IP"
              leading={<Search className="h-4 w-4" />} aria-label="Search alerts" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:flex md:flex-wrap">
            <Select value={severity} onChange={(e) => setSev(e.target.value as Severity | "")} aria-label="Severity" className="md:w-40">
              <option value="">All severities</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </Select>
            <Select value={status} onChange={(e) => setStat(e.target.value as AlertStatusFilter)} aria-label="Status" className="md:w-56">
              {ALERT_STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            <div className="col-span-2 sm:col-span-1">
              <Select value={category} onChange={(e) => setCat(e.target.value)} aria-label="Category" className="md:w-48">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2 md:ml-auto">
            {filtered && <Button size="sm" variant="ghost" icon={<FilterX className="h-3.5 w-3.5" />} onClick={clearFilters}>Reset</Button>}
            <Button size="icon" variant="ghost" aria-label="Refresh alerts" title="Refresh" onClick={() => { list.refetch(); summary.refetch(); }}>
              <RefreshCw className={cn("h-4 w-4", list.isFetching && "animate-spin")} />
            </Button>
          </div>
        </Toolbar>

        {list.isError ? (
          <EmptyState title="Could not load alerts" description={apiError(list.error).message}
            action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>} />
        ) : (
          <DataTable
            columns={columns}
            rows={list.data?.items}
            loading={list.isLoading}
            rowKey={(a) => a.id}
            onRowClick={(a) => openAlert(a.id)}
            sort={sort}
            onSort={onSort}
            empty={filtered ? (
              <EmptyState icon={<FilterX className="h-5 w-5" />} title="No alerts match these filters"
                description="Try a different severity, status or category, or clear the search."
                action={<Button size="sm" onClick={clearFilters}>Reset filters</Button>} />
            ) : (
              <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No active alerts"
                description="No detection rule has fired on recent telemetry. Resolved and dismissed alerts remain available under the status filter." />
            )}
          />
        )}
        {list.data && list.data.total > 0 && (
          <div className="border-t border-line/70">
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
          </div>
        )}
      </Card>

      <AlertDrawer alertId={alertId} onClose={closeAlert} />
      <RulesDrawer open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
