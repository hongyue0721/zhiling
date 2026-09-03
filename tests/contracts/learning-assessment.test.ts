import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  requireIdentity: vi.fn(),
  getNodeAssessment: vi.fn(),
  submit: vi.fn(),
  getProgress: vi.fn(),
}));

vi.mock("@/bootstrap/server", () => ({
  getServerRuntime: () => ({
    identity: { require: runtime.requireIdentity },
    learningAssessment: {
      getNodeAssessment: runtime.getNodeAssessment,
      submit: runtime.submit,
    },
    learningProgress: {
      get: runtime.getProgress,
    },
  }),
}));

import {
  GET as getNodeAssessment,
  POST as submitNodeAssessment,
} from "@/app/api/learning-relationships/[learningRelationshipId]/nodes/[nodeId]/assessment/route";
import { GET as getLearningProgress } from "@/app/api/learning-relationships/[learningRelationshipId]/progress/route";

const context = {
  params: Promise.resolve({
    learningRelationshipId: "learning-1",
    nodeId: "node-1",
  }),
};

beforeEach(() => {
  runtime.requireIdentity.mockReset().mockResolvedValue({
    userId: "user-1",
    email: "user@example.com",
    emailVerified: true,
  });
  runtime.getProgress.mockReset();
  runtime.getNodeAssessment.mockReset();
  runtime.submit.mockReset();
});

describe("learning assessment HTTP contract", () => {
  it("returns a question projection without answer fields", async () => {
    const assessment = {
      learningRelationshipId: "learning-1",
      questionSetId: "questions-1",
      versionId: "version-1",
      nodeId: "node-1",
      questions: [
        {
          questionId: "question-1",
          nodeId: "node-1",
          type: "single_choice",
          prompt: "Which statement is supported?",
          options: [
            { optionId: "a", label: "A" },
            { optionId: "b", label: "B" },
          ],
          sourceIds: ["source-1"],
        },
      ],
    };
    runtime.getNodeAssessment.mockResolvedValue(assessment);

    const response = await getNodeAssessment(
      new Request(
        "http://localhost/api/learning-relationships/learning-1/nodes/node-1/assessment",
      ),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual(assessment);
    expect(body.questions[0]).not.toHaveProperty("correctOptionIds");
    expect(body.questions[0]).not.toHaveProperty("explanation");
    expect(runtime.getNodeAssessment).toHaveBeenCalledWith(
      "user-1",
      "learning-1",
      "node-1",
    );
  });
  it("returns matching option sides without exposing pairing answers", async () => {
    const assessment = {
      learningRelationshipId: "learning-1",
      questionSetId: "questions-1",
      versionId: "version-1",
      nodeId: "node-1",
      questions: [
        {
          questionId: "matching-1",
          nodeId: "node-1",
          type: "matching",
          prompt: "Match concepts",
          options: [
            { optionId: "concept-a", label: "Concept A", side: "left" },
            {
              optionId: "description-a",
              label: "Description A",
              side: "right",
            },
          ],
          sourceIds: ["source-1"],
        },
      ],
    };
    runtime.getNodeAssessment.mockResolvedValue(assessment);

    const response = await getNodeAssessment(
      new Request(
        "http://localhost/api/learning-relationships/learning-1/nodes/node-1/assessment",
      ),
      context,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(assessment);
    expect(body.questions[0].options).toEqual(assessment.questions[0].options);
    expect(body.questions[0]).not.toHaveProperty("correctMatches");
  });

  it("submits answers with the idempotency key and returns server scoring", async () => {
    const result = {
      attemptId: "attempt-1",
      learningRelationshipId: "learning-1",
      questionSetId: "questions-1",
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
          explanation: "The source supports A.",
          sourceIds: ["source-1"],
        },
      ],
    };
    runtime.submit.mockResolvedValue(result);
    const answers = [{ questionId: "question-1", selectedOptionIds: ["a"] }];

    const response = await submitNodeAssessment(
      new Request(
        "http://localhost/api/learning-relationships/learning-1/nodes/node-1/assessment",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "submission-1",
          },
          body: JSON.stringify({ answers }),
        },
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(runtime.submit).toHaveBeenCalledWith(
      "user-1",
      "learning-1",
      "node-1",
      "submission-1",
      answers,
    );
  });
  it("returns invalid_request for malformed and empty JSON bodies", async () => {
    for (const body of ["{", ""]) {
      const response = await submitNodeAssessment(
        new Request(
          "http://localhost/api/learning-relationships/learning-1/nodes/node-1/assessment",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "Idempotency-Key": "submission-malformed",
            },
            body,
          },
        ),
        context,
      );
      const payload = (await response.json()) as { error: { code: string } };

      expect(response.status).toBe(400);
      expect(payload.error.code).toBe("invalid_request");
    }
    expect(runtime.submit).not.toHaveBeenCalled();
  });

  it("rejects a submission without an idempotency key before judging", async () => {
    const response = await submitNodeAssessment(
      new Request(
        "http://localhost/api/learning-relationships/learning-1/nodes/node-1/assessment",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            answers: [{ questionId: "question-1", selectedOptionIds: ["a"] }],
          }),
        },
      ),
      context,
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
    expect(runtime.submit).not.toHaveBeenCalled();
  });

  it("returns the persisted progress projection for the relationship", async () => {
    const progress = {
      learningRelationshipId: "learning-1",
      questionSetId: "questions-1",
      versionId: "version-1",
      nodes: [
        {
          nodeId: "node-1",
          bestScore: 8_000,
          completed: true,
          completedAt: "2026-09-02T00:00:00.000Z",
        },
        {
          nodeId: "node-2",
          bestScore: 0,
          completed: false,
          completedAt: null,
        },
      ],
      attempts: [],
    };
    runtime.getProgress.mockResolvedValue(progress);

    const response = await getLearningProgress(
      new Request(
        "http://localhost/api/learning-relationships/learning-1/progress",
      ),
      {
        params: Promise.resolve({ learningRelationshipId: "learning-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(progress);
    expect(runtime.getProgress).toHaveBeenCalledWith("user-1", "learning-1");
  });
});
