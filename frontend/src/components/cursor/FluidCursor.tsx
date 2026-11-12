import { useEffect, useRef, useState } from "react";
import { usePreferences } from "@/context/PreferencesContext";

/**
 * Lightweight fluid cursor: a precise dot plus a lagging, velocity-stretched ring with a short
 * blue-lavender trail. Pure transforms on a single rAF loop; pointer-events: none so it never
 * intercepts clicks, typing or selection. Disabled on touch / coarse pointers and when the user
 * prefers reduced motion (or turns it off in preferences).
 */
const TRAIL = 6;

export function FluidCursor() {
  const { cursor } = usePreferences();
  const [enabled, setEnabled] = useState(false);
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const trail = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const fine = matchMedia("(pointer: fine) and (hover: hover)");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(cursor && fine.matches && !reduced.matches);
    update();
    fine.addEventListener?.("change", update);
    reduced.addEventListener?.("change", update);
    return () => { fine.removeEventListener?.("change", update); reduced.removeEventListener?.("change", update); };
  }, [cursor]);

  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) { root.classList.remove("ztx-cursor-on"); return; }
    root.classList.add("ztx-cursor-on");

    const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    const ringPos = { ...mouse };
    const pts = Array.from({ length: TRAIL }, () => ({ ...mouse }));
    let hover = false, down = false, text = false, visible = false, raf = 0, scale = 1;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      mouse.x = e.clientX; mouse.y = e.clientY;
      if (!visible) { visible = true; ringPos.x = mouse.x; ringPos.y = mouse.y; setOpacity(1); }
      const t = e.target as HTMLElement | null;
      const interactive = t?.closest?.("a, button, [role='button'], [role='tab'], [role='switch'], [data-cursor='hover'], summary, label");
      text = !!t?.closest?.("input, textarea, [contenteditable='true'], select");
      hover = !!interactive && !text;
    };
    const onDown = () => { down = true; };
    const onUp = () => { down = false; };
    const onLeave = () => { visible = false; setOpacity(0); };
    const setOpacity = (o: number) => {
      [dot.current, ring.current, ...trail.current].forEach((el) => el && (el.style.opacity = String(o)));
    };

    const loop = () => {
      const dx = mouse.x - ringPos.x, dy = mouse.y - ringPos.y;
      ringPos.x += dx * 0.17; ringPos.y += dy * 0.17;
      const speed = Math.min(Math.hypot(dx, dy), 120);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const stretch = 1 + speed / 260;
      const target = text ? 0.45 : hover ? 1.65 : down ? 0.8 : 1;
      scale += (target - scale) * 0.2;
      if (dot.current) dot.current.style.transform = `translate3d(${mouse.x}px, ${mouse.y}px, 0) translate(-50%, -50%) scale(${hover ? 0.6 : text ? 0 : 1})`;
      if (ring.current) {
        ring.current.style.transform =
          `translate3d(${ringPos.x}px, ${ringPos.y}px, 0) translate(-50%, -50%) rotate(${angle}deg) scale(${scale * stretch}, ${scale / Math.sqrt(stretch)})`;
        ring.current.dataset.hover = hover ? "1" : "0";
      }
      let px = ringPos.x, py = ringPos.y;
      for (let i = 0; i < TRAIL; i++) {
        const p = pts[i];
        p.x += (px - p.x) * 0.38; p.y += (py - p.y) * 0.38;
        const el = trail.current[i];
        if (el) el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%) scale(${(1 - i / TRAIL) * (hover ? 0.4 : 1)})`;
        px = p.x; py = p.y;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("pointerdown", onDown, { passive: true });
    addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerdown", onDown);
      removeEventListener("pointerup", onUp);
      document.removeEventListener("mouseleave", onLeave);
      root.classList.remove("ztx-cursor-on");
    };
  }, [enabled]);

  if (!enabled) return null;
  const common = "pointer-events-none fixed left-0 top-0 z-[9999] rounded-full opacity-0 will-change-transform";
  return (
    <div aria-hidden>
      {Array.from({ length: TRAIL }).map((_, i) => (
        <div key={i} ref={(el) => { trail.current[i] = el; }} className={common}
          style={{ width: 10, height: 10, transition: "opacity .2s", background: `rgb(${i % 2 ? "155 138 251" : "108 143 245"} / ${0.16 - i * 0.02})`, filter: "blur(2px)" }} />
      ))}
      <div ref={ring} className={`${common} border transition-[opacity,background-color,border-color] duration-200 data-[hover='1']:border-lavender/70 data-[hover='1']:bg-accent/10`}
        style={{ width: 34, height: 34, borderColor: "rgb(108 143 245 / 0.55)", boxShadow: "0 0 18px rgb(108 143 245 / 0.18)", mixBlendMode: "normal" }} />
      <div ref={dot} className={`${common} transition-opacity`} style={{ width: 6, height: 6, background: "rgb(var(--fg))", boxShadow: "0 0 6px rgb(155 138 251 / .8)" }} />
    </div>
  );
}
