import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { PublishFeaturedLearningMap } from "@/modules/learning-catalog/application/learning-catalog";
import type { LearningMapPublication } from "@/modules/learning-catalog/domain/learning-map";
import {
  DrizzleLearningCatalogRepository,
  LearningMapVersionAlreadyExistsError,
} from "@/modules/learning-catalog/infrastructure/drizzle-learning-catalog";
import {
  featuredLearningMap,
  learningMap,
  learningMapNode,
  learningMapVersion,
  learningRelationship,
  learningViewpointSource,
} from "@/platform/database/catalog-schema";
import {
  learningAssessmentQuestion,
  learningAssessmentQuestionSet,
} from "@/platform/database/assessment-schema";
import { user } from "@/platform/database/auth-schema";
import { createPostgresDatabase } from "@/platform/database/postgres";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for catalog integration tests",
  );
}

const { database, pool } = createPostgresDatabase(databaseUrl);
const repository = new DrizzleLearningCatalogRepository(database);
const publish = new PublishFeaturedLearningMap(repository);

function publication(
  mapId: string,
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
    learningObjective: `Objective ${versionId} ${index}`,
    sourceIds: [sources[index]!.sourceId],
    viewpoints: [
      {
        viewpointId: `viewpoint-${index}`,
        kind: "consensus" as const,
        statement: `Statement ${versionId} ${index}`,
        conditions: null,
        sourceIds: [sources[index]!.sourceId],
      },
    ],
  }));

  return {
    mapId,
    versionId,
    title: `Title ${versionId}`,
    summary: `Summary ${versionId}`,
    featuredPosition,
    sources,
    nodes,
    prerequisites: nodes.slice(1).map((node, index) => ({
      nodeId: node.nodeId,
      prerequisiteNodeId: nodes[index]!.nodeId,
    })),
  };
}

async function insertPublishedQuestionSet(
  questionSetId: string,
  versionId: string,
  questionCountsByNode: Readonly<Record<string, number>>,
): Promise<void> {
  await database.insert(learningAssessmentQuestionSet).values({
    id: questionSetId,
    versionId,
    status: "draft",
    publishedAt: null,
  });
  const questions = Object.entries(questionCountsByNode)
    .flatMap(([nodeId, count]) =>
      Array.from({ length: count }, (_, index) => ({
        questionSetId,
        questionId: `${questionSetId}-${nodeId}-${index}`,
        versionId,
        nodeId,
        type: "single_choice" as const,
        prompt: `Question ${nodeId} ${index}`,
        explanation: `Explanation ${nodeId} ${index}`,
      })),
    )
    .map((question, position) => ({ ...question, position }));
  if (questions.length > 0) {
    await database.insert(learningAssessmentQuestion).values(questions);
  }
  await database
    .update(learningAssessmentQuestionSet)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(learningAssessmentQuestionSet.id, questionSetId));
}

function questionCounts(
  countByNode: Readonly<Record<string, number>> = {},
  defaultCount = 2,
): Record<string, number> {
  return Object.fromEntries(
    Array.from({ length: 5 }, (_, index) => [
      `node-${index}`,
      countByNode[`node-${index}`] ?? defaultCount,
    ]),
  );
}

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "drizzle" });
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE TABLE "learning_relationship", "learning_assessment_question_source", "learning_assessment_question_matching_answer", "learning_assessment_question_correct_option", "learning_assessment_question_option", "learning_assessment_question", "learning_assessment_question_set", "featured_learning_map", "learning_viewpoint_source", "learning_viewpoint", "learning_map_node_source", "knowledge_source", "learning_map_prerequisite", "learning_map_node", "learning_map_version", "learning_map", "user" CASCADE',
  );
});

afterAll(async () => {
  await pool.end();
});

describe("featured learning catalog persistence", () => {
  it("publishes one complete graph and returns a stable evidence projection", async () => {
    const input = publication("map-1", "version-1");
    await publish.execute(input);

    await expect(repository.listFeatured()).resolves.toEqual([
      {
        mapId: "map-1",
        versionId: "version-1",
        title: "Title version-1",
        summary: "Summary version-1",
        nodeCount: 5,
      },
    ]);
    const detail = await repository.findFeatured("map-1");
    expect(detail).toMatchObject({
      mapId: "map-1",
      versionId: "version-1",
      title: "Title version-1",
      summary: "Summary version-1",
    });
    expect(detail?.nodes).toHaveLength(5);
    expect(detail?.nodes[0]).toEqual({
      nodeId: "node-0",
      title: "Node 0",
      learningObjective: "Objective version-1 0",
      sourceIds: ["source-version-1-0"],
    });
    expect(detail?.sources[0]).toEqual({
      sourceId: "source-version-1-0",
      title: "Source 0",
      excerpt: "Evidence 0",
      url: "https://www.zhihu.com/version-1/source/0",
      authorName: "Author 0",
    });
    expect(detail?.viewpoints[0]).toEqual({
      viewpointId: "viewpoint-0",
      nodeId: "node-0",
      kind: "consensus",
      statement: "Statement version-1 0",
      conditions: null,
      sourceIds: ["source-version-1-0"],
    });
    expect(detail?.prerequisites).toEqual([
      { nodeId: "node-1", prerequisiteNodeId: "node-0" },
      { nodeId: "node-2", prerequisiteNodeId: "node-1" },
      { nodeId: "node-3", prerequisiteNodeId: "node-2" },
      { nodeId: "node-4", prerequisiteNodeId: "node-3" },
    ]);
  });

  it("orders the catalog by private featured position without exposing it", async () => {
    await publish.execute(publication("map-later", "version-later", 20));
    await publish.execute(publication("map-first", "version-first", 10));

    const items = await repository.listFeatured();
    expect(items.map(({ mapId }) => mapId)).toEqual(["map-first", "map-later"]);
    expect(items[0]).not.toHaveProperty("position");
  });

  it("hides drafts and published maps without a featured pointer", async () => {
    await database
      .insert(learningMap)
      .values([{ id: "draft-map" }, { id: "non-featured-map" }]);
    await database.insert(learningMapVersion).values([
      {
        id: "draft-version",
        mapId: "draft-map",
        title: "Draft",
        summary: "Hidden",
        status: "draft",
        publishedAt: null,
      },
      {
        id: "non-featured-version",
        mapId: "non-featured-map",
        title: "Published but not featured",
        summary: "Hidden",
        status: "published",
        publishedAt: new Date(),
      },
    ]);
    await expect(
      database.insert(featuredLearningMap).values({
        mapId: "draft-map",
        versionId: "draft-version",
        position: 99,
      }),
    ).rejects.toBeDefined();
    await expect(
      database
        .select({ mapId: featuredLearningMap.mapId })
        .from(featuredLearningMap)
        .where(eq(featuredLearningMap.mapId, "draft-map")),
    ).resolves.toEqual([]);

    await expect(repository.findFeatured("draft-map")).resolves.toBeNull();
    await expect(
      repository.findFeatured("non-featured-map"),
    ).resolves.toBeNull();
    await expect(repository.listFeatured()).resolves.toEqual([]);
  });

  it("switches only the featured pointer and preserves immutable old versions", async () => {
    await publish.execute(publication("map-1", "version-1"));
    await publish.execute(publication("map-1", "version-2"));

    await expect(repository.findFeatured("map-1")).resolves.toMatchObject({
      versionId: "version-2",
      title: "Title version-2",
    });
    const versions = await database
      .select({ id: learningMapVersion.id })
      .from(learningMapVersion)
      .where(eq(learningMapVersion.mapId, "map-1"));
    expect(versions.map(({ id }) => id).sort()).toEqual([
      "version-1",
      "version-2",
    ]);
    await expect(
      database
        .update(learningMapNode)
        .set({ title: "Mutated" })
        .where(eq(learningMapNode.versionId, "version-1")),
    ).rejects.toBeDefined();
    await expect(
      database
        .select({ title: learningMapNode.title })
        .from(learningMapNode)
        .where(
          and(
            eq(learningMapNode.versionId, "version-1"),
            eq(learningMapNode.nodeId, "node-0"),
          ),
        ),
    ).resolves.toEqual([{ title: "Node 0" }]);
    await expect(
      database
        .delete(learningViewpointSource)
        .where(
          and(
            eq(learningViewpointSource.versionId, "version-1"),
            eq(learningViewpointSource.nodeId, "node-0"),
            eq(learningViewpointSource.viewpointId, "viewpoint-0"),
          ),
        ),
    ).rejects.toBeDefined();
    await expect(
      database
        .select({ sourceId: learningViewpointSource.sourceId })
        .from(learningViewpointSource)
        .where(
          and(
            eq(learningViewpointSource.versionId, "version-1"),
            eq(learningViewpointSource.nodeId, "node-0"),
            eq(learningViewpointSource.viewpointId, "viewpoint-0"),
          ),
        ),
    ).resolves.toEqual([{ sourceId: "source-version-1-0" }]);
    await expect(
      publish.execute(publication("map-1", "version-1")),
    ).rejects.toBeInstanceOf(LearningMapVersionAlreadyExistsError);
  });

  it("rolls back every row when the final featured-pointer switch fails", async () => {
    await publish.execute(publication("map-1", "version-1", 1));

    await expect(
      publish.execute(publication("map-2", "version-failed", 1)),
    ).rejects.toBeDefined();
    const failedVersions = await database
      .select({ id: learningMapVersion.id })
      .from(learningMapVersion)
      .where(eq(learningMapVersion.id, "version-failed"));
    const failedMaps = await database
      .select({ id: learningMap.id })
      .from(learningMap)
      .where(eq(learningMap.id, "map-2"));
    expect(failedVersions).toEqual([]);
    expect(failedMaps).toEqual([]);
    await expect(repository.findFeatured("map-2")).resolves.toBeNull();
  });
});

describe("learning relationship persistence", () => {
  it("establishes one account-version relationship and reads through it", async () => {
    await database.insert(user).values([
      {
        id: "user-1",
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
      },
      {
        id: "user-2",
        name: "Other",
        email: "other@example.com",
        emailVerified: true,
      },
    ]);
    await publish.execute(publication("map-1", "version-1"));

    const relationship = await repository.establish("user-1", "version-1");
    const repeated = await repository.establish("user-1", "version-1");

    expect(relationship).toMatchObject({
      mapId: "map-1",
      versionId: "version-1",
    });
    expect(repeated).toEqual(relationship);
    await expect(
      repository.findByLearningRelationship(
        "user-1",
        relationship!.learningRelationshipId,
      ),
    ).resolves.toMatchObject({
      mapId: "map-1",
      versionId: "version-1",
      title: "Title version-1",
    });
    await expect(
      repository.findByLearningRelationship(
        "user-2",
        relationship!.learningRelationshipId,
      ),
    ).resolves.toBeNull();
    await expect(
      database
        .select({ id: learningRelationship.id })
        .from(learningRelationship),
    ).resolves.toHaveLength(1);
  });

  it("rejects an empty published question set without an orphan relationship", async () => {
    await database.insert(user).values({
      id: "user-1",
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
    });
    await publish.execute(publication("map-1", "version-1"));
    await insertPublishedQuestionSet(
      "question-set-empty",
      "version-1",
      questionCounts({}, 0),
    );

    await expect(
      repository.establishFeatured("user-1", "map-1"),
    ).resolves.toBeNull();
    await expect(
      database
        .select({ id: learningRelationship.id })
        .from(learningRelationship),
    ).resolves.toEqual([]);
  });

  it("rejects a published question set missing a map node without an orphan relationship", async () => {
    await database.insert(user).values({
      id: "user-1",
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
    });
    await publish.execute(publication("map-1", "version-1"));
    await insertPublishedQuestionSet(
      "question-set-partial",
      "version-1",
      questionCounts({ "node-0": 2 }, 0),
    );

    await expect(
      repository.establishFeatured("user-1", "map-1"),
    ).resolves.toBeNull();
    await expect(
      database
        .select({ id: learningRelationship.id })
        .from(learningRelationship),
    ).resolves.toEqual([]);
  });

  it("rejects a published question set with an invalid per-node count", async () => {
    await database.insert(user).values({
      id: "user-1",
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
    });
    await publish.execute(publication("map-1", "version-1"));
    await insertPublishedQuestionSet(
      "question-set-invalid",
      "version-1",
      questionCounts({ "node-0": 4, "node-1": 1 }),
    );
    await expect(
      repository.establishFeatured("user-1", "map-1"),
    ).resolves.toBeNull();
    await expect(
      database
        .select({ id: learningRelationship.id })
        .from(learningRelationship),
    ).resolves.toEqual([]);
  });

  it("establishes a complete current featured version idempotently and switches versions safely", async () => {
    await database.insert(user).values({
      id: "user-1",
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
    });
    await publish.execute(publication("map-1", "version-1"));
    await insertPublishedQuestionSet(
      "question-set-1",
      "version-1",
      questionCounts({ "node-0": 3 }),
    );

    const [relationship, repeated] = await Promise.all([
      repository.establishFeatured("user-1", "map-1"),
      repository.establishFeatured("user-1", "map-1"),
    ]);
    expect(relationship).toMatchObject({
      mapId: "map-1",
      versionId: "version-1",
      questionSetId: "question-set-1",
    });
    expect(repeated).toEqual(relationship);
    await expect(
      database
        .select({ id: learningRelationship.id })
        .from(learningRelationship),
    ).resolves.toHaveLength(1);

    await publish.execute(publication("map-1", "version-2"));
    await expect(
      repository.establishFeatured("user-1", "map-1"),
    ).resolves.toBeNull();
    await expect(
      database
        .select({
          versionId: learningRelationship.versionId,
          questionSetId: learningRelationship.questionSetId,
        })
        .from(learningRelationship),
    ).resolves.toEqual([
      { versionId: "version-1", questionSetId: "question-set-1" },
    ]);

    await insertPublishedQuestionSet(
      "question-set-2",
      "version-2",
      questionCounts(),
    );
    const current = await repository.establishFeatured("user-1", "map-1");
    expect(current).toMatchObject({
      mapId: "map-1",
      versionId: "version-2",
      questionSetId: "question-set-2",
    });
    await expect(
      database
        .select({ versionId: learningRelationship.versionId })
        .from(learningRelationship)
        .orderBy(asc(learningRelationship.versionId)),
    ).resolves.toEqual([
      { versionId: "version-1" },
      { versionId: "version-2" },
    ]);
  });

  it("lists only the account's published relationships in a stable order", async () => {
    await database.insert(user).values([
      {
        id: "user-1",
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
      },
      {
        id: "user-2",
        name: "Other",
        email: "other@example.com",
        emailVerified: true,
      },
    ]);
    await publish.execute(publication("map-1", "version-1", 1));
    await publish.execute(publication("map-2", "version-2", 2));

    await repository.establish("user-1", "version-1");
    await repository.establish("user-1", "version-2");
    await repository.establish("user-2", "version-1");

    const first = await repository.listLearningRelationships("user-1");
    const second = await repository.listLearningRelationships("user-1");

    expect(first).toEqual(second);
    expect(first).toEqual(
      expect.arrayContaining([
        {
          learningRelationshipId: expect.any(String),
          mapId: "map-1",
          versionId: "version-1",
          title: "Title version-1",
          summary: "Summary version-1",
        },
        {
          learningRelationshipId: expect.any(String),
          mapId: "map-2",
          versionId: "version-2",
          title: "Title version-2",
          summary: "Summary version-2",
        },
      ]),
    );
    expect(first).toHaveLength(2);
    expect(first[0]).not.toHaveProperty("userId");
    expect(first[0]).not.toHaveProperty("questionSetId");
  });
});
