export type LearningReportSource = Readonly<{
  sourceId: string;
  title: string;
  url: string;
  authorName: string;
}>;

export type LearningReportMapSnapshot = Readonly<{
  mapId: string;
  versionId: string;
  title: string;
  nodes: readonly Readonly<{
    nodeId: string;
    title: string;
    learningObjective: string;
    sourceIds: readonly string[];
  }>[];
  prerequisites: readonly Readonly<{
    nodeId: string;
    prerequisiteNodeId: string;
  }>[];
  sources: readonly LearningReportSource[];
  viewpoints: readonly Readonly<{
    viewpointId: string;
    nodeId: string;
    kind:
      "consensus" | "disagreement" | "practical_experience" | "supplementary";
    statement: string;
    conditions: string | null;
    sourceIds: readonly string[];
  }>[];
}>;

export type LearningReportProgressSnapshot = Readonly<{
  learningRelationshipId: string;
  versionId: string;
  questionSetId: string;
  nodes: readonly Readonly<{
    nodeId: string;
    bestScore: number;
    completed: boolean;
  }>[];
  attempts: readonly Readonly<{ nodeId: string }>[];
}>;

export type LearningReportInput = Readonly<{
  requestedLearningRelationshipId: string;
  map: LearningReportMapSnapshot;
  progress: LearningReportProgressSnapshot;
}>;

export type PrivateLearningReport = Readonly<{
  learningRelationshipId: string;
  map: Readonly<{
    mapId: string;
    versionId: string;
    title: string;
  }>;
  questionSetId: string;
  completion: Readonly<{
    completedNodeCount: number;
    totalNodeCount: number;
    completionBasisPoints: number;
  }>;
  weakNodes: readonly Readonly<{
    nodeId: string;
    title: string;
    bestScore: number;
    sourceIds: readonly string[];
  }>[];
  encounteredViewpoints: readonly Readonly<{
    viewpointId: string;
    nodeId: string;
    kind:
      "consensus" | "disagreement" | "practical_experience" | "supplementary";
    statement: string;
    conditions: string | null;
    sourceIds: readonly string[];
  }>[];
  nextSteps: readonly Readonly<{
    nodeId: string;
    title: string;
    learningObjective: string;
    reason: "improve_score" | "start_node";
    sourceIds: readonly string[];
  }>[];
  sources: readonly LearningReportSource[];
}>;

export class LearningReportInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearningReportInvariantError";
  }
}

const MAX_SCORE_BASIS_POINTS = 10_000;
const COMPLETION_SCORE_THRESHOLD = 8_000;
const VIEWPOINT_KINDS = {
  consensus: true,
  disagreement: true,
  practical_experience: true,
  supplementary: true,
} as const;

function assertNonBlank(value: string, message: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LearningReportInvariantError(message);
  }
}

function assertScore(value: number, message: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SCORE_BASIS_POINTS) {
    throw new LearningReportInvariantError(message);
  }
}

function assertAcyclic(
  nodeIds: ReadonlySet<string>,
  prerequisites: readonly Readonly<{
    nodeId: string;
    prerequisiteNodeId: string;
  }>[],
): void {
  const inDegree = new Map([...nodeIds].map((nodeId) => [nodeId, 0]));
  const dependentsByPrerequisite = new Map<string, string[]>();
  for (const { nodeId, prerequisiteNodeId } of prerequisites) {
    const dependents = dependentsByPrerequisite.get(prerequisiteNodeId) ?? [];
    dependents.push(nodeId);
    dependentsByPrerequisite.set(prerequisiteNodeId, dependents);
    inDegree.set(nodeId, (inDegree.get(nodeId) ?? 0) + 1);
  }

  const queue = [...inDegree]
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId);
  let visited = 0;
  while (queue.length > 0) {
    const nodeId = queue.pop()!;
    visited += 1;
    for (const dependent of dependentsByPrerequisite.get(nodeId) ?? []) {
      const degree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, degree);
      if (degree === 0) {
        queue.push(dependent);
      }
    }
  }

  if (visited !== nodeIds.size) {
    throw new LearningReportInvariantError("学习地图先修关系不能成环");
  }
}

function assertStableLearningFacts(input: LearningReportInput): void {
  const { map, progress, requestedLearningRelationshipId } = input;
  assertNonBlank(requestedLearningRelationshipId, "学习关系标识不能为空");
  assertNonBlank(progress.learningRelationshipId, "学习关系事实不能为空");
  assertNonBlank(progress.versionId, "学习进度版本不能为空");
  assertNonBlank(progress.questionSetId, "题目集标识不能为空");
  assertNonBlank(map.mapId, "学习地图标识不能为空");
  assertNonBlank(map.versionId, "学习地图版本不能为空");
  assertNonBlank(map.title, "学习地图标题不能为空");

  if (progress.learningRelationshipId !== requestedLearningRelationshipId) {
    throw new LearningReportInvariantError("学习关系标识不一致");
  }
  if (progress.versionId !== map.versionId) {
    throw new LearningReportInvariantError("地图版本与进度版本不一致");
  }
  if (map.nodes.length === 0) {
    throw new LearningReportInvariantError("结课报告不能基于空地图生成");
  }

  const mapNodeIds = new Set<string>();
  const sourceIds = new Set<string>();
  const sourceIdsByNode = new Map<string, ReadonlySet<string>>();
  for (const source of map.sources) {
    assertNonBlank(source.sourceId, "来源标识不能为空");
    assertNonBlank(source.title, "来源标题不能为空");
    assertNonBlank(source.url, "来源链接不能为空");
    assertNonBlank(source.authorName, "来源作者不能为空");
    if (sourceIds.has(source.sourceId)) {
      throw new LearningReportInvariantError("来源标识不能重复");
    }
    sourceIds.add(source.sourceId);
  }

  for (const node of map.nodes) {
    assertNonBlank(node.nodeId, "地图节点标识不能为空");
    assertNonBlank(node.title, "地图节点标题不能为空");
    assertNonBlank(node.learningObjective, "地图节点目标不能为空");
    if (mapNodeIds.has(node.nodeId)) {
      throw new LearningReportInvariantError("地图节点标识不能重复");
    }
    mapNodeIds.add(node.nodeId);
    if (node.sourceIds.length === 0) {
      throw new LearningReportInvariantError("地图节点必须关联来源");
    }
    const nodeSourceIds = new Set<string>();
    for (const sourceId of node.sourceIds) {
      assertNonBlank(sourceId, "节点来源标识不能为空");
      if (nodeSourceIds.has(sourceId)) {
        throw new LearningReportInvariantError("节点来源不能重复");
      }
      if (!sourceIds.has(sourceId)) {
        throw new LearningReportInvariantError("节点引用了不存在的来源");
      }
      nodeSourceIds.add(sourceId);
    }
    sourceIdsByNode.set(node.nodeId, nodeSourceIds);
  }

  const prerequisiteKeys = new Set<string>();
  for (const prerequisite of map.prerequisites) {
    assertNonBlank(prerequisite.nodeId, "先修节点标识不能为空");
    assertNonBlank(prerequisite.prerequisiteNodeId, "前置节点标识不能为空");
    if (
      !mapNodeIds.has(prerequisite.nodeId) ||
      !mapNodeIds.has(prerequisite.prerequisiteNodeId)
    ) {
      throw new LearningReportInvariantError("先修关系引用了不存在的节点");
    }
    if (prerequisite.nodeId === prerequisite.prerequisiteNodeId) {
      throw new LearningReportInvariantError("节点不能依赖自身");
    }
    const key = JSON.stringify([
      prerequisite.nodeId,
      prerequisite.prerequisiteNodeId,
    ]);
    if (prerequisiteKeys.has(key)) {
      throw new LearningReportInvariantError("先修关系不能重复");
    }
    prerequisiteKeys.add(key);
  }
  assertAcyclic(mapNodeIds, map.prerequisites);

  const viewpointKeys = new Set<string>();
  for (const viewpoint of map.viewpoints) {
    assertNonBlank(viewpoint.viewpointId, "观点标识不能为空");
    assertNonBlank(viewpoint.nodeId, "观点节点标识不能为空");
    assertNonBlank(viewpoint.statement, "观点陈述不能为空");
    if (!mapNodeIds.has(viewpoint.nodeId)) {
      throw new LearningReportInvariantError("观点引用了不存在的节点");
    }
    const key = JSON.stringify([viewpoint.nodeId, viewpoint.viewpointId]);
    if (viewpointKeys.has(key)) {
      throw new LearningReportInvariantError("观点标识不能重复");
    }
    viewpointKeys.add(key);
    if (!Object.hasOwn(VIEWPOINT_KINDS, viewpoint.kind)) {
      throw new LearningReportInvariantError("观点类型无效");
    }
    if (
      (viewpoint.conditions !== null &&
        (typeof viewpoint.conditions !== "string" ||
          viewpoint.conditions.trim().length === 0)) ||
      (viewpoint.kind === "disagreement" &&
        (viewpoint.conditions === null ||
          viewpoint.conditions.trim().length === 0))
    ) {
      throw new LearningReportInvariantError("观点适用条件无效");
    }
    if (viewpoint.sourceIds.length === 0) {
      throw new LearningReportInvariantError("观点必须关联来源");
    }
    const nodeSourceIds = sourceIdsByNode.get(viewpoint.nodeId)!;
    const viewpointSourceIds = new Set<string>();
    for (const sourceId of viewpoint.sourceIds) {
      assertNonBlank(sourceId, "观点来源标识不能为空");
      if (viewpointSourceIds.has(sourceId)) {
        throw new LearningReportInvariantError("观点来源不能重复");
      }
      if (!nodeSourceIds.has(sourceId)) {
        throw new LearningReportInvariantError("观点引用了节点之外的来源");
      }
      viewpointSourceIds.add(sourceId);
    }
  }

  const progressNodeIds = new Set<string>();
  for (const node of progress.nodes) {
    assertNonBlank(node.nodeId, "进度节点标识不能为空");
    if (progressNodeIds.has(node.nodeId)) {
      throw new LearningReportInvariantError("进度节点标识不能重复");
    }
    if (!mapNodeIds.has(node.nodeId)) {
      throw new LearningReportInvariantError("进度引用了不存在的地图节点");
    }
    assertScore(node.bestScore, "节点最佳成绩无效");
    if (
      typeof node.completed !== "boolean" ||
      node.completed !== node.bestScore >= COMPLETION_SCORE_THRESHOLD
    ) {
      throw new LearningReportInvariantError("节点完成状态与成绩不一致");
    }
    progressNodeIds.add(node.nodeId);
  }

  if (
    mapNodeIds.size !== progressNodeIds.size ||
    [...mapNodeIds].some((nodeId) => !progressNodeIds.has(nodeId))
  ) {
    throw new LearningReportInvariantError("地图节点与学习事实不一致");
  }
  for (const { nodeId } of progress.attempts) {
    assertNonBlank(nodeId, "尝试节点标识不能为空");
    if (!mapNodeIds.has(nodeId)) {
      throw new LearningReportInvariantError("尝试引用了不存在的地图节点");
    }
  }
}

function collectReportSources(
  map: LearningReportMapSnapshot,
  sourceIds: ReadonlySet<string>,
): readonly LearningReportSource[] {
  return map.sources
    .filter(({ sourceId }) => sourceIds.has(sourceId))
    .map((source) => ({ ...source }));
}
function indexPrerequisites(
  map: LearningReportMapSnapshot,
): ReadonlyMap<string, readonly string[]> {
  const prerequisitesByNode = new Map<string, string[]>();
  for (const edge of map.prerequisites) {
    const prerequisites = prerequisitesByNode.get(edge.nodeId) ?? [];
    prerequisites.push(edge.prerequisiteNodeId);
    prerequisitesByNode.set(edge.nodeId, prerequisites);
  }
  return prerequisitesByNode;
}

function projectWeakNodes(
  map: LearningReportMapSnapshot,
  progressByNode: ReadonlyMap<
    string,
    LearningReportProgressSnapshot["nodes"][number]
  >,
  attemptedNodeIds: ReadonlySet<string>,
): PrivateLearningReport["weakNodes"] {
  return map.nodes
    .filter(({ nodeId }) => {
      const nodeProgress = progressByNode.get(nodeId)!;
      return attemptedNodeIds.has(nodeId) && !nodeProgress.completed;
    })
    .map((node) => ({
      nodeId: node.nodeId,
      title: node.title,
      bestScore: progressByNode.get(node.nodeId)!.bestScore,
      sourceIds: [...node.sourceIds],
    }));
}

function projectEncounteredViewpoints(
  map: LearningReportMapSnapshot,
  attemptedNodeIds: ReadonlySet<string>,
): PrivateLearningReport["encounteredViewpoints"] {
  return map.viewpoints
    .filter(({ nodeId }) => attemptedNodeIds.has(nodeId))
    .map((viewpoint) => ({
      ...viewpoint,
      sourceIds: [...viewpoint.sourceIds],
    }));
}

function projectNextSteps(
  map: LearningReportMapSnapshot,
  attemptedNodeIds: ReadonlySet<string>,
  completedNodeIds: ReadonlySet<string>,
): PrivateLearningReport["nextSteps"] {
  const prerequisitesByNode = indexPrerequisites(map);
  const availableNodes = map.nodes.filter(({ nodeId }) => {
    if (completedNodeIds.has(nodeId)) {
      return false;
    }
    return (prerequisitesByNode.get(nodeId) ?? []).every((prerequisiteNodeId) =>
      completedNodeIds.has(prerequisiteNodeId),
    );
  });
  return [
    ...availableNodes.filter(({ nodeId }) => attemptedNodeIds.has(nodeId)),
    ...availableNodes.filter(({ nodeId }) => !attemptedNodeIds.has(nodeId)),
  ].map((node) => ({
    nodeId: node.nodeId,
    title: node.title,
    learningObjective: node.learningObjective,
    reason: attemptedNodeIds.has(node.nodeId)
      ? ("improve_score" as const)
      : ("start_node" as const),
    sourceIds: [...node.sourceIds],
  }));
}

export function projectPrivateLearningReport(
  input: LearningReportInput,
): PrivateLearningReport {
  assertStableLearningFacts(input);
  const { map, progress } = input;
  const progressByNode = new Map(
    progress.nodes.map((node) => [node.nodeId, node]),
  );
  const attemptedNodeIds = new Set(
    progress.attempts.map(({ nodeId }) => nodeId),
  );
  const completedNodeIds = new Set(
    progress.nodes
      .filter(({ completed }) => completed)
      .map(({ nodeId }) => nodeId),
  );
  const weakNodes = projectWeakNodes(map, progressByNode, attemptedNodeIds);
  const encounteredViewpoints = projectEncounteredViewpoints(
    map,
    attemptedNodeIds,
  );
  const nextSteps = projectNextSteps(map, attemptedNodeIds, completedNodeIds);
  const referencedSourceIds = new Set([
    ...weakNodes.flatMap(({ sourceIds }) => sourceIds),
    ...encounteredViewpoints.flatMap(({ sourceIds }) => sourceIds),
    ...nextSteps.flatMap(({ sourceIds }) => sourceIds),
  ]);

  return {
    learningRelationshipId: progress.learningRelationshipId,
    map: {
      mapId: map.mapId,
      versionId: map.versionId,
      title: map.title,
    },
    questionSetId: progress.questionSetId,
    completion: {
      completedNodeCount: completedNodeIds.size,
      totalNodeCount: map.nodes.length,
      completionBasisPoints: Math.round(
        (completedNodeIds.size * MAX_SCORE_BASIS_POINTS) / map.nodes.length,
      ),
    },
    weakNodes,
    encounteredViewpoints,
    nextSteps,
    sources: collectReportSources(map, referencedSourceIds),
  };
}
