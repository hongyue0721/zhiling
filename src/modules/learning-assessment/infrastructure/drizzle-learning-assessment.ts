import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  learningAssessmentAttempt,
  learningAssessmentQuestion,
  learningAssessmentQuestionCorrectOption,
  learningAssessmentQuestionMatchingAnswer,
  learningAssessmentQuestionOption,
  learningAssessmentQuestionSet,
  learningAssessmentQuestionSource,
} from "@/platform/database/assessment-schema";
import {
  learningMapNode,
  learningMapNodeSource,
  learningMapVersion,
  learningRelationship,
} from "@/platform/database/catalog-schema";
import { databaseSchema } from "@/platform/database/schema";
import { learningProgressNode } from "@/platform/database/progress-schema";

import {
  ASSESSMENT_COMPLETION_SCORE,
  LearningAssessmentInvariantError,
  scoreLearningAssessment,
  validateAssessmentAnswers,
  validateLearningAssessmentQuestionSet,
  type AssessmentAnswerSubmission,
  type LearningAssessmentQuestion,
  type LearningAssessmentQuestionSetPublication,
} from "../domain/assessment";
import type {
  LearningAssessmentProgressWriterInput,
  LearningAssessmentRepository,
  LearningAssessmentSubmissionResult,
  LearningNodeAssessment,
} from "../application/read-model";

export class LearningAssessmentPublicationError extends Error {
  constructor(readonly code: string) {
    super(`Learning assessment publication failed: ${code}`);
    this.name = "LearningAssessmentPublicationError";
  }
}

export class LearningAssessmentQuestionSetAlreadyExistsError extends Error {
  readonly code = "learning_assessment_question_set_already_exists";

  constructor() {
    super("Learning assessment question set already exists");
    this.name = "LearningAssessmentQuestionSetAlreadyExistsError";
  }
}

type QuestionRow = {
  questionId: string;
  nodeId: string;
  type: LearningAssessmentQuestion["type"];
  prompt: string;
  explanation: string;
  position: number;
};

type OptionRow = {
  questionId: string;
  optionId: string;
  label: string;
  position: number;
  side: string | null;
};

type CorrectOptionRow = { questionId: string; optionId: string };
type MatchingAnswerRow = {
  questionId: string;
  leftOptionId: string;
  rightOptionId: string;
};
type SourceRow = { questionId: string; sourceId: string };

function reconstructQuestions(
  questions: readonly QuestionRow[],
  options: readonly OptionRow[],
  correctOptions: readonly CorrectOptionRow[],
  matchingAnswers: readonly MatchingAnswerRow[],
  sources: readonly SourceRow[],
): LearningAssessmentQuestion[] {
  const optionsByQuestion = new Map<string, OptionRow[]>();
  for (const option of options) {
    const values = optionsByQuestion.get(option.questionId) ?? [];
    values.push(option);
    optionsByQuestion.set(option.questionId, values);
  }
  const correctByQuestion = new Map<string, string[]>();
  for (const option of correctOptions) {
    const values = correctByQuestion.get(option.questionId) ?? [];
    values.push(option.optionId);
    correctByQuestion.set(option.questionId, values);
  }
  const matchesByQuestion = new Map<string, MatchingAnswerRow[]>();
  for (const match of matchingAnswers) {
    const values = matchesByQuestion.get(match.questionId) ?? [];
    values.push(match);
    matchesByQuestion.set(match.questionId, values);
  }
  const sourcesByQuestion = new Map<string, string[]>();
  for (const source of sources) {
    const values = sourcesByQuestion.get(source.questionId) ?? [];
    values.push(source.sourceId);
    sourcesByQuestion.set(source.questionId, values);
  }
  return questions.map((question) => ({
    questionId: question.questionId,
    nodeId: question.nodeId,
    type: question.type,
    prompt: question.prompt,
    explanation: question.explanation,
    options: (optionsByQuestion.get(question.questionId) ?? []).map(
      ({ optionId, label, side }) =>
        side === "left" || side === "right"
          ? { optionId, label, side }
          : { optionId, label },
    ),
    correctOptionIds: [...(correctByQuestion.get(question.questionId) ?? [])],
    correctMatches: (matchesByQuestion.get(question.questionId) ?? []).map(
      ({ leftOptionId, rightOptionId }) => ({
        leftOptionId,
        rightOptionId,
      }),
    ),
    sourceIds: [...(sourcesByQuestion.get(question.questionId) ?? [])],
  }));
}

function ensureSubmittedOptionsAreKnown(
  questions: readonly LearningAssessmentQuestion[],
  answers: readonly AssessmentAnswerSubmission[],
): void {
  const questionsById = new Map(
    questions.map((question) => [question.questionId, question]),
  );
  for (const answer of answers) {
    const question = questionsById.get(answer.questionId);
    if (!question) {
      throw new LearningAssessmentInvariantError("unknown_submission_question");
    }
    const knownOptionIds = new Set(
      question.options.map(({ optionId }) => optionId),
    );
    if (
      answer.selectedOptionIds?.some(
        (optionId) => !knownOptionIds.has(optionId),
      ) ||
      answer.matches?.some(
        ({ leftOptionId, rightOptionId }) =>
          !knownOptionIds.has(leftOptionId) ||
          !knownOptionIds.has(rightOptionId),
      )
    ) {
      throw new LearningAssessmentInvariantError("invalid_submission");
    }
  }
}

function cloneSubmissionResult(
  result: LearningAssessmentSubmissionResult,
): LearningAssessmentSubmissionResult {
  return {
    ...result,
    questions: result.questions.map((question) => ({
      ...question,
      sourceIds: [...question.sourceIds],
    })),
  };
}

export class DrizzleLearningAssessmentRepository implements LearningAssessmentRepository {
  constructor(
    private readonly database: NodePgDatabase<typeof databaseSchema>,
  ) {}

  async publishQuestionSet(
    publication: LearningAssessmentQuestionSetPublication,
  ): Promise<void> {
    const validated = validateLearningAssessmentQuestionSet(publication);
    await this.database.transaction(async (transaction) => {
      const versions = await transaction
        .select({ id: learningMapVersion.id })
        .from(learningMapVersion)
        .where(
          and(
            eq(learningMapVersion.id, validated.versionId),
            eq(learningMapVersion.status, "published"),
          ),
        )
        .limit(1);
      if (!versions[0]) {
        throw new LearningAssessmentPublicationError(
          "assessment_version_not_published",
        );
      }

      const nodes = await transaction
        .select({ nodeId: learningMapNode.nodeId })
        .from(learningMapNode)
        .where(eq(learningMapNode.versionId, validated.versionId));
      const nodeIds = new Set(nodes.map(({ nodeId }) => nodeId));
      const questionCountByNode = new Map<string, number>();
      for (const question of validated.questions) {
        if (!nodeIds.has(question.nodeId)) {
          throw new LearningAssessmentPublicationError(
            "assessment_node_not_in_version",
          );
        }
        questionCountByNode.set(
          question.nodeId,
          (questionCountByNode.get(question.nodeId) ?? 0) + 1,
        );
      }
      if (
        questionCountByNode.size !== nodeIds.size ||
        [...nodeIds].some((nodeId) => {
          const count = questionCountByNode.get(nodeId) ?? 0;
          return count < 2 || count > 3;
        })
      ) {
        throw new LearningAssessmentPublicationError(
          "assessment_question_count_per_node_invalid",
        );
      }

      const nodeSources = await transaction
        .select({
          nodeId: learningMapNodeSource.nodeId,
          sourceId: learningMapNodeSource.sourceId,
        })
        .from(learningMapNodeSource)
        .where(eq(learningMapNodeSource.versionId, validated.versionId));
      const sourceIdsByNode = new Map<string, Set<string>>();
      for (const source of nodeSources) {
        const sourceIds =
          sourceIdsByNode.get(source.nodeId) ?? new Set<string>();
        sourceIds.add(source.sourceId);
        sourceIdsByNode.set(source.nodeId, sourceIds);
      }
      for (const question of validated.questions) {
        const nodeSourceIds = sourceIdsByNode.get(question.nodeId);
        if (
          !nodeSourceIds ||
          question.sourceIds.some((sourceId) => !nodeSourceIds.has(sourceId))
        ) {
          throw new LearningAssessmentPublicationError(
            "assessment_source_not_in_node",
          );
        }
      }

      const existing = await transaction
        .select({ id: learningAssessmentQuestionSet.id })
        .from(learningAssessmentQuestionSet)
        .where(
          and(
            eq(learningAssessmentQuestionSet.id, validated.questionSetId),
            eq(learningAssessmentQuestionSet.versionId, validated.versionId),
          ),
        )
        .limit(1);
      if (existing[0]) {
        throw new LearningAssessmentQuestionSetAlreadyExistsError();
      }

      await transaction.insert(learningAssessmentQuestionSet).values({
        id: validated.questionSetId,
        versionId: validated.versionId,
        status: "draft",
        publishedAt: null,
      });
      await transaction.insert(learningAssessmentQuestion).values(
        validated.questions.map((question, position) => ({
          questionSetId: validated.questionSetId,
          questionId: question.questionId,
          versionId: validated.versionId,
          nodeId: question.nodeId,
          position,
          type: question.type,
          prompt: question.prompt,
          explanation: question.explanation,
        })),
      );
      await transaction.insert(learningAssessmentQuestionOption).values(
        validated.questions.flatMap((question) =>
          question.options.map((option, position) => ({
            questionSetId: validated.questionSetId,
            questionId: question.questionId,
            optionId: option.optionId,
            label: option.label,
            position,
            side: option.side ?? null,
          })),
        ),
      );

      const correctOptions = validated.questions.flatMap((question) =>
        question.correctOptionIds.map((optionId) => ({
          questionSetId: validated.questionSetId,
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
        question.correctMatches.map((match) => ({
          questionSetId: validated.questionSetId,
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
            questionSetId: validated.questionSetId,
            questionId: question.questionId,
            versionId: validated.versionId,
            nodeId: question.nodeId,
            sourceId,
          })),
        ),
      );
      await transaction
        .update(learningAssessmentQuestionSet)
        .set({ status: "published", publishedAt: new Date() })
        .where(
          and(
            eq(learningAssessmentQuestionSet.id, validated.questionSetId),
            eq(learningAssessmentQuestionSet.status, "draft"),
          ),
        );
    });
  }

  async findNodeAssessment(
    userId: string,
    learningRelationshipId: string,
    versionId: string,
    nodeId: string,
  ): Promise<LearningNodeAssessment | null> {
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

    const questionSets = await this.database
      .select({
        id: learningAssessmentQuestionSet.id,
        versionId: learningAssessmentQuestionSet.versionId,
      })
      .from(learningAssessmentQuestionSet)
      .where(
        and(
          eq(learningAssessmentQuestionSet.id, relationship.questionSetId),
          eq(learningAssessmentQuestionSet.versionId, versionId),
          eq(learningAssessmentQuestionSet.status, "published"),
        ),
      )
      .limit(1);
    if (!questionSets[0]) {
      return null;
    }

    const [questionRows, optionRows, sourceRows] = await Promise.all([
      this.database
        .select({
          questionId: learningAssessmentQuestion.questionId,
          nodeId: learningAssessmentQuestion.nodeId,
          type: learningAssessmentQuestion.type,
          prompt: learningAssessmentQuestion.prompt,
          explanation: learningAssessmentQuestion.explanation,
          position: learningAssessmentQuestion.position,
        })
        .from(learningAssessmentQuestion)
        .where(
          and(
            eq(
              learningAssessmentQuestion.questionSetId,
              relationship.questionSetId,
            ),
            eq(learningAssessmentQuestion.versionId, versionId),
            eq(learningAssessmentQuestion.nodeId, nodeId),
          ),
        )
        .orderBy(asc(learningAssessmentQuestion.position)),
      this.database
        .select({
          questionId: learningAssessmentQuestionOption.questionId,
          optionId: learningAssessmentQuestionOption.optionId,
          label: learningAssessmentQuestionOption.label,
          position: learningAssessmentQuestionOption.position,
          side: learningAssessmentQuestionOption.side,
        })
        .from(learningAssessmentQuestionOption)
        .innerJoin(
          learningAssessmentQuestion,
          and(
            eq(
              learningAssessmentQuestion.questionSetId,
              learningAssessmentQuestionOption.questionSetId,
            ),
            eq(
              learningAssessmentQuestion.questionId,
              learningAssessmentQuestionOption.questionId,
            ),
          ),
        )
        .where(
          and(
            eq(
              learningAssessmentQuestionOption.questionSetId,
              relationship.questionSetId,
            ),
            eq(learningAssessmentQuestion.nodeId, nodeId),
          ),
        )
        .orderBy(
          asc(learningAssessmentQuestionOption.questionId),
          asc(learningAssessmentQuestionOption.position),
        ),
      this.database
        .select({
          questionId: learningAssessmentQuestionSource.questionId,
          sourceId: learningAssessmentQuestionSource.sourceId,
        })
        .from(learningAssessmentQuestionSource)
        .innerJoin(
          learningAssessmentQuestion,
          and(
            eq(
              learningAssessmentQuestion.questionSetId,
              learningAssessmentQuestionSource.questionSetId,
            ),
            eq(
              learningAssessmentQuestion.questionId,
              learningAssessmentQuestionSource.questionId,
            ),
          ),
        )
        .where(
          and(
            eq(
              learningAssessmentQuestionSource.questionSetId,
              relationship.questionSetId,
            ),
            eq(learningAssessmentQuestion.nodeId, nodeId),
          ),
        )
        .orderBy(
          asc(learningAssessmentQuestionSource.questionId),
          asc(learningAssessmentQuestionSource.sourceId),
        ),
    ]);
    if (questionRows.length === 0) {
      return null;
    }

    return {
      learningRelationshipId,
      questionSetId: relationship.questionSetId,
      versionId: questionSets[0].versionId,
      nodeId,
      questions: questionRows.map((question) => ({
        questionId: question.questionId,
        nodeId: question.nodeId,
        type: question.type,
        prompt: question.prompt,
        options: optionRows
          .filter(({ questionId }) => questionId === question.questionId)
          .map(({ optionId, label, side }) =>
            side === "left" || side === "right"
              ? { optionId, label, side }
              : { optionId, label },
          ),
        sourceIds: sourceRows
          .filter(({ questionId }) => questionId === question.questionId)
          .map(({ sourceId }) => sourceId),
      })),
    };
  }

  async submit(
    input: LearningAssessmentProgressWriterInput,
  ): Promise<LearningAssessmentSubmissionResult | null> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT id FROM learning_relationship WHERE id = ${input.learningRelationshipId} AND user_id = ${input.userId} AND version_id = ${input.versionId} FOR UPDATE`,
      );
      const relationships = await transaction
        .select({
          questionSetId: learningRelationship.questionSetId,
        })
        .from(learningRelationship)
        .where(
          and(
            eq(learningRelationship.id, input.learningRelationshipId),
            eq(learningRelationship.userId, input.userId),
            eq(learningRelationship.versionId, input.versionId),
          ),
        )
        .limit(1);
      const relationship = relationships[0];
      if (!relationship?.questionSetId) {
        return null;
      }

      const existingAttempts = await transaction
        .select({ result: learningAssessmentAttempt.result })
        .from(learningAssessmentAttempt)
        .where(
          and(
            eq(
              learningAssessmentAttempt.learningRelationshipId,
              input.learningRelationshipId,
            ),
            eq(
              learningAssessmentAttempt.questionSetId,
              relationship.questionSetId,
            ),
            eq(learningAssessmentAttempt.nodeId, input.nodeId),
            eq(learningAssessmentAttempt.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existingAttempts[0]) {
        return cloneSubmissionResult(
          existingAttempts[0].result as LearningAssessmentSubmissionResult,
        );
      }

      const questionSets = await transaction
        .select({ versionId: learningAssessmentQuestionSet.versionId })
        .from(learningAssessmentQuestionSet)
        .where(
          and(
            eq(learningAssessmentQuestionSet.id, relationship.questionSetId),
            eq(learningAssessmentQuestionSet.versionId, input.versionId),
            eq(learningAssessmentQuestionSet.status, "published"),
          ),
        )
        .limit(1);
      if (!questionSets[0]) {
        return null;
      }

      const questionRows = await transaction
        .select({
          questionId: learningAssessmentQuestion.questionId,
          nodeId: learningAssessmentQuestion.nodeId,
          type: learningAssessmentQuestion.type,
          prompt: learningAssessmentQuestion.prompt,
          explanation: learningAssessmentQuestion.explanation,
          position: learningAssessmentQuestion.position,
        })
        .from(learningAssessmentQuestion)
        .where(
          and(
            eq(
              learningAssessmentQuestion.questionSetId,
              relationship.questionSetId,
            ),
            eq(learningAssessmentQuestion.versionId, input.versionId),
            eq(learningAssessmentQuestion.nodeId, input.nodeId),
          ),
        )
        .orderBy(asc(learningAssessmentQuestion.position));
      const optionRows = await transaction
        .select({
          questionId: learningAssessmentQuestionOption.questionId,
          optionId: learningAssessmentQuestionOption.optionId,
          label: learningAssessmentQuestionOption.label,
          position: learningAssessmentQuestionOption.position,
          side: learningAssessmentQuestionOption.side,
        })
        .from(learningAssessmentQuestionOption)
        .where(
          eq(
            learningAssessmentQuestionOption.questionSetId,
            relationship.questionSetId,
          ),
        )
        .orderBy(
          asc(learningAssessmentQuestionOption.questionId),
          asc(learningAssessmentQuestionOption.position),
        );
      const correctOptionRows = await transaction
        .select({
          questionId: learningAssessmentQuestionCorrectOption.questionId,
          optionId: learningAssessmentQuestionCorrectOption.optionId,
        })
        .from(learningAssessmentQuestionCorrectOption)
        .where(
          eq(
            learningAssessmentQuestionCorrectOption.questionSetId,
            relationship.questionSetId,
          ),
        );
      const matchingRows = await transaction
        .select({
          questionId: learningAssessmentQuestionMatchingAnswer.questionId,
          leftOptionId: learningAssessmentQuestionMatchingAnswer.leftOptionId,
          rightOptionId: learningAssessmentQuestionMatchingAnswer.rightOptionId,
        })
        .from(learningAssessmentQuestionMatchingAnswer)
        .where(
          eq(
            learningAssessmentQuestionMatchingAnswer.questionSetId,
            relationship.questionSetId,
          ),
        );
      const sourceRows = await transaction
        .select({
          questionId: learningAssessmentQuestionSource.questionId,
          sourceId: learningAssessmentQuestionSource.sourceId,
        })
        .from(learningAssessmentQuestionSource)
        .where(
          and(
            eq(
              learningAssessmentQuestionSource.questionSetId,
              relationship.questionSetId,
            ),
            eq(learningAssessmentQuestionSource.nodeId, input.nodeId),
          ),
        );
      if (questionRows.length === 0) {
        return null;
      }

      const questions = reconstructQuestions(
        questionRows,
        optionRows.filter((option) =>
          questionRows.some(
            (question) => question.questionId === option.questionId,
          ),
        ),
        correctOptionRows.filter((option) =>
          questionRows.some(
            (question) => question.questionId === option.questionId,
          ),
        ),
        matchingRows.filter((match) =>
          questionRows.some(
            (question) => question.questionId === match.questionId,
          ),
        ),
        sourceRows,
      );
      const normalizedAnswers = validateAssessmentAnswers(
        questions,
        input.answers,
      );
      ensureSubmittedOptionsAreKnown(questions, normalizedAnswers);
      const scoring = scoreLearningAssessment(questions, normalizedAnswers);
      const submittedAt = new Date();
      const attemptId = `attempt_${crypto.randomUUID()}`;

      const progressRows = await transaction
        .insert(learningProgressNode)
        .values({
          learningRelationshipId: input.learningRelationshipId,
          questionSetId: relationship.questionSetId,
          versionId: input.versionId,
          nodeId: input.nodeId,
          bestScore: scoring.nodeScore,
          bestAttemptId: attemptId,
          completedAt:
            scoring.nodeScore >= ASSESSMENT_COMPLETION_SCORE
              ? submittedAt
              : null,
          updatedAt: submittedAt,
        })
        .onConflictDoUpdate({
          target: [
            learningProgressNode.learningRelationshipId,
            learningProgressNode.nodeId,
          ],
          set: {
            bestScore: sql`GREATEST(${learningProgressNode.bestScore}, ${scoring.nodeScore})`,
            bestAttemptId: sql`CASE WHEN ${learningProgressNode.bestScore} < ${scoring.nodeScore} THEN ${attemptId} ELSE ${learningProgressNode.bestAttemptId} END`,
            completedAt: sql`CASE WHEN ${learningProgressNode.completedAt} IS NOT NULL THEN ${learningProgressNode.completedAt} WHEN ${scoring.nodeScore} >= ${ASSESSMENT_COMPLETION_SCORE} THEN ${submittedAt} ELSE NULL END`,
            updatedAt: submittedAt,
          },
        })
        .returning({
          bestScore: learningProgressNode.bestScore,
          bestAttemptId: learningProgressNode.bestAttemptId,
          completedAt: learningProgressNode.completedAt,
        });
      const progress = progressRows[0]!;
      const result: LearningAssessmentSubmissionResult = {
        attemptId,
        learningRelationshipId: input.learningRelationshipId,
        questionSetId: relationship.questionSetId,
        versionId: input.versionId,
        nodeId: input.nodeId,
        nodeScore: scoring.nodeScore,
        bestScore: progress.bestScore,
        completed: progress.completedAt !== null,
        submittedAt: submittedAt.toISOString(),
        questions: questions.map((question) => {
          const score = scoring.questionScores.find(
            ({ questionId }) => questionId === question.questionId,
          )!;
          return {
            questionId: question.questionId,
            correct: score.correct,
            scoreBasisPoints: score.scoreBasisPoints,
            explanation: question.explanation,
            sourceIds: [...question.sourceIds],
          };
        }),
      };

      const insertedAttempts = await transaction
        .insert(learningAssessmentAttempt)
        .values({
          id: attemptId,
          learningRelationshipId: input.learningRelationshipId,
          questionSetId: relationship.questionSetId,
          versionId: input.versionId,
          nodeId: input.nodeId,
          idempotencyKey: input.idempotencyKey,
          answers: normalizedAnswers,
          result,
          nodeScore: scoring.nodeScore,
          createdAt: submittedAt,
        })
        .onConflictDoNothing({
          target: [
            learningAssessmentAttempt.learningRelationshipId,
            learningAssessmentAttempt.questionSetId,
            learningAssessmentAttempt.nodeId,
            learningAssessmentAttempt.idempotencyKey,
          ],
        })
        .returning({ id: learningAssessmentAttempt.id });
      if (insertedAttempts.length === 0) {
        throw new Error(
          "assessment idempotency key was committed concurrently",
        );
      }
      return cloneSubmissionResult(result);
    });
  }
}
