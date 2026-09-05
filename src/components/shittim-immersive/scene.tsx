"use client";
import { useEffect, useRef } from "react";
import { mountUniverse, type Universe, type UniverseMode } from "./universe";
import s from "./scenes.module.css";
export function Scene({ mode, paused = false, pulse = 0 }: { mode: UniverseMode; paused?: boolean; pulse?: number }) {
  const host = useRef<HTMLDivElement>(null), engine = useRef<Universe | null>(null);
  const initialMode = useRef(mode);
  useEffect(() => { if (!host.current) return; const instance = mountUniverse(host.current, initialMode.current); engine.current = instance; return () => { instance.destroy(); engine.current = null; }; }, []); // scene survives mode transitions
  useEffect(() => engine.current?.setMode(mode), [mode]);
  useEffect(() => engine.current?.setPaused(paused), [paused]);
  useEffect(() => { if (pulse) engine.current?.burst(); }, [pulse]);
  return <div className={s.universe} data-mode={mode} aria-hidden="true"><div className={s.nebula} /><div ref={host} className={s.particles} /></div>;
}
export function Scanner({ label = "正在检测", compact = false }: { label?: string; compact?: boolean }) {
  return <div className={s.scanner} data-compact={compact} role="status" aria-live="polite">
    <div className={s.scanVisual} aria-hidden="true"><i /><i /><i /><span className={s.scanCore} /><span className={s.scanBeam} /></div>
    <span className={s.scanLabel}>{label}<b aria-hidden="true"><i /><i /><i /></b></span>
  </div>;
}
