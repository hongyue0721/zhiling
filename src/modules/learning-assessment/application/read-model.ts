import type {
  AssessmentAnswerSubmission,
  AssessmentQuestionType,
  LearningAssessmentQuestion,
  LearningAssessmentQuestionSetPublication,
} from "../domain/assessment";

export type AssessmentQuestionPrompt = Readonly<{
  questionId: string;
  nodeId: string;
  type: AssessmentQuestionType;
  prompt: string;
  options: readonly Readonly<{
    optionId: string;
    label: string;
  }>[];
  sourceIds: readonly string[];
}>;

export type LearningNodeAssessment = Readonly<{
  learningRelationshipId: string;
  questionSetId: string;
  versionId: string;
  nodeId: string;
  questions: readonly AssessmentQuestionPrompt[];
}>;

export type AssessmentQuestionResult = Readonly<{
  questionId: string;
  correct: boolean;
  scoreBasisPoints: number;
  explanation: string;
  sourceIds: readonly string[];
}>;

export type LearningAssessmentSubmissionResult = Readonly<{
  attemptId: string;
  learningRelationshipId: string;
  questionSetId: string;
  versionId: string;
  nodeId: string;
  nodeScore: number;
  bestScore: number;
  completed: boolean;
  submittedAt: string;
  questions: readonly AssessmentQuestionResult[];
}>;

export type LearningAssessmentProgressWriterInput = Readonly<{
  userId: string;
  learningRelationshipId: string;
  versionId: string;
  nodeId: string;
  questionSetId?: string;
  idempotencyKey: string;
  answers: readonly AssessmentAnswerSubmission[];
}>;

export interface LearningAssessmentRepository {
  publishQuestionSet(
    publication: LearningAssessmentQuestionSetPublication,
  ): Promise<void>;
  findNodeAssessment(
    userId: string,
    learningRelationshipId: string,
    versionId: string,
    nodeId: string,
  ): Promise<LearningNodeAssessment | null>;
  submit(
    input: LearningAssessmentProgressWriterInput,
  ): Promise<LearningAssessmentSubmissionResult | null>;
}

export type StoredAssessmentQuestion = LearningAssessmentQuestion;
