import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/utils/format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "subtle";
type Size = "xs" | "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg shadow-[0_1px_0_0_rgb(255_255_255/0.18)_inset,0_6px_16px_-6px_rgb(var(--accent)/0.6)] hover:brightness-110 active:brightness-95",
  secondary: "bg-elevated text-fg border border-line hover:border-line-strong hover:bg-elevated/80",
  outline: "border border-line text-fg hover:bg-elevated/60 hover:border-line-strong",
  ghost: "text-muted hover:text-fg hover:bg-elevated/70",
  subtle: "bg-accent/10 text-accent hover:bg-accent/15",
  danger: "bg-danger/90 text-white hover:bg-danger shadow-[0_6px_16px_-8px_rgb(var(--danger)/0.7)]",
};
const SIZES: Record<Size, string> = {
  xs: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-[13px] gap-2 rounded-lg",
  lg: "h-11 px-5 text-sm gap-2 rounded-xl",
  icon: "h-8 w-8 rounded-lg justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode; iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, iconRight, className, children, disabled, type = "button", ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      data-cursor="hover"
      className={cn(
        "relative inline-flex select-none items-center font-medium whitespace-nowrap transition-[background,border,color,filter,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant], SIZES[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
      {iconRight}
    </button>
  );
});
