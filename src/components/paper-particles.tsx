"use client";

import { useEffect, useRef } from "react";

type Particle = {
  /** 归一化坐标（0-1），缩放无关 */
  x: number;
  y: number;
  radius: number;
  /** 漂移速度（px/s），带方向 */
  vx: number;
  vy: number;
  /** 视差深度：越大越靠近纸面 */
  depth: number;
  /** 呼吸相位 */
  phase: number;
  alpha: number;
};

const MAX_PARTICLES = 64;
const AREA_PER_PARTICLE = 26000;

/**
 * 纸面墨点背景：暖棕墨尘缓慢漂浮，带轻微鼠标视差。
 * 纯装饰层，不拦截指针；prefers-reduced-motion 时渲染单帧后静止。
 */
export function PaperParticles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

    let particles: Particle[] = [];
    let rafId = 0;
    let lastTime = performance.now();
    let pointerX = 0.5;
    let pointerY = 0.5;
    let dpr = 1;

    const spawn = () => {
      const { innerWidth, innerHeight } = window;
      const mobile = innerWidth <= 820;
      const count = Math.min(
        MAX_PARTICLES,
        Math.round((innerWidth * innerHeight) / AREA_PER_PARTICLE / (mobile ? 2 : 1)),
      );
      particles = Array.from({ length: count }, () => {
        const depth = 0.3 + Math.random() * 0.7;
        return {
          x: Math.random(),
          y: Math.random(),
          radius: 0.8 + Math.random() * 1.8,
          // 漂移以极缓的上浮为主，叠加少量水平游移
          vx: (Math.random() - 0.5) * 6 * depth,
          vy: -(2 + Math.random() * 7) * depth,
          depth,
          phase: Math.random() * Math.PI * 2,
          alpha: 0.05 + Math.random() * 0.09,
        };
      });
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      spawn();
    };

    const draw = (time: number) => {
      const { innerWidth: width, innerHeight: height } = window;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const elapsed = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      // 视差偏移：鼠标位置相对屏幕中心的偏移 × 深度
      const parallaxX = (pointerX - 0.5) * 18;
      const parallaxY = (pointerY - 0.5) * 12;

      for (const p of particles) {
        if (!reducedMotion) {
          p.x += (p.vx * elapsed) / width;
          p.y += (p.vy * elapsed) / height;
          // 越界后从对侧回绕，保持密度恒定
          if (p.y < -0.02) p.y = 1.02;
          if (p.x < -0.02) p.x = 1.02;
          if (p.x > 1.02) p.x = -0.02;
        }
        const breathe =
          0.6 + 0.4 * Math.sin(time / 2400 + p.phase + p.depth * 3);
        const px = p.x * width + parallaxX * p.depth;
        const py = p.y * height + parallaxY * p.depth;

        context.beginPath();
        context.arc(px, py, p.radius * p.depth * breathe, 0, Math.PI * 2);
        context.fillStyle = `rgba(138, 68, 35, ${(p.alpha * breathe).toFixed(3)})`;
        context.fill();
      }
      if (!reducedMotion) rafId = requestAnimationFrame(draw);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointerX = event.clientX / window.innerWidth;
      pointerY = event.clientY / window.innerHeight;
    };

    resize();
    window.addEventListener("resize", resize);
    if (finePointer.matches) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    }
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="paper-particles"
    />
  );
}
