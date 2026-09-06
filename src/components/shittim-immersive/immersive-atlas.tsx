"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type CSSProperties,
} from "react";
import {
  layoutReadingAtlas,
  readingPath,
  chapterNumeral,
  type ReadingTarget,
} from "./book-atlas-model";
import type { LearningMapDetail } from "@/components/contracts";
import s from "./scenes.module.css";
export function ImmersiveAtlas({
  map,
  completed,
  selected,
  onSelect,
  pulse = 0,
}: {
  map: LearningMapDetail;
  completed: ReadonlySet<string>;
  selected: string | null;
  onSelect: (target: ReadingTarget) => void;
  pulse?: number;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1100, height: 610 }),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [dragging, setDragging] = useState(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    cx: number;
    cy: number;
  } | null>(null);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) {
        setSize({ width: r.width, height: r.height });
        setPan({ x: 0, y: 0 });
        setZoom(1);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(
    () => layoutReadingAtlas(map, size.width, size.height),
    [map, size],
  );
  const byId = useMemo(
    () => new Map(layout.points.map((p) => [p.id, p])),
    [layout],
  );
  function down(event: PointerEvent<HTMLDivElement>) {
    if (layout.columns === 1 || (event.target as Element).closest("button,a"))
      return;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      cx: pan.x,
      cy: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d?.id === event.pointerId)
      setPan({ x: d.cx + event.clientX - d.x, y: d.cy + event.clientY - d.y });
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <section className={s.atlasRegion} aria-label="学习图谱">
      <div
        className={s.atlasSurface}
        ref={surface}
        data-dragging={dragging}
        data-columns={layout.columns}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <div
          className={s.graph}
          data-dragging={dragging}
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg
            className={s.edges}
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            {layout.links.map((edge, index) => {
              const a = byId.get(edge.from),
                b = byId.get(edge.to);
              if (!a || !b) return null;
              const d = readingPath(a, b, edge.kind);
              return (
                <g
                  key={edge.id}
                  data-kind={edge.kind}
                  data-lit={completed.has(a.nodeId)}
                >
                  <path className={s.edgeBase} d={d} />
                  {edge.kind === "spine" && (
                    <path
                      className={s.edgeFlow}
                      d={d}
                      style={{ animationDelay: `${index * -0.7}s` }}
                    />
                  )}
                </g>
              );
            })}
          </svg>
          {layout.points.map((point, index) => (
            <button
              type="button"
              key={point.id}
              className={
                point.kind === "chapter" ? s.chapterNode : s.marginNode
              }
              data-point={point.id}
              data-kind={point.kind}
              data-selected={selected === point.nodeId}
              data-completed={completed.has(point.nodeId)}
              style={
                {
                  left: point.x,
                  top: point.y,
                  width: point.width,
                  height: point.height,
                  "--tilt": `${point.tilt}deg`,
                  "--delay": `${Math.min(index, 12) * 42}ms`,
                } as CSSProperties
              }
              onClick={() =>
                onSelect({
                  nodeId: point.nodeId,
                  kind: point.kind,
                  refId: point.refId,
                })
              }
              aria-label={
                point.kind === "chapter"
                  ? `${point.label}，阅读知识${completed.has(point.nodeId) ? "，已完成练习" : ""}`
                  : `${point.kind === "source" ? "引文" : "批注"}：${point.label}`
              }
            >
              {point.kind === "chapter" ? (
                <>
                  <span className={s.chapterIndex} aria-hidden="true">
                    {chapterNumeral(point.order)}
                  </span>
                  <span className={s.chapterLabel}>{point.label}</span>
                  {completed.has(point.nodeId) && (
                    <i className={s.readSeal} aria-hidden="true">
                      阅
                    </i>
                  )}
                </>
              ) : (
                <>
                  <span className={s.marginGlyph} aria-hidden="true">
                    {point.kind === "source" ? "❧" : "·"}
                  </span>
                  <span>{point.label}</span>
                </>
              )}
            </button>
          ))}
          {pulse > 0 && (
            <i key={pulse} className={s.completionWave} aria-hidden="true" />
          )}
        </div>
      </div>
      <footer className={s.atlasFooter}>
        <span className={s.folioCount}>
          {map.nodes.length} 章 <i>·</i>{" "}
          {layout.points.length - map.nodes.length} 处旁注
        </span>
        <div className={s.mapTools} role="group" aria-label="地图视角">
          <button
            type="button"
            className={s.tool}
            aria-label="缩小地图"
            disabled={layout.columns === 1}
            onClick={() => setZoom((v) => Math.max(0.85, v - 0.1))}
          >
            −
          </button>
          <button
            type="button"
            className={s.tool}
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
              surface.current?.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            展卷
          </button>
          <button
            type="button"
            className={s.tool}
            aria-label="放大地图"
            disabled={layout.columns === 1}
            onClick={() => setZoom((v) => Math.min(1.5, v + 0.1))}
          >
            ＋
          </button>
        </div>
        <span className={s.folioSignature} aria-hidden="true">
          a cartography of curiosity
        </span>
      </footer>
    </section>
  );
}
