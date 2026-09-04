export const generationViewpointKinds = [
  "consensus",
  "disagreement",
  "practical_experience",
  "supplementary",
] as const;
export type GenerationViewpointKind = (typeof generationViewpointKinds)[number];

export const generationSourceContentTypes = [
  "answer",
  "article",
  "question",
] as const;
export type GenerationSourceContentType =
  (typeof generationSourceContentTypes)[number];

export const generationSourceAuthorityLevels = [
  "low",
  "medium",
  "high",
  "very_high",
] as const;
export type GenerationSourceAuthorityLevel =
  (typeof generationSourceAuthorityLevels)[number];

export const generationQuestionTypes = [
  "single_choice",
  "multiple_choice",
  "matching",
  "opinion_analysis",
] as const;
export type GenerationQuestionType = (typeof generationQuestionTypes)[number];

export type GenerationSourceCandidate = Readonly<{
  sourceId: string;
  title: string;
  excerpt: string;
  url: string;
  authorName: string;
  contentType: GenerationSourceContentType;
  updatedAt: number;
  authorityLevel: GenerationSourceAuthorityLevel;
  rankingScore: number;
}>;

export type GenerationDirectionCandidate = Readonly<{
  directionId: string;
  title: string;
  objective: string;
  searchQuery: string;
}>;

export type GenerationMapCandidate = Readonly<{
  title: string;
  summary: string;
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
  viewpoints?: readonly GenerationViewpointCandidate[];
}>;

export type GenerationViewpointCandidate = Readonly<{
  viewpointId: string;
  nodeId: string;
  kind: GenerationViewpointKind;
  statement: string;
  conditions: string | null;
  sourceIds: readonly string[];
}>;

export type GenerationQuestionCandidate = Readonly<{
  questionId: string;
  nodeId: string;
  type: GenerationQuestionType;
  prompt: string;
  explanation: string;
  options: readonly Readonly<{ optionId: string; label: string }>[];
  correctOptionIds?: readonly string[];
  correctMatches?: readonly Readonly<{
    leftOptionId: string;
    rightOptionId: string;
  }>[];
  sourceIds: readonly string[];
}>;

export type GenerationCandidate = Readonly<{
  directions: readonly GenerationDirectionCandidate[];
  map: GenerationMapCandidate;
  viewpoints: readonly GenerationViewpointCandidate[];
  questions: readonly GenerationQuestionCandidate[];
  sources: readonly GenerationSourceCandidate[];
}>;

export class GenerationCandidateValidationError extends Error {
  readonly code = "candidate_invalid" as const;

  constructor(readonly reason: string) {
    super(`Generation candidate is invalid: ${reason}`);
    this.name = "GenerationCandidateValidationError";
  }
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function hasNoModelUrl(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") {
    return true;
  }
  if (seen.has(value)) {
    return true;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.every((item) => hasNoModelUrl(item, seen));
  }
  return Object.entries(value).every(([key, child]) => {
    if (key.toLowerCase() === "url" || key.toLowerCase().endsWith("url")) {
      return false;
    }
    return hasNoModelUrl(child, seen);
  });
}

function assertNoModelUrl(value: unknown, label: string): void {
  if (!hasNoModelUrl(value)) {
    throw new GenerationCandidateValidationError(`${label}_contains_url`);
  }
}

function assertAcyclic(
  nodeIds: ReadonlySet<string>,
  edges: readonly Readonly<{
    nodeId: string;
    prerequisiteNodeId: string;
  }>[],
): void {
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const nodeId of nodeIds) {
    inDegree.set(nodeId, 0);
  }
  for (const edge of edges) {
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
      continue;
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
    throw new GenerationCandidateValidationError("cyclic_prerequisites");
  }
}

export function validateGenerationCandidate(
  candidate: GenerationCandidate,
): GenerationCandidate {
  assertNoModelUrl(candidate.directions, "directions");
  assertNoModelUrl(candidate.map, "map");
  assertNoModelUrl(candidate.viewpoints, "viewpoints");
  assertNoModelUrl(candidate.questions, "questions");

  if (candidate.directions.length < 3 || candidate.directions.length > 4) {
    throw new GenerationCandidateValidationError("direction_count");
  }
  const directionIds = candidate.directions.map(
    ({ directionId }) => directionId,
  );
  if (
    !directionIds.every((value) => nonBlank(value)) ||
    !unique(directionIds)
  ) {
    throw new GenerationCandidateValidationError("direction_ids");
  }
  for (const direction of candidate.directions) {
    if (
      !nonBlank(direction.title) ||
      !nonBlank(direction.objective) ||
      !nonBlank(direction.searchQuery)
    ) {
      throw new GenerationCandidateValidationError("direction_fields");
    }
  }

  if (candidate.map.nodes.length < 5 || candidate.map.nodes.length > 7) {
    throw new GenerationCandidateValidationError("node_count");
  }
  if (!nonBlank(candidate.map.title) || !nonBlank(candidate.map.summary)) {
    throw new GenerationCandidateValidationError("map_fields");
  }
  const nodeIds = candidate.map.nodes.map(({ nodeId }) => nodeId);
  if (!nodeIds.every((value) => nonBlank(value)) || !unique(nodeIds)) {
    throw new GenerationCandidateValidationError("node_ids");
  }
  const knownNodes = new Set(nodeIds);
  const sourceIds = candidate.sources.map(({ sourceId }) => sourceId);
  if (
    sourceIds.length === 0 ||
    !sourceIds.every((value) => nonBlank(value)) ||
    !unique(sourceIds)
  ) {
    throw new GenerationCandidateValidationError("source_ids");
  }
  const knownSources = new Set(sourceIds);
  for (const source of candidate.sources) {
    if (
      !nonBlank(source.title) ||
      !nonBlank(source.excerpt) ||
      !nonBlank(source.authorName) ||
      !nonBlank(source.url) ||
      !(generationSourceContentTypes as readonly string[]).includes(
        source.contentType,
      ) ||
      !(generationSourceAuthorityLevels as readonly string[]).includes(
        source.authorityLevel,
      ) ||
      !Number.isInteger(source.updatedAt) ||
      source.updatedAt < 0 ||
      !Number.isFinite(source.rankingScore)
    ) {
      throw new GenerationCandidateValidationError("source_fields");
    }
    try {
      const url = new URL(source.url);
      if (
        url.protocol !== "https:" ||
        !(
          url.hostname === "zhihu.com" || url.hostname.endsWith(".zhihu.com")
        ) ||
        url.username !== "" ||
        url.password !== "" ||
        url.port !== ""
      ) {
        throw new Error("invalid source URL");
      }
    } catch {
      throw new GenerationCandidateValidationError("source_url");
    }
  }

  for (const node of candidate.map.nodes) {
    if (!nonBlank(node.title) || !nonBlank(node.learningObjective)) {
      throw new GenerationCandidateValidationError("node_fields");
    }
    if (node.sourceIds.length === 0 || !unique(node.sourceIds)) {
      throw new GenerationCandidateValidationError("node_sources");
    }
    if (node.sourceIds.some((sourceId) => !knownSources.has(sourceId))) {
      throw new GenerationCandidateValidationError("node_unknown_source");
    }
  }

  const edgeKeys = new Set<string>();
  for (const edge of candidate.map.prerequisites) {
    if (
      !knownNodes.has(edge.nodeId) ||
      !knownNodes.has(edge.prerequisiteNodeId)
    ) {
      throw new GenerationCandidateValidationError("unknown_prerequisite_node");
    }
    if (edge.nodeId === edge.prerequisiteNodeId) {
      throw new GenerationCandidateValidationError("self_prerequisite");
    }
    const key = `${edge.nodeId}\u0000${edge.prerequisiteNodeId}`;
    if (edgeKeys.has(key)) {
      throw new GenerationCandidateValidationError("duplicate_prerequisite");
    }
    edgeKeys.add(key);
  }
  assertAcyclic(knownNodes, candidate.map.prerequisites);

  const sourceIdsByNode = new Map<string, Set<string>>(
    candidate.map.nodes.map((node) => [node.nodeId, new Set(node.sourceIds)]),
  );
  const viewpointIds = candidate.viewpoints.map(
    ({ viewpointId }) => viewpointId,
  );
  if (!unique(viewpointIds)) {
    throw new GenerationCandidateValidationError("duplicate_viewpoint");
  }
  for (const viewpoint of candidate.viewpoints) {
    const nodeSources = sourceIdsByNode.get(viewpoint.nodeId);
    if (
      !nonBlank(viewpoint.viewpointId) ||
      !nonBlank(viewpoint.statement) ||
      !(generationViewpointKinds as readonly string[]).includes(
        viewpoint.kind,
      ) ||
      !nodeSources ||
      viewpoint.sourceIds.length === 0 ||
      !unique(viewpoint.sourceIds) ||
      viewpoint.sourceIds.some(
        (sourceId) => !knownSources.has(sourceId) || !nodeSources.has(sourceId),
      ) ||
      (viewpoint.kind === "disagreement" &&
        !nonBlank(viewpoint.conditions ?? ""))
    ) {
      throw new GenerationCandidateValidationError("viewpoint_evidence");
    }
  }

  const questionsByNode = new Map<string, number>();
  const questionIds = candidate.questions.map(({ questionId }) => questionId);
  if (!unique(questionIds)) {
    throw new GenerationCandidateValidationError("duplicate_question");
  }
  for (const question of candidate.questions) {
    const nodeSources = sourceIdsByNode.get(question.nodeId);
    const options = question.options.map(({ optionId }) => optionId);
    const correctOptionIds = [...(question.correctOptionIds ?? [])];
    const correctMatches = [...(question.correctMatches ?? [])];
    if (
      !nonBlank(question.questionId) ||
      !nonBlank(question.prompt) ||
      !nonBlank(question.explanation) ||
      !(generationQuestionTypes as readonly string[]).includes(question.type) ||
      !nodeSources ||
      options.length < 2 ||
      !options.every((value) => nonBlank(value)) ||
      !question.options.every((option) => nonBlank(option.label)) ||
      !unique(options) ||
      question.sourceIds.length === 0 ||
      !unique(question.sourceIds) ||
      question.sourceIds.some(
        (sourceId) => !knownSources.has(sourceId) || !nodeSources.has(sourceId),
      )
    ) {
      throw new GenerationCandidateValidationError("question_fields");
    }
    if (question.type === "matching") {
      const leftOptionIds = correctMatches.map(
        ({ leftOptionId }) => leftOptionId,
      );
      const rightOptionIds = correctMatches.map(
        ({ rightOptionId }) => rightOptionId,
      );
      const rightOptionIdSet = new Set(rightOptionIds);
      if (
        correctOptionIds.length > 0 ||
        correctMatches.length === 0 ||
        !unique(leftOptionIds) ||
        !unique(rightOptionIds) ||
        leftOptionIds.length + rightOptionIds.length !== options.length ||
        leftOptionIds.some((optionId) => rightOptionIdSet.has(optionId)) ||
        correctMatches.some(
          ({ leftOptionId, rightOptionId }) =>
            !options.includes(leftOptionId) ||
            !options.includes(rightOptionId) ||
            leftOptionId === rightOptionId,
        )
      ) {
        throw new GenerationCandidateValidationError("question_answer");
      }
    } else if (
      correctMatches.length > 0 ||
      correctOptionIds.length === 0 ||
      !unique(correctOptionIds) ||
      correctOptionIds.some((optionId) => !options.includes(optionId)) ||
      ((question.type === "single_choice" ||
        question.type === "opinion_analysis") &&
        correctOptionIds.length !== 1)
    ) {
      throw new GenerationCandidateValidationError("question_answer");
    }
    questionsByNode.set(
      question.nodeId,
      (questionsByNode.get(question.nodeId) ?? 0) + 1,
    );
  }
  if (
    questionsByNode.size !== knownNodes.size ||
    [...knownNodes].some((nodeId) => {
      const count = questionsByNode.get(nodeId) ?? 0;
      return count < 2 || count > 3;
    })
  ) {
    throw new GenerationCandidateValidationError("question_count_per_node");
  }

  return {
    directions: candidate.directions.map((direction) => ({ ...direction })),
    map: {
      ...candidate.map,
      nodes: candidate.map.nodes.map((node) => ({
        ...node,
        sourceIds: [...node.sourceIds],
      })),
      prerequisites: candidate.map.prerequisites.map((edge) => ({ ...edge })),
    },
    viewpoints: candidate.viewpoints.map((viewpoint) => ({
      ...viewpoint,
      sourceIds: [...viewpoint.sourceIds],
    })),
    questions: candidate.questions.map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option })),
      correctOptionIds: [...(question.correctOptionIds ?? [])],
      correctMatches: [...(question.correctMatches ?? [])].map((match) => ({
        ...match,
      })),
      sourceIds: [...question.sourceIds],
    })),
    sources: candidate.sources.map((source) => ({ ...source })),
  };
}

export { assertNoModelUrl };
