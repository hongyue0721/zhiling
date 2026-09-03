import type {
  GenerationCheckpoint,
  GenerationEvent,
  GenerationSnapshot,
  GenerationTask,
} from "../application/ports";
import {
  generationCheckpoint,
  generationEvent,
  generationTask,
} from "@/platform/database/generation-schema";

export type GenerationTaskRow = typeof generationTask.$inferSelect;
export type GenerationCheckpointRow = typeof generationCheckpoint.$inferSelect;
export type GenerationEventRow = typeof generationEvent.$inferSelect;

export const STAGE_CHECKPOINT_KEY = "stage";

export const taskProjection = {
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

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function asTaskRow(value: unknown): GenerationTaskRow {
  return value as GenerationTaskRow;
}

export function asCheckpointRow(value: unknown): GenerationCheckpointRow {
  return value as GenerationCheckpointRow;
}

export function toTask(value: unknown): GenerationTask {
  const row = asTaskRow(value);
  return {
    id: row.id,
    topic: row.topic,
    normalizedTopic: row.normalizedTopic,
    pipelineVersion: row.pipelineVersion,
    sourceAdapterVersion: row.sourceAdapterVersion,
    modelAdapterVersion: row.modelAdapterVersion,
    status: row.status,
    stage: row.stage,
    sequence: Number(row.sequence),
    deadlineAt: asDate(row.deadlineAt),
    nextAttemptAt: asDate(row.nextAttemptAt),
    retryCount: row.retryCount,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt ? asDate(row.leaseExpiresAt) : null,
    heartbeatAt: row.heartbeatAt ? asDate(row.heartbeatAt) : null,
    mapId: row.mapId,
    versionId: row.versionId,
    questionSetId: row.questionSetId,
    failureCode: row.failureCode,
    failureRetryable: row.failureRetryable,
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
    completedAt: row.completedAt ? asDate(row.completedAt) : null,
  };
}

export function toCheckpoint(value: unknown): GenerationCheckpoint {
  const row = asCheckpointRow(value);
  return {
    taskId: row.taskId,
    stage: row.stage,
    operationKey: row.operationKey,
    input: row.input,
    output: row.output,
    attemptCount: row.attemptCount,
    completedAt: row.completedAt ? asDate(row.completedAt) : null,
    updatedAt: asDate(row.updatedAt),
  };
}

export function toSnapshot(
  task: GenerationTask,
  learningRelationshipId: string | null,
): GenerationSnapshot {
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
    sequence: task.sequence,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    deadlineAt: task.deadlineAt.toISOString(),
    result,
    failure,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
  };
}

export function toEvent(
  taskId: string,
  row: GenerationEventRow,
): GenerationEvent {
  const data =
    typeof row.data === "object" &&
    row.data !== null &&
    !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : ({ value: row.data } as Record<string, unknown>);
  return {
    taskId,
    sequence: Number(row.sequence),
    type: row.type,
    occurredAt: asDate(row.occurredAt).toISOString(),
    data,
  };
}
