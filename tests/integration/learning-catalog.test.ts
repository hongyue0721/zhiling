import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "drizzle" });
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE TABLE "learning_relationship", "featured_learning_map", "learning_viewpoint_source", "learning_viewpoint", "learning_map_node_source", "knowledge_source", "learning_map_prerequisite", "learning_map_node", "learning_map_version", "learning_map", "user" CASCADE',
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
});
