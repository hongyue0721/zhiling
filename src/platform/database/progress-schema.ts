import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import {
  learningMapNode,
  learningMapVersion,
  learningRelationship,
} from "./catalog-schema";
import { learningAssessmentQuestionSet } from "./assessment-schema";

export const learningProgressNode = pgTable(
  "learning_progress_node",
  {
    learningRelationshipId: text("learning_relationship_id").notNull(),
    questionSetId: text("question_set_id").notNull(),
    versionId: text("version_id").notNull(),
    nodeId: text("node_id").notNull(),
    bestScore: integer("best_score").notNull().default(0),
    bestAttemptId: text("best_attempt_id"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.learningRelationshipId, table.nodeId] }),
    foreignKey({
      columns: [table.learningRelationshipId],
      foreignColumns: [learningRelationship.id],
      name: "learning_progress_node_relationship_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.questionSetId],
      foreignColumns: [learningAssessmentQuestionSet.id],
      name: "learning_progress_node_question_set_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.versionId],
      foreignColumns: [learningMapVersion.id],
      name: "learning_progress_node_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.questionSetId, table.versionId],
      foreignColumns: [
        learningAssessmentQuestionSet.id,
        learningAssessmentQuestionSet.versionId,
      ],
      name: "learning_progress_node_question_set_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.versionId, table.nodeId],
      foreignColumns: [learningMapNode.versionId, learningMapNode.nodeId],
      name: "learning_progress_node_node_fk",
    }).onDelete("restrict"),
    check(
      "learning_progress_node_best_score_check",
      sql`${table.bestScore} >= 0 AND ${table.bestScore} <= 10000`,
    ),
    check(
      "learning_progress_node_completion_check",
      sql`(${table.completedAt} IS NULL AND ${table.bestScore} < 8000) OR (${table.completedAt} IS NOT NULL AND ${table.bestScore} >= 8000)`,
    ),
    index("learning_progress_node_question_set_idx").on(table.questionSetId),
  ],
);

export const progressSchema = { learningProgressNode };
