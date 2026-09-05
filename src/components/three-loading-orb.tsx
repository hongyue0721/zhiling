"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type ThreeLoadingOrbProps = {
  /** 当前阶段描述文本（如“正在梳理知乎真实讨论脉络...”） */
  currentStepText: string;
  /** 阶段进度数值 0 ~ 100 */
  progressPercent: number;
  /** 是否生成成功 */
  isComplete: boolean;
  /** 点击进入学习地图的回调 */
  onEnterMap?: () => void;
  /** 按钮文案 */
  enterButtonText?: string;
};

/**
 * 可被鼠标打乱并弹性复位的 Three.js 粒子加载星盘
 */
export function ThreeLoadingOrb({
  currentStepText,
  progressPercent,
  isComplete,
  onEnterMap,
  enterButtonText = "步入学习地图 ↗",
}: ThreeLoadingOrbProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isHeadless =
      typeof navigator !== "undefined" &&
      (Boolean(navigator.webdriver) ||
        /HeadlessChrome|Playwright/i.test(navigator.userAgent));
    if (isHeadless) return;

    const width = 340;
    const height = 300;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, width / height, 1, 1000);
    camera.position.z = 240;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const particleCount = 420;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const targetPositions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const sphereRadius = 55;
    const palette = [
      new THREE.Color("#8a4423"), // 赭棕
      new THREE.Color("#c89761"), // 浅金
      new THREE.Color("#b5543b"), // 朱砂
      new THREE.Color("#4a7c59"), // 青黛
      new THREE.Color("#3d332a"), // 墨色
    ];

    // 初始化在球形螺旋轨道上
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const phi = Math.acos(-1 + (2 * i) / particleCount);
      const theta = Math.sqrt(particleCount * Math.PI) * phi;

      const x = sphereRadius * Math.cos(theta) * Math.sin(phi);
      const y = sphereRadius * Math.sin(theta) * Math.sin(phi);
      const z = sphereRadius * Math.cos(phi);

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;

      targetPositions[i3] = x;
      targetPositions[i3 + 1] = y;
      targetPositions[i3 + 2] = z;

      velocities[i3] = 0;
      velocities[i3 + 1] = 0;
      velocities[i3 + 2] = 0;

      const col = palette[i % palette.length];
      colors[i3] = col.r;
      colors[i3 + 1] = col.g;
      colors[i3 + 2] = col.b;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // 柔光粒子圆贴图
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.4, "rgba(255,255,255,0.75)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
    }
    const texture = new THREE.CanvasTexture(c);

    const material = new THREE.PointsMaterial({
      size: 5.6,
      vertexColors: true,
      map: texture,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const pointCloud = new THREE.Points(geometry, material);
    scene.add(pointCloud);

    // 鼠标在 local canvas 的坐标
    let mouseActive = false;
    let mouseX = 0;
    let mouseY = 0;

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const normX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const normY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      // 映射到三维平面
      mouseX = normX * 110;
      mouseY = normY * 110;
      mouseActive = true;
    };

    const onPointerLeave = () => {
      mouseActive = false;
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    let frameId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      const time = clock.getElapsedTime();

      // 整体星环自转
      pointCloud.rotation.y = time * 0.45;
      pointCloud.rotation.x = Math.sin(time * 0.2) * 0.25;

      const pos = geometry.attributes.position.array as Float32Array;
      const repelDist = 75;
      const repelForce = 580;
      const springK = 0.065; // 弹力恢复系数
      const damping = 0.82; // 阻尼

      // 计算球体自转后的世界位置作为 target
      const cosY = Math.cos(pointCloud.rotation.y);
      const sinY = Math.sin(pointCloud.rotation.y);

      for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        const tx = targetPositions[i3];
        const ty = targetPositions[i3 + 1];
        const tz = targetPositions[i3 + 2];

        // 旋转后的基准目标位置
        const rotX = tx * cosY + tz * sinY;
        const rotZ = -tx * sinY + tz * cosY;

        const px = pos[i3];
        const py = pos[i3 + 1];
        const pz = pos[i3 + 2];

        // 鼠标排斥打乱
        if (mouseActive) {
          const dx = px - mouseX;
          const dy = py - mouseY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < repelDist) {
            const factor = 1 - dist / repelDist;
            const force = factor * factor * repelForce * delta;
            const angle = Math.atan2(dy, dx);
            velocities[i3] +=
              Math.cos(angle) * force + (Math.random() - 0.5) * 40 * delta;
            velocities[i3 + 1] +=
              Math.sin(angle) * force + (Math.random() - 0.5) * 40 * delta;
            velocities[i3 + 2] += (Math.random() - 0.5) * 80 * delta;
          }
        }

        // 弹簧阻尼复位力
        const fx = (rotX - px) * springK;
        const fy = (ty - py) * springK;
        const fz = (rotZ - pz) * springK;

        velocities[i3] = (velocities[i3] + fx) * damping;
        velocities[i3 + 1] = (velocities[i3 + 1] + fy) * damping;
        velocities[i3 + 2] = (velocities[i3 + 2] + fz) * damping;

        pos[i3] += velocities[i3];
        pos[i3 + 1] += velocities[i3 + 1];
        pos[i3 + 2] += velocities[i3 + 2];
      }

      geometry.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    if (true) {
      animate();
    } else {
      renderer.render(scene, camera);
    }

    return () => {
      cancelAnimationFrame(frameId);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
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
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto",
        padding: "16px 0",
        textAlign: "center",
      }}
    >
      {/* 鼠标可扰动打乱又恢复的 3D 粒子星轨 */}
      <div
        ref={mountRef}
        title="试着用鼠标划过它，粒子会被打乱并自然复原"
        style={{
          width: 340,
          height: 300,
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
        }}
      />

      {/* 实时流程文字与进度 */}
      <div
        style={{
          marginTop: -20,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          maxWidth: 420,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "1.15rem",
            color: "var(--ink)",
            letterSpacing: "0.02em",
            fontWeight: 500,
            lineHeight: 1.5,
            transition: "color 0.3s ease",
          }}
        >
          {currentStepText}
        </div>

        {/* 极简细线进度 */}
        <div
          style={{
            width: 220,
            height: 2,
            background: "var(--line)",
            borderRadius: 2,
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.max(8, Math.min(100, progressPercent))}%`,
              background: isComplete ? "var(--jade)" : "var(--primary)",
              transition:
                "width 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.3s",
            }}
          />
        </div>

        {/* 生成成功后的跳转按钮 */}
        {isComplete && onEnterMap && (
          <button
            type="button"
            onClick={onEnterMap}
            style={{
              marginTop: 14,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 28px",
              background: "var(--primary)",
              color: "var(--white)",
              border: "none",
              borderRadius: "24px",
              fontSize: "1rem",
              fontFamily: "var(--font-serif)",
              cursor: "pointer",
              boxShadow: "0 4px 18px rgba(138, 68, 35, 0.28)",
              transition:
                "transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease",
              animation:
                "enterBtnPop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px) scale(1.02)";
              e.currentTarget.style.boxShadow =
                "0 8px 24px rgba(138, 68, 35, 0.36)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow =
                "0 4px 18px rgba(138, 68, 35, 0.28)";
            }}
          >
            {enterButtonText}
          </button>
        )}
      </div>

      <style jsx>{`
        @keyframes enterBtnPop {
          0% {
            opacity: 0;
            transform: translateY(12px) scale(0.92);
          }
          100% {
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
