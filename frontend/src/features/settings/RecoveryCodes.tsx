import { useState } from "react";
import { Copy, Download, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Form";
import { useToast } from "@/context/ToastContext";
import { copyText } from "@/features/audit/CopyValue";
import { Notice } from "./shared";

function downloadText(text: string, filename: string) {
  const href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

/** One-time display of freshly issued recovery codes. */
export function RecoveryCodes({ codes, email, onDone, doneLabel = "Done" }: { codes: string[]; email: string; onDone: () => void; doneLabel?: string }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const [handled, setHandled] = useState(false);
  const body = [
    "ZeroTrustX MFA recovery codes",
    `Account: ${email}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Each code can be used once to sign in or to disable MFA if you lose your authenticator.",
    "Store them somewhere safe and offline.",
    "",
    ...codes.map((c, i) => `${String(i + 1).padStart(2, " ")}. ${c}`),
    "",
  ].join("\n");

  return (
    <div className="space-y-4">
      <Notice tone="warning" icon={<KeyRound className="h-3.5 w-3.5" />}>
        <span className="font-medium">These codes are shown only once.</span>{" "}
        <span className="text-muted">ZeroTrustX stores only a hash of each code, so they cannot be displayed again. Each code works a single time.</span>
      </Notice>
      <ol className="grid grid-cols-1 gap-2 rounded-xl border border-line bg-base/50 p-3 min-[400px]:grid-cols-2" aria-label="Recovery codes">
        {codes.map((c, i) => (
          <li key={c} className="flex items-center gap-2 rounded-md border border-line/70 bg-surface/70 px-2.5 py-1.5">
            <span className="num w-4 text-right text-2xs text-subtle">{i + 1}</span>
            <code className="font-mono text-[13px] tracking-wide text-fg">{c}</code>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={async () => {
          if (await copyText(codes.join("\n"))) { setHandled(true); toast.success("Recovery codes copied"); }
          else toast.error("Could not copy", "Use Download instead.");
        }}>Copy all</Button>
        <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => {
          downloadText(body, `zerotrustx-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`);
          setHandled(true);
        }}>Download .txt</Button>
      </div>
      <div className="flex flex-col gap-3 border-t border-line/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Checkbox checked={saved} onChange={setSaved} label="I've saved these recovery codes somewhere safe" />
        <Button variant="primary" disabled={!saved} onClick={onDone}>{doneLabel}</Button>
      </div>
      {!handled && !saved && <p className="text-2xs text-subtle">Tip: copy or download the codes before confirming.</p>}
    </div>
  );
}
