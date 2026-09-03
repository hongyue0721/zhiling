import { createHash } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";

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

import type {
  GenerationCache,
  GenerationClock,
  GenerationIdGenerator,
  GenerationPublicationPort,
  GenerationPublicationResult,
} from "../application/ports";
import type { GenerationCandidate } from "../domain/candidate";
import {
  GenerationLeaseLostError,
  GenerationTaskFailure,
} from "../application/ports";
import { validateGenerationCandidate } from "../domain/candidate";
import { stableMapId } from "../domain/identity";
import {
  GENERATION_LEASE_MS,
  LOCAL_OPERATION_TIMEOUT_MS,
} from "../domain/state-machine";
import type { MapGenerationDatabase } from "./generation-database";
import {
  STAGE_CHECKPOINT_KEY,
  taskProjection,
  toTask,
} from "./generation-projection";

function stableMapId(normalizedTopic: string): string {
  return `map_${createHash("sha256").update(normalizedTopic, "utf8").digest("hex")}`;
}

export class DrizzleGenerationPublication implements GenerationPublicationPort {
  constructor(
    private readonly database: MapGenerationDatabase,
    private readonly now: GenerationClock,
    private readonly idGenerator: GenerationIdGenerator,
  ) {}

  async publishCandidate(
    taskId: string,
    workerId: string,
    candidate: GenerationCandidate,
  ): Promise<GenerationPublicationResult> {
    const validated = validateGenerationCandidate(candidate);
    const versionId = `map_version_${taskId}`;
    const questionSetId = `question_set_${taskId}`;
    const now = this.now();
    let result: GenerationPublicationResult | null = null;
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql.raw(`SET LOCAL statement_timeout = ${LOCAL_OPERATION_TIMEOUT_MS}`),
      );
      const currentRows = await transaction
        .select(taskProjection)
        .from(generationTask)
        .where(
          and(
            eq(generationTask.id, taskId),
            eq(generationTask.status, "publishing"),
            eq(generationTask.leaseOwner, workerId),
            gt(generationTask.leaseExpiresAt, now),
          ),
        )
        .limit(1)
        .for("update");
      const current = currentRows[0] ? toTask(currentRows[0]) : null;
      if (!current) {
        throw new GenerationLeaseLostError();
      }
      const mapId = stableMapId(current.normalizedTopic);

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
        .where(eq(generationParticipant.taskId, taskId));
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

      const sequence = current.sequence + 1;
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
            eq(generationTask.id, taskId),
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
          normalizedTopic: current.normalizedTopic,
          pipelineVersion: current.pipelineVersion,
          sourceAdapterVersion: current.sourceAdapterVersion,
          modelAdapterVersion: current.modelAdapterVersion,
          taskId,
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
            taskId,
            mapId,
            versionId,
            questionSetId,
            createdAt: completionNow,
          },
        });
      await transaction.insert(generationEvent).values({
        taskId,
        sequence,
        type: "succeeded",
        data: { status: "succeeded", mapId, versionId, questionSetId },
        occurredAt: completionNow,
      });
      result = { mapId, versionId, questionSetId };
    });
    if (!result) {
      throw new GenerationTaskFailure("internal_failure", false);
    }
    return result;
  }

  async completeCachedTask(
    taskId: string,
    workerId: string,
    cache: GenerationCache,
  ): Promise<void> {
    const now = this.now();
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql.raw(`SET LOCAL statement_timeout = ${LOCAL_OPERATION_TIMEOUT_MS}`),
      );
      const currentRows = await transaction
        .select(taskProjection)
        .from(generationTask)
        .where(
          and(
            eq(generationTask.id, taskId),
            eq(generationTask.status, "cache_lookup"),
            eq(generationTask.leaseOwner, workerId),
            gt(generationTask.leaseExpiresAt, now),
          ),
        )
        .limit(1)
        .for("update");
      const current = currentRows[0] ? toTask(currentRows[0]) : null;
      if (!current) {
        throw new GenerationLeaseLostError();
      }
      const participants = await transaction
        .select({ userId: generationParticipant.userId })
        .from(generationParticipant)
        .where(eq(generationParticipant.taskId, taskId));
      if (participants.length === 0) {
        throw new GenerationTaskFailure("internal_failure", false);
      }
      for (const participant of participants) {
        await transaction
          .insert(learningRelationship)
          .values({
            id: `learning_${this.idGenerator()}`,
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
      const sequence = current.sequence + 1;
      const completionNow = this.now();
      await transaction
        .insert(generationCheckpoint)
        .values({
          taskId,
          stage: "cache_lookup",
          operationKey: STAGE_CHECKPOINT_KEY,
          input: { identity: current.normalizedTopic },
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
            eq(generationTask.id, taskId),
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
        taskId,
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
}
