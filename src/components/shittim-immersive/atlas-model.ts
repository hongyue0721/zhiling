/** Pure layout and answer helpers. No UI state, timers, or fabricated progress. */
export type AtlasNode = Readonly<{ nodeId: string; title: string }>;
export type AtlasEdge = Readonly<{ nodeId: string; prerequisiteNodeId: string }>;
export type Position = { id: string; x: number; y: number; depth: number };
export type Answerable = Readonly<{ questionId: string; type: string; options: readonly { optionId: string; side?: string }[] }>;
export type Picks = Readonly<Record<string, readonly string[]>>;
export type Pairs = Readonly<Record<string, Readonly<Record<string, string>>>>;
export function layoutAtlas(nodes: readonly AtlasNode[], edges: readonly AtlasEdge[], mobile = false): Position[] {
  const ids = new Set(nodes.map(n => n.nodeId));
  const indegree = new Map(nodes.map(n => [n.nodeId, 0]));
  const depth = new Map(nodes.map(n => [n.nodeId, 0]));
  const children = new Map(nodes.map(n => [n.nodeId, [] as string[]]));
  const seen = new Set<string>();
  for (const e of edges) {
    const key = JSON.stringify([e.prerequisiteNodeId, e.nodeId]);
    if (!ids.has(e.nodeId) || !ids.has(e.prerequisiteNodeId) || e.nodeId === e.prerequisiteNodeId || seen.has(key)) continue;
    seen.add(key); indegree.set(e.nodeId, indegree.get(e.nodeId)! + 1); children.get(e.prerequisiteNodeId)!.push(e.nodeId);
  }
  const queue = nodes.filter(n => indegree.get(n.nodeId) === 0).map(n => n.nodeId); const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!; visited.add(id);
    for (const next of children.get(id)!) {
      depth.set(next, Math.max(depth.get(next)!, depth.get(id)! + 1));
      indegree.set(next, indegree.get(next)! - 1); if (indegree.get(next) === 0) queue.push(next);
    }
  }
  // Invalid cyclic graphs still remain navigable; no edges are invented.
  const ordered = [...nodes].sort((a, b) => depth.get(a.nodeId)! - depth.get(b.nodeId)!);
  const columns = mobile ? Math.min(2, nodes.length || 1) : Math.min(4, Math.max(1, Math.ceil(nodes.length / 2)));
  const rows = Math.ceil(nodes.length / columns);
  return ordered.map((n, i) => {
    const row = Math.floor(i / columns); const column = row % 2 ? columns - 1 - i % columns : i % columns;
    return { id: n.nodeId, depth: depth.get(n.nodeId)!,
      x: columns === 1 ? 50 : 13 + column * 74 / (columns - 1),
      y: rows === 1 ? 48 : 18 + row * 62 / (rows - 1) + (mobile ? 0 : (column % 2 ? -9 : 5)),
    };
  });
}
export function curvePath(a: Position, b: Position): string {
  const ax = a.x * 10, ay = a.y * 6, bx = b.x * 10, by = b.y * 6;
  return `M ${ax} ${ay} C ${ax + (bx-ax)*.45} ${ay}, ${bx - (bx-ax)*.45} ${by}, ${bx} ${by}`;
}
export function isAnswered(q: Answerable, picks: Picks, pairs: Pairs): boolean {
  if (q.type === "matching") {
    const left = q.options.filter(o => o.side === "left"), right = new Set(q.options.filter(o => o.side === "right").map(o => o.optionId));
    const values = left.map(o => pairs[q.questionId]?.[o.optionId] ?? "");
    return left.length > 0 && values.every(v => right.has(v)) && new Set(values).size === values.length;
  }
  const selected = picks[q.questionId] ?? [], allowed = new Set(q.options.map(o => o.optionId));
  return selected.length > 0 && selected.every(id => allowed.has(id)) && new Set(selected).size === selected.length && (q.type === "multiple_choice" || selected.length === 1);
}
export function buildAnswers(questions: readonly Answerable[], picks: Picks, pairs: Pairs) {
  if (!questions.length || !questions.every(q => isAnswered(q, picks, pairs))) return null;
  return questions.map(q => q.type === "matching" ? {
    questionId: q.questionId, matches: q.options.filter(o => o.side === "left").map(o => ({ leftOptionId: o.optionId, rightOptionId: pairs[q.questionId][o.optionId] })),
  } : { questionId: q.questionId, selectedOptionIds: [...picks[q.questionId]] });
}
export function nextNodeId(nodes: readonly AtlasNode[], completed: ReadonlySet<string>, current?: string) {
  return nodes.find(n => n.nodeId !== current && !completed.has(n.nodeId))?.nodeId ?? null;
}
export function clampZoom(value: number) { return Math.max(.65, Math.min(1.9, value)); }
export function clock(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
