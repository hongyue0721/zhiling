export const viewpointKinds = [
  "consensus",
  "disagreement",
  "practical_experience",
  "supplementary",
] as const;

export type ViewpointKind = (typeof viewpointKinds)[number];

export type LearningMapSource = Readonly<{
  sourceId: string;
  title: string;
  excerpt: string;
  url: string;
  authorName: string;
}>;

export type LearningMapViewpoint = Readonly<{
  viewpointId: string;
  kind: ViewpointKind;
  statement: string;
  conditions: string | null;
  sourceIds: readonly string[];
}>;

export type LearningMapNode = Readonly<{
  nodeId: string;
  title: string;
  learningObjective: string;
  sourceIds: readonly string[];
  viewpoints: readonly LearningMapViewpoint[];
}>;

export type LearningMapPrerequisite = Readonly<{
  nodeId: string;
  prerequisiteNodeId: string;
}>;

export type LearningMapPublication = Readonly<{
  mapId: string;
  versionId: string;
  title: string;
  summary: string;
  featuredPosition: number;
  nodes: readonly LearningMapNode[];
  prerequisites: readonly LearningMapPrerequisite[];
  sources: readonly LearningMapSource[];
}>;

export type LearningMapInvariantCode =
  | "invalid_map_id"
  | "invalid_version_id"
  | "invalid_map_title"
  | "invalid_map_summary"
  | "invalid_featured_position"
  | "invalid_node_count"
  | "invalid_node_id"
  | "invalid_node_title"
  | "invalid_learning_objective"
  | "duplicate_node"
  | "invalid_source_id"
  | "duplicate_source"
  | "invalid_viewpoint_id"
  | "invalid_viewpoint_statement"
  | "invalid_viewpoint_kind"
  | "duplicate_viewpoint"
  | "invalid_source"
  | "node_without_source"
  | "duplicate_node_source"
  | "unknown_source_reference"
  | "unknown_node_reference"
  | "self_prerequisite"
  | "duplicate_prerequisite"
  | "cyclic_prerequisites"
  | "viewpoint_without_source"
  | "unknown_viewpoint_source"
  | "duplicate_viewpoint_source"
  | "invalid_viewpoint_conditions";

export class LearningMapInvariantError extends Error {
  constructor(readonly code: LearningMapInvariantCode) {
    super(`Learning map invariant failed: ${code}`);
    this.name = "LearningMapInvariantError";
  }
}

function assertUnique(
  values: readonly string[],
  code: LearningMapInvariantCode,
) {
  if (new Set(values).size !== values.length) {
    throw new LearningMapInvariantError(code);
  }
}

function assertNonBlank(value: string, code: LearningMapInvariantCode) {
  if (value.trim().length === 0) {
    throw new LearningMapInvariantError(code);
  }
}

function assertZhihuSource(source: LearningMapSource) {
  assertNonBlank(source.sourceId, "invalid_source_id");
  try {
    const url = new URL(source.url);
    const isZhihuHost =
      url.hostname === "zhihu.com" || url.hostname.endsWith(".zhihu.com");
    if (
      source.url !== source.url.trim() ||
      source.title.trim().length === 0 ||
      source.excerpt.trim().length === 0 ||
      source.authorName.trim().length === 0 ||
      url.protocol !== "https:" ||
      !isZhihuHost ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) {
      throw new LearningMapInvariantError("invalid_source");
    }
  } catch (error) {
    if (error instanceof LearningMapInvariantError) {
      throw error;
    }
    throw new LearningMapInvariantError("invalid_source");
  }
}

function assertAcyclic(
  nodeIds: ReadonlySet<string>,
  prerequisites: readonly LearningMapPrerequisite[],
) {
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map([...nodeIds].map((nodeId) => [nodeId, 0]));

  for (const edge of prerequisites) {
    const dependents = outgoing.get(edge.prerequisiteNodeId) ?? [];
    dependents.push(edge.nodeId);
    outgoing.set(edge.prerequisiteNodeId, dependents);
    inDegree.set(edge.nodeId, (inDegree.get(edge.nodeId) ?? 0) + 1);
  }

  const queue = [...inDegree]
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId);
  let visited = 0;

  while (queue.length > 0) {
    const nodeId = queue.pop();
    if (!nodeId) {
      break;
    }
    visited += 1;
    for (const dependent of outgoing.get(nodeId) ?? []) {
      const degree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, degree);
      if (degree === 0) {
        queue.push(dependent);
      }
    }
  }

  if (visited !== nodeIds.size) {
    throw new LearningMapInvariantError("cyclic_prerequisites");
  }
}

export function validateLearningMapPublication(
  publication: LearningMapPublication,
): LearningMapPublication {
  assertNonBlank(publication.mapId, "invalid_map_id");
  assertNonBlank(publication.versionId, "invalid_version_id");
  assertNonBlank(publication.title, "invalid_map_title");
  assertNonBlank(publication.summary, "invalid_map_summary");
  if (!Number.isInteger(publication.featuredPosition)) {
    throw new LearningMapInvariantError("invalid_featured_position");
  }

  if (publication.nodes.length < 5 || publication.nodes.length > 7) {
    throw new LearningMapInvariantError("invalid_node_count");
  }

  for (const node of publication.nodes) {
    assertNonBlank(node.nodeId, "invalid_node_id");
    assertNonBlank(node.title, "invalid_node_title");
    assertNonBlank(node.learningObjective, "invalid_learning_objective");
  }
  const nodeIds = publication.nodes.map(({ nodeId }) => nodeId);
  assertUnique(nodeIds, "duplicate_node");
  const sourceIds = publication.sources.map(({ sourceId }) => sourceId);
  assertUnique(sourceIds, "duplicate_source");
  const knownNodes = new Set(nodeIds);
  const knownSources = new Set(sourceIds);

  for (const source of publication.sources) {
    assertZhihuSource(source);
  }

  for (const node of publication.nodes) {
    if (node.sourceIds.length === 0) {
      throw new LearningMapInvariantError("node_without_source");
    }
    assertUnique(node.sourceIds, "duplicate_node_source");
    for (const sourceId of node.sourceIds) {
      if (!knownSources.has(sourceId)) {
        throw new LearningMapInvariantError("unknown_source_reference");
      }
    }

    assertUnique(
      node.viewpoints.map(({ viewpointId }) => viewpointId),
      "duplicate_viewpoint",
    );
    const nodeSources = new Set(node.sourceIds);
    for (const viewpoint of node.viewpoints) {
      assertNonBlank(viewpoint.viewpointId, "invalid_viewpoint_id");
      assertNonBlank(viewpoint.statement, "invalid_viewpoint_statement");
      if (!(viewpointKinds as readonly string[]).includes(viewpoint.kind)) {
        throw new LearningMapInvariantError("invalid_viewpoint_kind");
      }
      if (
        (viewpoint.conditions !== null &&
          viewpoint.conditions.trim().length === 0) ||
        (viewpoint.kind === "disagreement" && viewpoint.conditions === null)
      ) {
        throw new LearningMapInvariantError("invalid_viewpoint_conditions");
      }
      if (viewpoint.sourceIds.length === 0) {
        throw new LearningMapInvariantError("viewpoint_without_source");
      }
      assertUnique(viewpoint.sourceIds, "duplicate_viewpoint_source");
      for (const sourceId of viewpoint.sourceIds) {
        if (!knownSources.has(sourceId)) {
          throw new LearningMapInvariantError("unknown_source_reference");
        }
        if (!nodeSources.has(sourceId)) {
          throw new LearningMapInvariantError("unknown_viewpoint_source");
        }
      }
    }
  }

  const edgeKeys = new Set<string>();
  for (const edge of publication.prerequisites) {
    if (
      !knownNodes.has(edge.nodeId) ||
      !knownNodes.has(edge.prerequisiteNodeId)
    ) {
      throw new LearningMapInvariantError("unknown_node_reference");
    }
    if (edge.nodeId === edge.prerequisiteNodeId) {
      throw new LearningMapInvariantError("self_prerequisite");
    }
    const key = `${edge.nodeId}\u0000${edge.prerequisiteNodeId}`;
    if (edgeKeys.has(key)) {
      throw new LearningMapInvariantError("duplicate_prerequisite");
    }
    edgeKeys.add(key);
  }
  assertAcyclic(knownNodes, publication.prerequisites);

  return {
    ...publication,
    nodes: publication.nodes.map((node) => ({
      ...node,
      sourceIds: [...node.sourceIds],
      viewpoints: node.viewpoints.map((viewpoint) => ({
        ...viewpoint,
        sourceIds: [...viewpoint.sourceIds],
      })),
    })),
    prerequisites: publication.prerequisites.map((edge) => ({ ...edge })),
    sources: publication.sources.map((source) => ({ ...source })),
  };
}
