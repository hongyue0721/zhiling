/** Conservative transport normalization. Never repair answer semantics or invent IDs. */
export class ModelFormatError extends Error {
  constructor(
    public readonly code:
      "not_object" | "invalid_json" | "ambiguous_json" | "unfinished_json",
  ) {
    super(code);
    this.name = "ModelFormatError";
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ModelFormatError("not_object");
  }
  return value as Record<string, unknown>;
}

/**
 * Accept one complete JSON object surrounded by prose/fences. Scan quotes and
 * escapes, rather than using a greedy /{.*}/ regex that joins unrelated objects.
 */
export function parseModelObject(content: string): Record<string, unknown> {
  const text = content.replace(/^\uFEFF/u, "").trim();
  try {
    return asObject(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof ModelFormatError) throw error;
  }
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  const candidates: Record<string, unknown>[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (start < 0) {
      if (char === "{") {
        start = i;
        depth = 1;
      }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try {
        candidates.push(
          asObject(JSON.parse(text.slice(start, i + 1)) as unknown),
        );
      } catch {
        throw new ModelFormatError("invalid_json");
      }
      if (candidates.length > 1) throw new ModelFormatError("ambiguous_json");
      start = -1;
    }
  }
  if (start >= 0) throw new ModelFormatError("unfinished_json");
  if (candidates.length !== 1) throw new ModelFormatError("invalid_json");
  return candidates[0]!;
}

type NodeLike = {
  nodeId: string;
  sourceIds: readonly string[];
};
type MapLike = {
  nodes: readonly NodeLike[];
  prerequisites: readonly {
    nodeId: string;
    prerequisiteNodeId: string;
  }[];
};
type SourceLike = { sourceId: string };

/** Pure input projection: one batch sends only its own nodes and evidence. */
export function assessmentScope<M extends MapLike, S extends SourceLike>(
  map: M,
  sources: readonly S[],
  targets?: readonly string[],
): {
  map: M;
  sources: readonly S[];
  targetNodeIds: readonly string[];
} {
  const ids = targets ?? map.nodes.map((node) => node.nodeId);
  const wanted = new Set(ids);
  if (
    !ids.length ||
    wanted.size !== ids.length ||
    ids.some((id) => !map.nodes.some((n) => n.nodeId === id))
  ) {
    throw new RangeError("Unknown, duplicate or empty assessment target");
  }
  const nodes = map.nodes.filter((node) => wanted.has(node.nodeId));
  const needed = new Set(nodes.flatMap((node) => [...node.sourceIds]));
  return {
    map: {
      ...map,
      nodes,
      prerequisites: map.prerequisites.filter(
        (edge) =>
          wanted.has(edge.nodeId) && wanted.has(edge.prerequisiteNodeId),
      ),
    } as M,
    sources: sources.filter((source) => needed.has(source.sourceId)),
    targetNodeIds: [...ids],
  };
}
