import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq } from "drizzle-orm";

import {
  createMapGenerationRuntime,
  createMapGenerationWorkerRuntime,
  type GenerationSource,
  type SourceSearchAccess,
  type StructuredModelAccess,
} from "@/modules/map-generation/public/server";
import { learningMapVersion } from "@/platform/database/catalog-schema";
import {
  generationCheckpoint,
  generationTask,
} from "@/platform/database/generation-schema";
import { user } from "@/platform/database/auth-schema";
import { createPostgresDatabase } from "@/platform/database/postgres";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for map generation integration tests",
  );
}

const { database, pool } = createPostgresDatabase(databaseUrl);
const versions = {
  pipelineVersion: "pipeline-test-v1",
  sourceAdapterVersion: "source-test-v1",
  modelAdapterVersion: "model-test-v1",
};

const sources: readonly GenerationSource[] = Array.from(
  { length: 5 },
  (_, index) => ({
    sourceId: `source-${index}`,
    title: `Source ${index}`,
    excerpt: `Evidence ${index}`,
    url: `https://www.zhihu.com/question/${index}`,
    authorName: `Author ${index}`,
    contentType: "answer" as const,
    updatedAt: 1_700_000_000 + index,
    authorityLevel: "high" as const,
    rankingScore: 1 - index / 10,
  }),
);

function provider(): StructuredModelAccess {
  return {
    async planDirections() {
      return {
        directions: [0, 1, 2].map((index) => ({
          directionId: `direction-${index}`,
          title: `Direction ${index}`,
          objective: `Objective ${index}`,
          searchQuery: `topic ${index}`,
        })),
      };
    },
    async structureMap() {
      return {
        title: "Generated map",
        summary: "Generated summary",
        nodes: sources.map((source, index) => ({
          nodeId: `node-${index}`,
          title: `Node ${index}`,
          learningObjective: `Learn ${index}`,
          sourceIds: [source.sourceId],
        })),
        prerequisites: sources.slice(1).map((_, index) => ({
          nodeId: `node-${index + 1}`,
          prerequisiteNodeId: `node-${index}`,
        })),
      };
    },
    async extractViewpoints() {
      return {
        viewpoints: sources.map((source, index) => ({
          viewpointId: `viewpoint-${index}`,
          nodeId: `node-${index}`,
          kind: "consensus" as const,
          statement: `Statement ${index}`,
          conditions: null,
          sourceIds: [source.sourceId],
        })),
      };
    },
    async generateAssessments() {
      return {
        questions: sources.flatMap((source, index) =>
          [0, 1].map((questionIndex) => ({
            questionId: `question-${index}-${questionIndex}`,
            nodeId: `node-${index}`,
            type: "single_choice" as const,
            prompt: `Question ${index}-${questionIndex}`,
            explanation: `Explanation ${index}-${questionIndex}`,
            options: [
              { optionId: "correct", label: "Correct" },
              { optionId: "wrong", label: "Wrong" },
            ],
            correctOptionIds: ["correct"],
            sourceIds: [source.sourceId],
          })),
        ),
      };
    },
  };
}

function sourceSearch(onQuery?: (query: string) => void): SourceSearchAccess {
  return {
    async search(input) {
      onQuery?.(input.query);
      return { searchId: "search-test", sources };
    },
  };
}

async function insertUser(id: string): Promise<void> {
  await database.insert(user).values({
    id,
    name: id,
    email: `${id}@example.test`,
    emailVerified: true,
  });
}

beforeAll(async () => {
  const migrationsFolder = fileURLToPath(
    new URL("../../drizzle", import.meta.url),
  );
  await migrate(database, { migrationsFolder });
});

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE "learning_map" CASCADE');
  await pool.query('TRUNCATE TABLE "generation_task" CASCADE');
  await pool.query('TRUNCATE TABLE "user" CASCADE');
  await insertUser("user-a");
  await insertUser("user-b");
});

afterAll(async () => {
  await pool.end();
});

describe("map generation persistence", () => {
  it("deduplicates identity, publishes atomically, and isolates participants", async () => {
    let id = 0;
    const idGenerator = () => `id-${id++}`;
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      idGenerator,
    }).generation;
    const worker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: provider(),
      idGenerator,
      sleep: async () => undefined,
    }).worker;

    const [first, second] = await Promise.all([
      generation.requestGeneration("user-a", "  Topic  "),
      generation.requestGeneration("user-b", "topic"),
    ]);
    expect(new Set([first.snapshot.taskId, second.snapshot.taskId]).size).toBe(
      1,
    );
    expect([first.reuse, second.reuse].sort()).toEqual([
      "active_task",
      "created",
    ]);
    expect(await worker.runOnce("worker-1")).toBe(true);

    const completed = await generation.getGeneration(
      "user-a",
      first.snapshot.taskId,
    );
    expect(completed?.status).toBe("succeeded");
    expect(completed?.result?.learningRelationshipId).toBeTruthy();
    expect(Object.keys(completed ?? {}).sort()).toEqual([
      "completedAt",
      "createdAt",
      "deadlineAt",
      "failure",
      "result",
      "sequence",
      "stage",
      "status",
      "taskId",
      "updatedAt",
    ]);
    expect(completed).not.toHaveProperty("topic");
    expect(completed).not.toHaveProperty("normalizedTopic");
    expect(completed).not.toHaveProperty("pipelineVersion");
    expect(completed).not.toHaveProperty("sourceAdapterVersion");
    expect(completed).not.toHaveProperty("modelAdapterVersion");
    expect(completed).not.toHaveProperty("questionSetId");
    expect(
      await generation.getGeneration("user-b", first.snapshot.taskId),
    ).toMatchObject({ status: "succeeded" });
    expect(
      await generation.getGeneration(
        "not-a-participant",
        first.snapshot.taskId,
      ),
    ).toBeNull();
    expect(
      await database
        .select({ id: learningMapVersion.id })
        .from(learningMapVersion),
    ).toHaveLength(1);
    expect(
      await database.select({ id: generationTask.id }).from(generationTask),
    ).toHaveLength(1);

    const cacheHit = await generation.requestGeneration("user-a", "TOPIC");
    expect(cacheHit.reuse).toBe("cache");
    expect(cacheHit.snapshot.result?.learningRelationshipId).toBe(
      completed?.result?.learningRelationshipId,
    );
    expect(cacheHit.snapshot).not.toHaveProperty("topic");
    expect(cacheHit.snapshot).not.toHaveProperty("normalizedTopic");
    expect(cacheHit.snapshot).not.toHaveProperty("questionSetId");

    await pool.query(
      `UPDATE "generation_cache"
       SET "created_at" = NOW() - INTERVAL '6 hours 1 second'
       WHERE "task_id" = $1`,
      [first.snapshot.taskId],
    );
    const expiredCache = await generation.requestGeneration("user-a", "TOPIC");
    expect(expiredCache.reuse).toBe("created");
    expect(expiredCache.snapshot.taskId).not.toBe(first.snapshot.taskId);
  });
  it("honors provider Retry-After without crossing the generation deadline", async () => {
    const delays: number[] = [];
    let planAttempts = 0;
    const baseModel = provider();
    const retryingModel: StructuredModelAccess = {
      ...baseModel,
      async planDirections(input) {
        planAttempts += 1;
        if (planAttempts < 3) {
          throw {
            provider: "model",
            code: "rate_limited",
            retryable: true,
            retryAfterMs: 4_000,
          };
        }
        return baseModel.planDirections(input);
      },
    };
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const worker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: retryingModel,
      idGenerator: () => crypto.randomUUID(),
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    }).worker;
    const created = await generation.requestGeneration(
      "user-a",
      "retry-after topic",
    );

    await worker.runOnce("retry-worker");

    expect(planAttempts).toBe(3);
    expect(delays.slice(0, 2)).toEqual([4_000, 4_000]);
    expect(
      (await generation.getGeneration("user-a", created.snapshot.taskId))
        ?.status,
    ).toBe("succeeded");
  });
  it("keeps external retry attempts across an expired worker lease", async () => {
    const baseTime = new Date("2026-09-02T00:00:00.000Z");
    let expired = false;
    let planAttempts = 0;
    const failingModel: StructuredModelAccess = {
      ...provider(),
      async planDirections() {
        planAttempts += 1;
        expired = true;
        throw {
          provider: "model",
          code: "temporarily_unavailable",
          retryable: true,
        };
      },
    };
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      now: () => baseTime,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const created = await generation.requestGeneration(
      "user-a",
      "takeover retry topic",
    );
    const workerDependencies = {
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: failingModel,
      now: () => new Date(baseTime.getTime() + (expired ? 61_000 : 0)),
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
      scheduleHeartbeat: () => () => undefined,
    };
    const firstWorker =
      createMapGenerationWorkerRuntime(workerDependencies).worker;
    await firstWorker.runOnce("takeover-worker-1");

    const checkpointAfterTakeover = await database
      .select({ attemptCount: generationCheckpoint.attemptCount })
      .from(generationCheckpoint)
      .where(
        and(
          eq(generationCheckpoint.taskId, created.snapshot.taskId),
          eq(generationCheckpoint.stage, "planning"),
          eq(generationCheckpoint.operationKey, "planning"),
        ),
      );
    expect(checkpointAfterTakeover[0]?.attemptCount).toBe(1);

    const secondWorker =
      createMapGenerationWorkerRuntime(workerDependencies).worker;
    await secondWorker.runOnce("takeover-worker-2");

    expect(planAttempts).toBe(3);
    expect(
      (await generation.getGeneration("user-a", created.snapshot.taskId))
        ?.failure?.code,
    ).toBe("model_unavailable");
  });
  it("maps model protocol failures to non-retryable candidate errors", async () => {
    let structureAttempts = 0;
    const baseModel = provider();
    const invalidModel: StructuredModelAccess = {
      ...baseModel,
      async structureMap() {
        structureAttempts += 1;
        throw {
          provider: "model",
          code: "protocol_error",
          retryable: false,
        };
      },
    };
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const worker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: invalidModel,
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
    }).worker;
    const created = await generation.requestGeneration(
      "user-a",
      "protocol failure topic",
    );

    await worker.runOnce("protocol-worker");

    const failed = await generation.getGeneration(
      "user-a",
      created.snapshot.taskId,
    );
    expect(structureAttempts).toBe(1);
    expect(failed?.status).toBe("failed");
    expect(failed?.failure?.code).toBe("candidate_invalid");
  });
  it("reuses a stable topic map identity across provider versions", async () => {
    const firstGeneration = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const firstWorker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: provider(),
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
    }).worker;
    const first = await firstGeneration.requestGeneration(
      "user-a",
      "stable map topic",
    );
    await firstWorker.runOnce("stable-worker-1");

    const secondVersions = {
      ...versions,
      sourceAdapterVersion: "source-test-v2",
    };
    const secondGeneration = createMapGenerationRuntime({
      database,
      providerVersions: secondVersions,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const secondWorker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: secondVersions,
      sourceSearch: sourceSearch(),
      structuredModel: provider(),
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
    }).worker;
    const second = await secondGeneration.requestGeneration(
      "user-a",
      "stable map topic",
    );
    await secondWorker.runOnce("stable-worker-2");

    const published = await database
      .select({
        id: learningMapVersion.id,
        mapId: learningMapVersion.mapId,
      })
      .from(learningMapVersion);
    expect(published).toHaveLength(2);
    expect(new Set(published.map((version) => version.mapId)).size).toBe(1);
    expect(first.snapshot.taskId).not.toBe(second.snapshot.taskId);
  });
  it("renews the lease on an independent fifteen-second heartbeat", async () => {
    let heartbeat: (() => void) | null = null;
    let heartbeatInterval = 0;
    let heartbeatTicks = 0;
    let canceled = false;
    const scheduleHeartbeat = (callback: () => void, milliseconds: number) => {
      heartbeat = () => {
        heartbeatTicks += 1;
        callback();
      };
      heartbeatInterval = milliseconds;
      return () => {
        canceled = true;
        heartbeat = null;
      };
    };
    const baseModel = provider();
    const heartbeatModel: StructuredModelAccess = {
      ...baseModel,
      async planDirections(input) {
        heartbeat?.();
        return baseModel.planDirections(input);
      },
    };
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const worker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: heartbeatModel,
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
      scheduleHeartbeat,
    }).worker;
    const created = await generation.requestGeneration(
      "user-a",
      "heartbeat topic",
    );

    await worker.runOnce("heartbeat-worker");

    expect(heartbeatInterval).toBe(15_000);
    expect(heartbeatTicks).toBeGreaterThan(0);
    expect(canceled).toBe(true);
    expect(
      (await generation.getGeneration("user-a", created.snapshot.taskId))
        ?.status,
    ).toBe("succeeded");
  });
  it("supplements each intermediate node lacking evidence once", async () => {
    const baseModel = provider();
    const incompleteModel: StructuredModelAccess = {
      ...baseModel,
      async structureMap(input) {
        const map = await baseModel.structureMap(input);
        return {
          ...map,
          nodes: map.nodes.map((node, index) =>
            index === 0 ? { ...node, sourceIds: [] } : node,
          ),
        };
      },
    };
    const queries: string[] = [];
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const worker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch((query) => queries.push(query)),
      structuredModel: incompleteModel,
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
    }).worker;
    const created = await generation.requestGeneration(
      "user-a",
      "supplement topic",
    );

    await worker.runOnce("supplement-worker");

    expect(queries).toHaveLength(4);
    expect(
      queries.filter((query) => query === "supplement topic Node 0"),
    ).toHaveLength(1);
    expect(
      (await generation.getGeneration("user-a", created.snapshot.taskId))
        ?.status,
    ).toBe("succeeded");
  });

  it("falls back to a snapshot when the event cursor is outside retention", async () => {
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const created = await generation.requestGeneration(
      "user-a",
      "cursor topic",
    );
    await pool.query(
      'DELETE FROM "generation_event" WHERE "task_id" = $1 AND "sequence" = 1',
      [created.snapshot.taskId],
    );
    const events = await generation.readEvents(
      "user-a",
      created.snapshot.taskId,
      0,
    );
    expect(events?.kind).toBe("snapshot");
  });
});
