export type LearningReportViewpointKind =
  "consensus" | "disagreement" | "practical_experience" | "supplementary";

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
    kind: LearningReportViewpointKind;
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
  sources: readonly Readonly<{
    sourceId: string;
    title: string;
    url: string;
    authorName: string;
  }>[];
}>;
