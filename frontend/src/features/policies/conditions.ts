import type { FieldMeta, PolicyCondition, PolicyFields } from "@/types/api";
import { titleCase } from "@/utils/format";
import { WEEKDAYS } from "./types";

/** How the value of a condition is edited, derived from the field type and operator. */
export type ValueKind = "none" | "chips" | "numberList" | "number" | "range" | "cidr" | "select" | "text";

export function valueKind(meta: FieldMeta | undefined, op: string): ValueKind {
  if (!meta) return "text";
  if (op === "is_true" || op === "is_false") return "none";
  if (op === "between") return "range";
  if (op === "in_cidr" || op === "not_in_cidr") return "cidr";
  if (["in", "not_in", "contains", "not_contains"].includes(op)) return meta.type === "number" ? "numberList" : "chips";
  if (meta.type === "number") return "number";
  if (meta.options?.length) return "select";
  return "text";
}

/** Editor-side condition: values are kept in an input-friendly shape and converted on submit. */
export interface DraftCondition { key: string; field: string; operator: string; value: unknown }

let seq = 0;
export const newKey = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyValue(kind: ValueKind, meta?: FieldMeta): unknown {
  switch (kind) {
    case "none": return null;
    case "chips": case "numberList": return [];
    case "range": return ["", ""];
    case "select": return meta?.options?.[0] ?? "";
    default: return "";
  }
}

/** Convert a stored condition value into the editor representation. */
export function toDraftValue(kind: ValueKind, value: unknown): unknown {
  switch (kind) {
    case "none": return null;
    case "chips": return Array.isArray(value) ? value.map(String) : value == null || value === "" ? [] : [String(value)];
    case "numberList": return Array.isArray(value) ? value.map(Number).filter((n) => !Number.isNaN(n)) : [];
    case "range": return Array.isArray(value) && value.length === 2 ? [String(value[0]), String(value[1])] : ["", ""];
    case "cidr": return Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
    case "number": return value == null ? "" : String(value);
    default: return value == null ? "" : String(value);
  }
}

/** Convert an editor value into the API payload value. Returns the raw (possibly invalid) value; validate separately. */
export function toPayloadValue(kind: ValueKind, value: unknown): unknown {
  const num = (v: unknown) => (v === "" || v == null ? NaN : Number(v));
  switch (kind) {
    case "none": return null;
    case "chips": return (value as string[]).map((s) => s.trim()).filter(Boolean);
    case "numberList": return value as number[];
    case "range": return (value as string[]).map(num);
    case "cidr": return String(value ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    case "number": return num(value);
    default: return String(value ?? "").trim();
  }
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export function isIp(s: string) { return IPV4.test(s) || (/^[0-9a-f:]+$/i.test(s) && s.includes(":")); }
export function isCidr(s: string) {
  const [ip, bits, ...rest] = s.split("/");
  if (rest.length) return false;
  if (!isIp(ip)) return false;
  if (bits === undefined) return true;
  const n = Number(bits);
  return /^\d+$/.test(bits) && n >= 0 && n <= (ip.includes(":") ? 128 : 32);
}

/** Client-side mirror of backend `validate_condition`. */
export function validatePayloadValue(kind: ValueKind, value: unknown, meta?: FieldMeta): string | null {
  switch (kind) {
    case "none": return null;
    case "chips": case "numberList": return (value as unknown[]).length ? null : "Add at least one value";
    case "range": {
      const [a, b] = value as number[];
      if (Number.isNaN(a) || Number.isNaN(b)) return "Enter both a minimum and a maximum";
      return a > b ? "Minimum must not exceed maximum" : null;
    }
    case "cidr": {
      const list = value as string[];
      if (!list.length) return "Enter at least one network (CIDR)";
      const bad = list.find((n) => !isCidr(n));
      return bad ? `“${bad}” is not a valid network` : null;
    }
    case "number": return Number.isNaN(value as number) ? "Enter a number" : null;
    default:
      if (!value) return "Enter a value";
      if (meta?.type === "ip" && !isIp(String(value))) return "Enter a valid IP address";
      return null;
  }
}

export function weekdayLabel(n: number) { return WEEKDAYS[n] ?? String(n); }

export function formatValue(field: string, op: string, value: unknown): string {
  if (op === "is_true" || op === "is_false") return "";
  const fmt = (v: unknown) => (field === "request.weekday" ? weekdayLabel(Number(v)) : String(v));
  if (op === "between" && Array.isArray(value)) return `${value[0]} – ${value[1]}`;
  if (Array.isArray(value)) return value.map(fmt).join(", ");
  return value == null ? "" : fmt(value);
}

/** Human-readable parts for a condition chip: [field label, operator label, value]. */
export function describeCondition(c: Pick<PolicyCondition, "field" | "operator" | "value">, cat?: PolicyFields): [string, string, string] {
  const label = cat?.fields[c.field]?.label ?? titleCase(c.field);
  const op = cat?.operators[c.operator] ?? c.operator;
  return [label, op, formatValue(c.field, c.operator, c.value)];
}

export function conditionText(c: Pick<PolicyCondition, "field" | "operator" | "value">, cat?: PolicyFields) {
  return describeCondition(c, cat).filter(Boolean).join(" ");
}
