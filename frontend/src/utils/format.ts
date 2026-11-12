export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function fmtDate(iso?: string | null, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, opts).format(d);
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const future = diff < 0;
  const s = Math.abs(diff);
  const units: [number, string][] = [[60, "s"], [60, "m"], [24, "h"], [30, "d"], [12, "mo"], [Number.POSITIVE_INFINITY, "y"]];
  let v = s;
  let label = "s";
  for (const [step, u] of units) {
    label = u;
    if (v < step) break;
    v /= step;
  }
  const n = Math.max(1, Math.floor(v));
  if (label === "s" && s < 10) return future ? "in a moment" : "just now";
  return future ? `in ${n}${label}` : `${n}${label} ago`;
}

export function titleCase(s?: string | null) {
  if (!s) return "";
  return s.replace(/[_.]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name?: string | null) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

export function riskLevel(score: number) {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  if (score >= 15) return "low";
  return "minimal";
}

export const fmtNum = (n?: number | null) => (n === undefined || n === null ? "—" : new Intl.NumberFormat().format(n));
