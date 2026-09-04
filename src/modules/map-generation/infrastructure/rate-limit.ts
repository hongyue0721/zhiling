import { sql } from "drizzle-orm";

import { generationRateLimit } from "@/platform/database/generation-schema";
import type { PostgresDatabase } from "@/platform/database/postgres";

export type GenerationRateLimitPolicy = Readonly<{
  windowSeconds: number;
  maxRequests: number;
}>;

export type GenerationRateLimitReservation = (
  transaction: unknown,
  userId: string,
  now: Date,
) => Promise<void>;

export class GenerationRateLimitConfigurationError extends Error {
  readonly code = "generation_rate_limit_configuration_invalid" as const;

  constructor() {
    super("Generation rate-limit policy must use positive safe integers");
    this.name = "GenerationRateLimitConfigurationError";
  }
}

export class GenerationRateLimitExceededError extends Error {
  readonly code = "rate_limited" as const;
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("Generation rate limit exceeded");
    this.name = "GenerationRateLimitExceededError";
    this.retryAfterMs = retryAfterMs;
  }
}

function assertPolicy(policy: GenerationRateLimitPolicy): void {
  if (
    !Number.isSafeInteger(policy.windowSeconds) ||
    policy.windowSeconds <= 0 ||
    !Number.isSafeInteger(policy.maxRequests) ||
    policy.maxRequests <= 0
  ) {
    throw new GenerationRateLimitConfigurationError();
  }
}

export function createGenerationRateLimitReservation(
  policy: GenerationRateLimitPolicy,
): GenerationRateLimitReservation {
  assertPolicy(policy);
  const windowMs = policy.windowSeconds * 1_000;
  if (!Number.isSafeInteger(windowMs)) {
    throw new GenerationRateLimitConfigurationError();
  }

  return async (transaction, userId, now) => {
    const db = transaction as unknown as PostgresDatabase;
    const windowStartedAt = new Date(
      Math.floor(now.getTime() / windowMs) * windowMs,
    );
    const windowStartedAtValue = windowStartedAt.toISOString();
    const rows = await db
      .insert(generationRateLimit)
      .values({
        userId,
        windowStartedAt: sql`${windowStartedAtValue}`,
        requestCount: 1,
      })
      .onConflictDoUpdate({
        target: generationRateLimit.userId,
        set: {
          windowStartedAt: sql`CASE WHEN ${generationRateLimit.windowStartedAt} < ${windowStartedAtValue} THEN ${windowStartedAtValue} ELSE ${generationRateLimit.windowStartedAt} END`,
          requestCount: sql`CASE WHEN ${generationRateLimit.windowStartedAt} < ${windowStartedAtValue} THEN 1 ELSE ${generationRateLimit.requestCount} + 1 END`,
        },
      })
      .returning({ requestCount: generationRateLimit.requestCount });
    const requestCount = rows[0]?.requestCount;
    if (typeof requestCount !== "number") {
      throw new Error("Generation rate-limit reservation did not return a row");
    }
    if (requestCount > policy.maxRequests) {
      const retryAfterMs = Math.max(
        1,
        windowStartedAt.getTime() + windowMs - now.getTime(),
      );
      throw new GenerationRateLimitExceededError(retryAfterMs);
    }
  };
}
