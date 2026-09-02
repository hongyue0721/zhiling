export type AssessmentQuestionType =
  "single_choice" | "multiple_choice" | "matching" | "opinion_analysis";

export type AssessmentMatchingAnswer = Readonly<{
  leftOptionId: string;
  rightOptionId: string;
}>;

export type AssessmentQuestionOption = Readonly<{
  optionId: string;
  label: string;
}>;

export type AssessmentQuestionPrompt = Readonly<{
  questionId: string;
  nodeId: string;
  type: AssessmentQuestionType;
  prompt: string;
  options: readonly AssessmentQuestionOption[];
  sourceIds: readonly string[];
}>;

export type LearningNodeAssessment = Readonly<{
  learningRelationshipId: string;
  questionSetId: string;
  versionId: string;
  nodeId: string;
  questions: readonly AssessmentQuestionPrompt[];
}>;

export type AssessmentAnswerSubmission = Readonly<{
  questionId: string;
  selectedOptionIds?: readonly string[];
  matches?: readonly AssessmentMatchingAnswer[];
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
