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

import { learningAssessmentQuestionSet } from "@/platform/database/assessment-schema";
import {
  learningMapVersion,
  learningRelationship,
} from "@/platform/database/catalog-schema";
import {
  generationCache,
  generationCheckpoint,
  generationEvent,
  generationParticipant,
  generationTask,
} from "@/platform/database/generation-schema";

import type {
  GenerationCache,
  GenerationCheckpoint,
  GenerationClock,
  GenerationIdGenerator,
  GenerationIdentity,
  GenerationProviderVersions,
  GenerationTask,
  GenerationTaskStore,
} from "../application/ports";
import {
  GenerationLeaseLostError,
  GenerationTaskFailure,
} from "../application/ports";
import {
  assertGenerationTransition,
  GENERATION_DEADLINE_MS,
  GENERATION_LEASE_MS,
} from "../domain/state-machine";
import { createGenerationIdentity } from "../domain/identity";
import type {
  GenerationEventsResult,
  GenerationRequestResult,
} from "../application/ports";
import type {
  GenerationDatabaseExecutor,
  MapGenerationDatabase,
} from "./generation-database";
import {
  STAGE_CHECKPOINT_KEY,
  taskProjection,
  toCheckpoint,
  toEvent,
  toSnapshot,
  toTask,
} from "./generation-projection";
import type { GenerationRateLimitReservation } from "./rate-limit";

export const GENERATION_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;

export class DrizzleGenerationTaskStore implements GenerationTaskStore {
  constructor(
    private readonly database: MapGenerationDatabase,
    private readonly providerVersions: GenerationProviderVersions,
    private readonly now: GenerationClock,
    private readonly idGenerator: GenerationIdGenerator,
    private readonly reserveRateLimit?: GenerationRateLimitReservation,
  ) {}

  async requestGeneration(
    userId: string,
    topic: string,
  ): Promise<GenerationRequestResult> {
    const identity = createGenerationIdentity(topic, this.providerVersions);
    const requestedAt = this.now();
    const taskId = this.idGenerator();
    return this.database.transaction(async (transaction) => {
      const db = transaction as unknown as GenerationDatabaseExecutor;
      const cached = await this.findReusableCacheIn(db, identity);
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
      const refreshedCache = await this.findReusableCacheIn(db, identity);
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
        ? toTask(inserted[0])
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

  async readEvents(
    userId: string,
    taskId: string,
    afterSequence: number,
  ): Promise<GenerationEventsResult | null> {
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
      cursor > task.sequence ||
      (firstSequence !== null && cursor < firstSequence - 1) ||
      (firstSequence === null && task.sequence > cursor);
    const mappedEvents = events.map((event) => toEvent(taskId, event));
    const terminalCursor =
      (task.status === "succeeded" || task.status === "failed") &&
      cursor === task.sequence;
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

  async claimTask(workerId: string): Promise<GenerationTask | null> {
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
    return claimed[0] ? toTask(claimed[0]) : null;
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
      const db = transaction as unknown as GenerationDatabaseExecutor;
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
      const current = currentRows[0] ? toTask(currentRows[0]) : null;
      if (!current || current.status === "succeeded") {
        throw new GenerationLeaseLostError();
      }
      if (current.status === "failed") {
        return;
      }
      const sequence = current.sequence + 1;
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
    stage: GenerationTask["stage"],
    operationKey: string,
    input: unknown,
  ): Promise<number> {
    const now = this.now();
    await this.database.transaction(async (transaction) => {
      await transaction
        .insert(generationCheckpoint)
        .values({
          taskId,
          stage,
          operationKey,
          input,
          output: null,
          attemptCount: 1,
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
            attemptCount: sql`${generationCheckpoint.attemptCount} + 1`,
            input,
            updatedAt: now,
          },
        });
      const renewed = await transaction
        .update(generationTask)
        .set({
          retryCount: sql`${generationTask.retryCount} + 1`,
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
      if (renewed.length === 0) {
        throw new GenerationLeaseLostError();
      }
    });
    const rows = await this.database
      .select({ attemptCount: generationCheckpoint.attemptCount })
      .from(generationCheckpoint)
      .where(
        and(
          eq(generationCheckpoint.taskId, taskId),
          eq(generationCheckpoint.stage, stage),
          eq(generationCheckpoint.operationKey, operationKey),
        ),
      )
      .limit(1);
    return rows[0]?.attemptCount ?? 1;
  }

  async resetAttempt(
    taskId: string,
    workerId: string,
    stage: GenerationTask["stage"],
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
    from: GenerationTask["status"],
    to: GenerationTask["status"],
    stage: GenerationTask["stage"],
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

  async getCheckpoints(
    taskId: string,
  ): Promise<ReadonlyMap<string, GenerationCheckpoint>> {
    const rows = await this.database
      .select()
      .from(generationCheckpoint)
      .where(
        and(
          eq(generationCheckpoint.taskId, taskId),
          eq(generationCheckpoint.operationKey, STAGE_CHECKPOINT_KEY),
        ),
      );
    return new Map(rows.map((row) => [row.stage, toCheckpoint(row)]));
  }

  async findReusableCache(
    identity: GenerationIdentity,
  ): Promise<GenerationCache | null> {
    return this.findReusableCacheIn(this.database, identity);
  }

  private async reuseCachedTask(
    db: GenerationDatabaseExecutor,
    userId: string,
    cached: GenerationCache,
  ): Promise<GenerationRequestResult> {
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
      reuse: "cache",
      snapshot: toSnapshot(task, relationshipId),
    };
  }

  private async findReusableCacheIn(
    db: GenerationDatabaseExecutor,
    identity: GenerationIdentity,
  ): Promise<GenerationCache | null> {
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
    db: GenerationDatabaseExecutor,
    identity: GenerationIdentity,
  ): Promise<GenerationTask | null> {
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
    return rows[0] ? toTask(rows[0]) : null;
  }

  private async findTaskById(
    db: GenerationDatabaseExecutor,
    taskId: string,
  ): Promise<GenerationTask | null> {
    const rows = await db
      .select(taskProjection)
      .from(generationTask)
      .where(eq(generationTask.id, taskId))
      .limit(1);
    return rows[0] ? toTask(rows[0]) : null;
  }

  private async findAuthorizedTask(
    userId: string,
    taskId: string,
  ): Promise<GenerationTask | null> {
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
    return rows[0] ? toTask(rows[0]) : null;
  }

  private async snapshotForUser(
    db: GenerationDatabaseExecutor,
    task: GenerationTask,
    userId: string,
  ) {
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
    return toSnapshot(task, relationshipId);
  }

  private async addParticipant(
    db: GenerationDatabaseExecutor,
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
    db: GenerationDatabaseExecutor,
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
    from: GenerationTask["status"],
    to: GenerationTask["status"],
    stage: GenerationTask["stage"],
    now: Date,
  ): Promise<void> {
    const db = transaction as GenerationDatabaseExecutor;
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
