import {
  paperPoint,
  particleSeeds,
  PAPER_PALETTES,
  readPaperTheme,
  type PaperMode,
} from "./paper-model";
export type PaperRenderer = {
  setMode(mode: PaperMode): void;
  setPaused(paused: boolean): void;
  burst(): void;
  destroy(): void;
  renderer: "three-webgl" | "canvas2d" | "static";
};
/** Immediate fallback: same folio shape, no images or timers pretending to be task progress. */
export function mountPaperFallback(
  host: HTMLElement,
  initial: PaperMode,
): PaperRenderer {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "display:block;width:100%;height:100%;pointer-events:none";
  host.append(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx)
    return {
      renderer: "static",
      setMode() {},
      setPaused() {},
      burst() {},
      destroy() {
        canvas.remove();
      },
    };
  host.dataset.renderer = "canvas2d";
  const seeds = particleSeeds(2400);
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  let mode = initial,
    paused = false,
    destroyed = false,
    raf = 0,
    width = 1,
    height = 1;
  let time = 0,
    last = performance.now(),
    burst = 0,
    mx = -10,
    my = -10;
  const positions = new Float32Array(2400 * 3);
  let initialized = false;
  function draw(now = performance.now()) {
    if (destroyed) return;
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    const moving = !paused && !media.matches && !document.hidden;
    if (moving) {
      time += dt;
      burst *= Math.exp(-dt * 2.8);
    }
    const context = ctx!;
    context.clearRect(0, 0, width, height);
    const palette = PAPER_PALETTES[readPaperTheme()];
    const scale = Math.min(width * 0.23, height * 0.29);
    const ambient = mode === "map" || mode === "ambient";
    const count = ambient ? 280 : 2400;
    for (let i = 0; i < count; i++) {
      const k = i * 4,
        j = i * 3;
      const p = paperPoint(
        seeds[k],
        seeds[k + 1],
        seeds[k + 2],
        seeds[k + 3],
        time,
        mode,
      );
      const ease = !initialized || !moving ? 1 : 1 - Math.exp(-dt * 3.4);
      positions[j] += (p.x - positions[j]) * ease;
      positions[j + 1] += (p.y - positions[j + 1]) * ease;
      positions[j + 2] += (p.z - positions[j + 2]) * ease;
      let px = positions[j],
        py = positions[j + 1];
      const distance = Math.hypot(px - mx, py - my);
      const force = moving ? Math.exp(-distance * distance * 7) * 0.12 : 0;
      px += (px - mx) * force + Math.sin(seeds[k] * 65) * burst * 0.3;
      py += (py - my) * force + Math.cos(seeds[k + 1] * 40) * burst * 0.35;
      const perspective = 3.6 / (3.6 + positions[j + 2]);
      context.fillStyle = i % 7 === 0 ? palette.gold : palette.ink;
      context.globalAlpha = p.alpha * (ambient ? 1 : 0.84);
      context.beginPath();
      context.arc(
        width * 0.5 + px * scale * perspective,
        height * 0.56 - py * scale * perspective,
        Math.max(0.4, p.size * 0.63 * perspective),
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    initialized = true;
    context.globalAlpha = 1;
    if (moving) raf = requestAnimationFrame(draw);
  }
  function wake() {
    cancelAnimationFrame(raf);
    last = performance.now();
    draw();
  }
  function resize() {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const dpr = Math.min(devicePixelRatio || 1, 1.65);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    wake();
  }
  const onPointer = (event: PointerEvent) => {
    if (paused || media.matches) return;
    const r = host.getBoundingClientRect(),
      scale = Math.min(width * 0.23, height * 0.29);
    mx = (event.clientX - r.left - width / 2) / scale;
    my = -(event.clientY - r.top - height * 0.56) / scale;
  };
  const leave = () => {
    mx = -10;
    my = -10;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  document.addEventListener("pointermove", onPointer, { passive: true });
  document.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("shittim:theme", wake);
  media.addEventListener("change", wake);
  resize();
  return {
    renderer: "canvas2d",
    setMode(value) {
      mode = value;
      wake();
    },
    setPaused(value) {
      paused = value;
      wake();
    },
    burst() {
      if (!paused && !media.matches) {
        burst = 1;
        wake();
      }
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("pointermove", onPointer);
      document.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("shittim:theme", wake);
      media.removeEventListener("change", wake);
      canvas.remove();
    },
  };
}
