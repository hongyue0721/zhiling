/** Reading branches are projections of data already in the map response.
 * They are NOT extra learning/assessment nodes and never trigger generation. */
export type ReadingMap = {
  nodes: readonly {
    nodeId: string;
    title: string;
    learningObjective: string;
    sourceIds: readonly string[];
  }[];
  prerequisites: readonly { nodeId: string; prerequisiteNodeId: string }[];
  viewpoints: readonly {
    viewpointId: string;
    nodeId: string;
    statement: string;
    conditions: string | null;
    kind: string;
    sourceIds: readonly string[];
  }[];
  sources: readonly {
    sourceId: string;
    title: string;
    excerpt: string;
    url: string;
    authorName: string;
  }[];
};
export type ReadingTarget = {
  nodeId: string;
  kind: "chapter" | "viewpoint" | "source" | "objective";
  refId?: string;
};
export type ReadingPoint = ReadingTarget & {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  order: number;
  tilt: number;
};
export type ReadingLayout = {
  width: number;
  height: number;
  points: ReadingPoint[];
  links: { id: string; from: string; to: string; kind: "spine" | "margin" }[];
  columns: number;
};
export const chapterNumeral = (index: number): string =>
  ["壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖", "拾"][index] ??
  String(index + 1);
const brief = (value: string) => value.trim().replace(/\s+/gu, " ");
export function readingBranches(
  map: ReadingMap,
  nodeId: string,
): Omit<ReadingPoint, "x" | "y" | "width" | "height" | "order" | "tilt">[] {
  const node = map.nodes.find((n) => n.nodeId === nodeId);
  if (!node) return [];
  const out: ReturnType<typeof readingBranches> = [];
  for (const v of map.viewpoints
    .filter((v) => v.nodeId === nodeId && v.statement.trim())
    .slice(0, 2)) {
    out.push({
      id: `${nodeId}:v:${v.viewpointId}`,
      nodeId,
      kind: "viewpoint",
      refId: v.viewpointId,
      label: brief(v.statement),
    });
  }
  for (const id of [...new Set(node.sourceIds)]) {
    if (out.length >= 3) break;
    const source = map.sources.find((s) => s.sourceId === id);
    if (source)
      out.push({
        id: `${nodeId}:s:${id}`,
        nodeId,
        kind: "source",
        refId: id,
        label: brief(source.title),
      });
  }
  if (!out.length && node.learningObjective.trim())
    out.push({
      id: `${nodeId}:objective`,
      nodeId,
      kind: "objective",
      label: brief(node.learningObjective),
    });
  return out;
}
/** Fixed cells with scattered internal anchors. Tall maps scroll instead of shrinking text. */
export function layoutReadingAtlas(
  map: ReadingMap,
  availableWidth: number,
  availableHeight: number,
): ReadingLayout {
  const width = Math.max(
    300,
    Number.isFinite(availableWidth) ? availableWidth : 1100,
  );
  const columns = width >= 1080 ? 3 : width >= 720 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(map.nodes.length / columns));
  const pad = columns === 1 ? 16 : 28;
  const cellW = (width - pad * 2) / columns;
  const rowH = Math.max(
    274,
    Math.min(308, (Math.max(availableHeight, 400) - pad * 2) / rows),
  );
  const height = Math.max(availableHeight, rows * rowH + pad * 2);
  const points: ReadingPoint[] = [];
  const links: ReadingLayout["links"] = [];
  map.nodes.forEach((node, i) => {
    const row = Math.floor(i / columns),
      col = row % 2 ? columns - 1 - (i % columns) : i % columns;
    const jitter = columns === 1 ? 0 : [0, 7, -6, 6, -3, 2][i % 6]!;
    const x = pad + cellW * (col + 0.46),
      y = pad + row * rowH + 92 + jitter;
    points.push({
      id: node.nodeId,
      nodeId: node.nodeId,
      kind: "chapter",
      label: node.title,
      x,
      y,
      width: Math.min(218, cellW * 0.78),
      height: 72,
      order: i,
      tilt: 0,
    });
    const branches = readingBranches(map, node.nodeId);
    branches.forEach((branch, j) => {
      // Upper reference, lower left note, lower right note. All have reserved rectangles.
      const slots = [
        { dx: cellW * 0.19, dy: -65, w: Math.min(170, cellW * 0.55), h: 46 },
        { dx: -cellW * 0.19, dy: 86, w: Math.min(152, cellW * 0.48), h: 54 },
        { dx: cellW * 0.2, dy: 144, w: Math.min(158, cellW * 0.49), h: 54 },
      ];
      const slotIndex =
        branch.kind === "source" && j === branches.length - 1 ? 0 : j + 1;
      const slot = slots[slotIndex % 3]!;
      points.push({
        ...branch,
        x: x + slot.dx,
        y: y + slot.dy,
        width: slot.w,
        height: slot.h,
        order: i,
        tilt: j % 2 ? 1.3 : -1.1,
      });
      links.push({
        id: `${node.nodeId}->${branch.id}`,
        from: node.nodeId,
        to: branch.id,
        kind: "margin",
      });
    });
  });
  const known = new Set(map.nodes.map((n) => n.nodeId));
  for (const edge of map.prerequisites)
    if (
      known.has(edge.nodeId) &&
      known.has(edge.prerequisiteNodeId) &&
      edge.nodeId !== edge.prerequisiteNodeId
    ) {
      links.push({
        id: `${edge.prerequisiteNodeId}->${edge.nodeId}`,
        from: edge.prerequisiteNodeId,
        to: edge.nodeId,
        kind: "spine",
      });
    }
  return { width, height, points, links, columns };
}
export function readingPath(
  a: ReadingPoint,
  b: ReadingPoint,
  kind: "spine" | "margin",
): string {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (kind === "spine" && Math.abs(dy) < 110) {
    const side = Math.sign(dx) || 1;
    const ax = a.x + side * (a.width / 2 + 7),
      bx = b.x - side * (b.width / 2 + 7),
      bend = (bx - ax) * 0.45;
    return `M ${ax} ${a.y} C ${ax + bend} ${a.y - 33}, ${bx - bend} ${b.y - 33}, ${bx} ${b.y}`;
  }
  const sign = Math.sign(dy) || 1,
    ay = a.y + sign * (a.height / 2 + 5),
    by = b.y - sign * (b.height / 2 + 5);
  const mid = (ay + by) / 2;
  return `M ${a.x} ${ay} C ${a.x + dx * 0.13} ${mid}, ${b.x - dx * 0.13} ${mid}, ${b.x} ${by}`;
}
export function rectanglesOverlap(
  a: ReadingPoint,
  b: ReadingPoint,
  gap = 0,
): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap
  );
}
