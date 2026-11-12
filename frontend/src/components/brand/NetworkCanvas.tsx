import { useEffect, useRef } from "react";

/**
 * Subtle animated "zero trust mesh": nodes drift slowly; edges near the pointer light up and
 * verification pulses travel along random edges. Paused when reduced motion is preferred.
 */
export function NetworkCanvas({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const mouse = { x: -999, y: -999 };
    type N = { x: number; y: number; vx: number; vy: number; r: number; verified: number };
    let nodes: N[] = [];
    let pulses: { a: number; b: number; t: number; c: string }[] = [];

    const resize = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(70, (w * h) / 18000));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
        r: Math.random() * 1.4 + 0.8, verified: 0,
      }));
    };
    resize();
    const onMove = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
    addEventListener("resize", resize);
    addEventListener("pointermove", onMove, { passive: true });

    const LINK = 140;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const n of nodes) {
        if (!reduced) { n.x += n.vx; n.y += n.vy; }
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
        n.verified = Math.max(0, n.verified - 0.01);
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > LINK) continue;
          const md = Math.hypot((a.x + b.x) / 2 - mouse.x, (a.y + b.y) / 2 - mouse.y);
          const near = Math.max(0, 1 - md / 220);
          ctx.strokeStyle = `rgba(${near > 0.05 ? "155,138,251" : "108,143,245"},${(1 - d / LINK) * (0.1 + near * 0.35)})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          if (!reduced && Math.random() < 0.0006 && pulses.length < 14) pulses.push({ a: i, b: j, t: 0, c: Math.random() < 0.85 ? "103,200,222" : "236,104,116" });
        }
      }
      pulses = pulses.filter((p) => p.t <= 1);
      for (const p of pulses) {
        p.t += 0.012;
        const a = nodes[p.a], b = nodes[p.b];
        if (!a || !b) continue;
        const x = a.x + (b.x - a.x) * p.t, y = a.y + (b.y - a.y) * p.t;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
        g.addColorStop(0, `rgba(${p.c},0.85)`); g.addColorStop(1, `rgba(${p.c},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
        if (p.t > 0.98) b.verified = 1;
      }
      for (const n of nodes) {
        ctx.fillStyle = n.verified > 0 ? `rgba(103,200,222,${0.5 + n.verified * 0.5})` : "rgba(142,168,250,0.55)";
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + n.verified * 1.5, 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); removeEventListener("pointermove", onMove); };
  }, []);
  return <canvas ref={ref} className={className} aria-hidden />;
}
