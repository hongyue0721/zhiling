import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormalIdentityRequiredError } from "@/modules/identity/public/server";

const runtime = vi.hoisted(() => ({
  requireIdentity: vi.fn(),
  getReport: vi.fn(),
}));

vi.mock("@/bootstrap/server", () => ({
  identity: { require: runtime.requireIdentity },
  learningReport: { get: runtime.getReport },
}));

import { GET as getLearningReport } from "@/app/api/learning-relationships/[learningRelationshipId]/report/route";

const context = {
  params: Promise.resolve({ learningRelationshipId: "learning-1" }),
};

const report = {
  learningRelationshipId: "learning-1",
  map: {
    mapId: "map-1",
    versionId: "version-1",
    title: "TypeScript",
  },
  questionSetId: "questions-1",
  completion: {
    completedNodeCount: 1,
    totalNodeCount: 2,
    completionBasisPoints: 5_000,
  },
  weakNodes: [
    {
      nodeId: "node-2",
      title: "泛型",
      bestScore: 6_000,
      sourceIds: ["source-2"],
    },
  ],
  encounteredViewpoints: [
    {
      viewpointId: "viewpoint-1",
      nodeId: "node-1",
      kind: "consensus",
      statement: "类型检查应尽早反馈错误",
      conditions: null,
      sourceIds: ["source-1"],
    },
  ],
  nextSteps: [
    {
      nodeId: "node-2",
      title: "泛型",
      learningObjective: "使用泛型表达约束",
      reason: "improve_score",
      sourceIds: ["source-2"],
    },
  ],
  sources: [
    {
      sourceId: "source-1",
      title: "基础来源",
      url: "https://www.zhihu.com/question/foundation",
      authorName: "作者甲",
    },
    {
      sourceId: "source-2",
      title: "泛型来源",
      url: "https://www.zhihu.com/question/generics",
      authorName: "作者乙",
    },
  ],
};

beforeEach(() => {
  runtime.requireIdentity.mockReset().mockResolvedValue({
    userId: "user-1",
    email: "user@example.com",
    emailVerified: true,
  });
  runtime.getReport.mockReset();
});

describe("private learning report HTTP contract", () => {
  it("returns the account report without internal identity or attempt details", async () => {
    runtime.getReport.mockResolvedValue(report);

    const response = await getLearningReport(
      new Request(
        "http://localhost/api/learning-relationships/learning-1/report",
      ),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual(report);
    expect(runtime.getReport).toHaveBeenCalledWith("user-1", "learning-1");
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("attempts");
    expect(JSON.stringify(body)).not.toContain("session");
  });

  it("uses the same safe not-found response for a missing or foreign relationship", async () => {
    runtime.getReport.mockResolvedValue(null);

    for (const learningRelationshipId of [
      "learning-other",
      "learning-missing",
    ]) {
      const response = await getLearningReport(
        new Request(
          `http://localhost/api/learning-relationships/${learningRelationshipId}/report`,
        ),
        {
          params: Promise.resolve({ learningRelationshipId }),
        },
      );
      const body = (await response.json()) as {
        error: { code: string; message: string; requestId: string };
      };

      expect(response.status).toBe(404);
      expect(body.error.code).toBe("resource_not_found");
      expect(body.error.message).not.toContain(learningRelationshipId);
      expect(body.error.requestId).toMatch(/^req_[0-9a-f]{32}$/);
    }

    expect(runtime.getReport).toHaveBeenNthCalledWith(
      1,
      "user-1",
      "learning-other",
    );
    expect(runtime.getReport).toHaveBeenNthCalledWith(
      2,
      "user-1",
      "learning-missing",
    );
  });

  it("rejects unauthenticated reads before resolving a report", async () => {
    runtime.requireIdentity.mockRejectedValue(
      new FormalIdentityRequiredError(),
    );

    const response = await getLearningReport(
      new Request(
        "http://localhost/api/learning-relationships/learning-1/report",
      ),
      context,
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("authentication_required");
    expect(runtime.getReport).not.toHaveBeenCalled();
  });
});
