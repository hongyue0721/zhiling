import type * as Three from "three";
import { paperPoint, particleSeeds, PAPER_PALETTES, readPaperTheme, type PaperMode } from "./paper-model";
import type { PaperRenderer } from "./paper-fallback";

/** Real Three.js engine. Imported lazily; no React re-render in the animation loop. */
export function mountPaperThree(
  host: HTMLElement,
  initial: PaperMode,
  THREE: typeof Three,
  onContextLost: () => void,
): PaperRenderer {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;pointer-events:none";
  canvas.setAttribute("aria-hidden", "true");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 30);
  const count = host.clientWidth < 700 ? 2200 : 3800;
  const seeds = particleSeeds(count), positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count), alpha = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const alphaAttribute = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
  const sizeAttribute = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("aAlpha", alphaAttribute); geometry.setAttribute("aSize", sizeAttribute);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    uniforms: { uDpr: { value: 1 }, uInk: { value: new THREE.Color() }, uGold: { value: new THREE.Color() } },
    vertexShader: `
      attribute float aAlpha; attribute float aSize; uniform float uDpr;
      varying float vAlpha; varying float vGold;
      void main() {
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_PointSize = clamp(aSize * uDpr * 1.5 * (3.6 / max(.4, -p.z)), 1.0, 8.0);
        vAlpha = aAlpha; vGold = fract(aSize * 17.0) > .82 ? 1.0 : 0.0;
      }`,
    fragmentShader: `
      uniform vec3 uInk; uniform vec3 uGold; varying float vAlpha; varying float vGold;
      void main() {
        float radius = length(gl_PointCoord - vec2(.5));
        float opacity = (1.0 - smoothstep(.18, .5, radius)) * vAlpha;
        if (opacity < .015) discard;
        gl_FragColor = vec4(mix(uInk, uGold, vGold), opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material); points.frustumCulled = false; scene.add(points);
  // Small floating paper fragments. Their low opacity never covers node text.
  const paperGeometry = new THREE.PlaneGeometry(.027, .048);
  const paperMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: .24, side: THREE.DoubleSide, depthWrite: false });
  const papers = new THREE.InstancedMesh(paperGeometry, paperMaterial, 24);
  papers.frustumCulled = false; papers.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(papers);
  const dummy = new THREE.Object3D();
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  let mode = initial, paused = false, destroyed = false, initialized = false, raf = 0;
  let time = 0, last = performance.now(), burst = 0, mx = -10, my = -10, width = 1, height = 1;
  function theme() {
    const palette = PAPER_PALETTES[readPaperTheme()];
    material.uniforms.uInk.value.set(palette.ink); material.uniforms.uGold.value.set(palette.gold);
    paperMaterial.color.set(palette.gold); wake();
  }
  function draw(now = performance.now()) {
    if (destroyed) return;
    const dt = Math.min(.04, (now - last) / 1000); last = now;
    const moving = !paused && !media.matches && !document.hidden;
    if (moving) { time += dt; burst *= Math.exp(-dt * 2.8); }
    const ambient = mode === "map" || mode === "ambient";
    geometry.setDrawRange(0, ambient ? 380 : count);
    const easing = !initialized || !moving ? 1 : 1 - Math.exp(-dt * 3.4);
    for (let i = 0; i < count; i++) {
      const k = i * 4, j = i * 3;
      const p = paperPoint(seeds[k], seeds[k + 1], seeds[k + 2], seeds[k + 3], time, mode);
      const dx = p.x - mx, dy = p.y - my;
      const force = moving ? Math.exp(-(dx * dx + dy * dy) * 7) * .12 : 0;
      const x = p.x + dx * force + Math.sin(seeds[k] * 65) * burst * .3;
      const y = p.y + dy * force + Math.cos(seeds[k + 1] * 40) * burst * .35;
      positions[j] += (x - positions[j]) * easing;
      positions[j + 1] += (y - positions[j + 1]) * easing;
      positions[j + 2] += (p.z - positions[j + 2]) * easing;
      sizes[i] = p.size; alpha[i] = p.alpha;
    }
    positionAttribute.needsUpdate = true; sizeAttribute.needsUpdate = true; alphaAttribute.needsUpdate = true;
    for (let i = 0; i < 24; i++) {
      const k = i * 4;
      dummy.position.set((seeds[k] - .5) * 5.8, (seeds[k + 1] - .5) * 3.4 + Math.sin(time * .17 + i) * .1, -.6 + seeds[k + 2] * .6);
      dummy.rotation.set(time * .16 + i, time * .11 + i * 1.8, seeds[k] * 7);
      dummy.scale.setScalar(ambient ? .7 : 1 + burst * 1.5); dummy.updateMatrix(); papers.setMatrixAt(i, dummy.matrix);
    }
    papers.instanceMatrix.needsUpdate = true;
    initialized = true;
    renderer.render(scene, camera);
    if (moving) raf = requestAnimationFrame(draw);
  }
  function wake() { if (destroyed) return; cancelAnimationFrame(raf); last = performance.now(); draw(); }
  function resize() {
    const r = host.getBoundingClientRect(); width = Math.max(1, r.width); height = Math.max(1, r.height);
    const dpr = Math.min(devicePixelRatio || 1, 1.65); renderer.setPixelRatio(dpr); renderer.setSize(width, height, false);
    material.uniforms.uDpr.value = dpr; camera.aspect = width / height;
    const scale = Math.min(width * .23, height * .29);
    camera.position.z = height / (2 * scale * Math.tan(THREE.MathUtils.degToRad(20)));
    camera.position.y = height * .06 / scale; camera.updateProjectionMatrix(); wake();
  }
  const onPointer = (e: PointerEvent) => {
    if (paused || media.matches) return;
    const r = host.getBoundingClientRect(), scale = Math.min(width * .23, height * .29);
    mx = (e.clientX - r.left - width / 2) / scale; my = -(e.clientY - r.top - height * .56) / scale;
  };
  const leave = () => { mx = -10; my = -10; };
  const lost = (event: Event) => { event.preventDefault(); if (!destroyed) onContextLost(); };
  const ro = new ResizeObserver(resize);
  host.append(canvas); host.dataset.renderer = "three-webgl";
  ro.observe(host); canvas.addEventListener("webglcontextlost", lost);
  document.addEventListener("pointermove", onPointer, { passive: true }); document.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", wake); window.addEventListener("shittim:theme", theme);
  media.addEventListener("change", wake); resize(); theme();
  return {
    renderer: "three-webgl", setMode(value) { mode = value; wake(); },
    setPaused(value) { paused = value; wake(); }, burst() { if (!paused && !media.matches) { burst = 1; wake(); } },
    destroy() {
      destroyed = true; cancelAnimationFrame(raf); ro.disconnect(); canvas.removeEventListener("webglcontextlost", lost);
      document.removeEventListener("pointermove", onPointer); document.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", wake); window.removeEventListener("shittim:theme", theme); media.removeEventListener("change", wake);
      geometry.dispose(); material.dispose(); paperGeometry.dispose(); paperMaterial.dispose(); papers.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
