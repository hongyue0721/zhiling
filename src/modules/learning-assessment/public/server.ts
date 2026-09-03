import "server-only";

import {
  createLearningAssessmentRuntime as createInternalLearningAssessmentRuntime,
  type LearningAssessmentRuntimeDependencies,
} from "../infrastructure/runtime";
import type {
  LearningNodeAssessment as InternalNodeAssessment,
  LearningAssessmentSubmissionResult as InternalSubmissionResult,
} from "../application/read-model";
import type { LearningAssessmentQuestionSetPublication as InternalQuestionSetPublication } from "../domain/assessment";
import type {
  AssessmentAnswerSubmission,
  LearningNodeAssessment,
  LearningAssessmentSubmissionResult,
} from "./contracts";
export { LearningAssessmentRequestError } from "../application/learning-assessment";

export type LearningAssessmentAccess = Readonly<{
  getNodeAssessment(
    userId: string,
    learningRelationshipId: string,
    nodeId: string,
  ): Promise<LearningNodeAssessment | null>;
  submit(
    userId: string,
    learningRelationshipId: string,
    nodeId: string,
    idempotencyKey: string,
    answers: readonly AssessmentAnswerSubmission[],
  ): Promise<LearningAssessmentSubmissionResult | null>;
  publishQuestionSet(
    publication: InternalQuestionSetPublication,
  ): Promise<void>;
}>;

export type LearningAssessmentRuntime = Readonly<{
  assessment: LearningAssessmentAccess;
}>;

function toPublicNodeAssessment(
  assessment: InternalNodeAssessment,
): LearningNodeAssessment {
  return {
    learningRelationshipId: assessment.learningRelationshipId,
    questionSetId: assessment.questionSetId,
    versionId: assessment.versionId,
    nodeId: assessment.nodeId,
    questions: assessment.questions.map((question) => ({
      questionId: question.questionId,
      nodeId: question.nodeId,
      type: question.type,
      prompt: question.prompt,
      options: question.options.map((option) => ({ ...option })),
      sourceIds: [...question.sourceIds],
    })),
  };
}

function toPublicSubmissionResult(
  result: InternalSubmissionResult,
): LearningAssessmentSubmissionResult {
  return {
    attemptId: result.attemptId,
    learningRelationshipId: result.learningRelationshipId,
    questionSetId: result.questionSetId,
    versionId: result.versionId,
    nodeId: result.nodeId,
    nodeScore: result.nodeScore,
    bestScore: result.bestScore,
    completed: result.completed,
    submittedAt: result.submittedAt,
    questions: result.questions.map((question) => ({
      questionId: question.questionId,
      correct: question.correct,
      scoreBasisPoints: question.scoreBasisPoints,
      explanation: question.explanation,
      sourceIds: [...question.sourceIds],
    })),
  };
}

export function createLearningAssessmentRuntime(
  dependencies: LearningAssessmentRuntimeDependencies,
): LearningAssessmentRuntime {
  const runtime = createInternalLearningAssessmentRuntime(dependencies);
  return {
    assessment: {
      async getNodeAssessment(userId, learningRelationshipId, nodeId) {
        const assessment = await runtime.assessment.findNodeAssessment(
          userId,
          learningRelationshipId,
          nodeId,
        );
        return assessment ? toPublicNodeAssessment(assessment) : null;
      },
      async submit(
        userId,
        learningRelationshipId,
        nodeId,
        idempotencyKey,
        answers,
      ) {
        const result = await runtime.assessment.submit(
          userId,
          learningRelationshipId,
          nodeId,
          idempotencyKey,
          answers,
        );
        return result ? toPublicSubmissionResult(result) : null;
      },
      async publishQuestionSet(publication) {
        await runtime.assessment.publishQuestionSet(publication);
      },
    },
  };
}

export type {
  AssessmentAnswerSubmission,
  AssessmentMatchingSide,
  AssessmentQuestionOption,
  AssessmentQuestionPrompt,
  AssessmentQuestionResult,
  AssessmentQuestionType,
  AssessmentMatchingAnswer,
  LearningAssessmentSubmissionResult,
  LearningNodeAssessment,
} from "./contracts";
export type {
  AssessmentQuestionPublication,
  LearningAssessmentQuestionSetPublication,
} from "../domain/assessment";
