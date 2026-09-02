import type { LearningMapDetail } from "@/modules/learning-catalog/public/contracts";

import {
  LearningAssessmentInvariantError,
  validateLearningAssessmentQuestionSet,
  type AssessmentAnswerSubmission,
  type LearningAssessmentQuestionSetPublication,
} from "../domain/assessment";
import type {
  LearningAssessmentProgressWriterInput,
  LearningAssessmentRepository,
  LearningAssessmentSubmissionResult,
  LearningNodeAssessment,
} from "./read-model";

export interface LearningRelationshipMapReader {
  findByLearningRelationship(
    userId: string,
    learningRelationshipId: string,
  ): Promise<LearningMapDetail | null>;
}

export class LearningAssessmentRequestError extends Error {
  readonly code = "invalid_request" as const;

  constructor(readonly reason: string) {
    super(`Learning assessment request is invalid: ${reason}`);
    this.name = "LearningAssessmentRequestError";
  }
}

export class LearningAssessmentService {
  constructor(
    private readonly repository: LearningAssessmentRepository,
    private readonly mapReader: LearningRelationshipMapReader,
  ) {}

  async publishQuestionSet(
    publication: LearningAssessmentQuestionSetPublication,
  ): Promise<void> {
    const validated = validateLearningAssessmentQuestionSet(publication);
    await this.repository.publishQuestionSet(validated);
  }

  async findNodeAssessment(
    userId: string,
    learningRelationshipId: string,
    nodeId: string,
  ): Promise<LearningNodeAssessment | null> {
    const map = await this.mapReader.findByLearningRelationship(
      userId,
      learningRelationshipId,
    );
    if (!map || !map.nodes.some((node) => node.nodeId === nodeId)) {
      return null;
    }
    return this.repository.findNodeAssessment(
      userId,
      learningRelationshipId,
      map.versionId,
      nodeId,
    );
  }

  async submit(
    userId: string,
    learningRelationshipId: string,
    nodeId: string,
    idempotencyKey: string,
    answers: readonly AssessmentAnswerSubmission[],
  ): Promise<LearningAssessmentSubmissionResult | null> {
    if (idempotencyKey.trim().length === 0 || idempotencyKey.length > 256) {
      throw new LearningAssessmentRequestError("invalid_idempotency_key");
    }
    const map = await this.mapReader.findByLearningRelationship(
      userId,
      learningRelationshipId,
    );
    if (!map || !map.nodes.some((node) => node.nodeId === nodeId)) {
      return null;
    }

    const input: LearningAssessmentProgressWriterInput = {
      userId,
      learningRelationshipId,
      versionId: map.versionId,
      nodeId,
      idempotencyKey,
      answers: answers.map((answer) => ({
        ...answer,
        selectedOptionIds: answer.selectedOptionIds
          ? [...answer.selectedOptionIds]
          : undefined,
        matches: answer.matches
          ? answer.matches.map((match) => ({ ...match }))
          : undefined,
      })),
    };

    try {
      return await this.repository.submit(input);
    } catch (error) {
      if (error instanceof LearningAssessmentInvariantError) {
        throw new LearningAssessmentRequestError(error.code);
      }
      throw error;
    }
  }
}
