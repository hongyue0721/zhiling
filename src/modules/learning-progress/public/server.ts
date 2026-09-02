import "server-only";

import {
  createLearningProgressRuntime as createInternalLearningProgressRuntime,
  type LearningProgressRuntimeDependencies,
} from "../infrastructure/runtime";
import type { LearningProgressSummary as InternalProgress } from "../application/read-model";
import type { LearningProgressSummary } from "./contracts";

export type LearningProgressAccess = Readonly<{
  get(
    userId: string,
    learningRelationshipId: string,
  ): Promise<LearningProgressSummary | null>;
}>;

export type LearningProgressRuntime = Readonly<{
  progress: LearningProgressAccess;
}>;

function toPublicProgress(progress: InternalProgress): LearningProgressSummary {
  return {
    learningRelationshipId: progress.learningRelationshipId,
    versionId: progress.versionId,
    questionSetId: progress.questionSetId,
    nodes: progress.nodes.map((node) => ({ ...node })),
    attempts: progress.attempts.map((attempt) => ({ ...attempt })),
  };
}

export function createLearningProgressRuntime(
  dependencies: LearningProgressRuntimeDependencies,
): LearningProgressRuntime {
  const runtime = createInternalLearningProgressRuntime(dependencies);
  return {
    progress: {
      async get(userId, learningRelationshipId) {
        const progress = await runtime.progress.find(
          userId,
          learningRelationshipId,
        );
        return progress ? toPublicProgress(progress) : null;
      },
    },
  };
}

export type {
  LearningAttemptSummary,
  LearningNodeProgress,
  LearningProgressSummary,
} from "./contracts";
