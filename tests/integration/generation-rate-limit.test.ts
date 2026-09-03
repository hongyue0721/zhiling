import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createMapGenerationRuntime,
  type GenerationProviderVersionInput,
} from "@/modules/map-generation/public/server";
import {
  createGenerationRateLimitReservation,
  GenerationRateLimitConfigurationError,
  GenerationRateLimitExceededError,
} from "@/modules/map-generation/infrastructure/rate-limit";
import { readGenerationEnvironment } from "@/modules/map-generation/infrastructure/config";
import { user } from "@/platform/database/auth-schema";
import { createPostgresDatabase } from "@/platform/database/postgres";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for generation rate-limit integration tests",
  );
}

const { database, pool } = createPostgresDatabase(databaseUrl);
const userId = `rate-limit-${randomUUID()}`;
const providerVersions: GenerationProviderVersionInput = {
  pipelineVersion: "pipeline-rate-limit-test-v1",
  sourceAdapterVersion: "source-rate-limit-test-v1",
  modelAdapterVersion: "model-rate-limit-test-v1",
};

beforeAll(async () => {
  const migrationsFolder = fileURLToPath(
    new URL("../../drizzle", import.meta.url),
  );
  await migrate(database, { migrationsFolder });
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE TABLE "generation_rate_limit", "generation_task", "user" CASCADE',
  );
  await database.insert(user).values({
    id: userId,
    name: "Rate limit test user",
    email: `${userId}@example.test`,
    emailVerified: true,
  });
});

afterAll(async () => {
  await pool.end();
});

describe("generation rate-limit policy", () => {
  it("rejects non-positive and unsafe configuration before reservation", () => {
    expect(() =>
      createGenerationRateLimitReservation({
        windowSeconds: 0,
        maxRequests: 1,
      }),
    ).toThrowError(GenerationRateLimitConfigurationError);
    expect(() =>
      createGenerationRateLimitReservation({
        windowSeconds: 60,
        maxRequests: 0,
      }),
    ).toThrowError(GenerationRateLimitConfigurationError);
    expect(() =>
      createGenerationRateLimitReservation({
        windowSeconds: Number.MAX_SAFE_INTEGER + 1,
        maxRequests: 1,
      }),
    ).toThrowError(GenerationRateLimitConfigurationError);
  });

  it("serializes concurrent reservations and rolls back rejected increments", async () => {
    const reserve = createGenerationRateLimitReservation({
      windowSeconds: 3_600,
      maxRequests: 1,
    });
    const now = new Date("2026-09-03T00:00:00.000Z");
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        database.transaction((transaction) =>
          reserve(transaction, userId, now),
        ),
      ),
    );

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(GenerationRateLimitExceededError);
      }
    }
    const stored = await pool.query(
      'SELECT "window_started_at", "request_count" FROM "generation_rate_limit" WHERE "user_id" = $1',
      [userId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({ request_count: 1 });
  });

  it("does not count active same-topic retries against the reservation", async () => {
    let id = 0;
    const generation = createMapGenerationRuntime({
      database,
      providerVersions,
      rateLimit: { windowSeconds: 3_600, maxRequests: 1 },
      idGenerator: () => `rate-task-${id++}`,
    }).generation;

    const [first, second] = await Promise.all([
      generation.requestGeneration(userId, "same topic"),
      generation.requestGeneration(userId, "same topic"),
    ]);
    expect(
      new Set([first.snapshot.taskId, second.snapshot.taskId]),
    ).toHaveLength(1);
    expect(new Set([first.reuse, second.reuse])).toEqual(
      new Set(["created", "active_task"]),
    );

    const retry = await generation.requestGeneration(userId, "same topic");
    expect(retry.reuse).toBe("active_task");

    const stored = await pool.query(
      'SELECT "request_count" FROM "generation_rate_limit" WHERE "user_id" = $1',
      [userId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.request_count).toBe(1);

    await expect(
      generation.requestGeneration(userId, "different topic"),
    ).rejects.toMatchObject({ code: "rate_limited" });
    const afterRejected = await pool.query(
      'SELECT "request_count" FROM "generation_rate_limit" WHERE "user_id" = $1',
      [userId],
    );
    expect(afterRejected.rows[0]?.request_count).toBe(1);
  });
});

describe("generation rate-limit environment", () => {
  it("parses explicit positive integer settings", () => {
    expect(
      readGenerationEnvironment({
        NODE_ENV: "test",
        GENERATION_RATE_LIMIT_WINDOW_SECONDS: "3600",
        GENERATION_RATE_LIMIT_MAX_REQUESTS: "5",
      }),
    ).toEqual({ rateLimit: { windowSeconds: 3_600, maxRequests: 5 } });
  });

  it("rejects unsafe integer settings instead of rounding them", () => {
    expect(() =>
      readGenerationEnvironment({
        NODE_ENV: "test",
        GENERATION_RATE_LIMIT_WINDOW_SECONDS: "9007199254740992",
        GENERATION_RATE_LIMIT_MAX_REQUESTS: "5",
      }),
    ).toThrow();
  });
});
