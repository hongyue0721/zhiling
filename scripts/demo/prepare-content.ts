import { asc, eq, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { LearningAssessmentService } from "@/modules/learning-assessment/application/learning-assessment";
import {
  validateLearningAssessmentQuestionSet,
  type LearningAssessmentQuestion,
} from "@/modules/learning-assessment/domain/assessment";
import { DrizzleLearningAssessmentRepository } from "@/modules/learning-assessment/infrastructure/drizzle-learning-assessment";
import { PublishFeaturedLearningMap } from "@/modules/learning-catalog/application/learning-catalog";
import type { LearningMapDetail } from "@/modules/learning-catalog/application/read-model";
import { DrizzleLearningCatalogRepository } from "@/modules/learning-catalog/infrastructure/drizzle-learning-catalog";
import {
  learningAssessmentQuestion,
  learningAssessmentQuestionCorrectOption,
  learningAssessmentQuestionMatchingAnswer,
  learningAssessmentQuestionOption,
  learningAssessmentQuestionSet,
  learningAssessmentQuestionSource,
} from "@/platform/database/assessment-schema";
import {
  featuredLearningMap,
  learningMap,
  learningMapVersion,
} from "@/platform/database/catalog-schema";
import { databaseSchema } from "@/platform/database/schema";

import {
  classifyExistingDemoObject,
  DEMO_MAP_ID,
  DEMO_MAP_PUBLICATION,
  DEMO_QUESTION_SET_ID,
  DEMO_QUESTION_SET_PUBLICATION,
  DEMO_VERSION_ID,
} from "./content";

type DemoMapSnapshot = Readonly<
  LearningMapDetail & { featuredPosition: number }
>;

type DemoQuestionSetSnapshot = Readonly<{
  questionSetId: string;
  versionId: string;
  status: "published";
  questions: readonly LearningAssessmentQuestion[];
}>;

function byId<T>(readId: (value: T) => string) {
  return (left: T, right: T) => readId(left).localeCompare(readId(right));
}

function expectedMapSnapshot(): DemoMapSnapshot {
  return {
    mapId: DEMO_MAP_PUBLICATION.mapId,
    versionId: DEMO_MAP_PUBLICATION.versionId,
    title: DEMO_MAP_PUBLICATION.title,
    summary: DEMO_MAP_PUBLICATION.summary,
    featuredPosition: DEMO_MAP_PUBLICATION.featuredPosition,
    nodes: DEMO_MAP_PUBLICATION.nodes
      .map(({ nodeId, title, learningObjective, sourceIds }) => ({
        nodeId,
        title,
        learningObjective,
        sourceIds: [...sourceIds].sort(),
      }))
      .sort(byId((node) => node.nodeId)),
    prerequisites: DEMO_MAP_PUBLICATION.prerequisites
      .map((edge) => ({ ...edge }))
      .sort(byId((edge) => `${edge.nodeId}\u0000${edge.prerequisiteNodeId}`)),
    sources: DEMO_MAP_PUBLICATION.sources
      .map((source) => ({ ...source }))
      .sort(byId((source) => source.sourceId)),
    viewpoints: DEMO_MAP_PUBLICATION.nodes
      .flatMap((node) =>
        node.viewpoints.map((viewpoint) => ({
          ...viewpoint,
          nodeId: node.nodeId,
          sourceIds: [...viewpoint.sourceIds].sort(),
        })),
      )
      .sort(
        byId(
          (viewpoint) => `${viewpoint.nodeId}\u0000${viewpoint.viewpointId}`,
        ),
      ),
  };
}

async function loadExistingMap(
  database: NodePgDatabase<typeof databaseSchema>,
  catalogRepository: DrizzleLearningCatalogRepository,
): Promise<unknown | null> {
  const [maps, versions] = await Promise.all([
    database
      .select({ id: learningMap.id })
      .from(learningMap)
      .where(eq(learningMap.id, DEMO_MAP_ID))
      .limit(1),
    database
      .select({
        id: learningMapVersion.id,
        mapId: learningMapVersion.mapId,
        status: learningMapVersion.status,
      })
      .from(learningMapVersion)
      .where(eq(learningMapVersion.id, DEMO_VERSION_ID))
      .limit(1),
  ]);
  if (!maps[0] && !versions[0]) {
    return null;
  }
  if (!maps[0] || !versions[0]) {
    return { inconsistentStableDemoIdentifiers: true };
  }

  const [detail, featured] = await Promise.all([
    catalogRepository.findFeatured(DEMO_MAP_ID),
    database
      .select({
        versionId: featuredLearningMap.versionId,
        position: featuredLearningMap.position,
      })
      .from(featuredLearningMap)
      .where(eq(featuredLearningMap.mapId, DEMO_MAP_ID))
      .limit(1),
  ]);
  if (
    !detail ||
    detail.versionId !== DEMO_VERSION_ID ||
    versions[0].mapId !== DEMO_MAP_ID ||
    versions[0].status !== "published" ||
    featured[0]?.versionId !== DEMO_VERSION_ID
  ) {
    return { inconsistentPublishedDemoMap: true };
  }
  return {
    ...detail,
    featuredPosition: featured[0].position,
    nodes: [...detail.nodes].sort(byId((node) => node.nodeId)),
    prerequisites: [...detail.prerequisites].sort(
      byId((edge) => `${edge.nodeId}\u0000${edge.prerequisiteNodeId}`),
    ),
    sources: [...detail.sources].sort(byId((source) => source.sourceId)),
    viewpoints: [...detail.viewpoints].sort(
      byId((viewpoint) => `${viewpoint.nodeId}\u0000${viewpoint.viewpointId}`),
    ),
  } satisfies DemoMapSnapshot;
}

function expectedQuestionSetSnapshot(): DemoQuestionSetSnapshot {
  const normalized = validateLearningAssessmentQuestionSet(
    DEMO_QUESTION_SET_PUBLICATION,
  );
  return {
    ...normalized,
    status: "published",
    questions: normalized.questions.map((question) => ({
      ...question,
      correctOptionIds: [...question.correctOptionIds].sort(),
      correctMatches: [...question.correctMatches].sort(
        byId((match) => `${match.leftOptionId}\u0000${match.rightOptionId}`),
      ),
      sourceIds: [...question.sourceIds].sort(),
    })),
  };
}

async function loadExistingQuestionSet(
  database: NodePgDatabase<typeof databaseSchema>,
): Promise<unknown | null> {
  const sets = await database
    .select({
      id: learningAssessmentQuestionSet.id,
      versionId: learningAssessmentQuestionSet.versionId,
      status: learningAssessmentQuestionSet.status,
    })
    .from(learningAssessmentQuestionSet)
    .where(
      or(
        eq(learningAssessmentQuestionSet.id, DEMO_QUESTION_SET_ID),
        eq(learningAssessmentQuestionSet.versionId, DEMO_VERSION_ID),
      ),
    );
  if (sets.length === 0) {
    return null;
  }
  if (
    sets.length !== 1 ||
    sets[0]?.id !== DEMO_QUESTION_SET_ID ||
    sets[0].versionId !== DEMO_VERSION_ID ||
    sets[0].status !== "published"
  ) {
    return { inconsistentPublishedDemoQuestionSet: true };
  }
  const questionSet = sets[0];

  const [questions, options, correctOptions, matches, sources] =
    await Promise.all([
      database
        .select({
          questionId: learningAssessmentQuestion.questionId,
          nodeId: learningAssessmentQuestion.nodeId,
          type: learningAssessmentQuestion.type,
          prompt: learningAssessmentQuestion.prompt,
          explanation: learningAssessmentQuestion.explanation,
        })
        .from(learningAssessmentQuestion)
        .where(
          eq(learningAssessmentQuestion.questionSetId, DEMO_QUESTION_SET_ID),
        )
        .orderBy(asc(learningAssessmentQuestion.position)),
      database
        .select({
          questionId: learningAssessmentQuestionOption.questionId,
          optionId: learningAssessmentQuestionOption.optionId,
          label: learningAssessmentQuestionOption.label,
          side: learningAssessmentQuestionOption.side,
        })
        .from(learningAssessmentQuestionOption)
        .where(
          eq(
            learningAssessmentQuestionOption.questionSetId,
            DEMO_QUESTION_SET_ID,
          ),
        )
        .orderBy(
          asc(learningAssessmentQuestionOption.questionId),
          asc(learningAssessmentQuestionOption.position),
        ),
      database
        .select({
          questionId: learningAssessmentQuestionCorrectOption.questionId,
          optionId: learningAssessmentQuestionCorrectOption.optionId,
        })
        .from(learningAssessmentQuestionCorrectOption)
        .where(
          eq(
            learningAssessmentQuestionCorrectOption.questionSetId,
            DEMO_QUESTION_SET_ID,
          ),
        )
        .orderBy(
          asc(learningAssessmentQuestionCorrectOption.questionId),
          asc(learningAssessmentQuestionCorrectOption.optionId),
        ),
      database
        .select({
          questionId: learningAssessmentQuestionMatchingAnswer.questionId,
          leftOptionId: learningAssessmentQuestionMatchingAnswer.leftOptionId,
          rightOptionId: learningAssessmentQuestionMatchingAnswer.rightOptionId,
        })
        .from(learningAssessmentQuestionMatchingAnswer)
        .where(
          eq(
            learningAssessmentQuestionMatchingAnswer.questionSetId,
            DEMO_QUESTION_SET_ID,
          ),
        )
        .orderBy(
          asc(learningAssessmentQuestionMatchingAnswer.questionId),
          asc(learningAssessmentQuestionMatchingAnswer.leftOptionId),
        ),
      database
        .select({
          questionId: learningAssessmentQuestionSource.questionId,
          sourceId: learningAssessmentQuestionSource.sourceId,
        })
        .from(learningAssessmentQuestionSource)
        .where(
          eq(
            learningAssessmentQuestionSource.questionSetId,
            DEMO_QUESTION_SET_ID,
          ),
        )
        .orderBy(
          asc(learningAssessmentQuestionSource.questionId),
          asc(learningAssessmentQuestionSource.sourceId),
        ),
    ]);

  return {
    questionSetId: questionSet.id,
    versionId: questionSet.versionId,
    status: "published",
    questions: questions.map((question) => ({
      ...question,
      options: options
        .filter((option) => option.questionId === question.questionId)
        .map(({ optionId, label, side }) =>
          side === "left" || side === "right"
            ? { optionId, label, side }
            : { optionId, label },
        ),
      correctOptionIds: correctOptions
        .filter((option) => option.questionId === question.questionId)
        .map((option) => option.optionId),
      correctMatches: matches
        .filter((match) => match.questionId === question.questionId)
        .map(({ leftOptionId, rightOptionId }) => ({
          leftOptionId,
          rightOptionId,
        })),
      sourceIds: sources
        .filter((source) => source.questionId === question.questionId)
        .map((source) => source.sourceId),
    })),
  };
}

export async function prepareDemoContent(
  database: NodePgDatabase<typeof databaseSchema>,
): Promise<
  Readonly<{
    map: "created" | "reused";
    questionSet: "created" | "reused";
  }>
> {
  const catalogRepository = new DrizzleLearningCatalogRepository(database);
  const mapState = classifyExistingDemoObject(
    "learning map version",
    expectedMapSnapshot(),
    await loadExistingMap(database, catalogRepository),
  );
  if (mapState === "missing") {
    await new PublishFeaturedLearningMap(catalogRepository).execute(
      DEMO_MAP_PUBLICATION,
    );
  }

  const assessmentRepository = new DrizzleLearningAssessmentRepository(
    database,
  );
  const assessment = new LearningAssessmentService(
    assessmentRepository,
    catalogRepository,
  );
  const questionSetState = classifyExistingDemoObject(
    "assessment question set",
    expectedQuestionSetSnapshot(),
    await loadExistingQuestionSet(database),
  );
  if (questionSetState === "missing") {
    await assessment.publishQuestionSet(DEMO_QUESTION_SET_PUBLICATION);
  }

  return {
    map: mapState === "missing" ? "created" : "reused",
    questionSet: questionSetState === "missing" ? "created" : "reused",
  };
}
