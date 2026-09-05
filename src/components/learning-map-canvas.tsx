"use client";

import type { PointerEvent, WheelEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { Button } from "antd";

import styles from "./learning-experience.module.css";
import type {
  LearningMapDetail,
  LearningProgressSummary,
} from "@/components/contracts";

export type QuestionSatellite = Readonly<{
  questionId: string;
  prompt: string;
  type: string;
}>;

type LearningMapCanvasProps = Readonly<{
  map: LearningMapDetail;
  progress: LearningProgressSummary | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  /** 当前选中节点对应的问题列表（由工作区传入，在节点周围展开） */
  questionsForSelectedNode?: QuestionSatellite[];
  /** 点击周围展开的问题触发跳转至答题检验 */
  onOpenQuestion?: (questionId: string) => void;
}>;

type LayoutNode = Readonly<{
  nodeId: string;
  x: number;
  y: number;
  level: number;
}>;

type MapSize = Readonly<{
  width: number;
  height: number;
}>;

const NODE_WIDTH = 264;
const NODE_HEIGHT = 150;
const LEVEL_GAP = 112;
const ROW_GAP = 42;
const PADDING = 72;
const MIN_SCALE = 0.58;
const MAX_SCALE = 1.65;
const INITIAL_VIEW_WIDTH = 1_180;
const MIN_LAYOUT_HEIGHT = 660;

function stableLayout(map: LearningMapDetail): {
  nodes: readonly LayoutNode[];
  size: MapSize;
} {
  const nodeIds = map.nodes
    .map((node) => node.nodeId)
    .slice()
    .sort();
  const knownIds = new Set(nodeIds);
  const incoming = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  const outgoing = new Map<string, string[]>(
    nodeIds.map((nodeId) => [nodeId, []]),
  );

  for (const edge of map.prerequisites) {
    if (!knownIds.has(edge.nodeId) || !knownIds.has(edge.prerequisiteNodeId)) {
      continue;
    }
    const next = outgoing.get(edge.prerequisiteNodeId);
    if (!next || next.includes(edge.nodeId)) {
      continue;
    }
    next.push(edge.nodeId);
    incoming.set(edge.nodeId, (incoming.get(edge.nodeId) ?? 0) + 1);
  }
  for (const children of outgoing.values()) {
    children.sort();
  }

  const ready = nodeIds.filter((nodeId) => incoming.get(nodeId) === 0);
  const levels = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  const processed = new Set<string>();
  while (ready.length > 0) {
    ready.sort();
    const current = ready.shift();
    if (!current) {
      break;
    }
    processed.add(current);
    const currentLevel = levels.get(current) ?? 0;
    for (const child of outgoing.get(current) ?? []) {
      levels.set(child, Math.max(levels.get(child) ?? 0, currentLevel + 1));
      const remaining = (incoming.get(child) ?? 0) - 1;
      incoming.set(child, remaining);
      if (remaining === 0) {
        ready.push(child);
      }
    }
  }

  for (const nodeId of nodeIds) {
    if (!processed.has(nodeId)) {
      levels.set(nodeId, 0);
    }
  }

  const groups = new Map<number, string[]>();
  for (const nodeId of nodeIds) {
    const level = levels.get(nodeId) ?? 0;
    const group = groups.get(level) ?? [];
    group.push(nodeId);
    groups.set(level, group);
  }
  for (const group of groups.values()) {
    group.sort();
  }

  const maxRows = Math.max(
    1,
    ...Array.from(groups.values(), (group) => group.length),
  );
  const maxLevel = Math.max(0, ...Array.from(groups.keys()));
  const contentHeight =
    PADDING * 2 + maxRows * NODE_HEIGHT + (maxRows - 1) * ROW_GAP;
  const size = {
    width: PADDING * 2 + (maxLevel + 1) * NODE_WIDTH + maxLevel * LEVEL_GAP,
    height: Math.max(MIN_LAYOUT_HEIGHT, contentHeight),
  };
  const layoutNodes: LayoutNode[] = [];
  for (const [level, group] of groups) {
    const groupHeight =
      group.length * NODE_HEIGHT + (group.length - 1) * ROW_GAP;
    const offsetY = Math.max(PADDING, (size.height - groupHeight) / 2);
    group.forEach((nodeId, index) => {
      layoutNodes.push({
        nodeId,
        level,
        x: PADDING + level * (NODE_WIDTH + LEVEL_GAP),
        y: offsetY + index * (NODE_HEIGHT + ROW_GAP),
      });
    });
  }

  return {
    nodes: layoutNodes.sort((left, right) =>
      left.nodeId.localeCompare(right.nodeId),
    ),
    size,
  };
}

export function LearningMapCanvas({
  map,
  progress,
  selectedNodeId,
  onSelectNode,
  questionsForSelectedNode = [],
  onOpenQuestion,
}: LearningMapCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const { nodes: layoutNodes, size } = useMemo(() => stableLayout(map), [map]);
  const layoutById = useMemo(
    () => new Map(layoutNodes.map((node) => [node.nodeId, node])),
    [layoutNodes],
  );
  const progressByNodeId = useMemo(
    () => new Map((progress?.nodes ?? []).map((node) => [node.nodeId, node])),
    [progress],
  );

  // 点击节点时，放大聚焦该节点
  function handleNodeClick(nodeId: string) {
    onSelectNode(nodeId);
    const target = layoutById.get(nodeId);
    if (target) {
      // 放大至 1.15 倍并平移聚焦
      setScale(1.15);
      const centerX = target.x + NODE_WIDTH / 2;
      const centerY = target.y + NODE_HEIGHT / 2;
      const viewW = Math.min(size.width, INITIAL_VIEW_WIDTH);
      const viewH = size.height;
      setPan({
        x: viewW / 2 - centerX * 1.15,
        y: viewH / 2 - centerY * 1.15,
      });
    }
  }

  function beginPan(event: PointerEvent<SVGSVGElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-map-node]")) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setPan((current) => ({
      x: current.x + (event.clientX - drag.x),
      y: current.y + (event.clientY - drag.y),
    }));
    dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
  }

  function endPan(event: PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function zoomBy(delta: number) {
    setScale((current) =>
      Math.min(MAX_SCALE, Math.max(MIN_SCALE, current + delta)),
    );
  }

  function resetView() {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }

  function onWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const direction = event.deltaY < 0 ? 0.08 : -0.08;
    zoomBy(direction);
  }

  // 计算当前选中节点及其周围问题卫星气泡的坐标
  const selectedLayoutNode = selectedNodeId
    ? layoutById.get(selectedNodeId)
    : null;
  const questionSatellites = useMemo(() => {
    if (!selectedLayoutNode || questionsForSelectedNode.length === 0) return [];
    const count = questionsForSelectedNode.length;
    const centerX = selectedLayoutNode.x + NODE_WIDTH / 2;
    const centerY = selectedLayoutNode.y + NODE_HEIGHT / 2;

    // 分布在节点上方或侧后方的弧线上
    const radiusX = 210;
    const radiusY = 130;

    return questionsForSelectedNode.map((q, idx) => {
      // 角度弧度：根据数量呈扇形张开
      const angle =
        count === 1
          ? -Math.PI / 2
          : -Math.PI * 0.85 + (idx / (count - 1)) * (Math.PI * 0.7);

      const qX = centerX + Math.cos(angle) * radiusX - 110;
      const qY = centerY + Math.sin(angle) * radiusY - 35;
      return {
        ...q,
        x: qX,
        y: qY,
        originX: centerX,
        originY: centerY,
        satelliteCenterX: qX + 110,
        satelliteCenterY: qY + 35,
      };
    });
  }, [selectedLayoutNode, questionsForSelectedNode]);

  return (
    <section
      className={`map-canvas-shell ${styles.mapCanvasExperience}`}
      aria-label="学习地图画布"
      style={{
        border: "none",
        background: "transparent",
        boxShadow: "none",
        position: "relative",
      }}
    >
      {/* 悬浮轻量控制栏 */}
      <div
        className={`map-canvas-toolbar ${styles.mapToolbar}`}
        style={{
          border: "1px dashed var(--line)",
          background: "rgba(251, 246, 236, 0.92)",
          backdropFilter: "blur(10px)",
          borderRadius: 24,
          padding: "6px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: "0.85rem",
            color: "var(--ink-muted)",
            fontFamily: "var(--font-body)",
          }}
        >
          拖动画布浏览 · 滚轮缩放
        </span>
        <div
          className="map-controls"
          aria-label="地图缩放控制"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <Button
            type="text"
            size="small"
            onClick={() => zoomBy(0.1)}
            aria-label="放大地图"
            style={{ fontWeight: 600, color: "var(--primary)" }}
          >
            +
          </Button>
          <span
            className="map-scale"
            aria-live="polite"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "0.85rem",
              color: "var(--ink)",
              minWidth: 40,
              textAlign: "center",
            }}
          >
            {Math.round(scale * 100)}%
          </span>
          <Button
            type="text"
            size="small"
            onClick={() => zoomBy(-0.1)}
            aria-label="缩小地图"
            style={{ fontWeight: 600, color: "var(--primary)" }}
          >
            −
          </Button>
          <Button
            type="text"
            size="small"
            onClick={resetView}
            style={{ fontSize: "0.82rem", color: "var(--ink-soft)" }}
          >
            重置
          </Button>
        </div>
      </div>

      {/* 无边框全景画布 */}
      <div
        className={`map-canvas-viewport ${styles.mapViewport}`}
        style={{
          border: "none",
          borderRadius: 0,
          background: "transparent",
        }}
      >
        <svg
          ref={svgRef}
          className={`map-canvas ${styles.mapSvg}`}
          viewBox={`0 0 ${Math.min(size.width, INITIAL_VIEW_WIDTH)} ${size.height}`}
          role="application"
          aria-label="可缩放、可平移的学习路径图"
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onWheel={onWheel}
          style={{
            cursor: "grab",
            border: "none",
            background: "transparent",
          }}
        >
          <defs>
            <pattern
              id="map-grid"
              width="36"
              height="36"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="18" cy="18" r="1" fill="rgba(138, 68, 35, 0.12)" />
            </pattern>
            <marker
              id="map-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path
                d="M 0 0 L 8 4 L 0 8 z"
                fill="var(--primary)"
                opacity="0.85"
              />
            </marker>
          </defs>

          <rect
            className={styles.mapGridRect}
            width={size.width}
            height={size.height}
            fill="url(#map-grid)"
          />

          <g
            transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}
            style={{
              transition: "transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)",
            }}
          >
            {/* 前置连线 */}
            <g aria-hidden="true">
              {map.prerequisites.map((edge) => {
                const from = layoutById.get(edge.prerequisiteNodeId);
                const to = layoutById.get(edge.nodeId);
                if (!from || !to) return null;
                const fromX = from.x + NODE_WIDTH;
                const fromY = from.y + NODE_HEIGHT / 2;
                const toX = to.x;
                const toY = to.y + NODE_HEIGHT / 2;
                const curve = Math.max(44, (toX - fromX) / 2);
                return (
                  <path
                    className={`${styles.mapEdge} map-edge`}
                    d={`M ${fromX} ${fromY} C ${fromX + curve} ${fromY}, ${toX - curve} ${toY}, ${toX} ${toY}`}
                    markerEnd="url(#map-arrow)"
                    key={`${edge.prerequisiteNodeId}:${edge.nodeId}`}
                    style={{
                      stroke: "var(--primary)",
                      strokeDasharray: "3 6",
                      strokeWidth: 1.8,
                      opacity: 0.65,
                    }}
                  />
                );
              })}
            </g>

            {/* 选中节点周围展开的问题连线与卫星问题气泡 */}
            {questionSatellites.map((q) => (
              <g key={`satellite-line-${q.questionId}`}>
                <path
                  d={`M ${q.originX} ${q.originY} Q ${(q.originX + q.satelliteCenterX) / 2} ${q.originY - 20} ${q.satelliteCenterX} ${q.satelliteCenterY}`}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={1.4}
                  strokeDasharray="2 4"
                  opacity={0.7}
                />
              </g>
            ))}

            {/* 节点绘制 */}
            {layoutNodes.map((layoutNode) => {
              const node = map.nodes.find(
                (candidate) => candidate.nodeId === layoutNode.nodeId,
              );
              if (!node) return null;
              const nodeNumber =
                map.nodes.findIndex(
                  (candidate) => candidate.nodeId === node.nodeId,
                ) + 1;
              const nodeProgress = progressByNodeId.get(node.nodeId);
              const completed = nodeProgress?.completed === true;
              const selected = selectedNodeId === node.nodeId;

              return (
                <foreignObject
                  x={layoutNode.x}
                  y={layoutNode.y}
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  key={node.nodeId}
                  data-map-node
                  style={{ overflow: "visible" }}
                >
                  <button
                    type="button"
                    className={`map-node ${styles.mapNode} ${selected ? "selected" : ""} ${completed ? "completed" : ""}`}
                    onClick={() => handleNodeClick(node.nodeId)}
                    aria-pressed={selected}
                    aria-label={`${node.title}${completed ? "，已完成" : "，未完成"}`}
                    style={{
                      transition:
                        "transform 0.3s var(--ease-out-soft), box-shadow 0.3s var(--ease-out-soft), border-color 0.3s",
                      transform: selected ? "scale(1.04)" : "none",
                      border: selected
                        ? "2px solid var(--primary)"
                        : completed
                          ? "1px solid var(--jade)"
                          : "1px dashed var(--line)",
                      background: completed
                        ? "rgba(74, 124, 89, 0.08)"
                        : selected
                          ? "rgba(138, 68, 35, 0.06)"
                          : "rgba(253, 250, 243, 0.94)",
                      boxShadow: selected
                        ? "0 8px 30px rgba(138, 68, 35, 0.16)"
                        : "0 2px 10px rgba(43, 36, 28, 0.04)",
                      borderRadius: 12,
                    }}
                  >
                    <span
                      className={styles.mapNodeStep}
                      aria-hidden="true"
                      style={{
                        fontFamily: "var(--font-serif)",
                        color: selected ? "var(--primary)" : "var(--ink-muted)",
                      }}
                    >
                      {String(nodeNumber).padStart(2, "0")}
                    </span>

                    <span
                      className={`${styles.mapNodeStatus} map-node-status`}
                      aria-hidden="true"
                      style={{
                        color: completed ? "var(--jade)" : "var(--ink-muted)",
                        fontWeight: completed ? 700 : 400,
                      }}
                    >
                      {completed ? "✓" : "○"}
                    </span>

                    <span
                      className={`${styles.mapNodeTitle} map-node-title`}
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontSize: "0.98rem",
                        color: "var(--ink)",
                        fontWeight: 600,
                      }}
                    >
                      {node.title}
                    </span>

                    <span
                      className={`${styles.mapNodeObjective} map-node-objective`}
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "0.82rem",
                        color: "var(--ink-soft)",
                      }}
                    >
                      {node.learningObjective}
                    </span>

                    <span
                      className={`${styles.mapNodeSources} map-node-sources`}
                      style={{
                        color: "var(--ink-muted)",
                        fontSize: "0.78rem",
                      }}
                    >
                      {node.sourceIds.length > 0
                        ? `${node.sourceIds.length} 处真实讨论`
                        : "基础概念"}
                    </span>
                  </button>
                </foreignObject>
              );
            })}

            {/* 渲染节点周围展开的问题卫星气泡 */}
            {questionSatellites.map((q, idx) => (
              <foreignObject
                x={q.x}
                y={q.y}
                width={220}
                height={70}
                key={`q-satellite-${q.questionId}`}
                style={{ overflow: "visible" }}
              >
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenQuestion?.(q.questionId);
                  }}
                  title="点击在侧边栏打开答题检验"
                  style={{
                    background: "rgba(253, 250, 243, 0.96)",
                    border: "1px dashed var(--primary)",
                    borderRadius: 14,
                    padding: "6px 12px",
                    boxShadow: "0 6px 20px rgba(138, 68, 35, 0.18)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    transition: "transform 0.2s ease, box-shadow 0.2s ease",
                    animation:
                      "satellitePop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both",
                    animationDelay: `${idx * 80}ms`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "scale(1.05)";
                    e.currentTarget.style.boxShadow =
                      "0 8px 24px rgba(138, 68, 35, 0.25)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.boxShadow =
                      "0 6px 20px rgba(138, 68, 35, 0.18)";
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: "0.74rem",
                      color: "var(--primary)",
                      fontFamily: "var(--font-serif)",
                      fontWeight: 600,
                    }}
                  >
                    <span>检验题 {idx + 1}</span>
                    <span style={{ fontSize: "0.7rem", opacity: 0.8 }}>
                      答题 ↗
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--ink)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-body)",
                    }}
                  >
                    {q.prompt}
                  </div>
                </div>
              </foreignObject>
            ))}
          </g>
        </svg>
      </div>

      <style jsx>{`
        @keyframes satellitePop {
          0% {
            opacity: 0;
            transform: scale(0.6) translateY(10px);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </section>
  );
}
