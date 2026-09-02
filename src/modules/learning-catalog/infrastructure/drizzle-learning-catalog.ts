import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  featuredLearningMap,
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
import { learningAssessmentQuestionSet } from "@/platform/database/assessment-schema";
import { databaseSchema } from "@/platform/database/schema";

import type { LearningMapPublisher } from "../application/learning-catalog";
import type {
  FeaturedLearningMapSummary,
  LearningCatalogReader,
  LearningMapDetail,
  LearningRelationship,
  LearningRelationshipWriter,
} from "../application/read-model";
import {
  validateLearningMapPublication,
  type LearningMapPublication,
} from "../domain/learning-map";

export class LearningMapVersionAlreadyExistsError extends Error {
  readonly code = "learning_map_version_already_exists";

  constructor() {
    super("Learning map version already exists");
    this.name = "LearningMapVersionAlreadyExistsError";
  }
}

export class DrizzleLearningCatalogRepository
  implements
    LearningMapPublisher,
    LearningCatalogReader,
    LearningRelationshipWriter
{
  constructor(
    private readonly database: NodePgDatabase<typeof databaseSchema>,
  ) {}

  async publishFeatured(publication: LearningMapPublication): Promise<void> {
    publication = validateLearningMapPublication(publication);

    await this.database.transaction(async (transaction) => {
      const existing = await transaction
        .select({ id: learningMapVersion.id })
        .from(learningMapVersion)
        .where(eq(learningMapVersion.id, publication.versionId))
        .limit(1);
      if (existing.length > 0) {
        throw new LearningMapVersionAlreadyExistsError();
      }

      await transaction
        .insert(learningMap)
        .values({ id: publication.mapId })
        .onConflictDoNothing({ target: learningMap.id });
      await transaction.insert(learningMapVersion).values({
        id: publication.versionId,
        mapId: publication.mapId,
        title: publication.title,
        summary: publication.summary,
        status: "draft",
        publishedAt: null,
      });
      await transaction.insert(learningMapNode).values(
        publication.nodes.map((node) => ({
          versionId: publication.versionId,
          nodeId: node.nodeId,
          title: node.title,
          learningObjective: node.learningObjective,
        })),
      );
      await transaction.insert(knowledgeSource).values(
        publication.sources.map((source) => ({
          versionId: publication.versionId,
          sourceId: source.sourceId,
          title: source.title,
          excerpt: source.excerpt,
          url: source.url,
          authorName: source.authorName,
        })),
      );
      await transaction.insert(learningMapNodeSource).values(
        publication.nodes.flatMap((node) =>
          node.sourceIds.map((sourceId) => ({
            versionId: publication.versionId,
            nodeId: node.nodeId,
            sourceId,
          })),
        ),
      );

      if (publication.prerequisites.length > 0) {
        await transaction.insert(learningMapPrerequisite).values(
          publication.prerequisites.map((edge) => ({
            versionId: publication.versionId,
            nodeId: edge.nodeId,
            prerequisiteNodeId: edge.prerequisiteNodeId,
          })),
        );
      }

      const viewpoints = publication.nodes.flatMap((node) =>
        node.viewpoints.map((viewpoint) => ({
          versionId: publication.versionId,
          nodeId: node.nodeId,
          viewpointId: viewpoint.viewpointId,
          kind: viewpoint.kind,
          statement: viewpoint.statement,
          conditions: viewpoint.conditions,
        })),
      );
      if (viewpoints.length > 0) {
        await transaction.insert(learningViewpoint).values(viewpoints);
        await transaction.insert(learningViewpointSource).values(
          publication.nodes.flatMap((node) =>
            node.viewpoints.flatMap((viewpoint) =>
              viewpoint.sourceIds.map((sourceId) => ({
                versionId: publication.versionId,
                nodeId: node.nodeId,
                viewpointId: viewpoint.viewpointId,
                sourceId,
              })),
            ),
          ),
        );
      }

      await transaction
        .update(learningMapVersion)
        .set({ status: "published", publishedAt: new Date() })
        .where(
          and(
            eq(learningMapVersion.id, publication.versionId),
            eq(learningMapVersion.status, "draft"),
          ),
        );
      await transaction
        .insert(featuredLearningMap)
        .values({
          mapId: publication.mapId,
          versionId: publication.versionId,
          position: publication.featuredPosition,
        })
        .onConflictDoUpdate({
          target: featuredLearningMap.mapId,
          set: {
            versionId: publication.versionId,
            position: publication.featuredPosition,
            updatedAt: new Date(),
          },
        });
    });
  }

  async listFeatured(): Promise<readonly FeaturedLearningMapSummary[]> {
    return this.database
      .select({
        mapId: featuredLearningMap.mapId,
        versionId: learningMapVersion.id,
        title: learningMapVersion.title,
        summary: learningMapVersion.summary,
        nodeCount: sql<number>`count(${learningMapNode.nodeId})::int`,
      })
      .from(featuredLearningMap)
      .innerJoin(
        learningMapVersion,
        and(
          eq(learningMapVersion.id, featuredLearningMap.versionId),
          eq(learningMapVersion.mapId, featuredLearningMap.mapId),
        ),
      )
      .innerJoin(
        learningMapNode,
        eq(learningMapNode.versionId, learningMapVersion.id),
      )
      .where(eq(learningMapVersion.status, "published"))
      .groupBy(
        featuredLearningMap.mapId,
        featuredLearningMap.position,
        learningMapVersion.id,
      )
      .orderBy(
        asc(featuredLearningMap.position),
        asc(featuredLearningMap.mapId),
      );
  }

  async findFeatured(mapId: string): Promise<LearningMapDetail | null> {
    const versions = await this.database
      .select({
        mapId: featuredLearningMap.mapId,
        versionId: learningMapVersion.id,
        title: learningMapVersion.title,
        summary: learningMapVersion.summary,
      })
      .from(featuredLearningMap)
      .innerJoin(
        learningMapVersion,
        and(
          eq(learningMapVersion.id, featuredLearningMap.versionId),
          eq(learningMapVersion.mapId, featuredLearningMap.mapId),
        ),
      )
      .where(
        and(
          eq(featuredLearningMap.mapId, mapId),
          eq(learningMapVersion.status, "published"),
        ),
      )
      .limit(1);
    const version = versions[0];
    return version ? this.loadLearningMapDetail(version) : null;
  }

  async findByLearningRelationship(
    userId: string,
    learningRelationshipId: string,
  ): Promise<LearningMapDetail | null> {
    const versions = await this.database
      .select({
        mapId: learningMapVersion.mapId,
        versionId: learningMapVersion.id,
        title: learningMapVersion.title,
        summary: learningMapVersion.summary,
      })
      .from(learningRelationship)
      .innerJoin(
        learningMapVersion,
        eq(learningMapVersion.id, learningRelationship.versionId),
      )
      .where(
        and(
          eq(learningRelationship.id, learningRelationshipId),
          eq(learningRelationship.userId, userId),
          eq(learningMapVersion.status, "published"),
        ),
      )
      .limit(1);
    const version = versions[0];
    return version ? this.loadLearningMapDetail(version) : null;
  }

  async establish(
    userId: string,
    versionId: string,
  ): Promise<LearningRelationship | null> {
    return this.database.transaction(async (transaction) => {
      const versions = await transaction
        .select({
          mapId: learningMapVersion.mapId,
          versionId: learningMapVersion.id,
        })
        .from(learningMapVersion)
        .where(
          and(
            eq(learningMapVersion.id, versionId),
            eq(learningMapVersion.status, "published"),
          ),
        )
        .limit(1);
      const version = versions[0];
      if (!version) {
        return null;
      }

      const questionSets = await transaction
        .select({ questionSetId: learningAssessmentQuestionSet.id })
        .from(learningAssessmentQuestionSet)
        .where(
          and(
            eq(learningAssessmentQuestionSet.versionId, version.versionId),
            eq(learningAssessmentQuestionSet.status, "published"),
          ),
        )
        .limit(1);
      const questionSetId = questionSets[0]?.questionSetId ?? null;

      const relationships = await transaction
        .insert(learningRelationship)
        .values({
          id: `learning_${crypto.randomUUID()}`,
          userId,
          versionId,
          questionSetId,
        })
        .onConflictDoUpdate({
          target: [learningRelationship.userId, learningRelationship.versionId],
          set: {
            userId,
            questionSetId: sql`COALESCE(${learningRelationship.questionSetId}, ${questionSetId})`,
          },
        })
        .returning({
          learningRelationshipId: learningRelationship.id,
          questionSetId: learningRelationship.questionSetId,
        });

      return {
        learningRelationshipId: relationships[0]!.learningRelationshipId,
        mapId: version.mapId,
        versionId: version.versionId,
        questionSetId: relationships[0]!.questionSetId,
      };
    });
  }

  private async loadLearningMapDetail(version: {
    mapId: string;
    versionId: string;
    title: string;
    summary: string;
  }): Promise<LearningMapDetail> {
    const [
      nodes,
      prerequisites,
      sources,
      nodeSources,
      viewpoints,
      viewpointSources,
    ] = await Promise.all([
      this.database
        .select({
          nodeId: learningMapNode.nodeId,
          title: learningMapNode.title,
          learningObjective: learningMapNode.learningObjective,
        })
        .from(learningMapNode)
        .where(eq(learningMapNode.versionId, version.versionId))
        .orderBy(asc(learningMapNode.nodeId)),
      this.database
        .select({
          nodeId: learningMapPrerequisite.nodeId,
          prerequisiteNodeId: learningMapPrerequisite.prerequisiteNodeId,
        })
        .from(learningMapPrerequisite)
        .where(eq(learningMapPrerequisite.versionId, version.versionId))
        .orderBy(
          asc(learningMapPrerequisite.nodeId),
          asc(learningMapPrerequisite.prerequisiteNodeId),
        ),
      this.database
        .select({
          sourceId: knowledgeSource.sourceId,
          title: knowledgeSource.title,
          excerpt: knowledgeSource.excerpt,
          url: knowledgeSource.url,
          authorName: knowledgeSource.authorName,
        })
        .from(knowledgeSource)
        .where(eq(knowledgeSource.versionId, version.versionId))
        .orderBy(asc(knowledgeSource.sourceId)),
      this.database
        .select({
          nodeId: learningMapNodeSource.nodeId,
          sourceId: learningMapNodeSource.sourceId,
        })
        .from(learningMapNodeSource)
        .where(eq(learningMapNodeSource.versionId, version.versionId))
        .orderBy(
          asc(learningMapNodeSource.nodeId),
          asc(learningMapNodeSource.sourceId),
        ),
      this.database
        .select({
          viewpointId: learningViewpoint.viewpointId,
          nodeId: learningViewpoint.nodeId,
          kind: learningViewpoint.kind,
          statement: learningViewpoint.statement,
          conditions: learningViewpoint.conditions,
        })
        .from(learningViewpoint)
        .where(eq(learningViewpoint.versionId, version.versionId))
        .orderBy(
          asc(learningViewpoint.nodeId),
          asc(learningViewpoint.viewpointId),
        ),
      this.database
        .select({
          nodeId: learningViewpointSource.nodeId,
          viewpointId: learningViewpointSource.viewpointId,
          sourceId: learningViewpointSource.sourceId,
        })
        .from(learningViewpointSource)
        .where(eq(learningViewpointSource.versionId, version.versionId))
        .orderBy(
          asc(learningViewpointSource.nodeId),
          asc(learningViewpointSource.viewpointId),
          asc(learningViewpointSource.sourceId),
        ),
    ]);

    const sourceIdsByNode = new Map<string, string[]>();
    for (const row of nodeSources) {
      const sourceIds = sourceIdsByNode.get(row.nodeId) ?? [];
      sourceIds.push(row.sourceId);
      sourceIdsByNode.set(row.nodeId, sourceIds);
    }
    const sourceIdsByViewpoint = new Map<string, Map<string, string[]>>();
    for (const row of viewpointSources) {
      const byViewpoint =
        sourceIdsByViewpoint.get(row.nodeId) ?? new Map<string, string[]>();
      const sourceIds = byViewpoint.get(row.viewpointId) ?? [];
      sourceIds.push(row.sourceId);
      byViewpoint.set(row.viewpointId, sourceIds);
      sourceIdsByViewpoint.set(row.nodeId, byViewpoint);
    }

    return {
      ...version,
      nodes: nodes.map((node) => ({
        ...node,
        sourceIds: sourceIdsByNode.get(node.nodeId) ?? [],
      })),
      prerequisites,
      sources,
      viewpoints: viewpoints.map((viewpoint) => ({
        ...viewpoint,
        sourceIds:
          sourceIdsByViewpoint
            .get(viewpoint.nodeId)
            ?.get(viewpoint.viewpointId) ?? [],
      })),
    };
  }
}
