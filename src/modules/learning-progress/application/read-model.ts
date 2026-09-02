export type LearningNodeProgress = Readonly<{
  nodeId: string;
  bestScore: number;
  completed: boolean;
  completedAt: string | null;
  bestAttemptId: string | null;
}>;

export type LearningAttemptSummary = Readonly<{
  attemptId: string;
  nodeId: string;
  nodeScore: number;
  submittedAt: string;
}>;

export type LearningProgressSummary = Readonly<{
  learningRelationshipId: string;
  versionId: string;
  questionSetId: string;
  nodes: readonly LearningNodeProgress[];
  attempts: readonly LearningAttemptSummary[];
}>;

export interface LearningProgressRepository {
  find(
    userId: string,
    learningRelationshipId: string,
    versionId: string,
    nodeIds: readonly string[],
  ): Promise<LearningProgressSummary | null>;
}
