import { describe, expect, it } from "vitest";

import {
  scoreLearningAssessment,
  scoreLearningAssessmentQuestion,
  validateLearningAssessmentQuestionSet,
  type LearningAssessmentQuestion,
} from "./assessment";

function question(
  overrides: Partial<LearningAssessmentQuestion> = {},
): LearningAssessmentQuestion {
  return {
    questionId: "question-1",
    nodeId: "node-1",
    type: "single_choice",
    prompt: "Prompt",
    explanation: "Explanation",
    options: [
      { optionId: "a", label: "A" },
      { optionId: "b", label: "B" },
      { optionId: "c", label: "C" },
    ],
    correctOptionIds: ["a"],
    correctMatches: [],
    sourceIds: ["source-1"],
    ...overrides,
  };
}

describe("learning assessment scoring", () => {
  it("requires exact answers for single choice and opinion analysis", () => {
    expect(
      scoreLearningAssessmentQuestion(question(), {
        questionId: "question-1",
        selectedOptionIds: ["a"],
      }),
    ).toMatchObject({ scoreBasisPoints: 10_000, correct: true });
    expect(
      scoreLearningAssessmentQuestion(question(), {
        questionId: "question-1",
        selectedOptionIds: ["a", "b"],
      }),
    ).toMatchObject({ scoreBasisPoints: 0, correct: false });
    expect(
      scoreLearningAssessmentQuestion(
        question({
          type: "opinion_analysis",
          correctOptionIds: ["b"],
        }),
        { questionId: "question-1", selectedOptionIds: ["a"] },
      ),
    ).toMatchObject({ scoreBasisPoints: 0, correct: false });
  });

  it("applies multiple-choice correct-minus-incorrect scoring", () => {
    const multipleChoice = question({
      type: "multiple_choice",
      correctOptionIds: ["a", "b", "c"],
    });
    expect(
      scoreLearningAssessmentQuestion(multipleChoice, {
        questionId: "question-1",
        selectedOptionIds: ["a", "b"],
      }),
    ).toMatchObject({ scoreBasisPoints: 6_666, correct: false });
    expect(
      scoreLearningAssessmentQuestion(multipleChoice, {
        questionId: "question-1",
        selectedOptionIds: ["a", "b", "c"],
      }),
    ).toMatchObject({ scoreBasisPoints: 10_000, correct: true });
    expect(
      scoreLearningAssessmentQuestion(multipleChoice, {
        questionId: "question-1",
        selectedOptionIds: ["a", "b", "c", "unknown"],
      }),
    ).toMatchObject({ scoreBasisPoints: 6_666, correct: false });
  });

  it("requires a complete matching permutation", () => {
    const matching = question({
      type: "matching",
      options: [
        { optionId: "concept-a", label: "Concept A" },
        { optionId: "concept-b", label: "Concept B" },
        { optionId: "description-a", label: "Description A" },
        { optionId: "description-b", label: "Description B" },
      ],
      correctOptionIds: [],
      correctMatches: [
        { leftOptionId: "concept-a", rightOptionId: "description-b" },
        { leftOptionId: "concept-b", rightOptionId: "description-a" },
      ],
    });
    expect(
      scoreLearningAssessmentQuestion(matching, {
        questionId: "question-1",
        matches: [
          { leftOptionId: "concept-b", rightOptionId: "description-a" },
          { leftOptionId: "concept-a", rightOptionId: "description-b" },
        ],
      }),
    ).toMatchObject({ scoreBasisPoints: 10_000, correct: true });
    expect(
      scoreLearningAssessmentQuestion(matching, {
        questionId: "question-1",
        matches: [
          { leftOptionId: "concept-a", rightOptionId: "description-a" },
          { leftOptionId: "concept-b", rightOptionId: "description-b" },
        ],
      }),
    ).toMatchObject({ scoreBasisPoints: 0, correct: false });
  });

  it("floors the node average and completes at exactly 80 percent", () => {
    const first = question();
    const second = question({
      questionId: "question-2",
      correctOptionIds: ["b"],
    });
    expect(
      scoreLearningAssessment(
        [first, second],
        [
          { questionId: "question-1", selectedOptionIds: ["a"] },
          { questionId: "question-2", selectedOptionIds: ["a"] },
        ],
      ),
    ).toEqual({
      questionScores: [
        { questionId: "question-1", scoreBasisPoints: 10_000, correct: true },
        { questionId: "question-2", scoreBasisPoints: 0, correct: false },
      ],
      nodeScore: 5_000,
    });

    const eighty = scoreLearningAssessment(
      [
        first,
        question({
          questionId: "question-3",
          type: "multiple_choice",
          correctOptionIds: ["a", "b", "c"],
        }),
      ],
      [
        { questionId: "question-1", selectedOptionIds: ["a"] },
        { questionId: "question-3", selectedOptionIds: ["a", "b"] },
      ],
    );
    expect(eighty.nodeScore).toBe(8_333);
    expect(eighty.nodeScore).toBeGreaterThanOrEqual(8_000);
  });
});

describe("learning assessment publication validation", () => {
  it("normalizes immutable answer and source arrays", () => {
    const publication = validateLearningAssessmentQuestionSet({
      questionSetId: "set-1",
      versionId: "version-1",
      questions: [
        {
          questionId: "question-1",
          nodeId: "node-1",
          type: "single_choice",
          prompt: "Prompt",
          explanation: "Explanation",
          options: [
            { optionId: "a", label: "A" },
            { optionId: "b", label: "B" },
          ],
          correctOptionIds: ["a"],
          sourceIds: ["source-1"],
        },
      ],
    });
    expect(publication).toEqual({
      questionSetId: "set-1",
      versionId: "version-1",
      questions: [
        {
          questionId: "question-1",
          nodeId: "node-1",
          type: "single_choice",
          prompt: "Prompt",
          explanation: "Explanation",
          options: [
            { optionId: "a", label: "A" },
            { optionId: "b", label: "B" },
          ],
          correctOptionIds: ["a"],
          correctMatches: [],
          sourceIds: ["source-1"],
        },
      ],
    });
  });
  it("derives matching sides from complete answer pairs", () => {
    const publication = validateLearningAssessmentQuestionSet({
      questionSetId: "set-matching",
      versionId: "version-1",
      questions: [
        {
          questionId: "matching-question",
          nodeId: "node-1",
          type: "matching",
          prompt: "Match concepts",
          explanation: "Each concept has one description.",
          options: [
            { optionId: "concept-a", label: "Concept A" },
            { optionId: "concept-b", label: "Concept B" },
            { optionId: "description-a", label: "Description A" },
            { optionId: "description-b", label: "Description B" },
          ],
          correctMatches: [
            { leftOptionId: "concept-a", rightOptionId: "description-b" },
            { leftOptionId: "concept-b", rightOptionId: "description-a" },
          ],
          sourceIds: ["source-1"],
        },
      ],
    });

    expect(publication.questions[0]?.options).toEqual([
      { optionId: "concept-a", label: "Concept A", side: "left" },
      { optionId: "concept-b", label: "Concept B", side: "left" },
      { optionId: "description-a", label: "Description A", side: "right" },
      { optionId: "description-b", label: "Description B", side: "right" },
    ]);
  });

  it.each([
    {
      name: "leaves an option outside every pair",
      options: [
        { optionId: "concept-a", label: "Concept A" },
        { optionId: "concept-b", label: "Concept B" },
        { optionId: "description-a", label: "Description A" },
      ],
      correctMatches: [
        { leftOptionId: "concept-a", rightOptionId: "description-a" },
      ],
    },
    {
      name: "places one option on both sides",
      options: [
        { optionId: "concept-a", label: "Concept A" },
        { optionId: "concept-b", label: "Concept B" },
        { optionId: "description-a", label: "Description A" },
        { optionId: "description-b", label: "Description B" },
      ],
      correctMatches: [
        { leftOptionId: "concept-a", rightOptionId: "description-a" },
        { leftOptionId: "description-a", rightOptionId: "description-b" },
      ],
    },
  ])("$name", ({ options, correctMatches }) => {
    expect(() =>
      validateLearningAssessmentQuestionSet({
        questionSetId: "set-invalid-matching",
        versionId: "version-1",
        questions: [
          {
            questionId: "matching-question",
            nodeId: "node-1",
            type: "matching",
            prompt: "Match concepts",
            explanation: "Each concept has one description.",
            options,
            correctMatches,
            sourceIds: ["source-1"],
          },
        ],
      }),
    ).toThrow("invalid_matching_answer");
  });
});
