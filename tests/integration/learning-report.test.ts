import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { PublishFeaturedLearningMap } from "@/modules/learning-catalog/application/learning-catalog";
import type { LearningMapPublication } from "@/modules/learning-catalog/domain/learning-map";
import { DrizzleLearningCatalogRepository } from "@/modules/learning-catalog/infrastructure/drizzle-learning-catalog";
import { createLearningCatalogRuntime } from "@/modules/learning-catalog/public/server";
import { createLearningAssessmentRuntime } from "@/modules/learning-assessment/public/server";
import type { LearningAssessmentQuestionSetPublication } from "@/modules/learning-assessment/domain/assessment";
import { createLearningProgressRuntime } from "@/modules/learning-progress/public/server";
import { createLearningReportRuntime } from "@/modules/learning-report/public/server";
import { user } from "@/platform/database/auth-schema";
import { createPostgresDatabase } from "@/platform/database/postgres";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for report integration tests");
}

const { database, pool } = createPostgresDatabase(databaseUrl);
const catalogRepository = new DrizzleLearningCatalogRepository(database);
const publishMap = new PublishFeaturedLearningMap(catalogRepository);
const catalogRuntime = createLearningCatalogRuntime({ database });
const assessmentRuntime = createLearningAssessmentRuntime({
  database,
  mapReader: catalogRuntime.catalog,
});
const progressRuntime = createLearningProgressRuntime({
  database,
  mapReader: catalogRuntime.catalog,
});
const reportRuntime = createLearningReportRuntime({
  mapReader: catalogRuntime.catalog,
  progressReader: progressRuntime.progress,
});

function publication(versionId: string): LearningMapPublication {
  const sources = Array.from({ length: 5 }, (_, index) => ({
    sourceId: `source-${versionId}-${index}`,
    title: `来源 ${versionId}-${index}`,
    excerpt: `证据 ${versionId}-${index}`,
    url: `https://www.zhihu.com/question/${versionId}-${index}`,
    authorName: `作者 ${index}`,
  }));
  return {
    mapId: "map-report",
    versionId,
    title: `报告地图 ${versionId}`,
    summary: `摘要 ${versionId}`,
    featuredPosition: 1,
    sources,
    nodes: sources.map((source, index) => ({
      nodeId: `node-${index}`,
      title: `节点 ${index}`,
      learningObjective: `掌握节点 ${index}`,
      sourceIds: [source.sourceId],
      viewpoints: [
        {
          viewpointId: `viewpoint-${versionId}-${index}`,
          kind: "consensus",
          statement: `观点 ${versionId}-${index}`,
          conditions: null,
          sourceIds: [source.sourceId],
        },
      ],
    })),
    prerequisites: Array.from({ length: 4 }, (_, index) => ({
      nodeId: `node-${index + 1}`,
      prerequisiteNodeId: `node-${index}`,
    })),
  };
}

function questionSet(
  versionId: string,
): LearningAssessmentQuestionSetPublication {
  return {
    questionSetId: `questions-${versionId}`,
    versionId,
    questions: Array.from({ length: 5 }, (_, nodeIndex) =>
      Array.from({ length: 2 }, (_, questionIndex) => ({
        questionId: `question-${versionId}-${nodeIndex}-${questionIndex}`,
        nodeId: `node-${nodeIndex}`,
        type: "single_choice" as const,
        prompt: `节点 ${nodeIndex} 的结论 ${questionIndex} 是什么？`,
        explanation: `来源 ${versionId}-${nodeIndex} 支持选项 A。`,
        options: [
          { optionId: "a", label: "A" },
          { optionId: "b", label: "B" },
        ],
        correctOptionIds: ["a"],
        sourceIds: [`source-${versionId}-${nodeIndex}`],
      })),
    ).flat(),
  };
}

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "drizzle" });
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE TABLE "learning_relationship", "learning_assessment_attempt", "learning_progress_node", "learning_assessment_question_source", "learning_assessment_question_matching_answer", "learning_assessment_question_correct_option", "learning_assessment_question_option", "learning_assessment_question", "learning_assessment_question_set", "featured_learning_map", "learning_viewpoint_source", "learning_viewpoint", "learning_map_node_source", "knowledge_source", "learning_map_prerequisite", "learning_map_node", "learning_map_version", "learning_map", "user" CASCADE',
  );
});

afterAll(async () => {
  await pool.end();
});

describe("private learning report integration", () => {
  it("projects the owner's pinned versions and hides the relationship from another account", async () => {
    await database.insert(user).values([
      {
        id: "owner",
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
      },
      {
        id: "other-user",
        name: "Other",
        email: "other@example.com",
        emailVerified: true,
      },
    ]);
    await publishMap.execute(publication("version-1"));
    await assessmentRuntime.assessment.publishQuestionSet(
      questionSet("version-1"),
    );
    const relationship =
      await catalogRuntime.catalog.establishLearningRelationship(
        "owner",
        "version-1",
      );
    if (!relationship) {
      throw new Error("expected owner learning relationship");
    }
    await publishMap.execute(publication("version-2"));
    await assessmentRuntime.assessment.submit(
      "owner",
      relationship.learningRelationshipId,
      "node-0",
      "partial-attempt",
      [
        {
          questionId: "question-version-1-0-0",
          selectedOptionIds: ["a"],
        },
        {
          questionId: "question-version-1-0-1",
          selectedOptionIds: ["b"],
        },
      ],
    );

    const report = await reportRuntime.report.get(
      "owner",
      relationship.learningRelationshipId,
    );
    const foreignReport = await reportRuntime.report.get(
      "other-user",
      relationship.learningRelationshipId,
    );

    expect(report).toMatchObject({
      learningRelationshipId: relationship.learningRelationshipId,
      map: {
        mapId: "map-report",
        versionId: "version-1",
        title: "报告地图 version-1",
      },
      questionSetId: "questions-version-1",
      completion: {
        completedNodeCount: 0,
        totalNodeCount: 5,
        completionBasisPoints: 0,
      },
      weakNodes: [
        {
          nodeId: "node-0",
          bestScore: 5_000,
          sourceIds: ["source-version-1-0"],
        },
      ],
      encounteredViewpoints: [
        {
          viewpointId: "viewpoint-version-1-0",
          nodeId: "node-0",
          sourceIds: ["source-version-1-0"],
        },
      ],
      nextSteps: [
        {
          nodeId: "node-0",
          reason: "improve_score",
          sourceIds: ["source-version-1-0"],
        },
      ],
      sources: [
        {
          sourceId: "source-version-1-0",
          url: "https://www.zhihu.com/question/version-1-0",
        },
      ],
    });
    expect(report?.sources.map(({ sourceId }) => sourceId)).toEqual([
      "source-version-1-0",
    ]);
    expect(
      report?.sources.some(({ sourceId }) => sourceId.includes("version-2")),
    ).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(
      /(?:attemptId|answers|userId|session)/,
    );
    expect(foreignReport).toBeNull();
  });
});
