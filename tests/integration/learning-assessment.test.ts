import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { PublishFeaturedLearningMap } from "@/modules/learning-catalog/application/learning-catalog";
import type { LearningMapPublication } from "@/modules/learning-catalog/domain/learning-map";
import { DrizzleLearningCatalogRepository } from "@/modules/learning-catalog/infrastructure/drizzle-learning-catalog";
import { DrizzleLearningAssessmentRepository } from "@/modules/learning-assessment/infrastructure/drizzle-learning-assessment";
import type {
  AssessmentQuestionPublication,
  LearningAssessmentQuestionSetPublication,
} from "@/modules/learning-assessment/domain/assessment";
import { DrizzleLearningProgressRepository } from "@/modules/learning-progress/infrastructure/drizzle-learning-progress";
import {
  learningAssessmentAttempt,
  learningAssessmentQuestion,
  learningAssessmentQuestionSet,
} from "@/platform/database/assessment-schema";
import { user } from "@/platform/database/auth-schema";
import { createPostgresDatabase } from "@/platform/database/postgres";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for assessment integration tests",
  );
}

const { database, pool } = createPostgresDatabase(databaseUrl);
const catalog = new DrizzleLearningCatalogRepository(database);
const publishMap = new PublishFeaturedLearningMap(catalog);
const assessment = new DrizzleLearningAssessmentRepository(database);
const progress = new DrizzleLearningProgressRepository(database);

function publication(
  versionId: string,
  featuredPosition = 1,
): LearningMapPublication {
  const sources = Array.from({ length: 5 }, (_, index) => ({
    sourceId: `source-${versionId}-${index}`,
    title: `Source ${index}`,
    excerpt: `Evidence ${index}`,
    url: `https://www.zhihu.com/${versionId}/source/${index}`,
    authorName: `Author ${index}`,
  }));
  const nodes = Array.from({ length: 5 }, (_, index) => ({
    nodeId: `node-${index}`,
    title: `Node ${index}`,
    learningObjective: `Objective ${index}`,
    sourceIds: [sources[index]!.sourceId],
    viewpoints: [],
  }));
  return {
    mapId: `map-${versionId}`,
    versionId,
    title: `Map ${versionId}`,
    summary: `Summary ${versionId}`,
    featuredPosition,
    sources,
    nodes,
    prerequisites: [],
  };
}
function questionSet(
  versionId: string,
  sourceVersionId = versionId,
): LearningAssessmentQuestionSetPublication {
  return {
    questionSetId: `question-set-${versionId}`,
    versionId,
    questions: Array.from({ length: 5 }, (_, nodeIndex) => {
      const sourceId = `source-${sourceVersionId}-${nodeIndex}`;
      const questions: AssessmentQuestionPublication[] = [
        {
          questionId: `question-${nodeIndex}-single`,
          nodeId: `node-${nodeIndex}`,
          type: "single_choice",
          prompt: "Choose the supported statement",
          explanation: "The source supports option A.",
          options: [
            { optionId: "a", label: "A" },
            { optionId: "b", label: "B" },
          ],
          correctOptionIds: ["a"],
          sourceIds: [sourceId],
        },
        {
          questionId: `question-${nodeIndex}-multiple`,
          nodeId: `node-${nodeIndex}`,
          type: "multiple_choice",
          prompt: "Choose all supported statements",
          explanation: "Three statements are supported by the source.",
          options: [
            { optionId: "a", label: "A" },
            { optionId: "b", label: "B" },
            { optionId: "c", label: "C" },
            { optionId: "d", label: "D" },
            { optionId: "e", label: "E" },
          ],
          correctOptionIds: ["a", "b", "c", "d", "e"],
          sourceIds: [sourceId],
        },
      ];
      if (nodeIndex === 2) {
        questions.push({
          questionId: `question-${nodeIndex}-matching`,
          nodeId: `node-${nodeIndex}`,
          type: "matching",
          prompt: "Match each concept to its description",
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
          sourceIds: [sourceId],
        });
      }
      return questions;
    }).flat(),
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

async function createRelationship(versionId = "version-1") {
  await database.insert(user).values({
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
  });
  await publishMap.execute(publication(versionId));
  await assessment.publishQuestionSet(questionSet(versionId));
  const relationship = await catalog.establish("user-1", versionId);
  if (!relationship) {
    throw new Error("expected relationship");
  }
  return relationship;
}

describe("learning assessment persistence", () => {
  it("returns a safe question projection and records idempotent attempts", async () => {
    const relationship = await createRelationship();
    const nodeAssessment = await assessment.findNodeAssessment(
      "user-1",
      relationship.learningRelationshipId,
      "version-1",
      "node-0",
    );
    expect(nodeAssessment?.questions).toHaveLength(2);
    expect(nodeAssessment?.questions[0]).not.toHaveProperty("correctOptionIds");
    expect(nodeAssessment?.questions[0]).not.toHaveProperty("explanation");

    const matchingAssessment = await assessment.findNodeAssessment(
      "user-1",
      relationship.learningRelationshipId,
      "version-1",
      "node-2",
    );
    expect(matchingAssessment?.questions[2]?.options).toEqual([
      { optionId: "concept-a", label: "Concept A", side: "left" },
      { optionId: "concept-b", label: "Concept B", side: "left" },
      { optionId: "description-a", label: "Description A", side: "right" },
      { optionId: "description-b", label: "Description B", side: "right" },
    ]);
    expect(matchingAssessment?.questions[2]).not.toHaveProperty(
      "correctMatches",
    );

    const answers = [
      { questionId: "question-0-single", selectedOptionIds: ["a"] },
      {
        questionId: "question-0-multiple",
        selectedOptionIds: ["a", "b", "c"],
      },
    ];
    const submission = {
      userId: "user-1",
      learningRelationshipId: relationship.learningRelationshipId,
      versionId: "version-1",
      nodeId: "node-0",
      idempotencyKey: "attempt-key-1",
      answers,
    };
    const [result, repeated] = await Promise.all([
      assessment.submit(submission),
      assessment.submit(submission),
    ]);
    expect(result).toMatchObject({
      nodeScore: 8_000,
      bestScore: 8_000,
      completed: true,
    });
    expect(repeated).toEqual(result);
    await expect(
      database
        .select({ id: learningAssessmentAttempt.id })
        .from(learningAssessmentAttempt),
    ).resolves.toHaveLength(1);
  });

  it("scopes idempotency by node", async () => {
    const relationship = await createRelationship();
    const nodeZeroAnswers = [
      { questionId: "question-0-single", selectedOptionIds: ["a"] },
      {
        questionId: "question-0-multiple",
        selectedOptionIds: ["a", "b", "c"],
      },
    ];
    const nodeOneAnswers = [
      { questionId: "question-1-single", selectedOptionIds: ["a"] },
      {
        questionId: "question-1-multiple",
        selectedOptionIds: ["a", "b", "c"],
      },
    ];
    const [nodeZero, nodeOne] = await Promise.all([
      assessment.submit({
        userId: "user-1",
        learningRelationshipId: relationship.learningRelationshipId,
        versionId: "version-1",
        nodeId: "node-0",
        idempotencyKey: "same-key",
        answers: nodeZeroAnswers,
      }),
      assessment.submit({
        userId: "user-1",
        learningRelationshipId: relationship.learningRelationshipId,
        versionId: "version-1",
        nodeId: "node-1",
        idempotencyKey: "same-key",
        answers: nodeOneAnswers,
      }),
    ]);

    expect(nodeZero?.nodeId).toBe("node-0");
    expect(nodeOne?.nodeId).toBe("node-1");
    expect(nodeZero?.questions).toHaveLength(2);
    expect(nodeOne?.questions).toHaveLength(2);
    await expect(
      database
        .select({ id: learningAssessmentAttempt.id })
        .from(learningAssessmentAttempt),
    ).resolves.toHaveLength(2);

    await expect(
      assessment.submit({
        userId: "user-1",
        learningRelationshipId: relationship.learningRelationshipId,
        versionId: "version-1",
        nodeId: "node-0",
        idempotencyKey: "same-key",
        answers: nodeZeroAnswers,
      }),
    ).resolves.toEqual(nodeZero);
    await expect(
      assessment.submit({
        userId: "user-1",
        learningRelationshipId: relationship.learningRelationshipId,
        versionId: "version-1",
        nodeId: "node-1",
        idempotencyKey: "same-key",
        answers: nodeOneAnswers,
      }),
    ).resolves.toEqual(nodeOne);
  });

  it("takes the maximum score and never regresses completion", async () => {
    const relationship = await createRelationship();
    const lowAnswers = [
      { questionId: "question-0-single", selectedOptionIds: ["b"] },
      { questionId: "question-0-multiple", selectedOptionIds: ["a", "d"] },
    ];
    const highAnswers = [
      { questionId: "question-0-single", selectedOptionIds: ["a"] },
      { questionId: "question-0-multiple", selectedOptionIds: ["a", "b", "c"] },
    ];
    const low = await assessment.submit({
      userId: "user-1",
      learningRelationshipId: relationship.learningRelationshipId,
      versionId: "version-1",
      nodeId: "node-0",
      idempotencyKey: "low",
      answers: lowAnswers,
    });
    const high = await assessment.submit({
      userId: "user-1",
      learningRelationshipId: relationship.learningRelationshipId,
      versionId: "version-1",
      nodeId: "node-0",
      idempotencyKey: "high",
      answers: highAnswers,
    });
    const lowerAfterCompletion = await assessment.submit({
      userId: "user-1",
      learningRelationshipId: relationship.learningRelationshipId,
      versionId: "version-1",
      nodeId: "node-0",
      idempotencyKey: "low-after-high",
      answers: lowAnswers,
    });
    expect(low?.bestScore).toBe(2_000);
    expect(high?.bestScore).toBe(8_000);
    expect(lowerAfterCompletion).toMatchObject({
      nodeScore: 2_000,
      bestScore: 8_000,
      completed: true,
    });
  });

  it("rejects source/version mismatches and restores progress history", async () => {
    const relationship = await createRelationship("version-1");
    await publishMap.execute(publication("version-2", 2));
    await expect(
      assessment.publishQuestionSet(questionSet("version-2", "version-1")),
    ).rejects.toThrow("assessment_source_not_in_node");

    await assessment.submit({
      userId: "user-1",
      learningRelationshipId: relationship.learningRelationshipId,
      versionId: "version-1",
      nodeId: "node-0",
      idempotencyKey: "restored-attempt",
      answers: [
        { questionId: "question-0-single", selectedOptionIds: ["b"] },
        {
          questionId: "question-0-multiple",
          selectedOptionIds: ["a", "d"],
        },
      ],
    });
    const summary = await progress.find(
      "user-1",
      relationship!.learningRelationshipId,
      "version-1",
      ["node-0", "node-1"],
    );
    expect(summary?.nodes).toHaveLength(2);
    expect(summary?.nodes[0]).toMatchObject({
      bestScore: 2_000,
      completed: false,
    });
    expect(summary?.attempts).toHaveLength(1);
    expect(summary?.attempts[0]).toMatchObject({
      nodeId: "node-0",
      nodeScore: 2_000,
    });
  });

  it("binds a published question set when an existing relationship is resumed", async () => {
    await database.insert(user).values({
      id: "user-1",
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
    });
    await publishMap.execute(publication("version-1"));
    const beforeQuestionSet = await catalog.establish("user-1", "version-1");
    expect(beforeQuestionSet?.questionSetId).toBeNull();

    await assessment.publishQuestionSet(questionSet("version-1"));
    const resumed = await catalog.establish("user-1", "version-1");

    expect(resumed).toMatchObject({
      learningRelationshipId: beforeQuestionSet?.learningRelationshipId,
      questionSetId: "question-set-version-1",
    });
  });

  it("keeps published question rows immutable", async () => {
    await createRelationship();
    await expect(
      database
        .update(learningAssessmentQuestion)
        .set({ prompt: "mutated" })
        .where(eq(learningAssessmentQuestion.questionId, "question-0-single")),
    ).rejects.toBeDefined();
    await expect(
      database
        .delete(learningAssessmentQuestionSet)
        .where(eq(learningAssessmentQuestionSet.id, "question-set-version-1")),
    ).rejects.toBeDefined();
  });
});
