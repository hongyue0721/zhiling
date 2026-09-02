import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const learningMapVersionStatus = pgEnum("learning_map_version_status", [
  "draft",
  "published",
]);
export const learningViewpointKind = pgEnum("learning_viewpoint_kind", [
  "consensus",
  "disagreement",
  "practical_experience",
  "supplementary",
]);

export const learningMap = pgTable("learning_map", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const learningMapVersion = pgTable(
  "learning_map_version",
  {
    id: text("id").primaryKey(),
    mapId: text("map_id")
      .notNull()
      .references(() => learningMap.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    status: learningMapVersionStatus("status").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    publishedAt: timestamp("published_at"),
  },
  (table) => [
    unique("learning_map_version_id_map_id_unique").on(table.id, table.mapId),
    index("learning_map_version_map_id_idx").on(table.mapId),
    check(
      "learning_map_version_publication_time_check",
      sql`(${table.status} = 'draft' AND ${table.publishedAt} IS NULL) OR (${table.status} = 'published' AND ${table.publishedAt} IS NOT NULL)`,
    ),
  ],
);

export const learningMapNode = pgTable(
  "learning_map_node",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => learningMapVersion.id, { onDelete: "restrict" }),
    nodeId: text("node_id").notNull(),
    title: text("title").notNull(),
    learningObjective: text("learning_objective").notNull(),
  },
  (table) => [primaryKey({ columns: [table.versionId, table.nodeId] })],
);

export const learningMapPrerequisite = pgTable(
  "learning_map_prerequisite",
  {
    versionId: text("version_id").notNull(),
    nodeId: text("node_id").notNull(),
    prerequisiteNodeId: text("prerequisite_node_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.versionId, table.nodeId, table.prerequisiteNodeId],
    }),
    foreignKey({
      columns: [table.versionId, table.nodeId],
      foreignColumns: [learningMapNode.versionId, learningMapNode.nodeId],
      name: "learning_map_prerequisite_node_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.versionId, table.prerequisiteNodeId],
      foreignColumns: [learningMapNode.versionId, learningMapNode.nodeId],
      name: "learning_map_prerequisite_required_node_fk",
    }).onDelete("restrict"),
    check(
      "learning_map_prerequisite_no_self_check",
      sql`${table.nodeId} <> ${table.prerequisiteNodeId}`,
    ),
  ],
);

export const knowledgeSource = pgTable(
  "knowledge_source",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => learningMapVersion.id, { onDelete: "restrict" }),
    sourceId: text("source_id").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull(),
    url: text("url").notNull(),
    authorName: text("author_name").notNull(),
    contentType: text("content_type"),
    updatedAt: bigint("updated_at", { mode: "number" }),
    authorityLevel: text("authority_level"),
    rankingScore: real("ranking_score"),
  },
  (table) => [primaryKey({ columns: [table.versionId, table.sourceId] })],
);

export const learningMapNodeSource = pgTable(
  "learning_map_node_source",
  {
    versionId: text("version_id").notNull(),
    nodeId: text("node_id").notNull(),
    sourceId: text("source_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.nodeId, table.sourceId] }),
    foreignKey({
      columns: [table.versionId, table.nodeId],
      foreignColumns: [learningMapNode.versionId, learningMapNode.nodeId],
      name: "learning_map_node_source_node_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.versionId, table.sourceId],
      foreignColumns: [knowledgeSource.versionId, knowledgeSource.sourceId],
      name: "learning_map_node_source_source_fk",
    }).onDelete("restrict"),
  ],
);

export const learningViewpoint = pgTable(
  "learning_viewpoint",
  {
    versionId: text("version_id").notNull(),
    nodeId: text("node_id").notNull(),
    viewpointId: text("viewpoint_id").notNull(),
    kind: learningViewpointKind("kind").notNull(),
    statement: text("statement").notNull(),
    conditions: text("conditions"),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.nodeId, table.viewpointId] }),
    foreignKey({
      columns: [table.versionId, table.nodeId],
      foreignColumns: [learningMapNode.versionId, learningMapNode.nodeId],
      name: "learning_viewpoint_node_fk",
    }).onDelete("restrict"),
    check(
      "learning_viewpoint_disagreement_conditions_check",
      sql`${table.kind} <> 'disagreement' OR (${table.conditions} IS NOT NULL AND length(trim(${table.conditions})) > 0)`,
    ),
  ],
);

export const learningViewpointSource = pgTable(
  "learning_viewpoint_source",
  {
    versionId: text("version_id").notNull(),
    nodeId: text("node_id").notNull(),
    viewpointId: text("viewpoint_id").notNull(),
    sourceId: text("source_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.versionId,
        table.nodeId,
        table.viewpointId,
        table.sourceId,
      ],
    }),
    foreignKey({
      columns: [table.versionId, table.nodeId, table.viewpointId],
      foreignColumns: [
        learningViewpoint.versionId,
        learningViewpoint.nodeId,
        learningViewpoint.viewpointId,
      ],
      name: "learning_viewpoint_source_viewpoint_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.versionId, table.nodeId, table.sourceId],
      foreignColumns: [
        learningMapNodeSource.versionId,
        learningMapNodeSource.nodeId,
        learningMapNodeSource.sourceId,
      ],
      name: "learning_viewpoint_source_node_source_fk",
    }).onDelete("restrict"),
  ],
);

export const learningRelationship = pgTable(
  "learning_relationship",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    versionId: text("version_id")
      .notNull()
      .references(() => learningMapVersion.id, { onDelete: "restrict" }),
    questionSetId: text("question_set_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("learning_relationship_user_version_unique").on(
      table.userId,
      table.versionId,
    ),
    index("learning_relationship_version_id_idx").on(table.versionId),
  ],
);

export const featuredLearningMap = pgTable(
  "featured_learning_map",
  {
    mapId: text("map_id")
      .primaryKey()
      .references(() => learningMap.id, { onDelete: "restrict" }),
    versionId: text("version_id").notNull(),
    position: integer("position").notNull().unique(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.versionId, table.mapId],
      foreignColumns: [learningMapVersion.id, learningMapVersion.mapId],
      name: "featured_learning_map_published_version_fk",
    }).onDelete("restrict"),
  ],
);

export const catalogSchema = {
  learningMap,
  learningMapVersion,
  learningMapNode,
  learningMapPrerequisite,
  knowledgeSource,
  learningMapNodeSource,
  learningRelationship,
  learningViewpoint,
  learningViewpointSource,
  featuredLearningMap,
};
