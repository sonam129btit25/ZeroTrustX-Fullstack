import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/format";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-elevated/70", className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.045] to-transparent" />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl border border-line bg-elevated text-subtle">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="text-[13px] font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export interface Column<T> {
  key: string; header: ReactNode; render: (row: T) => ReactNode; sortable?: boolean; className?: string; headerClassName?: string;
  hideBelow?: "sm" | "md" | "lg" | "xl";
}

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" };

export function DataTable<T>({ columns, rows, loading, rowKey, onRowClick, sort, onSort, empty, skeletonRows = 6 }: {
  columns: Column<T>[]; rows: T[] | undefined; loading?: boolean; rowKey: (r: T) => string | number; onRowClick?: (r: T) => void;
  sort?: { key: string; order: "asc" | "desc" }; onSort?: (key: string) => void; empty?: ReactNode; skeletonRows?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col"
                className={cn("sticky top-0 z-10 border-b border-line bg-card/95 px-4 py-2.5 text-2xs font-medium uppercase tracking-[0.07em] text-subtle backdrop-blur", c.hideBelow && HIDE[c.hideBelow], c.headerClassName)}>
                {c.sortable && onSort ? (
                  <button onClick={() => onSort(c.key)} className="inline-flex items-center gap-1 uppercase hover:text-fg" data-cursor="hover">
                    {c.header}
                    {sort?.key === c.key && (sort.order === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                ) : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !rows?.length
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={i}>{columns.map((c) => (
                  <td key={c.key} className={cn("border-b border-line/60 px-4 py-3.5", c.hideBelow && HIDE[c.hideBelow])}><Skeleton className="h-3.5 w-3/4" /></td>
                ))}</tr>
              ))
            : rows?.map((r, i) => (
                <motion.tr
                  key={rowKey(r)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.015, 0.2) }}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  data-cursor={onRowClick ? "hover" : undefined}
                  className={cn("group transition-colors", onRowClick && "cursor-pointer hover:bg-elevated/50")}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn("border-b border-line/60 px-4 py-3 align-middle text-[13px]", c.hideBelow && HIDE[c.hideBelow], c.className)}>
                      {c.render(r)}
                    </td>
                  ))}
                </motion.tr>
              ))}
        </tbody>
      </table>
      {!loading && rows && rows.length === 0 && (empty ?? <EmptyState title="No results" description="Try adjusting your filters." />)}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-muted">
      <span className="num">{from}–{to} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-1.5">
        <Button size="icon" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="num px-1">{page} / {pages}</span>
        <Button size="icon" variant="ghost" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string;
}) {
  const [id] = useState(() => Math.random().toString(36).slice(2));
  return (
    <div role="tablist" className={cn("flex items-center gap-1 overflow-x-auto rounded-lg border border-line bg-surface/60 p-1", className)}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)} data-cursor="hover"
          className={cn("relative whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors", value === t.value ? "text-fg" : "text-muted hover:text-fg")}>
          {value === t.value && (
            <motion.span layoutId={`tab-${id}`} className="absolute inset-0 rounded-md border border-line-strong/70 bg-elevated shadow-sm"
              transition={{ type: "spring", stiffness: 450, damping: 36 }} />
          )}
          <span className="relative flex items-center gap-1.5">
            {t.label}
            {t.count !== undefined && <span className="num rounded bg-base/60 px-1 text-2xs text-subtle">{t.count}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="label">{k}</dt>
          <dd className="mt-1 truncate text-[13px] text-fg">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
