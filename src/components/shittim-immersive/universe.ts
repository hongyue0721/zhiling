import { mountPaperFallback, type PaperRenderer } from "./paper-fallback";
import type { PaperMode } from "./paper-model";
export { particleSeeds } from "./paper-model";
export type UniverseMode = PaperMode;
export type Universe = PaperRenderer;
/** The lightweight folio is immediate; upgrade to the project's existing Three.js dependency. */
export function mountUniverse(host: HTMLElement, initial: PaperMode, forceFallback = false): Universe {
  let mode = initial, paused = false, destroyed = false;
  let active = mountPaperFallback(host, mode);
  if (!forceFallback) {
    void Promise.all([import("three"), import("./paper-three")]).then(([THREE, { mountPaperThree }]) => {
      if (destroyed) return;
      try {
        const candidate = mountPaperThree(host, mode, THREE, () => {
          active.destroy(); active = mountPaperFallback(host, mode); active.setPaused(paused);
        });
        active.destroy(); active = candidate; active.setPaused(paused);
      } catch {
        // WebGL unavailable: retain the already working, same-theme canvas renderer.
        host.dataset.renderer = active.renderer;
      }
    }).catch(() => { /* Chunk/network failure must never remove the usable page. */ });
  }
  return {
    get renderer() { return active.renderer; },
    setMode(value) { mode = value; active.setMode(value); },
    setPaused(value) { paused = value; active.setPaused(value); },
    burst() { active.burst(); },
    destroy() { destroyed = true; active.destroy(); },
  };
}
