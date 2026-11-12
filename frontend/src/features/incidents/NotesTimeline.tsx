import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownUp, GitCommitVertical, MessageSquareText, Send, UserRoundCog } from "lucide-react";
import { Avatar } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Form";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import { cn, fmtDate, timeAgo } from "@/utils/format";
import type { Incident } from "@/types/api";

type Note = NonNullable<Incident["notes"]>[number];
type Filter = "all" | "note" | "status_change" | "assignment";

const KIND: Record<string, { icon: typeof MessageSquareText; ring: string; label: string }> = {
  note: { icon: MessageSquareText, ring: "border-accent/30 bg-accent/10 text-accent", label: "Note" },
  status_change: { icon: GitCommitVertical, ring: "border-lavender/30 bg-lavender/10 text-lavender", label: "Status" },
  assignment: { icon: UserRoundCog, ring: "border-cyan/30 bg-cyan/10 text-cyan", label: "Assignment" },
};

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" }, { value: "note", label: "Notes" }, { value: "status_change", label: "Status" }, { value: "assignment", label: "Assignment" },
];

export function NotesTimeline({ incident, canWrite }: { incident: Incident; canWrite: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const notes = incident.notes ?? [];
  const counts = useMemo(() => notes.reduce<Record<string, number>>((a, n) => ({ ...a, [n.note_type]: (a[n.note_type] ?? 0) + 1 }), {}), [notes]);
  const shown = useMemo(() => {
    const f = filter === "all" ? notes : notes.filter((n) => n.note_type === filter);
    return newestFirst ? [...f].reverse() : f;
  }, [notes, filter, newestFirst]);

  return (
    <div>
      {canWrite && <Composer incidentId={incident.id} closed={incident.status === "closed"} />}
      <div className={cn("flex flex-wrap items-center justify-between gap-2 px-5 py-3", canWrite && "border-t border-line/70")}>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter timeline">
          {FILTERS.map((f) => {
            const n = f.value === "all" ? notes.length : counts[f.value] ?? 0;
            return (
              <button key={f.value} type="button" onClick={() => setFilter(f.value)} aria-pressed={filter === f.value} data-cursor="hover"
                className={cn("rounded-md border px-2 py-1 text-2xs font-medium transition-colors",
                  filter === f.value ? "border-line-strong bg-elevated text-fg" : "border-transparent text-muted hover:text-fg")}>
                {f.label} <span className="num text-subtle">{n}</span>
              </button>
            );
          })}
        </div>
        <Button size="xs" variant="ghost" icon={<ArrowDownUp className="h-3 w-3" />} onClick={() => setNewestFirst((v) => !v)}>
          {newestFirst ? "Newest first" : "Oldest first"}
        </Button>
      </div>
      {shown.length === 0 ? (
        <p className="px-5 pb-6 pt-2 text-center text-xs text-muted">No {filter === "all" ? "" : FILTERS.find((f) => f.value === filter)?.label.toLowerCase() + " "}entries yet.</p>
      ) : (
        <ol className="relative px-5 pb-5">
          <span aria-hidden className="absolute bottom-6 left-[35px] top-2 w-px bg-line" />
          <AnimatePresence initial={false}>
            {shown.map((n) => <Entry key={n.id} note={n} />)}
          </AnimatePresence>
        </ol>
      )}
    </div>
  );
}

function Entry({ note }: { note: Note }) {
  const k = KIND[note.note_type] ?? KIND.note;
  const Icon = k.icon;
  const isNote = note.note_type === "note";
  const author = note.author?.full_name ?? "System";
  return (
    <motion.li layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 34 }} className="relative flex gap-3 py-2.5">
      <span className={cn("relative z-10 grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border bg-surface", k.ring)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {isNote ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-fg"><Avatar name={author} size={16} />{author}</span>
          ) : <span className="text-[13px] text-fg">{note.body}</span>}
          {isNote && <span className="text-2xs text-subtle">added a note</span>}
          {!isNote && note.author && <span className="text-2xs text-subtle">by {author}</span>}
          <time dateTime={note.created_at} title={fmtDate(note.created_at, { dateStyle: "full", timeStyle: "long" })}
            className="cursor-default text-2xs text-subtle underline decoration-dotted decoration-line-strong underline-offset-2">
            {timeAgo(note.created_at)}
          </time>
        </div>
        {isNote && (
          <div className="mt-1.5 whitespace-pre-wrap break-words rounded-lg border border-line bg-card/70 px-3 py-2.5 text-[13px] leading-relaxed text-fg">{note.body}</div>
        )}
      </div>
    </motion.li>
  );
}

function Composer({ incidentId, closed }: { incidentId: string; closed: boolean }) {
  const [body, setBody] = useState("");
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async () => (await api.post<Incident>(`/incidents/${incidentId}/notes`, { body: body.trim() })).data,
    onSuccess: (inc) => {
      qc.setQueryData(["incidents", incidentId], inc);
      qc.invalidateQueries({ queryKey: ["incidents"] });
      setBody("");
      toast.success("Note added to timeline");
    },
    onError: (e) => toast.error("Could not add note", apiError(e).message),
  });
  const submit = () => { if (body.trim() && !m.isPending) m.mutate(); };
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="px-5 py-4">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={3} aria-label="Investigation note"
        placeholder={closed ? "This incident is closed. Notes are still recorded for the post-incident review…" : "Record findings, containment steps or hand-off context…"}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-2xs text-subtle">
          <kbd className="rounded border border-line bg-elevated px-1 font-mono">{isMac ? "⌘" : "Ctrl"}</kbd>{" + "}
          <kbd className="rounded border border-line bg-elevated px-1 font-mono">Enter</kbd> to submit
          {body.length > 4000 && <span className="num ml-2">{body.length}/5000</span>}
        </span>
        <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} loading={m.isPending} disabled={!body.trim()} onClick={submit}>Add note</Button>
      </div>
    </div>
  );
}
