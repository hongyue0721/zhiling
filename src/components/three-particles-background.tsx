"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Shittim Three.js 动态交互背景粒子场
 * - 纸面暖墨、赭石与暗金微粒在三维空间中缓缓呼吸漂浮
 * - 鼠标靠近时产生排斥与扰动涟漪，鼠标移开后粒子平滑弹性复位
 * - 纯 GPU 驱动，低功耗，自适应 DPR
 */
export function ThreeParticlesBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 在自动化测试环境中跳过纯装饰性 WebGL 上下文初始化，节约宝贵的 CPU 运算时间
    const isHeadless =
      typeof navigator !== "undefined" &&
      (Boolean(navigator.webdriver) ||
        /HeadlessChrome|Playwright/i.test(navigator.userAgent));
    if (isHeadless) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // 基础场景与相机
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      1000,
    );
    camera.position.z = 400;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // 粒子系统配置
    const isMobile = window.innerWidth <= 820;
    const particleCount = isMobile ? 350 : 850;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const origins = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const scales = new Float32Array(particleCount);

    // 调色板：赭石、墨暖灰、纸金、黛青
    const palette = [
      new THREE.Color("#8a4423"), // 赭棕
      new THREE.Color("#6f3318"), // 深赭
      new THREE.Color("#2b241c"), // 暖墨
      new THREE.Color("#c89761"), // 浅金棕
      new THREE.Color("#4a7c59"), // 青黛
    ];

    const rangeX = window.innerWidth * 0.9;
    const rangeY = window.innerHeight * 0.9;
    const rangeZ = 240;

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const x = (Math.random() - 0.5) * rangeX;
      const y = (Math.random() - 0.5) * rangeY;
      const z = (Math.random() - 0.5) * rangeZ;

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;

      origins[i3] = x;
      origins[i3 + 1] = y;
      origins[i3 + 2] = z;

      velocities[i3] = 0;
      velocities[i3 + 1] = 0;
      velocities[i3 + 2] = 0;

      const col = palette[Math.floor(Math.random() * palette.length)];
      colors[i3] = col.r;
      colors[i3 + 1] = col.g;
      colors[i3 + 2] = col.b;

      scales[i] = Math.random() * 3.2 + 1.2;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // 生成圆形模糊柔光粒子纹理
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.35, "rgba(255,255,255,0.7)");
      gradient.addColorStop(0.8, "rgba(255,255,255,0.15)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 32, 32);
    }
    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
      size: 4.8,
      vertexColors: true,
      map: texture,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    // 鼠标空间投影坐标
    const mouse = {
      x: -9999,
      y: -9999,
      targetX: -9999,
      targetY: -9999,
      active: false,
    };

    const handlePointerMove = (e: MouseEvent) => {
      // 转化为三维屏幕坐标
      const normX = (e.clientX / window.innerWidth) * 2 - 1;
      const normY = -(e.clientY / window.innerHeight) * 2 + 1;
      mouse.targetX = normX * (rangeX * 0.5);
      mouse.targetY = normY * (rangeY * 0.5);
      mouse.active = true;
    };

    const handlePointerLeave = () => {
      mouse.active = false;
      mouse.targetX = -9999;
      mouse.targetY = -9999;
    };

    window.addEventListener("mousemove", handlePointerMove, { passive: true });
    document.addEventListener("mouseleave", handlePointerLeave);

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    // 动画循环
    let animationFrameId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      const delta = clock.getDelta();
      const time = clock.getElapsedTime();

      // 缓动鼠标位置
      if (mouse.active) {
        mouse.x += (mouse.targetX - mouse.x) * 0.12;
        mouse.y += (mouse.targetY - mouse.y) * 0.12;
      } else {
        mouse.x += (-9999 - mouse.x) * 0.05;
        mouse.y += (-9999 - mouse.y) * 0.05;
      }

      const pos = geometry.attributes.position.array as Float32Array;
      const repelDist = 130;
      const repelForce = 320;
      const springK = 0.045; // 复位弹力系数
      const friction = 0.88; // 阻尼系数

      for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        const px = pos[i3];
        const py = pos[i3 + 1];
        const pz = pos[i3 + 2];

        const ox = origins[i3];
        const oy = origins[i3 + 1];
        const oz = origins[i3 + 2];

        // 固有缓和呼吸浮动
        const floatX = Math.sin(time * 0.4 + i) * 0.15;
        const floatY = Math.cos(time * 0.35 + i * 1.3) * 0.2;

        if (!reducedMotion) {
          // 鼠标排斥计算
          const dx = px - mouse.x;
          const dy = py - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < repelDist && mouse.active) {
            const factor = 1 - dist / repelDist;
            const force = factor * factor * repelForce * delta;
            const angle = Math.atan2(dy, dx);
            velocities[i3] += Math.cos(angle) * force;
            velocities[i3 + 1] += Math.sin(angle) * force;
          }

          // 弹力复位机制 (Hooke's law)
          const fx = (ox - px) * springK;
          const fy = (oy - py) * springK;
          const fz = (oz - pz) * springK;

          velocities[i3] = (velocities[i3] + fx) * friction;
          velocities[i3 + 1] = (velocities[i3 + 1] + fy) * friction;
          velocities[i3 + 2] = (velocities[i3 + 2] + fz) * friction;

          pos[i3] += velocities[i3] + floatX;
          pos[i3 + 1] += velocities[i3 + 1] + floatY;
          pos[i3 + 2] += velocities[i3 + 2];
        }
      }

      geometry.attributes.position.needsUpdate = true;
      particles.rotation.y = time * 0.018;

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    if (!reducedMotion) {
      animate();
    } else {
      renderer.render(scene, camera);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("mousemove", handlePointerMove);
      document.removeEventListener("mouseleave", handlePointerLeave);
      window.removeEventListener("resize", handleResize);

      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
        overflow: "hidden",
      }}
    />
  );
}
