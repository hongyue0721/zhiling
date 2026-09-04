import { createHash } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import {
  learningAssessmentQuestion,
  learningAssessmentQuestionCorrectOption,
  learningAssessmentQuestionMatchingAnswer,
  learningAssessmentQuestionOption,
  learningAssessmentQuestionSet,
  learningAssessmentQuestionSource,
} from "@/platform/database/assessment-schema";
import {
  knowledgeSource,
  learningMap,
  learningMapNode,
  learningMapNodeSource,
  learningMapPrerequisite,
  learningMapVersion,
  learningRelationship,
  learningViewpoint,
  learningViewpointSource,
} from "@/platform/database/catalog-schema";
import {
  generationCache,
  generationCheckpoint,
  generationEvent,
  generationParticipant,
  generationTask,
} from "@/platform/database/generation-schema";
import type { PostgresDatabase } from "@/platform/database/postgres";
import {
  assertGenerationTransition,
  generationStatuses,
  GENERATION_DEADLINE_MS,
  GENERATION_HEARTBEAT_MS,
  GENERATION_LEASE_MS,
  LOCAL_OPERATION_TIMEOUT_MS,
  MAX_EXTERNAL_RETRIES,
  type GenerationFailureCategory,
  type GenerationProgress,
} from "../domain/state-machine";
import {
  createGenerationIdentity,
  normalizeGenerationTopic,
} from "../domain/identity";
import {
  assertNoModelUrl,
  type GenerationCandidate,
  type GenerationDirectionCandidate,
  type GenerationMapCandidate,
  type GenerationSourceCandidate,
  type GenerationViewpointCandidate,
  validateGenerationCandidate,
  GenerationCandidateValidationError,
} from "../domain/candidate";
import type {
  GenerationProviderVersions,
  GenerationSourceSearchPort,
  GenerationStructuredModelPort,
} from "../application/ports";
import {
  createModelContextBudget,
  MODEL_MAX_ATTEMPTS,
  type GenerationDirectionSourceCoverage,
  type ModelContextBudget,
} from "../application/context-budget";
import type { GenerationRateLimitReservation } from "./rate-limit";

export type MapGenerationDatabase = PostgresDatabase;
export type GenerationIdGenerator = () => string;
export type GenerationClock = () => Date;
export type GenerationSleeper = (milliseconds: number) => Promise<void>;
export type GenerationHeartbeatScheduler = (
  callback: () => void,
  milliseconds: number,
) => () => void;

export type GenerationExternalRequestTimeouts = Readonly<{
  sourceTimeoutMs: number;
  modelTimeoutMs: number;
}>;

export type GenerationProviderVersionInput = Readonly<{
  pipelineVersion?: string;
  sourceAdapterVersion: string;
  modelAdapterVersion: string;
}>;

export const DEFAULT_PIPELINE_VERSION = "generation-pipeline-v2";
export const DEFAULT_EXTERNAL_REQUEST_TIMEOUTS: GenerationExternalRequestTimeouts =
  Object.freeze({
    sourceTimeoutMs: 20_000,
    modelTimeoutMs: 60_000,
  });
export const GENERATION_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
export const SEARCH_RESULTS_PER_DIRECTION = 8;
export const SUPPLEMENT_RESULTS_PER_NODE = 6;
export const MAX_TASK_AUTO_RECOVERIES = 3;
function stableMapId(normalizedTopic: string): string {
  return `map_${createHash("sha256").update(normalizedTopic, "utf8").digest("hex")}`;
}
const STAGE_CHECKPOINT_KEY = "stage";
const TASK_RECOVERY_CHECKPOINT_KEY = "task:auto-recovery";

export class GenerationLeaseLostError extends Error {
  readonly code = "generation_lease_lost" as const;

  constructor() {
    super("Generation task lease is no longer held");
    this.name = "GenerationLeaseLostError";
  }
}

export class GenerationTaskFailure extends Error {
  constructor(
    readonly category: GenerationFailureCategory,
    readonly retryable: boolean,
    message = category,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "GenerationTaskFailure";
  }
}

type DbExecutor = MapGenerationDatabase;
type TaskRow = typeof generationTask.$inferSelect;
type CheckpointRow = typeof generationCheckpoint.$inferSelect;
type CacheRow = {
  taskId: string;
  mapId: string;
  versionId: string;
  questionSetId: string;
};
type SearchStageOutput = Readonly<{
  sources: readonly GenerationSourceCandidate[];
  sourceIdsByDirection: readonly GenerationDirectionSourceCoverage[];
}>;

type TaskProjection = {
  id: typeof generationTask.id;
  topic: typeof generationTask.topic;
  normalizedTopic: typeof generationTask.normalizedTopic;
  pipelineVersion: typeof generationTask.pipelineVersion;
  sourceAdapterVersion: typeof generationTask.sourceAdapterVersion;
  modelAdapterVersion: typeof generationTask.modelAdapterVersion;
  status: typeof generationTask.status;
  stage: typeof generationTask.stage;
  sequence: typeof generationTask.sequence;
  deadlineAt: typeof generationTask.deadlineAt;
  nextAttemptAt: typeof generationTask.nextAttemptAt;
  retryCount: typeof generationTask.retryCount;
  leaseOwner: typeof generationTask.leaseOwner;
  leaseExpiresAt: typeof generationTask.leaseExpiresAt;
  heartbeatAt: typeof generationTask.heartbeatAt;
  mapId: typeof generationTask.mapId;
  versionId: typeof generationTask.versionId;
  questionSetId: typeof generationTask.questionSetId;
  failureCode: typeof generationTask.failureCode;
  failureRetryable: typeof generationTask.failureRetryable;
  createdAt: typeof generationTask.createdAt;
  updatedAt: typeof generationTask.updatedAt;
  completedAt: typeof generationTask.completedAt;
};

const taskProjection: TaskProjection = {
  id: generationTask.id,
  topic: generationTask.topic,
  normalizedTopic: generationTask.normalizedTopic,
  pipelineVersion: generationTask.pipelineVersion,
  sourceAdapterVersion: generationTask.sourceAdapterVersion,
  modelAdapterVersion: generationTask.modelAdapterVersion,
  status: generationTask.status,
  stage: generationTask.stage,
  sequence: generationTask.sequence,
  deadlineAt: generationTask.deadlineAt,
  nextAttemptAt: generationTask.nextAttemptAt,
  retryCount: generationTask.retryCount,
  leaseOwner: generationTask.leaseOwner,
  leaseExpiresAt: generationTask.leaseExpiresAt,
  heartbeatAt: generationTask.heartbeatAt,
  mapId: generationTask.mapId,
  versionId: generationTask.versionId,
  questionSetId: generationTask.questionSetId,
  failureCode: generationTask.failureCode,
  failureRetryable: generationTask.failureRetryable,
  createdAt: generationTask.createdAt,
  updatedAt: generationTask.updatedAt,
  completedAt: generationTask.completedAt,
};

function asTaskRow(value: unknown): TaskRow {
  return value as TaskRow;
}

function asCheckpointRow(value: unknown): CheckpointRow {
  return value as CheckpointRow;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

const generationStageOrder = generationStatuses.filter(
  (status): status is TaskRow["stage"] =>
    status !== "succeeded" && status !== "failed",
);
const generationStageValues: Readonly<Record<string, true>> =
  Object.fromEntries(generationStageOrder.map((stage) => [stage, true]));
const generationStageOrderIndex: Readonly<Record<string, number>> =
  Object.fromEntries(
    generationStageOrder.map((stage, index) => [stage, index]),
  );

function sortGenerationStages(
  stages: readonly TaskRow["stage"][],
): TaskRow["stage"][] {
  return [...stages].sort(
    (left, right) =>
      (generationStageOrderIndex[left] ?? Number.MAX_SAFE_INTEGER) -
      (generationStageOrderIndex[right] ?? Number.MAX_SAFE_INTEGER),
  );
}

function readProgress(value: unknown): GenerationProgress | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const progress: {
    model?: GenerationProgress["model"];
    search?: GenerationProgress["search"];
    supplement?: GenerationProgress["supplement"];
    recovery?: GenerationProgress["recovery"];
    reusedStages?: GenerationProgress["reusedStages"];
  } = {};
  const model = asRecord(record.model);
  if (
    model &&
    isSafeInteger(model.attempt) &&
    model.maxAttempts === MODEL_MAX_ATTEMPTS &&
    model.attempt >= 1 &&
    model.attempt <= model.maxAttempts
  ) {
    progress.model = {
      attempt: model.attempt,
      maxAttempts: model.maxAttempts,
    };
  }
  const search = asRecord(record.search);
  if (
    search &&
    isSafeInteger(search.completed) &&
    isSafeInteger(search.total) &&
    search.completed >= 0 &&
    search.total >= search.completed
  ) {
    progress.search = {
      completed: search.completed,
      total: search.total,
    };
  }
  const supplement = asRecord(record.supplement);
  if (
    supplement &&
    isSafeInteger(supplement.completed) &&
    isSafeInteger(supplement.total) &&
    supplement.completed >= 0 &&
    supplement.total >= supplement.completed
  ) {
    progress.supplement = {
      completed: supplement.completed,
      total: supplement.total,
    };
  }
  const recovery = asRecord(record.recovery);
  if (
    recovery &&
    recovery.reason === "model_output_invalid" &&
    (recovery.state === "started" || recovery.state === "exhausted") &&
    isSafeInteger(recovery.attempt) &&
    recovery.maxAttempts === MODEL_MAX_ATTEMPTS &&
    isSafeInteger(recovery.used) &&
    recovery.limit === MAX_TASK_AUTO_RECOVERIES &&
    recovery.attempt >= 1 &&
    recovery.attempt <= recovery.maxAttempts &&
    recovery.used >= 0 &&
    recovery.used <= recovery.limit
  ) {
    progress.recovery = {
      reason: "model_output_invalid",
      state: recovery.state,
      attempt: recovery.attempt,
      maxAttempts: recovery.maxAttempts,
      used: recovery.used,
      limit: recovery.limit,
    };
  }
  if (isArray(record.reusedStages)) {
    const reusedStages = record.reusedStages.filter(
      (
        stage,
      ): stage is NonNullable<GenerationProgress["reusedStages"]>[number] =>
        typeof stage === "string" && generationStageValues[stage] === true,
    );
    if (reusedStages.length > 0) {
      progress.reusedStages = reusedStages;
    }
  }
  return Object.keys(progress).length > 0 ? progress : undefined;
}

function toSnapshot(
  task: TaskRow,
  learningRelationshipId: string | null,
  progress?: GenerationProgress,
): {
  taskId: string;
  status: TaskRow["status"];
  stage: TaskRow["stage"];
  sequence: number;
  createdAt: string;
  updatedAt: string;
  deadlineAt: string;
  result: {
    mapId: string;
    versionId: string;
    learningRelationshipId: string;
  } | null;
  failure: {
    code: GenerationFailureCategory;
    retryable: boolean;
  } | null;
  completedAt: string | null;
  progress?: GenerationProgress;
} {
  const result =
    task.status === "succeeded" &&
    task.mapId &&
    task.versionId &&
    learningRelationshipId
      ? {
          mapId: task.mapId,
          versionId: task.versionId,
          learningRelationshipId,
        }
      : null;
  const failure =
    task.status === "failed" && task.failureCode
      ? {
          code: task.failureCode,
          retryable: task.failureRetryable === true,
        }
      : null;
  return {
    taskId: task.id,
    status: task.status,
    stage: task.stage,
    sequence: Number(task.sequence),
    createdAt: asDate(task.createdAt).toISOString(),
    updatedAt: asDate(task.updatedAt).toISOString(),
    deadlineAt: asDate(task.deadlineAt).toISOString(),
    result,
    failure,
    completedAt: task.completedAt
      ? asDate(task.completedAt).toISOString()
      : null,
    ...(progress ? { progress } : {}),
  };
}

function toEvent(taskId: string, row: typeof generationEvent.$inferSelect) {
  const data =
    asRecord(row.data) ?? ({ value: row.data } as Record<string, unknown>);
  return {
    taskId,
    sequence: Number(row.sequence),
    type: row.type,
    occurredAt: asDate(row.occurredAt).toISOString(),
    data,
  };
}

function externalProviderOf(error: unknown): "source" | "model" | null {
  const object = asRecord(error);
  return object?.provider === "source" || object?.provider === "model"
    ? object.provider
    : null;
}

function externalCode(error: unknown): string | null {
  const object = asRecord(error);
  return typeof object?.code === "string" ? object.code : null;
}

function isRetryableExternalError(error: unknown): boolean {
  const object = asRecord(error);
  if (typeof object?.retryable === "boolean") {
    return object.retryable;
  }
  return ["temporarily_unavailable", "timeout", "rate_limited"].includes(
    externalCode(error) ?? "",
  );
}

function externalRetryAfter(error: unknown): number | undefined {
  const value = asRecord(error)?.retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, GENERATION_DEADLINE_MS)
    : undefined;
}

function isModelOutputProtocolError(
  error: unknown,
  provider: "source" | "model",
): boolean {
  return provider === "model" && externalCode(error) === "protocol_error";
}

function mapExternalFailure(
  error: unknown,
  provider: "source" | "model",
): GenerationTaskFailure {
  const knownProvider = externalProviderOf(error) ?? provider;
  const category =
    knownProvider === "source"
      ? "source_unavailable"
      : isModelOutputProtocolError(error, knownProvider)
        ? "model_output_invalid"
        : "model_unavailable";
  return new GenerationTaskFailure(
    category,
    isRetryableExternalError(error),
    category,
    externalRetryAfter(error),
  );
}
function modelOutputInvalid(): GenerationTaskFailure {
  return new GenerationTaskFailure("model_output_invalid", true);
}

function assertModelOutputHasNoUrl(value: unknown, label: string): void {
  try {
    assertNoModelUrl(value, label);
  } catch {
    throw modelOutputInvalid();
  }
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

export class DrizzleMapGenerationRepository {
  constructor(
    readonly database: MapGenerationDatabase,
    private readonly providerVersions: GenerationProviderVersions,
    private readonly now: GenerationClock,
    readonly idGenerator: GenerationIdGenerator,
    private readonly reserveRateLimit?: GenerationRateLimitReservation,
  ) {}

  async requestGeneration(userId: string, topic: string) {
    const identity = createGenerationIdentity(topic, this.providerVersions);
    const requestedAt = this.now();
    const taskId = this.idGenerator();
    return this.database.transaction(async (transaction) => {
      const db = transaction as unknown as DbExecutor;
      const cached = await this.findReusableCache(db, identity);
      if (cached) {
        return this.reuseCachedTask(db, userId, cached);
      }

      const active = await this.findActiveTask(db, identity);
      if (active) {
        await this.addParticipant(db, active.id, userId);
        return {
          reuse: "active_task" as const,
          snapshot: await this.snapshotForUser(db, active, userId),
        };
      }
      const refreshedCache = await this.findReusableCache(db, identity);
      if (refreshedCache) {
        return this.reuseCachedTask(db, userId, refreshedCache);
      }

      const deadlineAt = new Date(
        requestedAt.getTime() + GENERATION_DEADLINE_MS,
      );
      const inserted = await transaction
        .insert(generationTask)
        .values({
          id: taskId,
          topic,
          normalizedTopic: identity.normalizedTopic,
          pipelineVersion: identity.pipelineVersion,
          sourceAdapterVersion: identity.sourceAdapterVersion,
          modelAdapterVersion: identity.modelAdapterVersion,
          status: "queued",
          stage: "queued",
          sequence: 1,
          deadlineAt,
          nextAttemptAt: requestedAt,
          retryCount: 0,
          failureCode: null,
          failureRetryable: null,
          createdAt: requestedAt,
          updatedAt: requestedAt,
          completedAt: null,
        })
        .onConflictDoNothing()
        .returning();
      const task = inserted[0]
        ? asTaskRow(inserted[0])
        : await this.findActiveTask(db, identity);
      if (!task) {
        throw new GenerationTaskFailure("internal_failure", false);
      }
      const wasCreated = inserted.length > 0;
      if (wasCreated && this.reserveRateLimit) {
        await this.reserveRateLimit(transaction, userId, requestedAt);
      }
      await this.addParticipant(db, task.id, userId);
      if (wasCreated) {
        await transaction.insert(generationCheckpoint).values({
          taskId: task.id,
          stage: "queued",
          operationKey: STAGE_CHECKPOINT_KEY,
          input: { topic },
          output: null,
          attemptCount: 0,
          completedAt: null,
          updatedAt: requestedAt,
        });
        await transaction.insert(generationEvent).values({
          taskId: task.id,
          sequence: 1,
          type: "snapshot",
          data: { status: "queued", stage: "queued" },
          occurredAt: requestedAt,
        });
      }
      return {
        reuse: wasCreated ? ("created" as const) : ("active_task" as const),
        snapshot: await this.snapshotForUser(db, task, userId),
      };
    });
  }

  async getGeneration(userId: string, taskId: string) {
    const task = await this.findAuthorizedTask(userId, taskId);
    return task ? this.snapshotForUser(this.database, task, userId) : null;
  }

  async readEvents(userId: string, taskId: string, afterSequence: number) {
    const task = await this.findAuthorizedTask(userId, taskId);
    if (!task) {
      return null;
    }
    const cursor =
      Number.isInteger(afterSequence) && afterSequence >= 0 ? afterSequence : 0;
    const events = await this.database
      .select()
      .from(generationEvent)
      .where(
        and(
          eq(generationEvent.taskId, taskId),
          gt(generationEvent.sequence, cursor),
        ),
      )
      .orderBy(asc(generationEvent.sequence));
    const first = await this.database
      .select({ sequence: generationEvent.sequence })
      .from(generationEvent)
      .where(eq(generationEvent.taskId, taskId))
      .orderBy(asc(generationEvent.sequence))
      .limit(1);
    const firstSequence = first[0] ? Number(first[0].sequence) : null;
    const historyUnavailable =
      cursor > Number(task.sequence) ||
      (firstSequence !== null && cursor < firstSequence - 1) ||
      (firstSequence === null && Number(task.sequence) > cursor);
    const mappedEvents = events.map((event) => toEvent(taskId, event));
    const terminalCursor =
      (task.status === "succeeded" || task.status === "failed") &&
      cursor === Number(task.sequence);
    if (terminalCursor) {
      return {
        kind: "snapshot" as const,
        snapshot: await this.snapshotForUser(this.database, task, userId),
        events: mappedEvents,
      };
    }
    if (historyUnavailable) {
      return {
        kind: "snapshot" as const,
        snapshot: await this.snapshotForUser(this.database, task, userId),
        events: mappedEvents,
      };
    }
    return { kind: "events" as const, events: mappedEvents };
  }

  async claimTask(workerId: string): Promise<TaskRow | null> {
    const now = this.now();
    const candidates = await this.database
      .select(taskProjection)
      .from(generationTask)
      .where(
        and(
          notInArray(generationTask.status, ["succeeded", "failed"]),
          lt(generationTask.nextAttemptAt, new Date(now.getTime() + 1)),
          or(
            isNull(generationTask.leaseExpiresAt),
            lt(generationTask.leaseExpiresAt, now),
          ),
        ),
      )
      .orderBy(asc(generationTask.nextAttemptAt), asc(generationTask.createdAt))
      .limit(1);
    const candidate = candidates[0];
    if (!candidate) {
      return null;
    }
    const claimed = await this.database
      .update(generationTask)
      .set({
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS),
        heartbeatAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(generationTask.id, candidate.id),
          notInArray(generationTask.status, ["succeeded", "failed"]),
          or(
            isNull(generationTask.leaseExpiresAt),
            lt(generationTask.leaseExpiresAt, now),
          ),
        ),
      )
      .returning();
    return claimed[0] ? asTaskRow(claimed[0]) : null;
  }

  async renewLease(taskId: string, workerId: string): Promise<void> {
    const now = this.now();
    const renewed = await this.database
      .update(generationTask)
      .set({
        leaseExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS),
        heartbeatAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(generationTask.id, taskId),
          eq(generationTask.leaseOwner, workerId),
          gt(generationTask.leaseExpiresAt, now),
        ),
      )
      .returning({ id: generationTask.id });
    if (renewed.length === 0) {
      throw new GenerationLeaseLostError();
    }
  }

  async failTask(
    taskId: string,
    workerId: string,
    failure: GenerationTaskFailure,
  ): Promise<void> {
    const now = this.now();
    await this.database.transaction(async (transaction) => {
      const db = transaction as unknown as DbExecutor;
      const currentRows = await db
        .select(taskProjection)
        .from(generationTask)
        .where(
          and(
            eq(generationTask.id, taskId),
            eq(generationTask.leaseOwner, workerId),
            gt(generationTask.leaseExpiresAt, now),
          ),
        )
        .limit(1)
        .for("update");
      const current = currentRows[0] ? asTaskRow(currentRows[0]) : null;
      if (!current || current.status === "succeeded") {
        throw new GenerationLeaseLostError();
      }
      if (current.status === "failed") {
        return;
      }
      const sequence = Number(current.sequence) + 1;
      const failureNow = this.now();
      const failed = await transaction
        .update(generationTask)
        .set({
          status: "failed",
          failureCode: failure.category,
          failureRetryable: failure.retryable,
          updatedAt: failureNow,
          completedAt: failureNow,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: failureNow,
          sequence,
        })
        .where(
          and(
            eq(generationTask.id, taskId),
            eq(generationTask.status, current.status),
            eq(generationTask.leaseOwner, workerId),
            gt(generationTask.leaseExpiresAt, failureNow),
          ),
        )
        .returning({ id: generationTask.id });
      if (failed.length === 0) {
        throw new GenerationLeaseLostError();
      }
      await transaction.insert(generationEvent).values({
        taskId,
        sequence,
        type: "failed",
        data: {
          status: "failed",
          stage: current.stage,
          code: failure.category,
          failure: {
            code: failure.category,
            retryable: failure.retryable,
          },
        },
        occurredAt: failureNow,
      });
    });
  }

  async recordAttempt(
    taskId: string,
    workerId: string,
    stage: TaskRow["stage"],
    operationKey: string,
    input: (attempt: number) => unknown,
    progress?: GenerationProgress,
    modelMaxAttempts?: number,
  ): Promise<number> {
    const now = this.now();
    let recordedAttempt = 1;
    await this.database.transaction(async (transaction) => {
      const previousRows = await transaction
        .select({ attemptCount: generationCheckpoint.attemptCount })
        .from(generationCheckpoint)
        .where(
          and(
            eq(generationCheckpoint.taskId, taskId),
            eq(generationCheckpoint.stage, stage),
            eq(generationCheckpoint.operationKey, operationKey),
          ),
        )
        .limit(1)
        .for("update");
      recordedAttempt = Number(previousRows[0]?.attemptCount ?? 0) + 1;
      const attemptInput = input(recordedAttempt);
      await transaction
        .insert(generationCheckpoint)
        .values({
          taskId,
          stage,
          operationKey,
          input: attemptInput,
          output: null,
          attemptCount: recordedAttempt,
          completedAt: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            generationCheckpoint.taskId,
            generationCheckpoint.stage,
            generationCheckpoint.operationKey,
          ],
          set: {
            attemptCount: recordedAttempt,
            input: attemptInput,
            output: null,
            completedAt: null,
            updatedAt: now,
          },
        });
      const renewed = await transaction
        .update(generationTask)
        .set({
          retryCount: sql`${generationTask.retryCount} + 1`,
          sequence: sql`${generationTask.sequence} + 1`,
          leaseExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS),
          heartbeatAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(generationTask.id, taskId),
            eq(generationTask.leaseOwner, workerId),
            eq(generationTask.stage, stage),
            gt(generationTask.leaseExpiresAt, now),
          ),
        )
        .returning({
          id: generationTask.id,
          sequence: generationTask.sequence,
        });
      if (renewed.length === 0) {
        throw new GenerationLeaseLostError();
      }
      await transaction.insert(generationEvent).values({
        taskId,
        sequence: Number(renewed[0]!.sequence),
        type: "progress",
        data: {
          status: stage,
          stage,
          ...(modelMaxAttempts === undefined
            ? {}
            : {
                model: {
                  attempt: recordedAttempt,
                  maxAttempts: modelMaxAttempts,
                },
              }),
          ...(progress ?? {}),
        },
        occurredAt: now,
      });
    });
    return recordedAttempt;
  }
  async publishProgress(
    taskId: string,
    workerId: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const now = this.now();
    await this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(generationTask)
        .set({
          sequence: sql`${generationTask.sequence} + 1`,
          leaseExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS),
          heartbeatAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(generationTask.id, taskId),
            eq(generationTask.leaseOwner, workerId),
            notInArray(generationTask.status, ["succeeded", "failed"]),
            gt(generationTask.leaseExpiresAt, now),
          ),
        )
        .returning({ sequence: generationTask.sequence });
      if (updated.length === 0) {
        throw new GenerationLeaseLostError();
      }
      await transaction.insert(generationEvent).values({
        taskId,
        sequence: Number(updated[0]!.sequence),
        type: "progress",
        data,
        occurredAt: now,
      });
    });
  }

  async consumeAutomaticRecovery(
    taskId: string,
    workerId: string,
    stage: TaskRow["stage"],
    attempt: number,
  ): Promise<
    Readonly<{
      allowed: boolean;
      used: number;
      progress: GenerationProgress;
    }>
  > {
    const now = this.now();
    return this.database.transaction(async (transaction) => {
      const currentRows = await transaction
        .select({ status: generationTask.status, stage: generationTask.stage })
        .from(generationTask)
        .where(
          and(
            eq(generationTask.id, taskId),
            eq(generationTask.leaseOwner, workerId),
            eq(generationTask.stage, stage),
            notInArray(generationTask.status, ["succeeded", "failed"]),
            gt(generationTask.leaseExpiresAt, now),
          ),
        )
        .limit(1)
        .for("update");
      const current = currentRows[0];
      if (!current) {
        throw new GenerationLeaseLostError();
      }
      const completedStageRows = await transaction
        .select({
          stage: generationCheckpoint.stage,
          completedAt: generationCheckpoint.completedAt,
        })
        .from(generationCheckpoint)
        .where(
          and(
            eq(generationCheckpoint.taskId, taskId),
            eq(generationCheckpoint.operationKey, STAGE_CHECKPOINT_KEY),
          ),
        );
      const reusedStages = sortGenerationStages(
        completedStageRows
          .filter((row) => row.completedAt !== null && row.stage !== stage)
          .map((row) => row.stage),
      );
      const budgetRows = await transaction
        .select({ output: generationCheckpoint.output })
        .from(generationCheckpoint)
        .where(
          and(
            eq(generationCheckpoint.taskId, taskId),
            eq(generationCheckpoint.stage, "queued"),
            eq(generationCheckpoint.operationKey, TASK_RECOVERY_CHECKPOINT_KEY),
          ),
        )
        .limit(1)
        .for("update");
      const budgetRow = budgetRows[0];
      let used = 0;
      if (budgetRow) {
        const budget = asRecord(budgetRow.output);
        if (
          typeof budget?.used !== "number" ||
          !isSafeInteger(budget.used) ||
          budget.used < 0 ||
          budget.used > MAX_TASK_AUTO_RECOVERIES
        ) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        used = budget.used;
      }
      const allowed = used < MAX_TASK_AUTO_RECOVERIES;
      const nextUsed = allowed ? used + 1 : used;
      if (allowed) {
        await transaction
          .insert(generationCheckpoint)
          .values({
            taskId,
            stage: "queued",
            operationKey: TASK_RECOVERY_CHECKPOINT_KEY,
            input: { limit: MAX_TASK_AUTO_RECOVERIES },
            output: { used: nextUsed },
            attemptCount: 0,
            completedAt: null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              generationCheckpoint.taskId,
              generationCheckpoint.stage,
              generationCheckpoint.operationKey,
            ],
            set: {
              output: { used: nextUsed },
              updatedAt: now,
            },
          });
      }
      const nextAttempt = Math.min(attempt + 1, MODEL_MAX_ATTEMPTS);
      const refreshed = await transaction
        .update(generationTask)
        .set({
          sequence: sql`${generationTask.sequence} + 1`,
          leaseExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS),
          heartbeatAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(generationTask.id, taskId),
            eq(generationTask.leaseOwner, workerId),
            eq(generationTask.stage, stage),
            gt(generationTask.leaseExpiresAt, now),
          ),
        )
        .returning({ sequence: generationTask.sequence });
      if (refreshed.length === 0) {
        throw new GenerationLeaseLostError();
      }
      const recoveryProgress: GenerationProgress = {
        recovery: {
          reason: "model_output_invalid",
          state: allowed ? "started" : "exhausted",
          attempt: nextAttempt,
          maxAttempts: MODEL_MAX_ATTEMPTS,
          used: nextUsed,
          limit: MAX_TASK_AUTO_RECOVERIES,
        },
        ...(reusedStages.length > 0 ? { reusedStages } : {}),
      };
      await transaction.insert(generationEvent).values({
        taskId,
        sequence: Number(refreshed[0]!.sequence),
        type: "progress",
        data: {
          status: current.status,
          stage,
          model: { attempt: nextAttempt, maxAttempts: MODEL_MAX_ATTEMPTS },
          ...recoveryProgress,
        },
        occurredAt: now,
      });
      return { allowed, used: nextUsed, progress: recoveryProgress };
    });
  }

  async resetAttempt(
    taskId: string,
    workerId: string,
    stage: TaskRow["stage"],
    operationKey: string,
  ): Promise<void> {
    const now = this.now();
    await this.database.transaction(async (transaction) => {
      const owner = await transaction
        .update(generationTask)
        .set({
          leaseExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS),
          heartbeatAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(generationTask.id, taskId),
            eq(generationTask.leaseOwner, workerId),
            eq(generationTask.stage, stage),
            gt(generationTask.leaseExpiresAt, now),
          ),
        )
        .returning({ id: generationTask.id });
      if (owner.length === 0) {
        throw new GenerationLeaseLostError();
      }
      await transaction
        .update(generationCheckpoint)
        .set({ attemptCount: 0, updatedAt: now })
        .where(
          and(
            eq(generationCheckpoint.taskId, taskId),
            eq(generationCheckpoint.stage, stage),
            eq(generationCheckpoint.operationKey, operationKey),
          ),
        );
    });
  }

  async completeStage(
    taskId: string,
    workerId: string,
    from: TaskRow["status"],
    to: TaskRow["status"],
    stage: TaskRow["stage"],
    input: unknown,
    output: unknown,
  ): Promise<void> {
    assertGenerationTransition(from, to);
    const now = this.now();
    await this.database.transaction(async (transaction) => {
      await transaction
        .insert(generationCheckpoint)
        .values({
          taskId,
          stage,
          operationKey: STAGE_CHECKPOINT_KEY,
          input,
          output,
          attemptCount: 0,
          completedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            generationCheckpoint.taskId,
            generationCheckpoint.stage,
            generationCheckpoint.operationKey,
          ],
          set: { input, output, completedAt: now, updatedAt: now },
        });
      await this.transitionInTransaction(
        transaction,
        taskId,
        workerId,
        from,
        to,
        stage,
        now,
      );
    });
  }

  async getCheckpoints(taskId: string): Promise<Map<string, CheckpointRow>> {
    const rows = await this.database
      .select()
      .from(generationCheckpoint)
      .where(
        and(
          eq(generationCheckpoint.taskId, taskId),
          eq(generationCheckpoint.operationKey, STAGE_CHECKPOINT_KEY),
        ),
      );
    return new Map(rows.map((row) => [row.stage, asCheckpointRow(row)]));
  }

  async publishCandidate(
    task: TaskRow,
    workerId: string,
    candidate: GenerationCandidate,
  ): Promise<{
    mapId: string;
    versionId: string;
    questionSetId: string;
  }> {
    const validated = validateGenerationCandidate(candidate);
    const mapId = stableMapId(task.normalizedTopic);
    const versionId = `map_version_${task.id}`;
    const questionSetId = `question_set_${task.id}`;
    const now = this.now();
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql.raw(`SET LOCAL statement_timeout = ${LOCAL_OPERATION_TIMEOUT_MS}`),
      );
      const current = await transaction
        .select(taskProjection)
        .from(generationTask)
        .where(
          and(
            eq(generationTask.id, task.id),
            eq(generationTask.status, "publishing"),
            eq(generationTask.leaseOwner, workerId),
            gt(generationTask.leaseExpiresAt, now),
          ),
        )
        .limit(1)
        .for("update");
      if (!current[0]) {
        throw new GenerationLeaseLostError();
      }

      await transaction
        .insert(learningMap)
        .values({ id: mapId })
        .onConflictDoNothing({ target: learningMap.id });
      await transaction.insert(learningMapVersion).values({
        id: versionId,
        mapId,
        title: validated.map.title,
        summary: validated.map.summary,
        status: "draft",
        publishedAt: null,
      });
      await transaction.insert(learningMapNode).values(
        validated.map.nodes.map((node) => ({
          versionId,
          nodeId: node.nodeId,
          title: node.title,
          learningObjective: node.learningObjective,
        })),
      );
      await transaction.insert(knowledgeSource).values(
        validated.sources.map((source) => ({
          versionId,
          sourceId: source.sourceId,
          title: source.title,
          excerpt: source.excerpt,
          url: source.url,
          authorName: source.authorName,
          contentType: source.contentType,
          updatedAt: source.updatedAt,
          authorityLevel: source.authorityLevel,
          rankingScore: source.rankingScore,
        })),
      );
      await transaction.insert(learningMapNodeSource).values(
        validated.map.nodes.flatMap((node) =>
          node.sourceIds.map((sourceId) => ({
            versionId,
            nodeId: node.nodeId,
            sourceId,
          })),
        ),
      );
      if (validated.map.prerequisites.length > 0) {
        await transaction.insert(learningMapPrerequisite).values(
          validated.map.prerequisites.map((edge) => ({
            versionId,
            nodeId: edge.nodeId,
            prerequisiteNodeId: edge.prerequisiteNodeId,
          })),
        );
      }
      if (validated.viewpoints.length > 0) {
        await transaction.insert(learningViewpoint).values(
          validated.viewpoints.map((viewpoint) => ({
            versionId,
            nodeId: viewpoint.nodeId,
            viewpointId: viewpoint.viewpointId,
            kind: viewpoint.kind,
            statement: viewpoint.statement,
            conditions: viewpoint.conditions,
          })),
        );
        await transaction.insert(learningViewpointSource).values(
          validated.viewpoints.flatMap((viewpoint) =>
            viewpoint.sourceIds.map((sourceId) => ({
              versionId,
              nodeId: viewpoint.nodeId,
              viewpointId: viewpoint.viewpointId,
              sourceId,
            })),
          ),
        );
      }

      await transaction.insert(learningAssessmentQuestionSet).values({
        id: questionSetId,
        versionId,
        status: "draft",
        publishedAt: null,
      });
      await transaction.insert(learningAssessmentQuestion).values(
        validated.questions.map((question, position) => ({
          questionSetId,
          questionId: question.questionId,
          versionId,
          nodeId: question.nodeId,
          position,
          type: question.type,
          prompt: question.prompt,
          explanation: question.explanation,
        })),
      );
      const matchingSidesByQuestion = new Map(
        validated.questions.map((question) => [
          question.questionId,
          new Map(
            (question.correctMatches ?? []).flatMap((match) => [
              [match.leftOptionId, "left" as const],
              [match.rightOptionId, "right" as const],
            ]),
          ),
        ]),
      );
      await transaction.insert(learningAssessmentQuestionOption).values(
        validated.questions.flatMap((question) =>
          question.options.map((option, position) => ({
            questionSetId,
            questionId: question.questionId,
            optionId: option.optionId,
            label: option.label,
            position,
            side:
              matchingSidesByQuestion
                .get(question.questionId)
                ?.get(option.optionId) ?? null,
          })),
        ),
      );
      const correctOptions = validated.questions.flatMap((question) =>
        (question.correctOptionIds ?? []).map((optionId) => ({
          questionSetId,
          questionId: question.questionId,
          optionId,
        })),
      );
      if (correctOptions.length > 0) {
        await transaction
          .insert(learningAssessmentQuestionCorrectOption)
          .values(correctOptions);
      }
      const matchingAnswers = validated.questions.flatMap((question) =>
        (question.correctMatches ?? []).map((match) => ({
          questionSetId,
          questionId: question.questionId,
          leftOptionId: match.leftOptionId,
          rightOptionId: match.rightOptionId,
        })),
      );
      if (matchingAnswers.length > 0) {
        await transaction
          .insert(learningAssessmentQuestionMatchingAnswer)
          .values(matchingAnswers);
      }
      await transaction.insert(learningAssessmentQuestionSource).values(
        validated.questions.flatMap((question) =>
          question.sourceIds.map((sourceId) => ({
            questionSetId,
            questionId: question.questionId,
            versionId,
            nodeId: question.nodeId,
            sourceId,
          })),
        ),
      );
      await transaction
        .update(learningMapVersion)
        .set({ status: "published", publishedAt: now })
        .where(
          and(
            eq(learningMapVersion.id, versionId),
            eq(learningMapVersion.status, "draft"),
          ),
        );
      await transaction
        .update(learningAssessmentQuestionSet)
        .set({ status: "published", publishedAt: now })
        .where(
          and(
            eq(learningAssessmentQuestionSet.id, questionSetId),
            eq(learningAssessmentQuestionSet.status, "draft"),
          ),
        );

      const participants = await transaction
        .select({ userId: generationParticipant.userId })
        .from(generationParticipant)
        .where(eq(generationParticipant.taskId, task.id));
      if (participants.length === 0) {
        throw new GenerationTaskFailure("internal_failure", false);
      }
      for (const participant of participants) {
        await transaction
          .insert(learningRelationship)
          .values({
            id: `learning_${this.idGenerator()}`,
            userId: participant.userId,
            versionId,
            questionSetId,
          })
          .onConflictDoUpdate({
            target: [
              learningRelationship.userId,
              learningRelationship.versionId,
            ],
            set: {
              questionSetId: sql`COALESCE(${learningRelationship.questionSetId}, ${questionSetId})`,
            },
          });
      }

      const sequence = Number(current[0]!.sequence) + 1;
      const completionNow = this.now();
      const completed = await transaction
        .update(generationTask)
        .set({
          status: "succeeded",
          stage: "publishing",
          mapId,
          versionId,
          questionSetId,
          failureCode: null,
          failureRetryable: null,
          sequence,
          updatedAt: completionNow,
          completedAt: completionNow,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: completionNow,
        })
        .where(
          and(
            eq(generationTask.id, task.id),
            eq(generationTask.status, "publishing"),
            eq(generationTask.leaseOwner, workerId),
            gt(generationTask.leaseExpiresAt, completionNow),
          ),
        )
        .returning({ id: generationTask.id });
      if (completed.length === 0) {
        throw new GenerationLeaseLostError();
      }
      await transaction
        .insert(generationCache)
        .values({
          normalizedTopic: task.normalizedTopic,
          pipelineVersion: task.pipelineVersion,
          sourceAdapterVersion: task.sourceAdapterVersion,
          modelAdapterVersion: task.modelAdapterVersion,
          taskId: task.id,
          mapId,
          versionId,
          questionSetId,
          createdAt: completionNow,
        })
        .onConflictDoUpdate({
          target: [
            generationCache.normalizedTopic,
            generationCache.pipelineVersion,
            generationCache.sourceAdapterVersion,
            generationCache.modelAdapterVersion,
          ],
          set: {
            taskId: task.id,
            mapId,
            versionId,
            questionSetId,
            createdAt: completionNow,
          },
        });
      await transaction.insert(generationEvent).values({
        taskId: task.id,
        sequence,
        type: "succeeded",
        data: { status: "succeeded", mapId, versionId, questionSetId },
        occurredAt: completionNow,
      });
    });
    return { mapId, versionId, questionSetId };
  }

  private async reuseCachedTask(
    db: DbExecutor,
    userId: string,
    cached: CacheRow,
  ) {
    await this.addParticipant(db, cached.taskId, userId);
    const relationshipId = await this.ensureLearningRelationship(
      db,
      userId,
      cached.versionId,
      cached.questionSetId,
    );
    const task = await this.findTaskById(db, cached.taskId);
    if (!task) {
      throw new GenerationTaskFailure("internal_failure", false);
    }
    return {
      reuse: "cache" as const,
      snapshot: toSnapshot(task, relationshipId),
    };
  }

  async findReusableCache(
    db: DbExecutor,
    identity: ReturnType<typeof createGenerationIdentity>,
  ): Promise<CacheRow | null> {
    const rows = await db
      .select({
        taskId: generationCache.taskId,
        mapId: generationCache.mapId,
        versionId: generationCache.versionId,
        questionSetId: generationCache.questionSetId,
      })
      .from(generationCache)
      .innerJoin(generationTask, eq(generationTask.id, generationCache.taskId))
      .innerJoin(
        learningMapVersion,
        and(
          eq(learningMapVersion.id, generationCache.versionId),
          eq(learningMapVersion.status, "published"),
        ),
      )
      .innerJoin(
        learningAssessmentQuestionSet,
        and(
          eq(learningAssessmentQuestionSet.id, generationCache.questionSetId),
          eq(learningAssessmentQuestionSet.status, "published"),
        ),
      )
      .where(
        and(
          gt(
            generationCache.createdAt,
            new Date(this.now().getTime() - GENERATION_CACHE_TTL_MS),
          ),
          eq(generationCache.normalizedTopic, identity.normalizedTopic),
          eq(generationCache.pipelineVersion, identity.pipelineVersion),
          eq(
            generationCache.sourceAdapterVersion,
            identity.sourceAdapterVersion,
          ),
          eq(generationCache.modelAdapterVersion, identity.modelAdapterVersion),
          eq(generationTask.status, "succeeded"),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async findActiveTask(
    db: DbExecutor,
    identity: ReturnType<typeof createGenerationIdentity>,
  ): Promise<TaskRow | null> {
    const rows = await db
      .select(taskProjection)
      .from(generationTask)
      .where(
        and(
          eq(generationTask.normalizedTopic, identity.normalizedTopic),
          eq(generationTask.pipelineVersion, identity.pipelineVersion),
          eq(
            generationTask.sourceAdapterVersion,
            identity.sourceAdapterVersion,
          ),
          eq(generationTask.modelAdapterVersion, identity.modelAdapterVersion),
          notInArray(generationTask.status, ["succeeded", "failed"]),
        ),
      )
      .orderBy(desc(generationTask.createdAt))
      .limit(1)
      .for("update");
    return rows[0] ? asTaskRow(rows[0]) : null;
  }

  private async findTaskById(
    db: DbExecutor,
    taskId: string,
  ): Promise<TaskRow | null> {
    const rows = await db
      .select(taskProjection)
      .from(generationTask)
      .where(eq(generationTask.id, taskId))
      .limit(1);
    return rows[0] ? asTaskRow(rows[0]) : null;
  }

  private async findAuthorizedTask(
    userId: string,
    taskId: string,
  ): Promise<TaskRow | null> {
    const rows = await this.database
      .select(taskProjection)
      .from(generationTask)
      .innerJoin(
        generationParticipant,
        and(
          eq(generationParticipant.taskId, generationTask.id),
          eq(generationParticipant.userId, userId),
        ),
      )
      .where(eq(generationTask.id, taskId))
      .limit(1);
    return rows[0] ? asTaskRow(rows[0]) : null;
  }

  private async latestProgressData(
    db: DbExecutor,
    taskId: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = await db
      .select({ data: generationEvent.data })
      .from(generationEvent)
      .where(
        and(
          eq(generationEvent.taskId, taskId),
          eq(generationEvent.type, "progress"),
        ),
      )
      .orderBy(desc(generationEvent.sequence))
      .limit(1);
    return asRecord(rows[0]?.data);
  }

  private async snapshotForUser(db: DbExecutor, task: TaskRow, userId: string) {
    let relationshipId: string | null = null;
    if (task.versionId) {
      const rows = await db
        .select({ id: learningRelationship.id })
        .from(learningRelationship)
        .where(
          and(
            eq(learningRelationship.userId, userId),
            eq(learningRelationship.versionId, task.versionId),
          ),
        )
        .limit(1);
      relationshipId = rows[0]?.id ?? null;
    }
    const progress =
      task.status === "failed" || task.status === "succeeded"
        ? undefined
        : readProgress(await this.latestProgressData(db, task.id));
    return toSnapshot(task, relationshipId, progress);
  }

  private async addParticipant(
    db: DbExecutor,
    taskId: string,
    userId: string,
  ): Promise<void> {
    await db
      .insert(generationParticipant)
      .values({ taskId, userId, joinedAt: this.now() })
      .onConflictDoNothing({
        target: [generationParticipant.taskId, generationParticipant.userId],
      });
  }

  private async ensureLearningRelationship(
    db: DbExecutor,
    userId: string,
    versionId: string,
    questionSetId: string,
  ): Promise<string> {
    const relationships = await db
      .insert(learningRelationship)
      .values({
        id: `learning_${this.idGenerator()}`,
        userId,
        versionId,
        questionSetId,
      })
      .onConflictDoUpdate({
        target: [learningRelationship.userId, learningRelationship.versionId],
        set: {
          questionSetId: sql`COALESCE(${learningRelationship.questionSetId}, ${questionSetId})`,
        },
      })
      .returning({ id: learningRelationship.id });
    const relationship = relationships[0];
    if (!relationship) {
      throw new GenerationTaskFailure("internal_failure", false);
    }
    return relationship.id;
  }

  private async transitionInTransaction(
    transaction: unknown,
    taskId: string,
    workerId: string,
    from: TaskRow["status"],
    to: TaskRow["status"],
    stage: TaskRow["stage"],
    now: Date,
  ): Promise<void> {
    const db = transaction as DbExecutor;
    const nextStage = to === "succeeded" || to === "failed" ? stage : to;
    const rows = await db
      .update(generationTask)
      .set({
        status: to,
        stage: nextStage,
        sequence: sql`${generationTask.sequence} + 1`,
        updatedAt: now,
        leaseExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS),
        heartbeatAt: now,
      })
      .where(
        and(
          eq(generationTask.id, taskId),
          eq(generationTask.status, from),
          eq(generationTask.leaseOwner, workerId),
          gt(generationTask.leaseExpiresAt, now),
        ),
      )
      .returning({ sequence: generationTask.sequence });
    if (rows.length === 0) {
      throw new GenerationLeaseLostError();
    }
    await db.insert(generationEvent).values({
      taskId,
      sequence: Number(rows[0]!.sequence),
      type: to === "failed" ? "failed" : "progress",
      data: { status: to, stage: nextStage },
      occurredAt: now,
    });
  }
}

export class MapGenerationWorker {
  constructor(
    private readonly repository: DrizzleMapGenerationRepository,
    private readonly sourceSearch: GenerationSourceSearchPort,
    private readonly structuredModel: GenerationStructuredModelPort,
    private readonly externalRequestTimeouts: GenerationExternalRequestTimeouts,
    private readonly now: GenerationClock,
    private readonly sleep: GenerationSleeper,
    private readonly scheduleHeartbeat: GenerationHeartbeatScheduler,
  ) {}

  async runOnce(workerId: string): Promise<boolean> {
    const task = await this.repository.claimTask(workerId);
    if (!task) {
      return false;
    }
    let taskError: unknown = null;
    let stopHeartbeat: (() => Promise<void>) | null = null;
    try {
      stopHeartbeat = this.startLeaseHeartbeat(task.id, workerId);
      await this.runTask(task, workerId);
    } catch (error) {
      taskError = error;
    } finally {
      if (stopHeartbeat) {
        try {
          await stopHeartbeat();
        } catch (error) {
          if (taskError === null) {
            taskError = error;
          }
        }
      }
    }
    if (taskError instanceof GenerationLeaseLostError) {
      return true;
    }
    if (taskError !== null) {
      const failure =
        taskError instanceof GenerationTaskFailure
          ? taskError
          : new GenerationTaskFailure("internal_failure", false);
      try {
        await this.repository.failTask(task.id, workerId, failure);
      } catch (failureError) {
        if (!(failureError instanceof GenerationLeaseLostError)) {
          throw failureError;
        }
      }
    }
    return true;
  }

  private startLeaseHeartbeat(
    taskId: string,
    workerId: string,
  ): () => Promise<void> {
    let stopped = false;
    let inFlight: Promise<void> | null = null;
    let failure: unknown = null;
    const tick = () => {
      if (stopped || inFlight || failure) {
        return;
      }
      inFlight = this.repository
        .renewLease(taskId, workerId)
        .catch((error: unknown) => {
          failure = error;
        })
        .finally(() => {
          inFlight = null;
        });
    };
    const cancel = this.scheduleHeartbeat(tick, GENERATION_HEARTBEAT_MS);
    return async () => {
      stopped = true;
      cancel();
      const pending = inFlight;
      if (pending) {
        await pending;
      }
      if (failure !== null) {
        throw failure;
      }
    };
  }

  private async runTask(task: TaskRow, workerId: string): Promise<void> {
    let status = task.status;
    const checkpoints = await this.repository.getCheckpoints(task.id);
    const stageOutputs = new Map<string, unknown>(
      [...checkpoints].map(([stage, checkpoint]) => [stage, checkpoint.output]),
    );
    const output = <T>(stage: TaskRow["stage"]): T | null => {
      const value = stageOutputs.get(stage);
      return value === null || value === undefined ? null : (value as T);
    };
    const reusedStages = sortGenerationStages(
      [...checkpoints]
        .filter(
          ([stage, checkpoint]) =>
            stage !== status &&
            checkpoint.completedAt !== null &&
            checkpoint.output !== null,
        )
        .map(([stage]) => stage as TaskRow["stage"]),
    );
    if (reusedStages.length > 0) {
      await this.repository.publishProgress(task.id, workerId, {
        status,
        stage: task.stage,
        reusedStages,
      });
    }
    while (status !== "succeeded" && status !== "failed") {
      this.assertDeadline(task);
      if (status === "queued") {
        await this.repository.completeStage(
          task.id,
          workerId,
          "queued",
          "normalizing",
          "queued",
          { topic: task.topic },
          { accepted: true },
        );
        stageOutputs.set("queued", { accepted: true });
        status = "normalizing";
        continue;
      }
      if (status === "normalizing") {
        const identity = {
          normalizedTopic: normalizeGenerationTopic(task.topic),
          pipelineVersion: task.pipelineVersion,
          sourceAdapterVersion: task.sourceAdapterVersion,
          modelAdapterVersion: task.modelAdapterVersion,
        };
        await this.repository.completeStage(
          task.id,
          workerId,
          "normalizing",
          "cache_lookup",
          "normalizing",
          { topic: task.topic },
          identity,
        );
        stageOutputs.set("normalizing", identity);
        status = "cache_lookup";
        continue;
      }
      if (status === "cache_lookup") {
        const cache = await this.findCache(task);
        if (cache) {
          await this.completeCachedTask(task, workerId, cache);
          return;
        }
        await this.repository.completeStage(
          task.id,
          workerId,
          "cache_lookup",
          "planning",
          "cache_lookup",
          { identity: task.normalizedTopic },
          { hit: false },
        );
        stageOutputs.set("cache_lookup", { hit: false });
        status = "planning";
        continue;
      }
      if (status === "planning") {
        const planned = await this.callModel(
          task,
          workerId,
          "planning",
          "planning",
          (attempt) => ({ topic: task.topic, attempt }),
          () =>
            this.structuredModel.planDirections({
              topic: task.topic,
              requestId: `${task.id}:planning`,
              timeoutMs: this.externalTimeout(task, "model"),
            }),
        );
        await this.repository.completeStage(
          task.id,
          workerId,
          "planning",
          "searching",
          "planning",
          { topic: task.topic },
          planned,
        );
        stageOutputs.set("planning", planned);
        status = "searching";
        continue;
      }
      if (status === "searching") {
        const planned = output<{
          directions: readonly GenerationDirectionCandidate[];
        }>("planning");
        if (!planned || !isArray(planned.directions)) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        const searched = await this.searchDirections(
          task,
          workerId,
          planned.directions,
        );
        if (searched.sources.length === 0) {
          throw new GenerationTaskFailure("source_insufficient", false);
        }
        await this.repository.completeStage(
          task.id,
          workerId,
          "searching",
          "structuring",
          "searching",
          { directions: planned.directions },
          searched,
        );
        stageOutputs.set("searching", searched);
        status = "structuring";
        continue;
      }
      if (status === "structuring") {
        const planned = output<{
          directions: readonly GenerationDirectionCandidate[];
        }>("planning");
        const searched = output<SearchStageOutput>("searching");
        if (!planned || !searched) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        const budgetForAttempt = (attempt: number): ModelContextBudget =>
          createModelContextBudget({
            attempt,
            directions: planned.directions,
            sources: searched.sources,
            sourceIdsByDirection: searched.sourceIdsByDirection,
          });
        let successfulBudget = budgetForAttempt(1);
        const structured = await this.callModel(
          task,
          workerId,
          "structuring",
          "structuring",
          (attempt) => {
            const budget = budgetForAttempt(attempt);
            return {
              directions: planned.directions,
              sources: budget.sources,
              contextBudget: {
                strategy: budget.strategy,
                attempt: budget.attempt,
                serializedChars: budget.serializedChars,
              },
            };
          },
          (attempt) => {
            successfulBudget = budgetForAttempt(attempt);
            const sources = successfulBudget.sources;
            return this.structuredModel
              .structureMap({
                topic: task.topic,
                directions: planned.directions,
                sources,
                requestId: `${task.id}:structuring`,
                timeoutMs: this.externalTimeout(task, "model"),
              })
              .then((value) => {
                assertModelOutputHasNoUrl(value, "structuring");
                return value;
              });
          },
        );
        const completedBudget = successfulBudget;
        await this.repository.completeStage(
          task.id,
          workerId,
          "structuring",
          "supplementing",
          "structuring",
          {
            directions: planned.directions,
            sources: completedBudget.sources,
            contextBudget: {
              strategy: completedBudget.strategy,
              attempt: completedBudget.attempt,
              serializedChars: completedBudget.serializedChars,
            },
          },
          structured,
        );
        stageOutputs.set("structuring", structured);
        status = "supplementing";
        continue;
      }
      if (status === "supplementing") {
        const structured = output<GenerationMapCandidate>("structuring");
        const searched = output<SearchStageOutput>("searching");
        if (!structured || !searched) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        const supplemented = await this.supplementMap(
          task,
          workerId,
          structured,
          searched.sources,
        );
        await this.repository.completeStage(
          task.id,
          workerId,
          "supplementing",
          "extracting",
          "supplementing",
          { map: structured, sources: searched.sources },
          supplemented,
        );
        stageOutputs.set("supplementing", supplemented);
        status = "extracting";
        continue;
      }
      if (status === "extracting") {
        const map = output<GenerationMapCandidate>("supplementing");
        const searched = output<SearchStageOutput>("searching");
        const supplemented = output<{
          map: GenerationMapCandidate;
          sources: readonly GenerationSourceCandidate[];
        }>("supplementing");
        const effectiveMap = supplemented?.map ?? map;
        const sources = supplemented?.sources ?? searched?.sources;
        const planned = output<{
          directions: readonly GenerationDirectionCandidate[];
        }>("planning");
        if (!effectiveMap || !sources || !planned) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        const requiredSourceIds = effectiveMap.nodes.flatMap(
          (node) => node.sourceIds,
        );
        const budgetForAttempt = (attempt: number): ModelContextBudget =>
          createModelContextBudget({
            attempt,
            directions: planned.directions,
            sources,
            requiredSourceIds,
            sourceIdsByDirection: searched?.sourceIdsByDirection,
          });
        const extracted = await this.callModel(
          task,
          workerId,
          "extracting",
          "extracting",
          (attempt) => {
            const budget = budgetForAttempt(attempt);
            return {
              map: effectiveMap,
              sources: budget.sources,
              contextBudget: {
                strategy: budget.strategy,
                attempt: budget.attempt,
                serializedChars: budget.serializedChars,
              },
            };
          },
          (attempt) => {
            const contextSources = budgetForAttempt(attempt).sources;
            return this.structuredModel
              .extractViewpoints({
                topic: task.topic,
                map: effectiveMap,
                sources: contextSources,
                requestId: `${task.id}:extracting`,
                timeoutMs: this.externalTimeout(task, "model"),
              })
              .then((value) => {
                assertModelOutputHasNoUrl(value, "extracting");
                return value;
              });
          },
        );
        await this.repository.completeStage(
          task.id,
          workerId,
          "extracting",
          "assessing",
          "extracting",
          { map: effectiveMap, sources },
          {
            map: effectiveMap,
            sources,
            viewpoints: extracted.viewpoints,
          },
        );
        stageOutputs.set("extracting", {
          map: effectiveMap,
          sources,
          viewpoints: extracted.viewpoints,
        });
        status = "assessing";
        continue;
      }
      if (status === "assessing") {
        const extracted = output<{
          map: GenerationMapCandidate;
          sources: readonly GenerationSourceCandidate[];
          viewpoints: readonly GenerationViewpointCandidate[];
        }>("extracting");
        const planned = output<{
          directions: readonly GenerationDirectionCandidate[];
        }>("planning");
        const searched = output<SearchStageOutput>("searching");
        if (!extracted || !planned) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        const requiredSourceIds = extracted.map.nodes.flatMap(
          (node) => node.sourceIds,
        );
        const budgetForAttempt = (attempt: number): ModelContextBudget =>
          createModelContextBudget({
            attempt,
            directions: planned.directions,
            sources: extracted.sources,
            requiredSourceIds,
            sourceIdsByDirection: searched?.sourceIdsByDirection,
          });
        const assessed = await this.callModel(
          task,
          workerId,
          "assessing",
          "assessing",
          (attempt) => {
            const budget = budgetForAttempt(attempt);
            return {
              map: extracted.map,
              viewpoints: extracted.viewpoints,
              sources: budget.sources,
              contextBudget: {
                strategy: budget.strategy,
                attempt: budget.attempt,
                serializedChars: budget.serializedChars,
              },
            };
          },
          (attempt) => {
            const contextSources = budgetForAttempt(attempt).sources;
            return this.structuredModel
              .generateAssessments({
                topic: task.topic,
                map: { ...extracted.map, viewpoints: extracted.viewpoints },
                sources: contextSources,
                requestId: `${task.id}:assessing`,
                timeoutMs: this.externalTimeout(task, "model"),
              })
              .then((value) => {
                assertModelOutputHasNoUrl(value, "assessing");
                return value;
              });
          },
        );
        const directions = planned.directions;
        await this.repository.completeStage(
          task.id,
          workerId,
          "assessing",
          "validating",
          "assessing",
          extracted,
          {
            directions,
            map: extracted.map,
            viewpoints: extracted.viewpoints,
            questions: assessed.questions,
            sources: extracted.sources,
          },
        );
        stageOutputs.set("assessing", {
          directions,
          map: extracted.map,
          viewpoints: extracted.viewpoints,
          questions: assessed.questions,
          sources: extracted.sources,
        });
        status = "validating";
        continue;
      }
      if (status === "validating") {
        const candidate = output<GenerationCandidate>("assessing");
        if (!candidate) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        const validated = await this.validateLocally(candidate);
        stageOutputs.set("validating", validated);
        await this.repository.completeStage(
          task.id,
          workerId,
          "validating",
          "publishing",
          "validating",
          candidate,
          validated,
        );
        status = "publishing";
        continue;
      }
      if (status === "publishing") {
        const candidate = output<GenerationCandidate>("validating");
        if (!candidate) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        await this.repository.publishCandidate(task, workerId, candidate);
        return;
      }
      throw new GenerationTaskFailure("internal_failure", false);
    }
  }

  private assertDeadline(task: TaskRow): void {
    if (this.now().getTime() >= asDate(task.deadlineAt).getTime()) {
      throw new GenerationTaskFailure("generation_timeout", false);
    }
  }

  private externalTimeout(task: TaskRow, provider: "source" | "model"): number {
    const remaining = asDate(task.deadlineAt).getTime() - this.now().getTime();
    if (remaining <= 0) {
      throw new GenerationTaskFailure("generation_timeout", false);
    }
    const configuredTimeout =
      provider === "model"
        ? this.externalRequestTimeouts.modelTimeoutMs
        : this.externalRequestTimeouts.sourceTimeoutMs;
    return Math.max(1, Math.min(configuredTimeout, remaining));
  }
  private async callModel<T>(
    task: TaskRow,
    workerId: string,
    stage: TaskRow["stage"],
    operationKey: string,
    input: (attempt: number) => unknown,
    call: (attempt: number) => Promise<T>,
  ): Promise<T> {
    return this.callExternal(
      task,
      workerId,
      stage,
      operationKey,
      input,
      "model",
      call,
    );
  }

  private async callSource<T>(
    task: TaskRow,
    workerId: string,
    stage: TaskRow["stage"],
    operationKey: string,
    input: unknown,
    call: () => Promise<T>,
  ): Promise<T> {
    return this.callExternal(
      task,
      workerId,
      stage,
      operationKey,
      () => input,
      "source",
      () => call(),
    );
  }

  private async callExternal<T>(
    task: TaskRow,
    workerId: string,
    stage: TaskRow["stage"],
    operationKey: string,
    input: (attempt: number) => unknown,
    provider: "source" | "model",
    call: (attempt: number) => Promise<T>,
  ): Promise<T> {
    const maxAttempts =
      provider === "model" ? MODEL_MAX_ATTEMPTS : MAX_EXTERNAL_RETRIES + 1;
    let activeRecoveryProgress: GenerationProgress | undefined;
    for (;;) {
      const attemptCount = await this.repository.recordAttempt(
        task.id,
        workerId,
        stage,
        operationKey,
        input,
        activeRecoveryProgress,
        provider === "model" ? MODEL_MAX_ATTEMPTS : undefined,
      );
      if (attemptCount > maxAttempts) {
        throw new GenerationTaskFailure(
          provider === "model" ? "model_unavailable" : "source_unavailable",
          false,
        );
      }
      try {
        const result = await withTimeout(
          call(attemptCount),
          this.externalTimeout(task, provider),
          () =>
            new GenerationTaskFailure(
              provider === "source"
                ? "source_unavailable"
                : "model_unavailable",
              true,
            ),
        );
        await this.repository.resetAttempt(
          task.id,
          workerId,
          stage,
          operationKey,
        );
        return result;
      } catch (error) {
        const failure =
          error instanceof GenerationTaskFailure
            ? error
            : mapExternalFailure(error, provider);
        const modelOutputProtocol =
          provider === "model" &&
          (isModelOutputProtocolError(error, provider) ||
            failure.category === "model_output_invalid");
        if (modelOutputProtocol) {
          if (attemptCount >= MODEL_MAX_ATTEMPTS) {
            throw new GenerationTaskFailure("model_output_invalid", false);
          }
          const delay = 250 * 2 ** (attemptCount - 1);
          const remaining =
            asDate(task.deadlineAt).getTime() - this.now().getTime();
          if (remaining <= delay) {
            throw new GenerationTaskFailure("generation_timeout", false);
          }
          const recovery = await this.repository.consumeAutomaticRecovery(
            task.id,
            workerId,
            stage,
            attemptCount,
          );
          if (!recovery.allowed) {
            throw new GenerationTaskFailure("model_output_invalid", false);
          }
          activeRecoveryProgress = recovery.progress;
          await this.repository.renewLease(task.id, workerId);
          await this.sleep(delay);
          continue;
        }
        if (!failure.retryable || attemptCount >= maxAttempts) {
          throw failure;
        }
        const exponentialBackoff = 250 * 2 ** (attemptCount - 1);
        const delay = Math.max(exponentialBackoff, failure.retryAfterMs ?? 0);
        const remaining =
          asDate(task.deadlineAt).getTime() - this.now().getTime();
        if (remaining <= delay) {
          throw new GenerationTaskFailure("generation_timeout", false);
        }
        await this.repository.renewLease(task.id, workerId);
        await this.sleep(delay);
      }
    }
  }
  private async findCache(task: TaskRow): Promise<CacheRow | null> {
    const identity = {
      normalizedTopic: task.normalizedTopic,
      pipelineVersion: task.pipelineVersion,
      sourceAdapterVersion: task.sourceAdapterVersion,
      modelAdapterVersion: task.modelAdapterVersion,
    };
    return this.repository.findReusableCache(
      this.repository.database,
      identity,
    );
  }

  private async completeCachedTask(
    task: TaskRow,
    workerId: string,
    cache: CacheRow,
  ): Promise<void> {
    const now = this.now();
    await this.repository.database.transaction(async (transaction) => {
      await transaction.execute(
        sql.raw(`SET LOCAL statement_timeout = ${LOCAL_OPERATION_TIMEOUT_MS}`),
      );
      const current = await transaction
        .select(taskProjection)
        .from(generationTask)
        .where(
          and(
            eq(generationTask.id, task.id),
            eq(generationTask.status, "cache_lookup"),
            eq(generationTask.leaseOwner, workerId),
            gt(generationTask.leaseExpiresAt, now),
          ),
        )
        .limit(1)
        .for("update");
      if (!current[0]) {
        throw new GenerationLeaseLostError();
      }
      const participants = await transaction
        .select({ userId: generationParticipant.userId })
        .from(generationParticipant)
        .where(eq(generationParticipant.taskId, task.id));
      if (participants.length === 0) {
        throw new GenerationTaskFailure("internal_failure", false);
      }
      for (const participant of participants) {
        await transaction
          .insert(learningRelationship)
          .values({
            id: `learning_${this.repository.idGenerator()}`,
            userId: participant.userId,
            versionId: cache.versionId,
            questionSetId: cache.questionSetId,
          })
          .onConflictDoUpdate({
            target: [
              learningRelationship.userId,
              learningRelationship.versionId,
            ],
            set: {
              questionSetId: sql`COALESCE(${learningRelationship.questionSetId}, ${cache.questionSetId})`,
            },
          });
      }
      const sequence = Number(current[0]!.sequence) + 1;
      const completionNow = this.now();
      await transaction
        .insert(generationCheckpoint)
        .values({
          taskId: task.id,
          stage: "cache_lookup",
          operationKey: STAGE_CHECKPOINT_KEY,
          input: { identity: task.normalizedTopic },
          output: cache,
          attemptCount: 0,
          completedAt: completionNow,
          updatedAt: completionNow,
        })
        .onConflictDoUpdate({
          target: [
            generationCheckpoint.taskId,
            generationCheckpoint.stage,
            generationCheckpoint.operationKey,
          ],
          set: {
            output: cache,
            completedAt: completionNow,
            updatedAt: completionNow,
          },
        });
      const completed = await transaction
        .update(generationTask)
        .set({
          status: "succeeded",
          stage: "cache_lookup",
          mapId: cache.mapId,
          versionId: cache.versionId,
          questionSetId: cache.questionSetId,
          sequence,
          updatedAt: completionNow,
          completedAt: completionNow,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: completionNow,
        })
        .where(
          and(
            eq(generationTask.id, task.id),
            eq(generationTask.status, "cache_lookup"),
            eq(generationTask.leaseOwner, workerId),
            gt(generationTask.leaseExpiresAt, completionNow),
          ),
        )
        .returning({ id: generationTask.id });
      if (completed.length === 0) {
        throw new GenerationLeaseLostError();
      }
      await transaction.insert(generationEvent).values({
        taskId: task.id,
        sequence,
        type: "succeeded",
        data: {
          status: "succeeded",
          mapId: cache.mapId,
          versionId: cache.versionId,
        },
        occurredAt: completionNow,
      });
    });
  }
  private async searchDirections(
    task: TaskRow,
    workerId: string,
    directions: readonly GenerationDirectionCandidate[],
  ): Promise<SearchStageOutput> {
    const byId = new Map<string, GenerationSourceCandidate>();
    const sourceIdsByDirection: GenerationDirectionSourceCoverage[] = [];
    await this.repository.publishProgress(task.id, workerId, {
      status: "searching",
      stage: "searching",
      search: { completed: 0, total: directions.length },
    });
    for (const [index, direction] of directions.entries()) {
      const response = await this.callSource(
        task,
        workerId,
        "searching",
        `search:${direction.directionId}`,
        { query: direction.searchQuery, directionId: direction.directionId },
        () =>
          this.sourceSearch.search({
            query: direction.searchQuery,
            count: SEARCH_RESULTS_PER_DIRECTION,
            requestId: `${task.id}:search:${direction.directionId}`,
            timeoutMs: this.externalTimeout(task, "source"),
          }),
      );
      if (
        !asRecord(response) ||
        !isArray((response as { sources?: unknown }).sources)
      ) {
        throw new GenerationTaskFailure("source_unavailable", false);
      }
      const directionSourceIds: string[] = [];
      for (const source of (
        response as { sources: readonly GenerationSourceCandidate[] }
      ).sources) {
        if (
          source &&
          typeof source.sourceId === "string" &&
          !byId.has(source.sourceId)
        ) {
          byId.set(source.sourceId, source);
        }
        if (
          source &&
          typeof source.sourceId === "string" &&
          !directionSourceIds.includes(source.sourceId)
        ) {
          directionSourceIds.push(source.sourceId);
        }
      }
      sourceIdsByDirection.push({
        directionId: direction.directionId,
        sourceIds: directionSourceIds,
      });
      await this.repository.publishProgress(task.id, workerId, {
        status: "searching",
        stage: "searching",
        search: { completed: index + 1, total: directions.length },
      });
    }
    return {
      sources: [...byId.values()],
      sourceIdsByDirection,
    };
  }

  private async supplementMap(
    task: TaskRow,
    workerId: string,
    map: GenerationMapCandidate,
    sources: readonly GenerationSourceCandidate[],
  ): Promise<{
    map: GenerationMapCandidate;
    sources: readonly GenerationSourceCandidate[];
  }> {
    const byId = new Map(sources.map((source) => [source.sourceId, source]));
    const nodes = map.nodes.map((node) => ({
      ...node,
      sourceIds: [...node.sourceIds],
    }));
    const pendingNodes = nodes.filter((node) => node.sourceIds.length === 0);
    await this.repository.publishProgress(task.id, workerId, {
      status: "supplementing",
      stage: "supplementing",
      supplement: { completed: 0, total: pendingNodes.length },
    });
    for (const [index, node] of pendingNodes.entries()) {
      const response = await this.callSource(
        task,
        workerId,
        "supplementing",
        `supplement:${node.nodeId}`,
        { query: `${task.topic} ${node.title}`, nodeId: node.nodeId },
        () =>
          this.sourceSearch.search({
            query: `${task.topic} ${node.title}`,
            count: SUPPLEMENT_RESULTS_PER_NODE,
            requestId: `${task.id}:supplement:${node.nodeId}`,
            timeoutMs: this.externalTimeout(task, "source"),
          }),
      );
      const responseRecord = asRecord(response);
      const supplemental = responseRecord?.sources;
      if (!isArray(supplemental)) {
        throw new GenerationTaskFailure("source_unavailable", false);
      }
      // SourceSearchAccess validates each normalized source at its boundary.
      const supplementalSources =
        supplemental as readonly GenerationSourceCandidate[];
      for (const source of supplementalSources) {
        if (source && typeof source.sourceId === "string") {
          byId.set(source.sourceId, source);
        }
      }
      const first = supplementalSources.find(
        (source) => source && typeof source.sourceId === "string",
      );
      if (!first) {
        throw new GenerationTaskFailure("source_insufficient", false);
      }
      node.sourceIds = [first.sourceId];
      await this.repository.publishProgress(task.id, workerId, {
        status: "supplementing",
        stage: "supplementing",
        supplement: {
          completed: index + 1,
          total: pendingNodes.length,
        },
      });
    }
    return {
      map: { ...map, nodes },
      sources: [...byId.values()],
    };
  }

  private async validateLocally(
    candidate: GenerationCandidate,
  ): Promise<GenerationCandidate> {
    const startedAt = this.now().getTime();
    let validated: GenerationCandidate;
    try {
      validated = validateGenerationCandidate(candidate);
    } catch (error) {
      if (error instanceof GenerationCandidateValidationError) {
        throw new GenerationTaskFailure("candidate_invalid", false);
      }
      throw error;
    }
    if (this.now().getTime() - startedAt > LOCAL_OPERATION_TIMEOUT_MS) {
      throw new GenerationTaskFailure("generation_timeout", false);
    }
    return validated;
  }
}

export { toSnapshot, toEvent, asTaskRow, type TaskRow };
