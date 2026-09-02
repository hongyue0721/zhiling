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
        { optionId: "left-a", label: "Left A" },
        { optionId: "left-b", label: "Left B" },
        { optionId: "right-a", label: "Right A" },
        { optionId: "right-b", label: "Right B" },
      ],
      correctOptionIds: [],
      correctMatches: [
        { leftOptionId: "left-a", rightOptionId: "right-b" },
        { leftOptionId: "left-b", rightOptionId: "right-a" },
      ],
    });
    expect(
      scoreLearningAssessmentQuestion(matching, {
        questionId: "question-1",
        matches: [
          { leftOptionId: "left-b", rightOptionId: "right-a" },
          { leftOptionId: "left-a", rightOptionId: "right-b" },
        ],
      }),
    ).toMatchObject({ scoreBasisPoints: 10_000, correct: true });
    expect(
      scoreLearningAssessmentQuestion(matching, {
        questionId: "question-1",
        matches: [
          { leftOptionId: "left-a", rightOptionId: "right-a" },
          { leftOptionId: "left-b", rightOptionId: "right-b" },
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
});
