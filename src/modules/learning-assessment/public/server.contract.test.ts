import { beforeEach, describe, expect, it, vi } from "vitest";

const internal = vi.hoisted(() => ({
  findNodeAssessment: vi.fn(),
  submit: vi.fn(),
  publishQuestionSet: vi.fn(),
}));

vi.mock("../infrastructure/runtime", () => ({
  createLearningAssessmentRuntime: () => ({
    assessment: {
      findNodeAssessment: internal.findNodeAssessment,
      submit: internal.submit,
      publishQuestionSet: internal.publishQuestionSet,
    },
  }),
}));

import { createLearningAssessmentRuntime } from "./server";

beforeEach(() => {
  internal.findNodeAssessment.mockReset();
  internal.submit.mockReset();
  internal.publishQuestionSet.mockReset();
});

describe("learning assessment public server boundary", () => {
  it("returns independent safe question DTOs", async () => {
    const internalAssessment = {
      learningRelationshipId: "learning-1",
      questionSetId: "set-1",
      versionId: "version-1",
      nodeId: "node-1",
      questions: [
        {
          questionId: "question-1",
          nodeId: "node-1",
          type: "single_choice" as const,
          prompt: "Prompt",
          options: [{ optionId: "a", label: "A" }],
          sourceIds: ["source-1"],
          correctOptionIds: ["a"],
        },
      ],
    };
    internal.findNodeAssessment.mockResolvedValue(internalAssessment);
    const runtime = createLearningAssessmentRuntime({
      database: undefined as never,
      mapReader: undefined as never,
    });

    const assessment = await runtime.assessment.getNodeAssessment(
      "user-1",
      "learning-1",
      "node-1",
    );
    expect(assessment).toEqual({
      learningRelationshipId: "learning-1",
      questionSetId: "set-1",
      versionId: "version-1",
      nodeId: "node-1",
      questions: [
        {
          questionId: "question-1",
          nodeId: "node-1",
          type: "single_choice",
          prompt: "Prompt",
          options: [{ optionId: "a", label: "A" }],
          sourceIds: ["source-1"],
        },
      ],
    });
    expect(assessment).not.toHaveProperty("questions.0.correctOptionIds");
    expect(assessment?.questions).not.toBe(internalAssessment.questions);
    expect(assessment?.questions[0]?.options).not.toBe(
      internalAssessment.questions[0]?.options,
    );
  });

  it("copies judgment explanations and score data", async () => {
    const result = {
      attemptId: "attempt-1",
      learningRelationshipId: "learning-1",
      questionSetId: "set-1",
      versionId: "version-1",
      nodeId: "node-1",
      nodeScore: 8_000,
      bestScore: 8_000,
      completed: true,
      submittedAt: "2026-09-02T00:00:00.000Z",
      questions: [
        {
          questionId: "question-1",
          correct: true,
          scoreBasisPoints: 10_000,
          explanation: "Because the source says so.",
          sourceIds: ["source-1"],
        },
      ],
    };
    internal.submit.mockResolvedValue(result);
    const runtime = createLearningAssessmentRuntime({
      database: undefined as never,
      mapReader: undefined as never,
    });
    const response = await runtime.assessment.submit(
      "user-1",
      "learning-1",
      "node-1",
      "key-1",
      [{ questionId: "question-1", selectedOptionIds: ["a"] }],
    );
    expect(response).toEqual(result);
    expect(response).not.toBe(result);
    expect(response?.questions).not.toBe(result.questions);
  });
});
