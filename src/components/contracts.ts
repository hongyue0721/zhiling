import type {
  FeaturedLearningMapSummary,
  LearningMapDetail,
  LearningRelationship,
  LearningRelationshipSummary,
} from "@/modules/learning-catalog/public/contracts";
import type {
  AssessmentAnswerSubmission,
  AssessmentQuestionPrompt,
  LearningAssessmentSubmissionResult,
} from "@/modules/learning-assessment/public/contracts";
import type { LearningProgressSummary } from "@/modules/learning-progress/public/contracts";
import type { PrivateLearningReport } from "@/modules/learning-report/public/contracts";
import type {
  GenerationEventType,
  GenerationProgress,
  GenerationRequestResult,
  GenerationSnapshot,
} from "@/modules/map-generation/public/contracts";

export type {
  FeaturedLearningMapSummary,
  LearningMapDetail,
  LearningRelationship,
  LearningRelationshipSummary,
};
export type { AssessmentAnswerSubmission, AssessmentQuestionPrompt };
export type { LearningProgressSummary, LearningAssessmentSubmissionResult };
export type { PrivateLearningReport };
export type {
  GenerationEventType,
  GenerationProgress,
  GenerationRequestResult,
  GenerationSnapshot,
};

export type LearningRelationshipList = Readonly<{
  items: readonly LearningRelationshipSummary[];
}>;

export type LearningRelationshipCreation = LearningRelationship;

export type SafeGenerationEvent = Readonly<{
  protocolVersion: "1";
  taskId: string;
  sequence: number;
  type: GenerationEventType;
  occurredAt: string;
  data: Readonly<Record<string, unknown>>;
}>;
