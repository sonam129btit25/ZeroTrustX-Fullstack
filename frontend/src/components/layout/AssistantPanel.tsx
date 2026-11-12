import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot, Loader2, Send } from "lucide-react";
import { api, apiError } from "@/services/api";
import type { AssistantResponse } from "@/types/api";
import { Drawer } from "@/components/ui/Overlay";
import { AssistantResult } from "@/components/security/Assistant";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";

const SUGGESTIONS = ["Who are the riskiest users?", "Show active incidents", "Why was access denied recently?", "Summarize activity today"];

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [history, setHistory] = useState<{ q: string; a: AssistantResponse }[]>([]);
  const ask = useMutation({
    mutationFn: async (question: string) => (await api.post<AssistantResponse>("/assistant/ask", { question })).data,
    onSuccess: (a, question) => { setHistory((h) => [{ q: question, a }, ...h].slice(0, 6)); setQ(""); },
  });
  const submit = (text: string) => { if (text.trim().length >= 2) ask.mutate(text.trim()); };

  return (
    <Drawer open={open} onClose={onClose} width="max-w-lg"
      title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-lavender" /> Security Assistant</span>}
      subtitle="Deterministic, local rule-based analysis. Advisory only — it cannot approve access or change policies."
      footer={
        <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); submit(q); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about risk, incidents, decisions, activity…" maxLength={500} aria-label="Question" />
          <Button type="submit" variant="primary" size="icon" aria-label="Ask" loading={ask.isPending}><Send className="h-4 w-4" /></Button>
        </form>
      }>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => submit(s)} className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted hover:border-line-strong hover:text-fg">{s}</button>
        ))}
      </div>
      {ask.isPending && <p className="mb-3 flex items-center gap-2 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analysing…</p>}
      {ask.isError && <p className="mb-3 text-xs text-danger">{apiError(ask.error).message}</p>}
      <div className="space-y-5">
        {history.map((h, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-accent/15 px-3 py-2 text-[13px] text-fg">{h.q}</p>
            <div className="rounded-xl border border-line bg-card p-3.5"><AssistantResult data={h.a} /></div>
          </div>
        ))}
        {!history.length && !ask.isPending && (
          <p className="text-xs leading-relaxed text-muted">Ask a question or pick a suggestion. Answers are generated from live platform records using explainable rules; no external AI service or API key is involved.</p>
        )}
      </div>
    </Drawer>
  );
}
