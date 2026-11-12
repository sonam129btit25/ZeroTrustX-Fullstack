import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { api } from "@/services/api";
import { cn } from "@/utils/format";

export interface PasswordPolicy { min_length: number; require_upper: boolean; require_lower: boolean; require_digit: boolean; require_symbol: boolean; allow_self_registration: boolean }

export function usePasswordPolicy() {
  return useQuery({
    queryKey: ["password-policy"],
    queryFn: async () => (await api.get<PasswordPolicy>("/auth/password-policy")).data,
    staleTime: 300_000,
  });
}

export function passwordChecks(pw: string, p?: PasswordPolicy) {
  const min = p?.min_length ?? 12;
  return [
    { ok: pw.length >= min, label: `At least ${min} characters` },
    ...(p?.require_upper ?? true ? [{ ok: /[A-Z]/.test(pw), label: "Uppercase letter" }] : []),
    ...(p?.require_lower ?? true ? [{ ok: /[a-z]/.test(pw), label: "Lowercase letter" }] : []),
    ...(p?.require_digit ?? true ? [{ ok: /\d/.test(pw), label: "Number" }] : []),
    ...(p?.require_symbol ?? true ? [{ ok: /[^A-Za-z0-9]/.test(pw), label: "Symbol" }] : []),
  ];
}

export function PasswordStrength({ password }: { password: string }) {
  const { data } = usePasswordPolicy();
  const checks = passwordChecks(password, data);
  const passed = checks.filter((c) => c.ok).length;
  const bonus = password.length >= 16 ? 1 : 0;
  const score = Math.min(4, Math.round(((passed / checks.length) * 3) + bonus));
  const labels = ["Very weak", "Weak", "Fair", "Strong", "Excellent"];
  const colors = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"];
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cn("h-1 rounded-full transition-colors duration-300", password && i < score ? colors[score] : "bg-elevated")} />
          ))}
        </div>
        <span className="w-16 text-right text-2xs text-muted">{password ? labels[score] : ""}</span>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {checks.map((c) => (
          <li key={c.label} className={cn("flex items-center gap-1.5 text-2xs", c.ok ? "text-success" : "text-subtle")}>
            {c.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
