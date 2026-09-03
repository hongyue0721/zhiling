import { describe, expect, it } from "vitest";

import {
  LearningReportInvariantError,
  projectPrivateLearningReport,
  type LearningReportInput,
} from "./learning-report";

function reportInput(): LearningReportInput {
  return {
    requestedLearningRelationshipId: "learning-1",
    map: {
      mapId: "map-1",
      versionId: "version-1",
      title: "TypeScript",
      nodes: [
        {
          nodeId: "node-foundation",
          title: "基础",
          learningObjective: "理解类型系统基础",
          sourceIds: ["source-foundation"],
        },
        {
          nodeId: "node-generics",
          title: "泛型",
          learningObjective: "使用泛型表达约束",
          sourceIds: ["source-generics"],
        },
        {
          nodeId: "node-narrowing",
          title: "类型收窄",
          learningObjective: "安全地收窄联合类型",
          sourceIds: ["source-narrowing"],
        },
      ],
      prerequisites: [
        {
          nodeId: "node-generics",
          prerequisiteNodeId: "node-foundation",
        },
        {
          nodeId: "node-narrowing",
          prerequisiteNodeId: "node-foundation",
        },
      ],
      sources: [
        {
          sourceId: "source-foundation",
          title: "基础来源",
          url: "https://www.zhihu.com/question/foundation",
          authorName: "作者甲",
        },
        {
          sourceId: "source-generics",
          title: "泛型来源",
          url: "https://www.zhihu.com/question/generics",
          authorName: "作者乙",
        },
        {
          sourceId: "source-narrowing",
          title: "收窄来源",
          url: "https://www.zhihu.com/question/narrowing",
          authorName: "作者丙",
        },
      ],
      viewpoints: [
        {
          viewpointId: "viewpoint-foundation",
          nodeId: "node-foundation",
          kind: "consensus",
          statement: "类型检查应尽早反馈错误",
          conditions: null,
          sourceIds: ["source-foundation"],
        },
        {
          viewpointId: "viewpoint-generics",
          nodeId: "node-generics",
          kind: "practical_experience",
          statement: "泛型约束应表达真实调用要求",
          conditions: "公共库接口",
          sourceIds: ["source-generics"],
        },
        {
          viewpointId: "viewpoint-narrowing",
          nodeId: "node-narrowing",
          kind: "supplementary",
          statement: "判别字段可以简化类型收窄",
          conditions: null,
          sourceIds: ["source-narrowing"],
        },
      ],
    },
    progress: {
      learningRelationshipId: "learning-1",
      versionId: "version-1",
      questionSetId: "questions-1",
      nodes: [
        { nodeId: "node-foundation", bestScore: 9_000, completed: true },
        { nodeId: "node-generics", bestScore: 6_000, completed: false },
        { nodeId: "node-narrowing", bestScore: 0, completed: false },
      ],
      attempts: [{ nodeId: "node-generics" }, { nodeId: "node-foundation" }],
    },
  };
}

describe("private learning report projection", () => {
  it("derives completion, weak nodes, encountered viewpoints and actionable next steps", () => {
    const report = projectPrivateLearningReport(reportInput());

    expect(report).toMatchObject({
      learningRelationshipId: "learning-1",
      map: {
        mapId: "map-1",
        versionId: "version-1",
        title: "TypeScript",
      },
      questionSetId: "questions-1",
      completion: {
        completedNodeCount: 1,
        totalNodeCount: 3,
        completionBasisPoints: 3_333,
      },
      weakNodes: [
        {
          nodeId: "node-generics",
          title: "泛型",
          bestScore: 6_000,
          sourceIds: ["source-generics"],
        },
      ],
    });
    expect(
      report.encounteredViewpoints.map(({ viewpointId }) => viewpointId),
    ).toEqual(["viewpoint-foundation", "viewpoint-generics"]);
    expect(report.nextSteps).toEqual([
      {
        nodeId: "node-generics",
        title: "泛型",
        learningObjective: "使用泛型表达约束",
        reason: "improve_score",
        sourceIds: ["source-generics"],
      },
      {
        nodeId: "node-narrowing",
        title: "类型收窄",
        learningObjective: "安全地收窄联合类型",
        reason: "start_node",
        sourceIds: ["source-narrowing"],
      },
    ]);
    expect(report.sources.map(({ sourceId }) => sourceId)).toEqual([
      "source-foundation",
      "source-generics",
      "source-narrowing",
    ]);
    expect(report).not.toHaveProperty("attempts");
    expect(JSON.stringify(report)).not.toContain("attemptId");
  });

  it("keeps locked nodes out of next steps until every prerequisite is complete", () => {
    const input = reportInput();
    const blockedInput: LearningReportInput = {
      ...input,
      progress: {
        ...input.progress,
        nodes: input.progress.nodes.map((node) => ({
          ...node,
          bestScore: 0,
          completed: false,
        })),
      },
    };

    const report = projectPrivateLearningReport(blockedInput);

    expect(report.nextSteps.map(({ nodeId }) => nodeId)).toEqual([
      "node-foundation",
    ]);
  });

  it("rejects facts from a different relationship or immutable map version", () => {
    const input = reportInput();

    expect(() =>
      projectPrivateLearningReport({
        ...input,
        progress: { ...input.progress, learningRelationshipId: "learning-2" },
      }),
    ).toThrow(LearningReportInvariantError);
    expect(() =>
      projectPrivateLearningReport({
        ...input,
        progress: { ...input.progress, versionId: "version-2" },
      }),
    ).toThrow(LearningReportInvariantError);
  });

  it("rejects malformed persisted facts instead of emitting an invalid report", () => {
    const input = reportInput();
    const progressWithInvalidScore: LearningReportInput = {
      ...input,
      progress: {
        ...input.progress,
        nodes: input.progress.nodes.map((node) =>
          node.nodeId === "node-generics"
            ? { ...node, bestScore: 10_001 }
            : node,
        ),
      },
    };
    const progressWithInconsistentCompletion: LearningReportInput = {
      ...input,
      progress: {
        ...input.progress,
        nodes: input.progress.nodes.map((node) =>
          node.nodeId === "node-generics"
            ? { ...node, bestScore: 8_000, completed: false }
            : node,
        ),
      },
    };
    const mapWithUnknownSource: LearningReportInput = {
      ...input,
      map: {
        ...input.map,
        nodes: input.map.nodes.map((node) =>
          node.nodeId === "node-generics"
            ? { ...node, sourceIds: ["missing-source"] }
            : node,
        ),
      },
    };
    const mapWithCyclicPrerequisites: LearningReportInput = {
      ...input,
      map: {
        ...input.map,
        prerequisites: [
          { nodeId: "node-generics", prerequisiteNodeId: "node-narrowing" },
          { nodeId: "node-narrowing", prerequisiteNodeId: "node-generics" },
        ],
      },
    };

    for (const candidate of [
      progressWithInvalidScore,
      progressWithInconsistentCompletion,
      mapWithUnknownSource,
      mapWithCyclicPrerequisites,
    ]) {
      expect(() => projectPrivateLearningReport(candidate)).toThrow(
        LearningReportInvariantError,
      );
    }
  });

  it("returns a projection whose nested arrays do not alias persisted facts", () => {
    const input = reportInput();
    const report = projectPrivateLearningReport(input);
    const mutableReport = report as unknown as {
      weakNodes: Array<{ sourceIds: string[] }>;
      encounteredViewpoints: Array<{ sourceIds: string[] }>;
      sources: Array<{ title: string }>;
    };

    mutableReport.weakNodes[0]!.sourceIds.push("report-only");
    mutableReport.encounteredViewpoints[0]!.sourceIds.push("report-only");
    mutableReport.sources[0]!.title = "report-only";

    expect(input.map.nodes[1]?.sourceIds).toEqual(["source-generics"]);
    expect(input.map.viewpoints[0]?.sourceIds).toEqual(["source-foundation"]);
    expect(input.map.sources[0]?.title).toBe("基础来源");
  });
});
