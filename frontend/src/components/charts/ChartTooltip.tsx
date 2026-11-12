import type { TooltipProps } from "recharts";
import { titleCase } from "@/utils/format";

export function ChartTooltip({ active, payload, label, labelFormatter }: TooltipProps<number, string> & { labelFormatter?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card-elevated min-w-[160px] rounded-lg px-3 py-2 text-xs">
      {label !== undefined && <p className="mb-1.5 font-medium text-fg">{labelFormatter ? labelFormatter(String(label)) : String(label)}</p>}
      <ul className="space-y-1">
        {payload.filter((p) => p.value !== undefined).map((p) => (
          <li key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: (p.color ?? p.payload?.fill) as string }} />
            <span className="text-muted">{titleCase(String(p.name ?? p.dataKey))}</span>
            <span className="num ml-auto font-medium text-fg">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
