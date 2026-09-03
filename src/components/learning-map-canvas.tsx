"use client";

import type { PointerEvent, WheelEvent } from "react";
import { useMemo, useRef, useState } from "react";

import type {
  LearningMapDetail,
  LearningProgressSummary,
} from "@/components/contracts";

type LearningMapCanvasProps = Readonly<{
  map: LearningMapDetail;
  progress: LearningProgressSummary | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
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

const NODE_WIDTH = 224;
const NODE_HEIGHT = 122;
const LEVEL_GAP = 94;
const ROW_GAP = 32;
const PADDING = 52;
const MIN_SCALE = 0.58;
const MAX_SCALE = 1.65;

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

  // The server contract guarantees an acyclic graph. Keeping any unexpected
  // leftovers visible makes a malformed response an explicit UI state rather
  // than silently dropping a node.
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
  const size = {
    width: PADDING * 2 + (maxLevel + 1) * NODE_WIDTH + maxLevel * LEVEL_GAP,
    height: PADDING * 2 + maxRows * NODE_HEIGHT + (maxRows - 1) * ROW_GAP,
  };
  const layoutNodes: LayoutNode[] = [];
  for (const [level, group] of groups) {
    const groupHeight =
      group.length * NODE_HEIGHT + (group.length - 1) * ROW_GAP;
    const offsetY =
      PADDING + Math.max(0, (size.height - PADDING - groupHeight) / 2);
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
    const direction = event.deltaY < 0 ? 0.1 : -0.1;
    zoomBy(direction);
  }

  return (
    <section className="map-canvas-shell" aria-label="学习地图画布">
      <div className="map-canvas-toolbar">
        <p className="map-canvas-hint">拖动画布浏览 · 滚轮缩放</p>
        <div className="map-controls" aria-label="地图缩放控制">
          <button
            type="button"
            className="map-control-button"
            onClick={() => zoomBy(0.1)}
            aria-label="放大地图"
          >
            +
          </button>
          <span className="map-scale" aria-live="polite">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            className="map-control-button"
            onClick={() => zoomBy(-0.1)}
            aria-label="缩小地图"
          >
            −
          </button>
          <button
            type="button"
            className="map-control-button map-control-reset"
            onClick={resetView}
          >
            重置
          </button>
        </div>
      </div>
      <div className="map-canvas-viewport">
        <svg
          ref={svgRef}
          className="map-canvas"
          viewBox={`0 0 ${size.width} ${size.height}`}
          role="application"
          aria-label="可缩放、可平移的学习路径图"
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onWheel={onWheel}
        >
          <defs>
            <pattern
              id="map-grid"
              width="32"
              height="32"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 32 0 L 0 0 0 32"
                fill="none"
                className="map-grid-line"
              />
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
              <path d="M 0 0 L 8 4 L 0 8 z" className="map-edge-arrow" />
            </marker>
          </defs>
          <rect width={size.width} height={size.height} fill="url(#map-grid)" />
          <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
            <g aria-hidden="true">
              {map.prerequisites.map((edge) => {
                const from = layoutById.get(edge.prerequisiteNodeId);
                const to = layoutById.get(edge.nodeId);
                if (!from || !to) {
                  return null;
                }
                const fromX = from.x + NODE_WIDTH;
                const fromY = from.y + NODE_HEIGHT / 2;
                const toX = to.x;
                const toY = to.y + NODE_HEIGHT / 2;
                const curve = Math.max(44, (toX - fromX) / 2);
                return (
                  <path
                    className="map-edge"
                    d={`M ${fromX} ${fromY} C ${fromX + curve} ${fromY}, ${toX - curve} ${toY}, ${toX} ${toY}`}
                    markerEnd="url(#map-arrow)"
                    key={`${edge.prerequisiteNodeId}:${edge.nodeId}`}
                  />
                );
              })}
            </g>
            {layoutNodes.map((layoutNode) => {
              const node = map.nodes.find(
                (candidate) => candidate.nodeId === layoutNode.nodeId,
              );
              if (!node) {
                return null;
              }
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
                >
                  <button
                    type="button"
                    className={`map-node ${selected ? "selected" : ""} ${completed ? "completed" : ""}`}
                    onClick={() => onSelectNode(node.nodeId)}
                    aria-pressed={selected}
                    aria-label={`${node.title}${completed ? "，已完成" : "，未完成"}`}
                  >
                    <span className="map-node-status" aria-hidden="true">
                      {completed ? "✓" : "○"}
                    </span>
                    <span className="map-node-title">{node.title}</span>
                    <span className="map-node-objective">
                      {node.learningObjective}
                    </span>
                    <span className="map-node-sources">
                      {node.sourceIds.length > 0
                        ? `${node.sourceIds.length} 个来源`
                        : "暂无来源"}
                    </span>
                  </button>
                </foreignObject>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}
