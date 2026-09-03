export type ViewpointKind =
  "consensus" | "disagreement" | "practical_experience" | "supplementary";

export type FeaturedLearningMapSummary = Readonly<{
  mapId: string;
  versionId: string;
  title: string;
  summary: string;
  nodeCount: number;
}>;

export type LearningMapDetail = Readonly<{
  mapId: string;
  versionId: string;
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
  sources: readonly Readonly<{
    sourceId: string;
    title: string;
    excerpt: string;
    url: string;
    authorName: string;
  }>[];
  viewpoints: readonly Readonly<{
    viewpointId: string;
    nodeId: string;
    kind: ViewpointKind;
    statement: string;
    conditions: string | null;
    sourceIds: readonly string[];
  }>[];
}>;

export type LearningRelationship = Readonly<{
  learningRelationshipId: string;
  mapId: string;
  versionId: string;
}>;

export type LearningRelationshipSummary = Readonly<{
  learningRelationshipId: string;
  mapId: string;
  versionId: string;
  title: string;
  summary: string;
}>;
