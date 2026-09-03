export const assessmentQuestionTypes = [
  "single_choice",
  "multiple_choice",
  "matching",
  "opinion_analysis",
] as const;

export type AssessmentQuestionType = (typeof assessmentQuestionTypes)[number];

export const ASSESSMENT_COMPLETION_SCORE = 8_000;

export const assessmentMatchingSides = ["left", "right"] as const;

export type AssessmentMatchingSide = (typeof assessmentMatchingSides)[number];

export type AssessmentQuestionOption = Readonly<{
  optionId: string;
  label: string;
  side?: AssessmentMatchingSide;
}>;

export type AssessmentMatchingAnswer = Readonly<{
  leftOptionId: string;
  rightOptionId: string;
}>;

export type AssessmentQuestionPublication = Readonly<{
  questionId: string;
  nodeId: string;
  type: AssessmentQuestionType;
  prompt: string;
  explanation: string;
  options: readonly AssessmentQuestionOption[];
  correctOptionIds?: readonly string[];
  correctMatches?: readonly AssessmentMatchingAnswer[];
  sourceIds: readonly string[];
}>;

export type LearningAssessmentQuestion = Readonly<{
  questionId: string;
  nodeId: string;
  type: AssessmentQuestionType;
  prompt: string;
  explanation: string;
  options: readonly AssessmentQuestionOption[];
  correctOptionIds: readonly string[];
  correctMatches: readonly AssessmentMatchingAnswer[];
  sourceIds: readonly string[];
}>;

export type LearningAssessmentQuestionSetPublication = Readonly<{
  questionSetId: string;
  versionId: string;
  questions: readonly AssessmentQuestionPublication[];
}>;

export type AssessmentAnswerSubmission = Readonly<{
  questionId: string;
  selectedOptionIds?: readonly string[];
  matches?: readonly AssessmentMatchingAnswer[];
}>;

export type AssessmentQuestionScore = Readonly<{
  questionId: string;
  scoreBasisPoints: number;
  correct: boolean;
}>;

export type AssessmentScoringResult = Readonly<{
  questionScores: readonly AssessmentQuestionScore[];
  nodeScore: number;
}>;

export type LearningAssessmentInvariantCode =
  | "invalid_question_set_id"
  | "invalid_version_id"
  | "empty_question_set"
  | "duplicate_question"
  | "invalid_question_id"
  | "invalid_question_node_id"
  | "invalid_question_type"
  | "invalid_question_prompt"
  | "invalid_question_explanation"
  | "invalid_question_options"
  | "invalid_option_id"
  | "duplicate_option"
  | "invalid_option_label"
  | "invalid_correct_option"
  | "duplicate_correct_option"
  | "invalid_matching_answer"
  | "duplicate_matching_left_option"
  | "duplicate_matching_right_option"
  | "invalid_question_sources"
  | "duplicate_question_source"
  | "invalid_submission"
  | "duplicate_submission_question"
  | "unknown_submission_question";

export class LearningAssessmentInvariantError extends Error {
  constructor(readonly code: LearningAssessmentInvariantCode) {
    super(`Learning assessment invariant failed: ${code}`);
    this.name = "LearningAssessmentInvariantError";
  }
}

function assertNonBlank(
  value: string,
  code:
    | "invalid_question_set_id"
    | "invalid_version_id"
    | "invalid_question_id"
    | "invalid_question_node_id"
    | "invalid_question_prompt"
    | "invalid_question_explanation"
    | "invalid_option_id"
    | "invalid_option_label",
): void {
  if (value.trim().length === 0) {
    throw new LearningAssessmentInvariantError(code);
  }
}

function assertUnique(
  values: readonly string[],
  code:
    | "duplicate_question"
    | "duplicate_option"
    | "duplicate_correct_option"
    | "duplicate_question_source"
    | "duplicate_submission_question"
    | "duplicate_matching_left_option"
    | "duplicate_matching_right_option",
): void {
  if (new Set(values).size !== values.length) {
    throw new LearningAssessmentInvariantError(code);
  }
}

function normalizeQuestion(
  question: AssessmentQuestionPublication,
): LearningAssessmentQuestion {
  assertNonBlank(question.questionId, "invalid_question_id");
  assertNonBlank(question.nodeId, "invalid_question_node_id");
  assertNonBlank(question.prompt, "invalid_question_prompt");
  assertNonBlank(question.explanation, "invalid_question_explanation");
  if (!(assessmentQuestionTypes as readonly string[]).includes(question.type)) {
    throw new LearningAssessmentInvariantError("invalid_question_type");
  }
  if (question.options.length < 2) {
    throw new LearningAssessmentInvariantError("invalid_question_options");
  }

  const optionIds = question.options.map(({ optionId }) => optionId);
  for (const option of question.options) {
    assertNonBlank(option.optionId, "invalid_option_id");
    assertNonBlank(option.label, "invalid_option_label");
  }
  assertUnique(optionIds, "duplicate_option");

  const sourceIds = [...question.sourceIds];
  if (sourceIds.length === 0) {
    throw new LearningAssessmentInvariantError("invalid_question_sources");
  }
  for (const sourceId of sourceIds) {
    if (sourceId.trim().length === 0) {
      throw new LearningAssessmentInvariantError("invalid_question_sources");
    }
  }
  assertUnique(sourceIds, "duplicate_question_source");

  const correctOptionIds = [...(question.correctOptionIds ?? [])];
  const correctMatches = [...(question.correctMatches ?? [])].map((match) => ({
    leftOptionId: match.leftOptionId,
    rightOptionId: match.rightOptionId,
  }));
  const knownOptionIds = new Set(optionIds);
  const matchingSideByOptionId = new Map<
    string,
    AssessmentMatchingSide
  >();

  if (question.type === "matching") {
    if (correctOptionIds.length > 0 || correctMatches.length === 0) {
      throw new LearningAssessmentInvariantError("invalid_matching_answer");
    }
    const leftOptionIds = correctMatches.map(({ leftOptionId }) => leftOptionId);
    const rightOptionIds = correctMatches.map(
      ({ rightOptionId }) => rightOptionId,
    );
    assertUnique(leftOptionIds, "duplicate_matching_left_option");
    assertUnique(rightOptionIds, "duplicate_matching_right_option");
    const rightOptionIdSet = new Set(rightOptionIds);
    if (
      leftOptionIds.length + rightOptionIds.length !== optionIds.length ||
      leftOptionIds.some((optionId) => rightOptionIdSet.has(optionId))
    ) {
      throw new LearningAssessmentInvariantError("invalid_matching_answer");
    }
    for (const match of correctMatches) {
      if (
        !knownOptionIds.has(match.leftOptionId) ||
        !knownOptionIds.has(match.rightOptionId) ||
        match.leftOptionId === match.rightOptionId
      ) {
        throw new LearningAssessmentInvariantError("invalid_matching_answer");
      }
    }
    for (const optionId of leftOptionIds) {
      matchingSideByOptionId.set(optionId, "left");
    }
    for (const optionId of rightOptionIds) {
      matchingSideByOptionId.set(optionId, "right");
    }
  } else {
    if (correctMatches.length > 0 || correctOptionIds.length === 0) {
      throw new LearningAssessmentInvariantError("invalid_correct_option");
    }
    assertUnique(correctOptionIds, "duplicate_correct_option");
    for (const optionId of correctOptionIds) {
      if (!knownOptionIds.has(optionId)) {
        throw new LearningAssessmentInvariantError("invalid_correct_option");
      }
    }
    if (
      (question.type === "single_choice" ||
        question.type === "opinion_analysis") &&
      correctOptionIds.length !== 1
    ) {
      throw new LearningAssessmentInvariantError("invalid_correct_option");
    }
  }

  const options = question.options.map(({ optionId, label }) => {
    const side = matchingSideByOptionId.get(optionId);
    return side ? { optionId, label, side } : { optionId, label };
  });

  return {
    questionId: question.questionId,
    nodeId: question.nodeId,
    type: question.type,
    prompt: question.prompt,
    explanation: question.explanation,
    options,
    correctOptionIds,
    correctMatches,
    sourceIds,
  };
}

export function validateLearningAssessmentQuestionSet(
  publication: LearningAssessmentQuestionSetPublication,
): Readonly<{
  questionSetId: string;
  versionId: string;
  questions: readonly LearningAssessmentQuestion[];
}> {
  assertNonBlank(publication.questionSetId, "invalid_question_set_id");
  assertNonBlank(publication.versionId, "invalid_version_id");
  if (publication.questions.length === 0) {
    throw new LearningAssessmentInvariantError("empty_question_set");
  }

  const questions = publication.questions.map(normalizeQuestion);
  assertUnique(
    questions.map(({ questionId }) => questionId),
    "duplicate_question",
  );
  return {
    questionSetId: publication.questionSetId,
    versionId: publication.versionId,
    questions,
  };
}

function asSelection(
  answer: AssessmentAnswerSubmission | undefined,
): readonly string[] {
  return answer?.selectedOptionIds ?? [];
}

function asMatches(
  answer: AssessmentAnswerSubmission | undefined,
): readonly AssessmentMatchingAnswer[] {
  return answer?.matches ?? [];
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function sameMatches(
  left: readonly AssessmentMatchingAnswer[],
  right: readonly AssessmentMatchingAnswer[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightByLeft = new Map(
    right.map(({ leftOptionId, rightOptionId }) => [
      leftOptionId,
      rightOptionId,
    ]),
  );
  return (
    new Set(left.map(({ leftOptionId }) => leftOptionId)).size ===
      left.length &&
    left.every(
      ({ leftOptionId, rightOptionId }) =>
        rightByLeft.get(leftOptionId) === rightOptionId,
    )
  );
}

export function scoreLearningAssessmentQuestion(
  question: LearningAssessmentQuestion,
  answer?: AssessmentAnswerSubmission,
): AssessmentQuestionScore {
  let scoreBasisPoints = 0;
  if (question.type === "matching") {
    scoreBasisPoints = sameMatches(asMatches(answer), question.correctMatches)
      ? 10_000
      : 0;
  } else {
    const selectedOptionIds = asSelection(answer);
    const selectedSet = new Set(selectedOptionIds);
    if (question.type === "multiple_choice") {
      const correctCount = selectedOptionIds.filter((optionId) =>
        question.correctOptionIds.includes(optionId),
      ).length;
      const incorrectCount = selectedOptionIds.filter(
        (optionId) => !question.correctOptionIds.includes(optionId),
      ).length;
      scoreBasisPoints = Math.max(
        0,
        Math.min(
          10_000,
          Math.floor(
            ((correctCount - incorrectCount) * 10_000) /
              question.correctOptionIds.length,
          ),
        ),
      );
    } else {
      scoreBasisPoints = sameSet([...selectedSet], question.correctOptionIds)
        ? 10_000
        : 0;
    }
  }

  return {
    questionId: question.questionId,
    scoreBasisPoints,
    correct: scoreBasisPoints === 10_000,
  };
}

export function scoreLearningAssessment(
  questions: readonly LearningAssessmentQuestion[],
  answers: readonly AssessmentAnswerSubmission[],
): AssessmentScoringResult {
  const answersByQuestion = new Map(
    answers.map((answer) => [answer.questionId, answer]),
  );
  const questionScores = questions.map((question) =>
    scoreLearningAssessmentQuestion(
      question,
      answersByQuestion.get(question.questionId),
    ),
  );
  const nodeScore = Math.floor(
    questionScores.reduce(
      (total, question) => total + question.scoreBasisPoints,
      0,
    ) / questionScores.length,
  );
  return { questionScores, nodeScore };
}

export function validateAssessmentAnswers(
  questions: readonly LearningAssessmentQuestion[],
  answers: readonly AssessmentAnswerSubmission[],
): readonly AssessmentAnswerSubmission[] {
  const questionIds = new Set(questions.map(({ questionId }) => questionId));
  assertUnique(
    answers.map(({ questionId }) => questionId),
    "duplicate_submission_question",
  );
  for (const answer of answers) {
    if (!questionIds.has(answer.questionId)) {
      throw new LearningAssessmentInvariantError("unknown_submission_question");
    }
    const question = questions.find(
      ({ questionId }) => questionId === answer.questionId,
    )!;
    if (
      (question.type === "matching" && answer.matches === undefined) ||
      (question.type !== "matching" && answer.selectedOptionIds === undefined)
    ) {
      throw new LearningAssessmentInvariantError("invalid_submission");
    }
    if (
      answer.selectedOptionIds !== undefined &&
      answer.matches !== undefined
    ) {
      throw new LearningAssessmentInvariantError("invalid_submission");
    }
    if (
      answer.selectedOptionIds &&
      new Set(answer.selectedOptionIds).size !== answer.selectedOptionIds.length
    ) {
      throw new LearningAssessmentInvariantError("invalid_submission");
    }
    if (answer.matches) {
      if (
        new Set(answer.matches.map(({ leftOptionId }) => leftOptionId)).size !==
          answer.matches.length ||
        new Set(answer.matches.map(({ rightOptionId }) => rightOptionId))
          .size !== answer.matches.length
      ) {
        throw new LearningAssessmentInvariantError("invalid_submission");
      }
    }
  }
  return answers.map((answer) => ({
    ...answer,
    selectedOptionIds: answer.selectedOptionIds
      ? [...answer.selectedOptionIds]
      : undefined,
    matches: answer.matches
      ? answer.matches.map((match) => ({ ...match }))
      : undefined,
  }));
}
