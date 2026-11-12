import { useQuery } from "@tanstack/react-query";
import { Bot, ExternalLink, FileCode2, RefreshCw, Server } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Data";
import { api, apiError } from "@/services/api";
import { cn, titleCase } from "@/utils/format";
import { ErrorCard, Fact, Section } from "./shared";

interface SystemStatus {
  status: string; version: string; environment: string; uptime_seconds: number; websocket_clients: number;
  assistant_provider: string; components: Record<string, string>;
}

export function humanDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.floor(sec)}s`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(" ");
}

const COMPONENT_LABEL: Record<string, string> = { api: "API", database: "Database (PostgreSQL)", policy_engine: "Policy engine", realtime: "Realtime (WebSocket)" };

export function SystemTab() {
  const q = useQuery({
    queryKey: ["system-status"],
    queryFn: async () => (await api.get<SystemStatus>("/system/status")).data,
    refetchInterval: 30_000,
  });

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-40 w-full rounded-xl" /><Skeleton className="h-48 w-full rounded-xl" /></div>;
  if (q.isError || !q.data) return <ErrorCard title="Couldn't load system status" message={apiError(q.error).message} onRetry={() => q.refetch()} />;
  const s = q.data;
  const operational = s.status === "operational";
  const local = s.assistant_provider === "local-rules";

  return (
    <div className="space-y-4">
      <Section
        title={<span className="flex items-center gap-2"><Server className="h-4 w-4 text-accent" />Platform status</span>}
        actions={<>
          <Badge tone={operational ? "success" : "warning"} dot>{titleCase(s.status)}</Badge>
          <Button size="icon" variant="ghost" aria-label="Refresh status" onClick={() => q.refetch()}>
            <RefreshCw className={cn("h-3.5 w-3.5", q.isFetching && "animate-spin")} />
          </Button>
        </>}
      >
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          <Fact label="Version"><span className="font-mono">v{s.version}</span></Fact>
          <Fact label="Environment"><Badge tone={s.environment === "production" ? "success" : "accent"}>{s.environment}</Badge></Fact>
          <Fact label="Uptime"><span className="num" title={`${s.uptime_seconds.toLocaleString()} seconds`}>{humanDuration(s.uptime_seconds)}</span></Fact>
          <Fact label="Realtime clients"><span className="num">{s.websocket_clients}</span></Fact>
        </dl>
        <ul className="mt-5 grid grid-cols-1 gap-2 border-t border-line/60 pt-4 sm:grid-cols-2">
          {Object.entries(s.components).map(([k, v]) => {
            const ok = v === "operational";
            return (
              <li key={k} className="flex items-center justify-between gap-3 rounded-lg border border-line/70 bg-surface/50 px-3 py-2">
                <span className="flex items-center gap-2.5 text-[13px]">
                  <span className="relative flex h-2 w-2">
                    {ok && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/40 [animation-duration:2.4s]" />}
                    <span className={cn("relative inline-flex h-2 w-2 rounded-full", ok ? "bg-success" : v === "degraded" ? "bg-warning" : "bg-danger")} />
                  </span>
                  {COMPONENT_LABEL[k] ?? titleCase(k)}
                </span>
                <span className={cn("text-2xs", ok ? "text-success" : "text-warning")}>{titleCase(v)}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-2xs text-subtle">Refreshes every 30 seconds.</p>
      </Section>

      <Section title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-lavender" />Security assistant</span>}
        actions={<span className="font-mono text-2xs text-subtle">{s.assistant_provider}</span>}>
        {local ? (
          <div className="space-y-2 text-xs leading-relaxed text-muted">
            <p><span className="font-medium text-fg">Deterministic, local rules engine.</span> Explanations and summaries are generated from platform data using fixed rules — no external AI service is called and no API keys are configured. The same input always yields the same output.</p>
            <p>A future AI provider would be optional and strictly advisory: it could summarise and suggest, but never make or change access decisions.</p>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted">The assistant uses the <span className="font-mono text-fg">{s.assistant_provider}</span> provider. Its output is advisory only and never changes access decisions.</p>
        )}
      </Section>

      <Section title={<span className="flex items-center gap-2"><FileCode2 className="h-4 w-4 text-cyan" />API</span>}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-xs leading-relaxed text-muted">
            Interactive OpenAPI documentation for the REST API (<span className="font-mono">/api/v1</span>). In development it is served by the backend
            (<span className="font-mono">localhost:8000/api/docs</span>) and reached through the dev proxy. Every endpoint enforces the same RBAC as this console.
          </p>
          <a href="/api/docs" target="_blank" rel="noopener noreferrer" data-cursor="hover"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-fg transition-colors hover:border-line-strong hover:bg-elevated/60">
            Open API docs <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </Section>
    </div>
  );
}
