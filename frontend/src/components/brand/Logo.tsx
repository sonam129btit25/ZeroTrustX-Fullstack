import { cn } from "@/utils/format";

export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="ztx-g" x1="6" y1="3" x2="34" y2="37" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8EA8FA" />
          <stop offset="1" stopColor="#9B8AFB" />
        </linearGradient>
        <linearGradient id="ztx-f" x1="20" y1="4" x2="20" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1B2740" />
          <stop offset="1" stopColor="#10182A" />
        </linearGradient>
      </defs>
      <path d="M20 3.5 7 8.3v9.6c0 8.3 5.5 14.8 13 17.6 7.5-2.8 13-9.3 13-17.6V8.3L20 3.5Z" fill="url(#ztx-f)" stroke="url(#ztx-g)" strokeWidth="1.6" strokeLinejoin="round" />
      <g stroke="#7F9BF7" strokeWidth="1.15" strokeLinecap="round" opacity="0.9">
        <path d="M20 13.2 14.2 21.6M20 13.2l5.8 8.4M14.2 21.6h11.6M14.2 21.6 20 27.4l5.8-5.8" />
      </g>
      <circle cx="20" cy="13.2" r="2.3" fill="#9B8AFB" />
      <circle cx="14.2" cy="21.6" r="2" fill="#6C8FF5" />
      <circle cx="25.8" cy="21.6" r="2" fill="#6C8FF5" />
      <circle cx="20" cy="27.4" r="1.7" fill="#67C8DE" />
    </svg>
  );
}

export function Logo({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!collapsed && (
        <span className="text-[15px] font-semibold tracking-tight text-fg">
          ZeroTrust<span className="bg-gradient-to-r from-accent to-lavender bg-clip-text text-transparent">X</span>
        </span>
      )}
    </span>
  );
}
