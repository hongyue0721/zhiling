import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";
import { learningAssessmentQuestionSet } from "./assessment-schema";
import { learningMapVersion } from "./catalog-schema";

export const generationStatus = pgEnum("generation_status", [
  "queued",
  "normalizing",
  "cache_lookup",
  "planning",
  "searching",
  "structuring",
  "supplementing",
  "extracting",
  "assessing",
  "validating",
  "publishing",
  "succeeded",
  "failed",
]);

export const generationStage = pgEnum("generation_stage", [
  "queued",
  "normalizing",
  "cache_lookup",
  "planning",
  "searching",
  "structuring",
  "supplementing",
  "extracting",
  "assessing",
  "validating",
  "publishing",
]);

export const generationFailureCategory = pgEnum("generation_failure_category", [
  "invalid_topic",
  "source_unavailable",
  "source_insufficient",
  "model_unavailable",
  "candidate_invalid",
  "generation_timeout",
  "internal_failure",
]);

export const generationEventType = pgEnum("generation_event_type", [
  "snapshot",
  "progress",
  "succeeded",
  "failed",
]);

export const generationTask = pgTable(
  "generation_task",
  {
    id: text("id").primaryKey(),
    topic: text("topic").notNull(),
    normalizedTopic: text("normalized_topic").notNull(),
    pipelineVersion: text("pipeline_version").notNull(),
    sourceAdapterVersion: text("source_adapter_version").notNull(),
    modelAdapterVersion: text("model_adapter_version").notNull(),
    status: generationStatus("status").notNull(),
    stage: generationStage("stage").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull().default(0),
    deadlineAt: timestamp("deadline_at").notNull(),
    nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
    retryCount: integer("retry_count").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    heartbeatAt: timestamp("heartbeat_at"),
    mapId: text("map_id"),
    versionId: text("version_id").references(() => learningMapVersion.id, {
      onDelete: "restrict",
    }),
    questionSetId: text("question_set_id").references(
      () => learningAssessmentQuestionSet.id,
      { onDelete: "restrict" },
    ),
    failureCode: generationFailureCategory("failure_code"),
    failureRetryable: boolean("failure_retryable"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    uniqueIndex("generation_task_active_identity_unique")
      .on(
        table.normalizedTopic,
        table.pipelineVersion,
        table.sourceAdapterVersion,
        table.modelAdapterVersion,
      )
      .where(sql`${table.status} NOT IN ('succeeded', 'failed')`),
    index("generation_task_claim_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
    ),
    index("generation_task_deadline_idx").on(table.deadlineAt),
    check(
      "generation_task_result_consistency_check",
      sql`(
        (${table.status} = 'succeeded' AND ${table.mapId} IS NOT NULL AND ${table.versionId} IS NOT NULL AND ${table.questionSetId} IS NOT NULL AND ${table.completedAt} IS NOT NULL)
        OR
        (${table.status} = 'failed' AND ${table.mapId} IS NULL AND ${table.versionId} IS NULL AND ${table.questionSetId} IS NULL AND ${table.completedAt} IS NOT NULL)
        OR
        (${table.status} NOT IN ('succeeded', 'failed') AND ${table.mapId} IS NULL AND ${table.versionId} IS NULL AND ${table.questionSetId} IS NULL AND ${table.completedAt} IS NULL)
      )`,
    ),
    check(
      "generation_task_failure_consistency_check",
      sql`(${table.status} = 'failed' AND ${table.failureCode} IS NOT NULL AND ${table.failureRetryable} IS NOT NULL) OR (${table.status} <> 'failed' AND ${table.failureCode} IS NULL AND ${table.failureRetryable} IS NULL)`,
    ),
    foreignKey({
      columns: [table.versionId, table.mapId],
      foreignColumns: [learningMapVersion.id, learningMapVersion.mapId],
      name: "generation_task_version_map_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.questionSetId, table.versionId],
      foreignColumns: [
        learningAssessmentQuestionSet.id,
        learningAssessmentQuestionSet.versionId,
      ],
      name: "generation_task_question_set_version_fk",
    }).onDelete("restrict"),
  ],
);

export const generationParticipant = pgTable(
  "generation_participant",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => generationTask.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.userId] }),
    index("generation_participant_user_idx").on(table.userId, table.taskId),
  ],
);

export const generationCheckpoint = pgTable(
  "generation_checkpoint",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => generationTask.id, { onDelete: "cascade" }),
    stage: generationStage("stage").notNull(),
    operationKey: text("operation_key").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    attemptCount: integer("attempt_count").notNull().default(0),
    completedAt: timestamp("completed_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.taskId, table.stage, table.operationKey],
    }),
    index("generation_checkpoint_task_idx").on(table.taskId, table.updatedAt),
    check(
      "generation_checkpoint_attempt_count_check",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);

export const generationEvent = pgTable(
  "generation_event",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => generationTask.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    type: generationEventType("type").notNull(),
    data: jsonb("data").notNull(),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.sequence] }),
    index("generation_event_task_sequence_idx").on(
      table.taskId,
      table.sequence,
    ),
    check("generation_event_sequence_check", sql`${table.sequence} > 0`),
  ],
);

export const generationCache = pgTable(
  "generation_cache",
  {
    normalizedTopic: text("normalized_topic").notNull(),
    pipelineVersion: text("pipeline_version").notNull(),
    sourceAdapterVersion: text("source_adapter_version").notNull(),
    modelAdapterVersion: text("model_adapter_version").notNull(),
    taskId: text("task_id")
      .notNull()
      .references(() => generationTask.id, { onDelete: "restrict" }),
    mapId: text("map_id").notNull(),
    versionId: text("version_id")
      .notNull()
      .references(() => learningMapVersion.id, { onDelete: "restrict" }),
    questionSetId: text("question_set_id")
      .notNull()
      .references(() => learningAssessmentQuestionSet.id, {
        onDelete: "restrict",
      }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.questionSetId, table.versionId],
      foreignColumns: [
        learningAssessmentQuestionSet.id,
        learningAssessmentQuestionSet.versionId,
      ],
      name: "generation_cache_question_set_version_fk",
    }).onDelete("restrict"),
    primaryKey({
      columns: [
        table.normalizedTopic,
        table.pipelineVersion,
        table.sourceAdapterVersion,
        table.modelAdapterVersion,
      ],
    }),
    unique("generation_cache_task_unique").on(table.taskId),
    foreignKey({
      columns: [table.versionId, table.mapId],
      foreignColumns: [learningMapVersion.id, learningMapVersion.mapId],
      name: "generation_cache_version_map_fk",
    }).onDelete("restrict"),
    index("generation_cache_version_idx").on(table.versionId),
  ],
);

export const generationSchema = {
  generationTask,
  generationParticipant,
  generationCheckpoint,
  generationEvent,
  generationCache,
};
