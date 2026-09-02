import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { learningAssessmentAttempt } from "@/platform/database/assessment-schema";
import { learningRelationship } from "@/platform/database/catalog-schema";
import { databaseSchema } from "@/platform/database/schema";
import { learningProgressNode } from "@/platform/database/progress-schema";

import type {
  LearningAttemptSummary,
  LearningProgressRepository,
  LearningProgressSummary,
} from "../application/read-model";

export class DrizzleLearningProgressRepository implements LearningProgressRepository {
  constructor(
    private readonly database: NodePgDatabase<typeof databaseSchema>,
  ) {}

  async find(
    userId: string,
    learningRelationshipId: string,
    versionId: string,
    nodeIds: readonly string[],
  ): Promise<LearningProgressSummary | null> {
    const relationships = await this.database
      .select({
        questionSetId: learningRelationship.questionSetId,
        relationshipVersionId: learningRelationship.versionId,
      })
      .from(learningRelationship)
      .where(
        and(
          eq(learningRelationship.id, learningRelationshipId),
          eq(learningRelationship.userId, userId),
          eq(learningRelationship.versionId, versionId),
        ),
      )
      .limit(1);
    const relationship = relationships[0];
    if (!relationship?.questionSetId) {
      return null;
    }

    const [progressRows, attemptRows] = await Promise.all([
      nodeIds.length > 0
        ? this.database
            .select({
              nodeId: learningProgressNode.nodeId,
              bestScore: learningProgressNode.bestScore,
              bestAttemptId: learningProgressNode.bestAttemptId,
              completedAt: learningProgressNode.completedAt,
            })
            .from(learningProgressNode)
            .where(
              and(
                eq(
                  learningProgressNode.learningRelationshipId,
                  learningRelationshipId,
                ),
                eq(
                  learningProgressNode.questionSetId,
                  relationship.questionSetId,
                ),
                eq(learningProgressNode.versionId, versionId),
                inArray(learningProgressNode.nodeId, [...nodeIds]),
              ),
            )
        : Promise.resolve([]),
      this.database
        .select({
          attemptId: learningAssessmentAttempt.id,
          nodeId: learningAssessmentAttempt.nodeId,
          nodeScore: learningAssessmentAttempt.nodeScore,
          submittedAt: learningAssessmentAttempt.createdAt,
        })
        .from(learningAssessmentAttempt)
        .where(
          and(
            eq(
              learningAssessmentAttempt.learningRelationshipId,
              learningRelationshipId,
            ),
            eq(
              learningAssessmentAttempt.questionSetId,
              relationship.questionSetId,
            ),
            eq(learningAssessmentAttempt.versionId, versionId),
          ),
        )
        .orderBy(
          desc(learningAssessmentAttempt.createdAt),
          desc(learningAssessmentAttempt.id),
        ),
    ]);
    const progressByNode = new Map(
      progressRows.map((row) => [row.nodeId, row]),
    );
    const nodes = nodeIds.map((nodeId) => {
      const progress = progressByNode.get(nodeId);
      const bestScore = progress?.bestScore ?? 0;
      return {
        nodeId,
        bestScore,
        completed:
          progress?.completedAt !== null && progress?.completedAt !== undefined,
        completedAt: progress?.completedAt?.toISOString() ?? null,
        bestAttemptId: progress?.bestAttemptId ?? null,
      };
    });
    const attempts: LearningAttemptSummary[] = attemptRows.map((attempt) => ({
      attemptId: attempt.attemptId,
      nodeId: attempt.nodeId,
      nodeScore: attempt.nodeScore,
      submittedAt: attempt.submittedAt.toISOString(),
    }));

    return {
      learningRelationshipId,
      versionId,
      questionSetId: relationship.questionSetId,
      nodes,
      attempts,
    };
  }
}
