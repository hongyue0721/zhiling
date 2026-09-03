import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  expect,
  request as playwrightRequest,
  test as base,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
export { expect };

import { PublishFeaturedLearningMap } from "../../src/modules/learning-catalog/application/learning-catalog";
import type { LearningMapPublication } from "../../src/modules/learning-catalog/domain/learning-map";
import { DrizzleLearningCatalogRepository } from "../../src/modules/learning-catalog/infrastructure/drizzle-learning-catalog";
import { LearningAssessmentService } from "../../src/modules/learning-assessment/application/learning-assessment";
import { DrizzleLearningAssessmentRepository } from "../../src/modules/learning-assessment/infrastructure/drizzle-learning-assessment";
import type {
  AssessmentAnswerSubmission,
  AssessmentQuestionPublication,
  LearningAssessmentQuestionSetPublication,
} from "../../src/modules/learning-assessment/domain/assessment";
import {
  learningMapVersion,
  learningRelationship,
} from "../../src/platform/database/catalog-schema";
import { user } from "../../src/platform/database/auth-schema";
import {
  generationEvent,
  generationTask,
} from "../../src/platform/database/generation-schema";
import { createPostgresDatabase } from "../../src/platform/database/postgres";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();
if (!TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required for Playwright E2E tests; refusing to use a default database",
  );
}

export const E2E_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

const { database, pool } = createPostgresDatabase(TEST_DATABASE_URL);
const runId = randomUUID().replaceAll("-", "");

const DOMAIN_TABLES = [
  '"generation_event"',
  '"generation_checkpoint"',
  '"generation_participant"',
  '"generation_cache"',
  '"generation_task"',
  '"learning_assessment_attempt"',
  '"learning_progress_node"',
  '"learning_assessment_question_source"',
  '"learning_assessment_question_matching_answer"',
  '"learning_assessment_question_correct_option"',
  '"learning_assessment_question_option"',
  '"learning_assessment_question"',
  '"learning_assessment_question_set"',
  '"learning_relationship"',
  '"featured_learning_map"',
  '"learning_viewpoint_source"',
  '"learning_viewpoint"',
  '"learning_map_node_source"',
  '"knowledge_source"',
  '"learning_map_prerequisite"',
  '"learning_map_node"',
  '"learning_map_version"',
  '"learning_map"',
] as const;

const IDENTITY_TABLES = [
  '"rateLimit"',
  '"verification"',
  '"session"',
  '"account"',
  '"user"',
] as const;

async function truncateTables(
  tables: readonly string[],
  includeIdentity: boolean,
): Promise<void> {
  const allTables = includeIdentity
    ? [...tables, ...IDENTITY_TABLES]
    : [...tables, '"rateLimit"', '"verification"'];
  await pool.query(
    `TRUNCATE TABLE ${allTables.join(", ")} RESTART IDENTITY CASCADE`,
  );
}

function buildMapPublication(): LearningMapPublication {
  const sources = Array.from({ length: 5 }, (_, index) => {
    const number = index + 1;
    return {
      sourceId: `e2e-source-${number}`,
      title: `E2E 来源 ${number}`,
      excerpt: `E2E 来源摘要 ${number}`,
      url: `https://www.zhihu.com/question/e2e-${runId}-${number}`,
      authorName: `E2E 作者 ${number}`,
    };
  });
  const viewpointKinds = [
    "consensus",
    "disagreement",
    "practical_experience",
    "supplementary",
    "consensus",
  ] as const;
  const nodes = sources.map((source, index) => {
    const number = index + 1;
    const kind = viewpointKinds[index]!;
    return {
      nodeId: `e2e-node-${number}`,
      title: `E2E 节点 ${number}`,
      learningObjective: `E2E 学习目标 ${number}`,
      sourceIds: [source.sourceId],
      viewpoints: [
        {
          viewpointId: `e2e-viewpoint-${number}`,
          kind,
          statement: `E2E 观点陈述 ${number}`,
          conditions: kind === "disagreement" ? "E2E 适用条件" : null,
          sourceIds: [source.sourceId],
        },
      ],
    };
  });

  return {
    mapId: "e2e-featured-map",
    versionId: "e2e-featured-map-v1",
    title: "E2E 精选五节点地图",
    summary: "E2E 用于验证用户学习闭环的固定版本。",
    featuredPosition: 1,
    sources,
    nodes,
    prerequisites: nodes.slice(1).map((node, index) => ({
      nodeId: node.nodeId,
      prerequisiteNodeId: nodes[index]!.nodeId,
    })),
  };
}

function buildQuestionSetPublication(): LearningAssessmentQuestionSetPublication {
  const sourceForNode = (nodeNumber: number) => `e2e-source-${nodeNumber}`;
  const questions: AssessmentQuestionPublication[] = [];

  for (let nodeNumber = 1; nodeNumber <= 5; nodeNumber += 1) {
    const nodeId = `e2e-node-${nodeNumber}`;
    const sourceId = sourceForNode(nodeNumber);
    const firstQuestionId = `e2e-question-${nodeNumber}-first`;
    const secondQuestionId = `e2e-question-${nodeNumber}-second`;

    if (nodeNumber === 1) {
      questions.push(
        {
          questionId: firstQuestionId,
          nodeId,
          type: "single_choice",
          prompt: "E2E 单选题：请选择一项基础路径。",
          explanation: "E2E 单选题服务端评分解释。",
          options: [
            { optionId: "e2e-single-a", label: "基础路径 A" },
            { optionId: "e2e-single-b", label: "基础路径 B" },
          ],
          correctOptionIds: ["e2e-single-a"],
          sourceIds: [sourceId],
        },
        {
          questionId: secondQuestionId,
          nodeId,
          type: "multiple_choice",
          prompt: "E2E 多选题：请选择所有符合条件的路径。",
          explanation: "E2E 多选题服务端评分解释。",
          options: [
            { optionId: "e2e-multiple-a", label: "条件路径 A" },
            { optionId: "e2e-multiple-b", label: "条件路径 B" },
            { optionId: "e2e-multiple-c", label: "条件路径 C" },
          ],
          correctOptionIds: ["e2e-multiple-a", "e2e-multiple-b"],
          sourceIds: [sourceId],
        },
      );
      continue;
    }

    if (nodeNumber === 2) {
      questions.push(
        {
          questionId: firstQuestionId,
          nodeId,
          type: "matching",
          prompt: "E2E 匹配题：为每个概念选择对应关系。",
          explanation: "E2E 匹配题服务端评分解释。",
          options: [
            { optionId: "concept-one", label: "概念一" },
            { optionId: "concept-two", label: "概念二" },
            { optionId: "relation-one", label: "关系一" },
            { optionId: "relation-two", label: "关系二" },
          ],
          correctMatches: [
            { leftOptionId: "concept-one", rightOptionId: "relation-one" },
            { leftOptionId: "concept-two", rightOptionId: "relation-two" },
          ],
          sourceIds: [sourceId],
        },
        {
          questionId: secondQuestionId,
          nodeId,
          type: "opinion_analysis",
          prompt: "E2E 观点辨析：请选择最符合材料的判断。",
          explanation: "E2E 观点辨析服务端评分解释。",
          options: [
            { optionId: "e2e-opinion-a", label: "材料判断 A" },
            { optionId: "e2e-opinion-b", label: "材料判断 B" },
          ],
          correctOptionIds: ["e2e-opinion-b"],
          sourceIds: [sourceId],
        },
      );
      continue;
    }

    questions.push(
      {
        questionId: firstQuestionId,
        nodeId,
        type: "single_choice",
        prompt: `E2E 节点 ${nodeNumber} 单选题。`,
        explanation: `E2E 节点 ${nodeNumber} 单选解释。`,
        options: [
          { optionId: `e2e-node-${nodeNumber}-a`, label: "节点选项 A" },
          { optionId: `e2e-node-${nodeNumber}-b`, label: "节点选项 B" },
        ],
        correctOptionIds: [`e2e-node-${nodeNumber}-a`],
        sourceIds: [sourceId],
      },
      {
        questionId: secondQuestionId,
        nodeId,
        type: "opinion_analysis",
        prompt: `E2E 节点 ${nodeNumber} 观点辨析题。`,
        explanation: `E2E 节点 ${nodeNumber} 观点解释。`,
        options: [
          { optionId: `e2e-node-${nodeNumber}-op-a`, label: "观点选项 A" },
          { optionId: `e2e-node-${nodeNumber}-op-b`, label: "观点选项 B" },
        ],
        correctOptionIds: [`e2e-node-${nodeNumber}-op-a`],
        sourceIds: [sourceId],
      },
    );
  }

  return {
    questionSetId: "e2e-question-set-v1",
    versionId: "e2e-featured-map-v1",
    questions,
  };
}

async function publishLearningContent(): Promise<void> {
  const catalogRepository = new DrizzleLearningCatalogRepository(database);
  await new PublishFeaturedLearningMap(catalogRepository).execute(
    buildMapPublication(),
  );

  const assessmentRepository = new DrizzleLearningAssessmentRepository(
    database,
  );
  const assessment = new LearningAssessmentService(
    assessmentRepository,
    catalogRepository,
  );
  await assessment.publishQuestionSet(buildQuestionSetPublication());
}

type TestAccount = Readonly<{
  email: string;
  password: string;
  userId: string;
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>;
}>;

async function createVerifiedAccount(
  role: "primary" | "secondary",
): Promise<TestAccount> {
  const email = `e2e-${runId}-${role}@example.invalid`;
  const password = "E2E-only-password-1234";
  const api = await playwrightRequest.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: {
      Accept: "application/json",
      Origin: E2E_BASE_URL,
    },
  });

  try {
    const signUp = await api.post("/api/auth/sign-up/email", {
      data: {
        name: `E2E ${role}`,
        email,
        password,
        callbackURL: "/auth?verified=1",
      },
    });
    if (!signUp.ok()) {
      throw new Error(
        `Better Auth HTTP sign-up failed for ${role}: ${signUp.status()} ${await signUp.text()}`,
      );
    }

    const rows = await database
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    const createdUser = rows[0];
    if (!createdUser) {
      throw new Error(`Better Auth did not persist the ${role} test user`);
    }

    // The test DB is the only place where verification is marked complete. The
    // browser still receives a normal Better Auth session from sign-in below.
    await database
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, createdUser.id));

    const signIn = await api.post("/api/auth/sign-in/email", {
      data: { email, password, callbackURL: "/" },
    });
    if (!signIn.ok()) {
      throw new Error(
        `Better Auth HTTP sign-in failed for ${role}: ${signIn.status()} ${await signIn.text()}`,
      );
    }

    return {
      email,
      password,
      userId: createdUser.id,
      storageState: await api.storageState(),
    };
  } finally {
    await api.dispose();
  }
}

async function failGenerationTask(taskId: string): Promise<void> {
  await database.transaction(async (transaction) => {
    const rows = await transaction
      .select({
        status: generationTask.status,
        stage: generationTask.stage,
        sequence: generationTask.sequence,
      })
      .from(generationTask)
      .where(eq(generationTask.id, taskId))
      .limit(1);
    const task = rows[0];
    if (!task) {
      throw new Error(`Generation task ${taskId} was not found in the test DB`);
    }

    const failedAt = new Date();
    const sequence = Number(task.sequence) + 1;
    await transaction
      .update(generationTask)
      .set({
        status: "failed",
        failureCode: "source_insufficient",
        failureRetryable: false,
        sequence,
        updatedAt: failedAt,
        completedAt: failedAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: failedAt,
      })
      .where(
        and(
          eq(generationTask.id, taskId),
          eq(generationTask.status, task.status),
        ),
      );
    await transaction.insert(generationEvent).values({
      taskId,
      sequence,
      type: "failed",
      data: {
        status: "failed",
        stage: task.stage,
        code: "source_insufficient",
        failure: {
          code: "source_insufficient",
          retryable: false,
        },
        providerPayload: { raw: "must-not-cross-boundary" },
        userId: "must-not-cross-boundary",
      },
      occurredAt: failedAt,
    });
  });
}

async function addProgressThenFail(taskId: string): Promise<void> {
  await database.transaction(async (transaction) => {
    const rows = await transaction
      .select({
        status: generationTask.status,
        stage: generationTask.stage,
        sequence: generationTask.sequence,
      })
      .from(generationTask)
      .where(eq(generationTask.id, taskId))
      .limit(1);
    const task = rows[0];
    if (!task) {
      throw new Error(`Generation task ${taskId} was not found in the test DB`);
    }

    const progressedAt = new Date();
    const progressSequence = Number(task.sequence) + 1;
    await transaction
      .update(generationTask)
      .set({
        status: "normalizing",
        stage: "normalizing",
        sequence: progressSequence,
        updatedAt: progressedAt,
      })
      .where(
        and(
          eq(generationTask.id, taskId),
          eq(generationTask.status, task.status),
        ),
      );
    await transaction.insert(generationEvent).values({
      taskId,
      sequence: progressSequence,
      type: "progress",
      data: {
        status: "normalizing",
        stage: "normalizing",
        providerPayload: { raw: "must-not-cross-boundary" },
      },
      occurredAt: progressedAt,
    });

    const failedAt = new Date(progressedAt.getTime() + 1);
    const failedSequence = progressSequence + 1;
    await transaction
      .update(generationTask)
      .set({
        status: "failed",
        failureCode: "source_insufficient",
        failureRetryable: false,
        sequence: failedSequence,
        updatedAt: failedAt,
        completedAt: failedAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: failedAt,
      })
      .where(
        and(
          eq(generationTask.id, taskId),
          eq(generationTask.status, "normalizing"),
        ),
      );
    await transaction.insert(generationEvent).values({
      taskId,
      sequence: failedSequence,
      type: "failed",
      data: {
        status: "failed",
        stage: "normalizing",
        code: "source_insufficient",
        failure: {
          code: "source_insufficient",
          retryable: false,
        },
        providerPayload: { raw: "must-not-cross-boundary" },
        attemptId: "must-not-cross-boundary",
      },
      occurredAt: failedAt,
    });
  });
}

async function succeedGenerationTask(
  taskId: string,
  learningRelationshipId: string,
): Promise<void> {
  await database.transaction(async (transaction) => {
    const taskRows = await transaction
      .select({
        status: generationTask.status,
        sequence: generationTask.sequence,
      })
      .from(generationTask)
      .where(eq(generationTask.id, taskId))
      .limit(1);
    const task = taskRows[0];
    if (!task) {
      throw new Error(`Generation task ${taskId} was not found in the test DB`);
    }

    const relationshipRows = await transaction
      .select({
        versionId: learningRelationship.versionId,
        questionSetId: learningRelationship.questionSetId,
      })
      .from(learningRelationship)
      .where(eq(learningRelationship.id, learningRelationshipId))
      .limit(1);
    const relationship = relationshipRows[0];
    if (!relationship || !relationship.questionSetId) {
      throw new Error(
        `Learning relationship ${learningRelationshipId} was not found or has no question set`,
      );
    }

    const versionRows = await transaction
      .select({ mapId: learningMapVersion.mapId })
      .from(learningMapVersion)
      .where(eq(learningMapVersion.id, relationship.versionId))
      .limit(1);
    const version = versionRows[0];
    if (!version) {
      throw new Error(
        `Learning map version ${relationship.versionId} was not found`,
      );
    }

    const succeededAt = new Date();
    const sequence = Number(task.sequence) + 1;
    await transaction
      .update(generationTask)
      .set({
        status: "succeeded",
        stage: "publishing",
        sequence,
        mapId: version.mapId,
        versionId: relationship.versionId,
        questionSetId: relationship.questionSetId,
        failureCode: null,
        failureRetryable: null,
        updatedAt: succeededAt,
        completedAt: succeededAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: succeededAt,
      })
      .where(
        and(
          eq(generationTask.id, taskId),
          eq(generationTask.status, task.status),
        ),
      );
    await transaction.insert(generationEvent).values({
      taskId,
      sequence,
      type: "succeeded",
      data: {
        status: "succeeded",
        mapId: version.mapId,
        versionId: relationship.versionId,
        questionSetId: relationship.questionSetId,
      },
      occurredAt: succeededAt,
    });
  });
}

type E2EScenario = Readonly<{
  mapId: string;
  versionId: string;
  questionSetId: string;
  primary: TestAccount;
  secondary: TestAccount;
  primaryApi: APIRequestContext;
  secondaryApi: APIRequestContext;
  primaryPage: Page;
  secondaryPage: Page;
  correctAnswers: Readonly<
    Record<string, readonly AssessmentAnswerSubmission[]>
  >;
  failGenerationTask(taskId: string): Promise<void>;
  addProgressThenFail(taskId: string): Promise<void>;
  succeedGenerationTask(
    taskId: string,
    learningRelationshipId: string,
  ): Promise<void>;
  close(): Promise<void>;
}>;

type E2EWorkerState = Readonly<{
  primary: TestAccount;
  secondary: TestAccount;
}>;

type WorkerFixtures = Readonly<{
  e2eDatabase: E2EWorkerState;
}>;

type TestFixtures = Readonly<{
  scenario: E2EScenario;
}>;

export const test = base.extend<TestFixtures, WorkerFixtures>({
  e2eDatabase: [
    async ({}, use) => {
      await migrate(database, { migrationsFolder: "drizzle" });
      await truncateTables(DOMAIN_TABLES, true);
      const primary = await createVerifiedAccount("primary");
      const secondary = await createVerifiedAccount("secondary");
      await use({ primary, secondary });
      await pool.end();
    },
    { scope: "worker", auto: true },
  ],
  scenario: async ({ browser, e2eDatabase }, use) => {
    await truncateTables(DOMAIN_TABLES, false);
    await publishLearningContent();

    const { primary, secondary } = e2eDatabase;
    const primaryApi = await playwrightRequest.newContext({
      baseURL: E2E_BASE_URL,
      storageState: primary.storageState,
      extraHTTPHeaders: { Accept: "application/json", Origin: E2E_BASE_URL },
    });
    const secondaryApi = await playwrightRequest.newContext({
      baseURL: E2E_BASE_URL,
      storageState: secondary.storageState,
      extraHTTPHeaders: { Accept: "application/json", Origin: E2E_BASE_URL },
    });
    const primaryContext = await browser.newContext({
      baseURL: E2E_BASE_URL,
      storageState: primary.storageState,
    });
    const secondaryContext = await browser.newContext({
      baseURL: E2E_BASE_URL,
      storageState: secondary.storageState,
    });
    const primaryPage = await primaryContext.newPage();
    const secondaryPage = await secondaryContext.newPage();

    const scenario: E2EScenario = {
      mapId: "e2e-featured-map",
      versionId: "e2e-featured-map-v1",
      questionSetId: "e2e-question-set-v1",
      primary,
      secondary,
      primaryApi,
      secondaryApi,
      primaryPage,
      secondaryPage,
      correctAnswers: {
        "e2e-node-1": [
          {
            questionId: "e2e-question-1-first",
            selectedOptionIds: ["e2e-single-a"],
          },
          {
            questionId: "e2e-question-1-second",
            selectedOptionIds: ["e2e-multiple-a", "e2e-multiple-b"],
          },
        ],
        "e2e-node-2": [
          {
            questionId: "e2e-question-2-first",
            matches: [
              { leftOptionId: "concept-one", rightOptionId: "relation-one" },
              { leftOptionId: "concept-two", rightOptionId: "relation-two" },
            ],
          },
          {
            questionId: "e2e-question-2-second",
            selectedOptionIds: ["e2e-opinion-b"],
          },
        ],
      },
      failGenerationTask,
      addProgressThenFail,
      succeedGenerationTask,
      async close() {
        await primaryPage.close();
        await secondaryPage.close();
        await primaryContext.close();
        await secondaryContext.close();
        await primaryApi.dispose();
        await secondaryApi.dispose();
      },
    };

    try {
      await use(scenario);
    } finally {
      await scenario.close();
    }
  },
});
