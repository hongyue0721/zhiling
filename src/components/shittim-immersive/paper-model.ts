/** Shared by Three.js and Canvas fallback. Pure and deterministic; no task state. */
export type PaperMode = "ambient" | "generating" | "searching" | "structuring" | "checking" | "success" | "map";
export type PaperTheme = "light" | "dark";
export type PaperPoint = { x: number; y: number; z: number; alpha: number; size: number };
export const PAPER_PALETTES = {
  light: { paper: "#f6f1e6", ink: "#8a4423", gold: "#af8650", dust: "#65513d", petal: "#c58d83" },
  dark: { paper: "#131110", ink: "#c89761", gold: "#d9b786", dust: "#c8c1ae", petal: "#e3ac9f" },
} as const;
export function particleSeeds(count: number, seed = 2703): Float32Array {
  const out = new Float32Array(Math.max(0, Math.floor(count)) * 4);
  let state = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    out[i] = state / 4294967296;
  }
  return out;
}
/** A gently opening folio, rather than an orbital globe. Units are world-space. */
export function paperPoint(a: number, b: number, c: number, d: number, time: number, mode: PaperMode): PaperPoint {
  const drift = Math.sin(time * 0.26 + a * 19) * 0.025;
  if (mode === "map" || mode === "ambient") {
    return { x: (a - .5) * 8.8 + Math.sin(time * .07 + b * 12) * .12,
      y: (b - .5) * 5.1 + drift, z: (c - .5) * 2.5,
      alpha: d > .9 ? .24 : .045, size: d > .97 ? 2.4 : 1.1 };
  }
  if (mode === "checking") {
    const angle = a * Math.PI * 2 + time * .1;
    const rim = d > .5 ? .73 + b * .025 : Math.sqrt(b) * .62;
    return { x: Math.cos(angle) * rim, y: Math.sin(angle) * rim,
      z: Math.sin(c * 19 + time * .5) * .07,
      alpha: d > .5 ? .9 : .17, size: 1.35 + d * .6 };
  }
  const side = a < .5 ? -1 : 1;
  let u = (a * 2) % 1, v = b - .5;
  const leaf = Math.floor(c * 4);
  // Contours, gutter and fine ruled lines make a folio silhouette, not a random cloud.
  const contour = d < .44;
  let opacity = .2;
  if (d < .22) { u = d < .11 ? .015 : 1; opacity = .82; }
  else if (d < .44) { v = d < .33 ? -.5 : .5; opacity = .7; }
  else if (d < .8) { u = .13 + u * .72; v = Math.round(v * 13) / 13; opacity = .25; }
  const opening = mode === "structuring" ? .93 : .78;
  let x = side * (.03 + u * 1.28);
  let y = -.12 + Math.sin(u * Math.PI) * (.23 + c * .06) + leaf * .03 + drift;
  let z = v * 1.45;
  // An occasional lifted leaf is shared by GPU and Canvas and does not imply task progress.
  if (leaf === 3 && (mode === "searching" || mode === "generating")) {
    const lift = (.5 + .5 * Math.sin(time * .65)) * .34;
    y += Math.sin(u * Math.PI * .75) * lift;
    x *= 1 - lift * .12;
  }
  const tilt = .68;
  const yy = y * Math.cos(tilt) - z * Math.sin(tilt);
  z = y * Math.sin(tilt) + z * Math.cos(tilt);
  y = yy + u * (1 - opening) * .14;
  if (mode === "success") { x *= 1.06; y += Math.sin(a * 18 + time) * .025; }
  return { x, y, z, alpha: opacity, size: contour ? 1.65 : 1.15 + c * .3 };

}
export function readPaperTheme(): PaperTheme {
  return typeof document !== "undefined" && document.documentElement.dataset.shittimTone === "dark" ? "dark" : "light";
}
