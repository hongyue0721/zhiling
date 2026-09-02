import { sql } from "drizzle-orm";
import {
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
} from "drizzle-orm/pg-core";

import {
  learningMapNode,
  learningMapNodeSource,
  learningMapVersion,
  learningRelationship,
} from "./catalog-schema";

export const learningAssessmentQuestionSetStatus = pgEnum(
  "learning_assessment_question_set_status",
  ["draft", "published"],
);
export const learningAssessmentQuestionType = pgEnum(
  "learning_assessment_question_type",
  ["single_choice", "multiple_choice", "matching", "opinion_analysis"],
);

export const learningAssessmentQuestionSet = pgTable(
  "learning_assessment_question_set",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => learningMapVersion.id, { onDelete: "restrict" }),
    status: learningAssessmentQuestionSetStatus("status").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    publishedAt: timestamp("published_at"),
  },
  (table) => [
    unique("learning_assessment_question_set_version_unique").on(
      table.versionId,
    ),
    unique("learning_assessment_question_set_id_version_unique").on(
      table.id,
      table.versionId,
    ),
    check(
      "learning_assessment_question_set_publication_time_check",
      sql`(${table.status} = 'draft' AND ${table.publishedAt} IS NULL) OR (${table.status} = 'published' AND ${table.publishedAt} IS NOT NULL)`,
    ),
    index("learning_assessment_question_set_version_id_idx").on(
      table.versionId,
    ),
  ],
);

export const learningAssessmentQuestion = pgTable(
  "learning_assessment_question",
  {
    questionSetId: text("question_set_id").notNull(),
    questionId: text("question_id").notNull(),
    versionId: text("version_id").notNull(),
    nodeId: text("node_id").notNull(),
    position: integer("position").notNull(),
    type: learningAssessmentQuestionType("type").notNull(),
    prompt: text("prompt").notNull(),
    explanation: text("explanation").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.questionSetId, table.questionId] }),
    foreignKey({
      columns: [table.questionSetId],
      foreignColumns: [learningAssessmentQuestionSet.id],
      name: "learning_assessment_question_set_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.questionSetId, table.versionId],
      foreignColumns: [
        learningAssessmentQuestionSet.id,
        learningAssessmentQuestionSet.versionId,
      ],
      name: "learning_assessment_question_set_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.versionId, table.nodeId],
      foreignColumns: [learningMapNode.versionId, learningMapNode.nodeId],
      name: "learning_assessment_question_node_fk",
    }).onDelete("restrict"),
    unique("learning_assessment_question_position_unique").on(
      table.questionSetId,
      table.position,
    ),
    index("learning_assessment_question_node_idx").on(
      table.questionSetId,
      table.nodeId,
    ),
  ],
);

export const learningAssessmentQuestionOption = pgTable(
  "learning_assessment_question_option",
  {
    questionSetId: text("question_set_id").notNull(),
    questionId: text("question_id").notNull(),
    optionId: text("option_id").notNull(),
    label: text("label").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.questionSetId, table.questionId, table.optionId],
    }),
    foreignKey({
      columns: [table.questionSetId, table.questionId],
      foreignColumns: [
        learningAssessmentQuestion.questionSetId,
        learningAssessmentQuestion.questionId,
      ],
      name: "learning_assessment_question_option_question_fk",
    }).onDelete("restrict"),
    unique("learning_assessment_question_option_position_unique").on(
      table.questionSetId,
      table.questionId,
      table.position,
    ),
  ],
);

export const learningAssessmentQuestionCorrectOption = pgTable(
  "learning_assessment_question_correct_option",
  {
    questionSetId: text("question_set_id").notNull(),
    questionId: text("question_id").notNull(),
    optionId: text("option_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.questionSetId, table.questionId, table.optionId],
    }),
    foreignKey({
      columns: [table.questionSetId, table.questionId, table.optionId],
      foreignColumns: [
        learningAssessmentQuestionOption.questionSetId,
        learningAssessmentQuestionOption.questionId,
        learningAssessmentQuestionOption.optionId,
      ],
      name: "learning_assessment_question_correct_option_fk",
    }).onDelete("restrict"),
  ],
);

export const learningAssessmentQuestionMatchingAnswer = pgTable(
  "learning_assessment_question_matching_answer",
  {
    questionSetId: text("question_set_id").notNull(),
    questionId: text("question_id").notNull(),
    leftOptionId: text("left_option_id").notNull(),
    rightOptionId: text("right_option_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.questionSetId, table.questionId, table.leftOptionId],
    }),
    unique("learning_assessment_question_matching_right_option_unique").on(
      table.questionSetId,
      table.questionId,
      table.rightOptionId,
    ),
    foreignKey({
      columns: [table.questionSetId, table.questionId],
      foreignColumns: [
        learningAssessmentQuestion.questionSetId,
        learningAssessmentQuestion.questionId,
      ],
      name: "learning_assessment_question_matching_question_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.questionSetId, table.questionId, table.leftOptionId],
      foreignColumns: [
        learningAssessmentQuestionOption.questionSetId,
        learningAssessmentQuestionOption.questionId,
        learningAssessmentQuestionOption.optionId,
      ],
      name: "learning_assessment_question_matching_left_option_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.questionSetId, table.questionId, table.rightOptionId],
      foreignColumns: [
        learningAssessmentQuestionOption.questionSetId,
        learningAssessmentQuestionOption.questionId,
        learningAssessmentQuestionOption.optionId,
      ],
      name: "learning_assessment_question_matching_right_option_fk",
    }).onDelete("restrict"),
  ],
);

export const learningAssessmentQuestionSource = pgTable(
  "learning_assessment_question_source",
  {
    questionSetId: text("question_set_id").notNull(),
    questionId: text("question_id").notNull(),
    versionId: text("version_id").notNull(),
    nodeId: text("node_id").notNull(),
    sourceId: text("source_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.questionSetId, table.questionId, table.sourceId],
    }),
    foreignKey({
      columns: [table.questionSetId, table.questionId],
      foreignColumns: [
        learningAssessmentQuestion.questionSetId,
        learningAssessmentQuestion.questionId,
      ],
      name: "learning_assessment_question_source_question_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.versionId, table.nodeId, table.sourceId],
      foreignColumns: [
        learningMapNodeSource.versionId,
        learningMapNodeSource.nodeId,
        learningMapNodeSource.sourceId,
      ],
      name: "learning_assessment_question_source_node_source_fk",
    }).onDelete("restrict"),
  ],
);

export const learningAssessmentAttempt = pgTable(
  "learning_assessment_attempt",
  {
    id: text("id").primaryKey(),
    learningRelationshipId: text("learning_relationship_id")
      .notNull()
      .references(() => learningRelationship.id, { onDelete: "restrict" }),
    questionSetId: text("question_set_id")
      .notNull()
      .references(() => learningAssessmentQuestionSet.id, {
        onDelete: "restrict",
      }),
    versionId: text("version_id")
      .notNull()
      .references(() => learningMapVersion.id, { onDelete: "restrict" }),
    nodeId: text("node_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    answers: jsonb("answers").notNull(),
    result: jsonb("result").notNull(),
    nodeScore: integer("node_score").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique(
      "learning_assessment_attempt_relationship_question_set_key_unique",
    ).on(
      table.learningRelationshipId,
      table.questionSetId,
      table.idempotencyKey,
    ),
    foreignKey({
      columns: [table.questionSetId, table.versionId],
      foreignColumns: [
        learningAssessmentQuestionSet.id,
        learningAssessmentQuestionSet.versionId,
      ],
      name: "learning_assessment_attempt_question_set_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.versionId, table.nodeId],
      foreignColumns: [learningMapNode.versionId, learningMapNode.nodeId],
      name: "learning_assessment_attempt_node_fk",
    }).onDelete("restrict"),
    check(
      "learning_assessment_attempt_score_check",
      sql`${table.nodeScore} >= 0 AND ${table.nodeScore} <= 10000`,
    ),
    index("learning_assessment_attempt_relationship_idx").on(
      table.learningRelationshipId,
      table.createdAt,
    ),
  ],
);

export const assessmentSchema = {
  learningAssessmentQuestionSet,
  learningAssessmentQuestion,
  learningAssessmentQuestionOption,
  learningAssessmentQuestionCorrectOption,
  learningAssessmentQuestionMatchingAnswer,
  learningAssessmentQuestionSource,
  learningAssessmentAttempt,
};
