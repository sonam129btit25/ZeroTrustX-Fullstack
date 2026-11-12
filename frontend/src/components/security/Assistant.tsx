import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot, Loader2, Sparkles } from "lucide-react";
import { api, apiError } from "@/services/api";
import type { AssistantResponse } from "@/types/api";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Overlay";
import { useAuth } from "@/context/AuthContext";

export function AssistantResult({ data }: { data: AssistantResponse }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="rounded border border-lavender/30 bg-lavender/10 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider text-lavender">Advisory</span>
        <span className="font-mono text-2xs text-subtle">{data.provider}</span>
      </div>
      <h4 className="text-sm font-semibold">{data.title}</h4>
      <p className="text-[13px] leading-relaxed text-fg/90">{data.summary}</p>
      {data.findings.length > 0 && (
        <div>
          <p className="label mb-1.5">Findings</p>
          <ul className="space-y-1">{data.findings.map((f, i) => <li key={i} className="text-xs leading-relaxed text-muted">• {f}</li>)}</ul>
        </div>
      )}
      {data.recommendations.length > 0 && (
        <div>
          <p className="label mb-1.5">Suggested next steps</p>
          <ul className="space-y-1">{data.recommendations.map((f, i) => <li key={i} className="text-xs leading-relaxed text-fg/90">→ {f}</li>)}</ul>
        </div>
      )}
      <p className="rounded-md border border-line bg-surface/60 p-2 text-2xs leading-relaxed text-subtle">{data.disclaimer}</p>
    </div>
  );
}

/** Inline "Explain" button that opens an advisory explanation from a GET endpoint (e.g. /assistant/decisions/:id). */
export function ExplainButton({ endpoint, label = "Explain", title = "Security Assistant" }: { endpoint: string; label?: string; title?: string }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const m = useMutation({ mutationFn: async () => (await api.get<AssistantResponse>(endpoint)).data });
  if (!can("assistant:use")) return null;
  return (
    <>
      <Button size="xs" variant="subtle" icon={<Sparkles className="h-3 w-3" />} onClick={() => { setOpen(true); m.mutate(); }}>{label}</Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-lavender" />{title}</span>} width="max-w-md">
        {m.isPending && <div className="flex items-center gap-2 text-xs text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Analysing platform data…</div>}
        {m.isError && <p className="text-xs text-danger">{apiError(m.error).message}</p>}
        {m.data && <AssistantResult data={m.data} />}
      </Drawer>
    </>
  );
}
