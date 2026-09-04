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
  generationCache,
  generationCheckpoint,
  generationEvent,
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

const testRateLimit = {
  windowSeconds: 3600,
  maxRequests: 100,
} as const;

const sources: readonly GenerationSource[] = Array.from(
  { length: 6 },
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
    async generateAssessments(input) {
      const targetNodeIds =
        input.targetNodeIds ??
        sources.map(({ sourceId }) => sourceId.replace("source-", "node-"));
      const targetNodeSet = new Set(targetNodeIds);
      return {
        questions: sources
          .flatMap((source, index) =>
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
          )
          .filter(({ nodeId }) => targetNodeSet.has(nodeId)),
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
      rateLimit: testRateLimit,
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
    const staleCacheRows = await database
      .select({ createdAt: generationCache.createdAt })
      .from(generationCache)
      .where(eq(generationCache.taskId, first.snapshot.taskId));
    expect(staleCacheRows).toHaveLength(1);
    const staleCacheCreatedAt = staleCacheRows[0]!.createdAt;

    await worker.runOnce("worker-2");
    const replacedCacheRows = await database
      .select({
        taskId: generationCache.taskId,
        mapId: generationCache.mapId,
        versionId: generationCache.versionId,
        questionSetId: generationCache.questionSetId,
        createdAt: generationCache.createdAt,
      })
      .from(generationCache);
    expect(replacedCacheRows).toHaveLength(1);
    expect(replacedCacheRows[0]).toMatchObject({
      taskId: expiredCache.snapshot.taskId,
      mapId: completed?.result?.mapId,
    });
    expect(new Date(replacedCacheRows[0]!.createdAt).getTime()).toBeGreaterThan(
      new Date(staleCacheCreatedAt).getTime(),
    );

    const refreshedCacheHit = await generation.requestGeneration(
      "user-a",
      "TOPIC",
    );
    expect(refreshedCacheHit.reuse).toBe("cache");
    expect(refreshedCacheHit.snapshot.taskId).toBe(
      expiredCache.snapshot.taskId,
    );
    expect(refreshedCacheHit.snapshot.result?.mapId).toBe(
      completed?.result?.mapId,
    );
  });

  it("uses one model call per assessment batch and source call per normal stage", async () => {
    const modelCalls = {
      planning: 0,
      structuring: 0,
      extracting: 0,
      assessing: 0,
    };
    const assessmentTargets: string[][] = [];
    const modelTimeouts: number[] = [];
    const sourceTimeouts: number[] = [];
    const baseModel = provider();
    const countedModel: StructuredModelAccess = {
      async planDirections(input) {
        modelCalls.planning += 1;
        modelTimeouts.push(input.timeoutMs);
        return baseModel.planDirections(input);
      },
      async structureMap(input) {
        modelCalls.structuring += 1;
        modelTimeouts.push(input.timeoutMs);
        return baseModel.structureMap(input);
      },
      async extractViewpoints(input) {
        modelCalls.extracting += 1;
        modelTimeouts.push(input.timeoutMs);
        return baseModel.extractViewpoints(input);
      },
      async generateAssessments(input) {
        modelCalls.assessing += 1;
        assessmentTargets.push([...(input.targetNodeIds ?? [])]);
        modelTimeouts.push(input.timeoutMs);
        return baseModel.generateAssessments(input);
      },
    };
    let sourceCalls = 0;
    const baseSourceSearch = sourceSearch();
    const countedSource: SourceSearchAccess = {
      async search(input) {
        sourceCalls += 1;
        sourceTimeouts.push(input.timeoutMs);
        return baseSourceSearch.search(input);
      },
    };
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      rateLimit: testRateLimit,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const worker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: countedSource,
      structuredModel: countedModel,
      externalRequestTimeouts: {
        sourceTimeoutMs: 1_234,
        modelTimeoutMs: 56_789,
      },
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
    }).worker;
    const created = await generation.requestGeneration(
      "user-a",
      "normal success call budget topic",
    );

    await worker.runOnce("normal-success-worker");

    expect(modelCalls).toEqual({
      planning: 1,
      structuring: 1,
      extracting: 1,
      assessing: 3,
    });
    expect(assessmentTargets).toEqual([
      ["node-0", "node-1"],
      ["node-2", "node-3"],
      ["node-4", "node-5"],
    ]);
    expect(modelTimeouts).toEqual([
      56_789, 56_789, 56_789, 56_789, 56_789, 56_789,
    ]);
    const assessingStage = await database
      .select({ output: generationCheckpoint.output })
      .from(generationCheckpoint)
      .where(
        and(
          eq(generationCheckpoint.taskId, created.snapshot.taskId),
          eq(generationCheckpoint.stage, "assessing"),
          eq(generationCheckpoint.operationKey, "stage"),
        ),
      );
    const stageOutput = assessingStage[0]?.output;
    const assessedQuestionNodeIds =
      typeof stageOutput === "object" &&
      stageOutput !== null &&
      "questions" in stageOutput &&
      Array.isArray(stageOutput.questions)
        ? stageOutput.questions.map((question) =>
            typeof question === "object" &&
            question !== null &&
            "nodeId" in question &&
            typeof question.nodeId === "string"
              ? question.nodeId
              : null,
          )
        : undefined;
    expect(assessedQuestionNodeIds).toEqual([
      "node-0",
      "node-0",
      "node-1",
      "node-1",
      "node-2",
      "node-2",
      "node-3",
      "node-3",
      "node-4",
      "node-4",
      "node-5",
      "node-5",
    ]);
    expect(sourceCalls).toBe(3);
    expect(sourceTimeouts).toEqual([1_234, 1_234, 1_234]);
    expect(
      (await generation.getGeneration("user-a", created.snapshot.taskId))
        ?.status,
    ).toBe("succeeded");
  });
  it("resumes assessing from completed batch checkpoints after a lease interruption", async () => {
    const assessmentTargets: string[][] = [];
    let interrupted = false;
    let taskId = "";
    const baseModel = provider();
    const interruptingModel: StructuredModelAccess = {
      ...baseModel,
      async generateAssessments(input) {
        const targetNodeIds = [...(input.targetNodeIds ?? [])];
        assessmentTargets.push(targetNodeIds);
        if (!interrupted && targetNodeIds[0] === "node-2") {
          interrupted = true;
          await pool.query(
            `UPDATE "generation_task"
             SET "lease_expires_at" = NOW() - INTERVAL '1 second'
             WHERE "id" = $1`,
            [taskId],
          );
        }
        return baseModel.generateAssessments(input);
      },
    };
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      rateLimit: testRateLimit,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const workerDependencies = {
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: interruptingModel,
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
      scheduleHeartbeat: () => () => undefined,
    };
    const firstWorker =
      createMapGenerationWorkerRuntime(workerDependencies).worker;
    const created = await generation.requestGeneration(
      "user-a",
      "assessment checkpoint recovery topic",
    );
    taskId = created.snapshot.taskId;

    await firstWorker.runOnce("assessment-recovery-worker-1");

    expect(assessmentTargets).toEqual([
      ["node-0", "node-1"],
      ["node-2", "node-3"],
    ]);
    expect((await generation.getGeneration("user-a", taskId))?.status).toBe(
      "assessing",
    );
    const firstBatch = await database
      .select({
        output: generationCheckpoint.output,
        completedAt: generationCheckpoint.completedAt,
      })
      .from(generationCheckpoint)
      .where(
        and(
          eq(generationCheckpoint.taskId, taskId),
          eq(generationCheckpoint.stage, "assessing"),
          eq(generationCheckpoint.operationKey, "assessing:batch-0"),
        ),
      );
    expect(firstBatch[0]?.output).toMatchObject({
      questions: expect.any(Array),
    });
    expect(firstBatch[0]?.completedAt).not.toBeNull();

    const secondWorker =
      createMapGenerationWorkerRuntime(workerDependencies).worker;
    await secondWorker.runOnce("assessment-recovery-worker-2");

    expect(assessmentTargets).toEqual([
      ["node-0", "node-1"],
      ["node-2", "node-3"],
      ["node-2", "node-3"],
      ["node-4", "node-5"],
    ]);
    expect((await generation.getGeneration("user-a", taskId))?.status).toBe(
      "succeeded",
    );
  });

  it("keeps assessment retry budgets isolated by batch operation key", async () => {
    const attemptsByBatch = new Map<string, number>();
    const baseModel = provider();
    const retryingModel: StructuredModelAccess = {
      ...baseModel,
      async generateAssessments(input) {
        const key = (input.targetNodeIds ?? []).join(",");
        const attempts = (attemptsByBatch.get(key) ?? 0) + 1;
        attemptsByBatch.set(key, attempts);
        if (key === "node-0,node-1" && attempts < 3) {
          throw {
            provider: "model",
            code: "temporarily_unavailable",
            retryable: true,
          };
        }
        return baseModel.generateAssessments(input);
      },
    };
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      rateLimit: testRateLimit,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const worker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: retryingModel,
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
    }).worker;
    const created = await generation.requestGeneration(
      "user-a",
      "assessment batch retry budget topic",
    );

    await worker.runOnce("assessment-retry-worker");

    expect(attemptsByBatch).toEqual(
      new Map([
        ["node-0,node-1", 3],
        ["node-2,node-3", 1],
        ["node-4,node-5", 1],
      ]),
    );
    const batchCheckpoints = await database
      .select({
        operationKey: generationCheckpoint.operationKey,
        attemptCount: generationCheckpoint.attemptCount,
        completedAt: generationCheckpoint.completedAt,
      })
      .from(generationCheckpoint)
      .where(
        and(
          eq(generationCheckpoint.taskId, created.snapshot.taskId),
          eq(generationCheckpoint.stage, "assessing"),
        ),
      );
    expect(
      batchCheckpoints
        .filter(({ operationKey }) =>
          operationKey.startsWith("assessing:batch-"),
        )
        .sort((left, right) =>
          left.operationKey.localeCompare(right.operationKey),
        ),
    ).toEqual([
      {
        operationKey: "assessing:batch-0",
        attemptCount: 0,
        completedAt: expect.any(Date),
      },
      {
        operationKey: "assessing:batch-1",
        attemptCount: 0,
        completedAt: expect.any(Date),
      },
      {
        operationKey: "assessing:batch-2",
        attemptCount: 0,
        completedAt: expect.any(Date),
      },
    ]);
  });

  it.each([
    {
      name: "uses a meaningful model backoff when Retry-After is absent",
      code: "temporarily_unavailable" as const,
      retryAfterMs: undefined,
      expectedDelays: [5_000, 10_000],
    },
    {
      name: "honors a longer provider Retry-After",
      code: "rate_limited" as const,
      retryAfterMs: 12_000,
      expectedDelays: [12_000, 12_000],
    },
  ])(
    "$name without crossing the generation deadline",
    async ({ code, retryAfterMs, expectedDelays }) => {
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
              code,
              retryable: true,
              ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            };
          }
          return baseModel.planDirections(input);
        },
      };
      const generation = createMapGenerationRuntime({
        database,
        providerVersions: versions,
        rateLimit: testRateLimit,
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
        `retry-delay ${code}`,
      );

      await worker.runOnce("retry-worker");

      expect(planAttempts).toBe(3);
      expect(delays.slice(0, 2)).toEqual(expectedDelays);
      expect(
        (await generation.getGeneration("user-a", created.snapshot.taskId))
          ?.status,
      ).toBe("succeeded");
    },
  );
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
      rateLimit: testRateLimit,
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
  it("retries model protocol failures three times and reports model output invalid", async () => {
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
      rateLimit: testRateLimit,
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
    expect(structureAttempts).toBe(3);
    expect(failed?.status).toBe("failed");
    expect(failed?.failure).toEqual({
      code: "model_output_invalid",
      retryable: false,
    });
    expect(
      await database
        .select({ mapId: learningMapVersion.id })
        .from(learningMapVersion),
    ).toHaveLength(0);
  });
  it("recovers one non-JSON model response without repeating completed stages", async () => {
    let structureAttempts = 0;
    const baseModel = provider();
    const recoveringModel: StructuredModelAccess = {
      ...baseModel,
      async structureMap(input) {
        structureAttempts += 1;
        if (structureAttempts === 1) {
          throw {
            provider: "model",
            code: "protocol_error",
            retryable: false,
          };
        }
        return baseModel.structureMap(input);
      },
    };
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      rateLimit: testRateLimit,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const worker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: recoveringModel,
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
    }).worker;
    const created = await generation.requestGeneration(
      "user-a",
      "recover topic",
    );

    await worker.runOnce("recover-worker");

    expect(structureAttempts).toBe(2);
    expect(
      (await generation.getGeneration("user-a", created.snapshot.taskId))
        ?.status,
    ).toBe("succeeded");
    const recoveryCheckpoint = await database
      .select({ output: generationCheckpoint.output })
      .from(generationCheckpoint)
      .where(
        and(
          eq(generationCheckpoint.taskId, created.snapshot.taskId),
          eq(generationCheckpoint.stage, "queued"),
          eq(generationCheckpoint.operationKey, "task:auto-recovery"),
        ),
      );
    expect(recoveryCheckpoint[0]?.output).toEqual({ used: 1 });
    const completedStructuring = await database
      .select({ input: generationCheckpoint.input })
      .from(generationCheckpoint)
      .where(
        and(
          eq(generationCheckpoint.taskId, created.snapshot.taskId),
          eq(generationCheckpoint.stage, "structuring"),
          eq(generationCheckpoint.operationKey, "stage"),
        ),
      );
    expect(completedStructuring[0]?.input).toMatchObject({
      contextBudget: { attempt: 2 },
    });
    const recoveryEvents = await database
      .select({ data: generationEvent.data })
      .from(generationEvent)
      .where(eq(generationEvent.taskId, created.snapshot.taskId));
    const visibleRecoveryEvents = recoveryEvents.filter((event) => {
      const data = event.data as Record<string, unknown>;
      return data.recovery !== undefined && data.model !== undefined;
    });
    expect(visibleRecoveryEvents).toHaveLength(2);
    expect(visibleRecoveryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            model: { attempt: 2, maxAttempts: 3 },
            recovery: expect.objectContaining({
              reason: "model_output_invalid",
              state: "started",
              attempt: 2,
              maxAttempts: 3,
              used: 1,
              limit: 3,
            }),
            reusedStages: expect.arrayContaining(["planning", "searching"]),
          }),
        }),
      ]),
    );
  });

  it("fails closed when the task recovery checkpoint is malformed", async () => {
    let structureAttempts = 0;
    const baseModel = provider();
    const malformedCheckpointModel: StructuredModelAccess = {
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
      rateLimit: testRateLimit,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const worker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: malformedCheckpointModel,
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
    }).worker;
    const created = await generation.requestGeneration(
      "user-a",
      "malformed recovery checkpoint topic",
    );
    await database.insert(generationCheckpoint).values({
      taskId: created.snapshot.taskId,
      stage: "queued",
      operationKey: "task:auto-recovery",
      input: { limit: 3 },
      output: { used: "corrupt" },
      attemptCount: 0,
      completedAt: null,
    });

    await worker.runOnce("malformed-recovery-worker");

    expect(structureAttempts).toBe(1);
    expect(
      (await generation.getGeneration("user-a", created.snapshot.taskId))
        ?.failure,
    ).toEqual({ code: "internal_failure", retryable: false });
  });

  it("enforces three task-wide recovery attempts across model stages", async () => {
    const attempts = {
      structuring: 0,
      extracting: 0,
      assessing: 0,
    };
    const baseModel = provider();
    const exhaustedModel: StructuredModelAccess = {
      ...baseModel,
      async structureMap(input) {
        attempts.structuring += 1;
        if (attempts.structuring === 1) {
          throw {
            provider: "model",
            code: "protocol_error",
            retryable: false,
          };
        }
        return baseModel.structureMap(input);
      },
      async extractViewpoints(input) {
        attempts.extracting += 1;
        if (attempts.extracting === 1) {
          throw {
            provider: "model",
            code: "protocol_error",
            retryable: false,
          };
        }
        return baseModel.extractViewpoints(input);
      },
      async generateAssessments() {
        attempts.assessing += 1;
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
      rateLimit: testRateLimit,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const worker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: exhaustedModel,
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
    }).worker;
    const created = await generation.requestGeneration(
      "user-a",
      "global recovery topic",
    );

    await worker.runOnce("global-recovery-worker");

    expect(attempts).toEqual({
      structuring: 2,
      extracting: 2,
      assessing: 2,
    });
    expect(
      (await generation.getGeneration("user-a", created.snapshot.taskId))
        ?.failure?.code,
    ).toBe("model_output_invalid");
    const recoveryCheckpoint = await database
      .select({ output: generationCheckpoint.output })
      .from(generationCheckpoint)
      .where(
        and(
          eq(generationCheckpoint.taskId, created.snapshot.taskId),
          eq(generationCheckpoint.stage, "queued"),
          eq(generationCheckpoint.operationKey, "task:auto-recovery"),
        ),
      );
    expect(recoveryCheckpoint[0]?.output).toEqual({ used: 3 });
  });

  it("reuses a stable topic map identity across provider versions", async () => {
    const firstGeneration = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      rateLimit: testRateLimit,
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
      rateLimit: testRateLimit,
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
      rateLimit: testRateLimit,
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
      rateLimit: testRateLimit,
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

  it("returns a safe terminal snapshot at an exact succeeded cursor", async () => {
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      rateLimit: testRateLimit,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const worker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: provider(),
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
    }).worker;
    const created = await generation.requestGeneration(
      "user-a",
      "succeeded terminal cursor topic",
    );
    await worker.runOnce("terminal-success-worker");

    const snapshot = await generation.getGeneration(
      "user-a",
      created.snapshot.taskId,
    );
    expect(snapshot?.status).toBe("succeeded");
    const events = await generation.readEvents(
      "user-a",
      created.snapshot.taskId,
      snapshot!.sequence,
    );
    expect(events).toMatchObject({
      kind: "snapshot",
      events: [],
      snapshot: {
        status: "succeeded",
        sequence: snapshot!.sequence,
      },
    });
  });

  it("returns a safe terminal snapshot at an exact failed cursor", async () => {
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      rateLimit: testRateLimit,
      idGenerator: () => crypto.randomUUID(),
    }).generation;
    const failingModel: StructuredModelAccess = {
      ...provider(),
      async planDirections() {
        throw {
          provider: "model",
          code: "protocol_error",
          retryable: false,
        };
      },
    };
    const worker = createMapGenerationWorkerRuntime({
      database,
      providerVersions: versions,
      sourceSearch: sourceSearch(),
      structuredModel: failingModel,
      idGenerator: () => crypto.randomUUID(),
      sleep: async () => undefined,
    }).worker;
    const created = await generation.requestGeneration(
      "user-a",
      "failed terminal cursor topic",
    );
    await worker.runOnce("terminal-failure-worker");

    const snapshot = await generation.getGeneration(
      "user-a",
      created.snapshot.taskId,
    );
    expect(snapshot?.status).toBe("failed");
    const events = await generation.readEvents(
      "user-a",
      created.snapshot.taskId,
      snapshot!.sequence,
    );
    expect(events).toMatchObject({
      kind: "snapshot",
      events: [],
      snapshot: {
        status: "failed",
        sequence: snapshot!.sequence,
        failure: { code: "model_output_invalid", retryable: false },
      },
    });
  });

  it("falls back to a snapshot when the event cursor is outside retention", async () => {
    const generation = createMapGenerationRuntime({
      database,
      providerVersions: versions,
      rateLimit: testRateLimit,
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
