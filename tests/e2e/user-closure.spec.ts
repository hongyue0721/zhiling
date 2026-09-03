import { randomUUID } from "node:crypto";

import { expect, test } from "./fixtures";
import type { APIResponse } from "@playwright/test";

type JsonRecord = Record<string, unknown>;

type GenerationRequestPayload = Readonly<{
  reuse: "created" | "active_task" | "cache";
  snapshot: Readonly<{
    taskId: string;
    status: string;
    stage: string;
    sequence: number;
    result: unknown;
    failure: unknown;
  }>;
}>;

type SseRecord = Readonly<{
  id: number;
  event: string;
  data: JsonRecord;
}>;

function parseSseRecords(body: string): SseRecord[] {
  return body
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const id = block.match(/^id:\s*(\d+)$/m)?.[1];
      const event = block.match(/^event:\s*([^\r\n]+)$/m)?.[1];
      const data = block.match(/^data:\s*(.+)$/m)?.[1];
      if (!id || !event || !data) {
        return null;
      }
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed !== "object" || parsed === null) {
        return null;
      }
      return {
        id: Number(id),
        event,
        data: parsed as JsonRecord,
      } satisfies SseRecord;
    })
    .filter((record): record is SseRecord => record !== null);
}

function expectNoPrivateLeak(body: string, forbiddenValues: readonly string[]) {
  for (const value of forbiddenValues) {
    expect(body).not.toContain(value);
  }
  expect(body).not.toMatch(
    /userId|session|attemptId|providerPayload|correctOptionIds|correctMatches/i,
  );
}

async function expectSecureNotFound(
  response: APIResponse,
  forbiddenValues: readonly string[],
): Promise<void> {
  expect(response.status()).toBe(404);
  const body = await response.text();
  const payload = JSON.parse(body) as JsonRecord;
  const error = payload.error as JsonRecord;
  expect(error.code).toBe("resource_not_found");
  expectNoPrivateLeak(body, forbiddenValues);
}

test.describe("用户学习闭环", () => {
  test("匿名业务页面统一重定向到认证入口", async ({ page }) => {
    for (const path of [
      "/",
      "/generate",
      "/learn/not-a-real-relationship",
      "/learn/not-a-real-relationship/report",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth\?next=/);
      await expect(
        page.getByRole("heading", { name: "继续你的学习路径" }),
      ).toBeVisible();
    }
  });

  test("登录后区分精选与现场生成并完成地图答题报告闭环", async ({
    scenario,
  }) => {
    const page = scenario.primaryPage;
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "从可靠路径开始" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "你现在想弄懂什么？" }),
    ).toBeVisible();
    const featuredCard = page
      .getByRole("article")
      .filter({ hasText: "E2E 精选五节点地图" });
    await expect(featuredCard).toBeVisible();
    await expect(
      featuredCard.getByRole("button", { name: "加入学习" }),
    ).toBeVisible();

    await featuredCard.getByRole("button", { name: "加入学习" }).click();
    await expect(page).toHaveURL(/\/learn\/[^/]+$/);
    const relationshipId = new URL(page.url()).pathname.split("/").pop();
    if (!relationshipId) {
      throw new Error("The join flow did not return a relationship ID");
    }
    await expect(
      page.getByRole("heading", { name: "E2E 精选五节点地图" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /E2E 节点/ })).toHaveCount(5);

    const mapResponse = await scenario.primaryApi.get(
      `/api/learning-relationships/${relationshipId}/map`,
    );
    expect(mapResponse.status()).toBe(200);
    const map = (await mapResponse.json()) as {
      nodes: readonly JsonRecord[];
      prerequisites: readonly JsonRecord[];
      sources: readonly JsonRecord[];
      viewpoints: readonly JsonRecord[];
    };
    expect(map.nodes).toHaveLength(5);
    expect(map.prerequisites).toHaveLength(4);
    expect(map.sources).toHaveLength(5);
    expect(map.viewpoints).toHaveLength(5);
    expect(map.sources).toContainEqual(
      expect.objectContaining({
        sourceId: "e2e-source-1",
        title: "E2E 来源 1",
      }),
    );
    expect(map.viewpoints).toContainEqual(
      expect.objectContaining({
        viewpointId: "e2e-viewpoint-1",
        statement: "E2E 观点陈述 1",
      }),
    );

    const firstJoinResponse = await scenario.primaryApi.post(
      `/api/featured-learning-maps/${scenario.mapId}/learning-relationship`,
    );
    const secondJoinResponse = await scenario.primaryApi.post(
      `/api/featured-learning-maps/${scenario.mapId}/learning-relationship`,
    );
    expect(firstJoinResponse.status()).toBe(200);
    expect(secondJoinResponse.status()).toBe(200);
    const firstJoin = (await firstJoinResponse.json()) as JsonRecord;
    const secondJoin = (await secondJoinResponse.json()) as JsonRecord;
    expect(firstJoin).toEqual(secondJoin);
    expect(firstJoin.learningRelationshipId).toBe(relationshipId);

    const relationshipsResponse = await scenario.primaryApi.get(
      "/api/learning-relationships",
    );
    expect(relationshipsResponse.status()).toBe(200);
    const relationships = (await relationshipsResponse.json()) as {
      items: readonly JsonRecord[];
    };
    expect(relationships.items).toHaveLength(1);
    expect(relationships.items[0]?.learningRelationshipId).toBe(relationshipId);
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /E2E 精选五节点地图/ }),
    ).toBeVisible();
    await page.goto(`/learn/${relationshipId}`);
    await expect(
      page.getByRole("heading", { name: "E2E 精选五节点地图" }),
    ).toBeVisible();

    const canvas = page.getByRole("region", { name: "学习地图画布" });
    await expect(canvas.getByText("100%", { exact: true })).toBeVisible();
    await canvas.getByRole("button", { name: "放大地图" }).click();
    await expect(canvas.getByText("110%", { exact: true })).toBeVisible();
    await canvas.getByRole("button", { name: "缩小地图" }).click();
    await expect(canvas.getByText("100%", { exact: true })).toBeVisible();

    const svg = page.getByRole("application", {
      name: "可缩放、可平移的学习路径图",
    });
    const rootGroup = svg.locator(":scope > g");
    const beforePan = await rootGroup.getAttribute("transform");
    const box = await svg.boundingBox();
    if (!box) {
      throw new Error("The learning map SVG has no bounding box");
    }
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 40);
    await page.mouse.up();
    await expect
      .poll(() => rootGroup.getAttribute("transform"))
      .not.toBe(beforePan);
    await canvas.getByRole("button", { name: "重置" }).click();
    await expect(rootGroup).toHaveAttribute(
      "transform",
      "translate(0 0) scale(1)",
    );

    await expect(
      page.getByRole("heading", { name: "E2E 节点 1" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "来源" }).getByText("E2E 来源 1", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("E2E 观点陈述 1", { exact: true }),
    ).toBeVisible();

    const assessmentResponse = await scenario.primaryApi.get(
      `/api/learning-relationships/${relationshipId}/nodes/e2e-node-1/assessment`,
    );
    expect(assessmentResponse.status()).toBe(200);
    const assessmentPayload = (await assessmentResponse.json()) as JsonRecord;
    const assessmentBody = JSON.stringify(assessmentPayload);
    expectNoPrivateLeak(assessmentBody, ["E2E 单选题服务端评分解释"]);
    expect(assessmentBody).not.toContain("explanation");
    expect(assessmentBody).not.toContain("correctOptionIds");
    expect(assessmentBody).not.toContain("correctMatches");
    const matchingAssessmentResponse = await scenario.primaryApi.get(
      `/api/learning-relationships/${relationshipId}/nodes/e2e-node-2/assessment`,
    );
    expect(matchingAssessmentResponse.status()).toBe(200);
    const matchingAssessment = (await matchingAssessmentResponse.json()) as {
      questions: readonly JsonRecord[];
    };
    const matchingQuestion = matchingAssessment.questions.find(
      (question) => question.type === "matching",
    );
    expect(matchingQuestion?.options).toEqual([
      { optionId: "concept-one", label: "概念一", side: "left" },
      { optionId: "concept-two", label: "概念二", side: "left" },
      { optionId: "relation-one", label: "关系一", side: "right" },
      { optionId: "relation-two", label: "关系二", side: "right" },
    ]);
    expect(matchingQuestion).not.toHaveProperty("correctMatches");
    expectNoPrivateLeak(JSON.stringify(matchingAssessment), [
      "E2E 匹配题服务端评分解释",
    ]);

    await page.getByRole("button", { name: "E2E 节点 1，未完成" }).click();
    await page.getByRole("button", { name: "开始节点验证" }).click();
    const assessmentPanel = page.locator("section.assessment-panel");
    await expect(
      assessmentPanel.getByText("单选题", { exact: true }),
    ).toBeVisible();
    await expect(
      assessmentPanel.getByText("多选题", { exact: true }),
    ).toBeVisible();
    await assessmentPanel.getByRole("button", { name: "← 返回节点" }).click();

    await page.getByRole("button", { name: "E2E 节点 2，未完成" }).click();
    await page.getByRole("button", { name: "开始节点验证" }).click();
    await expect(
      assessmentPanel.getByText("匹配题", { exact: true }),
    ).toBeVisible();
    await expect(
      assessmentPanel.getByText("观点辨析", { exact: true }),
    ).toBeVisible();
    await expect(assessmentPanel.locator(".matching-row")).toHaveCount(2);
    await expect(
      assessmentPanel.getByText("概念一", { exact: true }),
    ).toBeVisible();
    await expect(
      assessmentPanel.getByText("关系一", { exact: true }),
    ).toHaveCount(2);
    await assessmentPanel
      .locator(".matching-row")
      .nth(0)
      .locator("select")
      .selectOption("relation-one");
    await assessmentPanel
      .locator(".matching-row")
      .nth(1)
      .locator("select")
      .selectOption("relation-two");
    await assessmentPanel
      .locator('input[name="e2e-question-2-second"]')
      .nth(1)
      .check();
    const matchingSubmissionResponsePromise = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/api/learning-relationships/${relationshipId}/nodes/e2e-node-2/assessment`,
          ) && response.request().method() === "POST",
    );
    await assessmentPanel.getByRole("button", { name: "提交答案" }).click();
    const matchingSubmissionResponse = await matchingSubmissionResponsePromise;
    expect(matchingSubmissionResponse.status()).toBe(200);
    expect((await matchingSubmissionResponse.json()) as JsonRecord).toEqual(
      expect.objectContaining({
        nodeId: "e2e-node-2",
        nodeScore: 10000,
      }),
    );
    await expect(assessmentPanel.getByRole("status")).toContainText(
      "服务端已记录该节点完成",
    );
    await assessmentPanel.getByRole("button", { name: "返回地图" }).click();

    await page.getByRole("button", { name: "E2E 节点 1，未完成" }).click();
    await page.getByRole("button", { name: "开始节点验证" }).click();
    await assessmentPanel
      .locator('input[name="e2e-question-1-first"]')
      .first()
      .check();
    await assessmentPanel
      .locator('input[name="e2e-question-1-second"]')
      .nth(0)
      .check();
    await assessmentPanel
      .locator('input[name="e2e-question-1-second"]')
      .nth(1)
      .check();

    const submissionResponsePromise = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/api/learning-relationships/${relationshipId}/nodes/e2e-node-1/assessment`,
          ) && response.request().method() === "POST",
    );
    await assessmentPanel.getByRole("button", { name: "提交答案" }).click();
    const submissionResponse = await submissionResponsePromise;
    expect(submissionResponse.status()).toBe(200);
    const submission = (await submissionResponse.json()) as JsonRecord;
    expect(submission.attemptId).toEqual(expect.any(String));
    await expect(assessmentPanel.getByRole("status")).toContainText(
      "服务端已记录该节点完成",
    );

    const progressResponse = await scenario.primaryApi.get(
      `/api/learning-relationships/${relationshipId}/progress`,
    );
    expect(progressResponse.status()).toBe(200);
    const progress = (await progressResponse.json()) as {
      nodes: readonly JsonRecord[];
    };
    expect(progress.nodes).toContainEqual(
      expect.objectContaining({
        nodeId: "e2e-node-1",
        bestScore: 10000,
        completed: true,
      }),
    );
    expect(progress.nodes).toContainEqual(
      expect.objectContaining({
        nodeId: "e2e-node-2",
        bestScore: 10000,
        completed: true,
      }),
    );

    await assessmentPanel.getByRole("button", { name: "返回地图" }).click();
    await page.getByRole("link", { name: "查看私人报告" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/learn/${relationshipId}/report$`),
    );
    await expect(
      page.getByRole("heading", { name: "按服务端记录的节点完成情况" }),
    ).toBeVisible();
    await expect(page.getByText("40%", { exact: true })).toBeVisible();
    const reportText = await page.locator("body").innerText();
    expectNoPrivateLeak(reportText, [
      "attemptId",
      "E2E 匹配题服务端评分解释",
      "userId",
      "providerPayload",
      "E2E 单选题服务端评分解释",
    ]);

    const reportResponse = await scenario.primaryApi.get(
      `/api/learning-relationships/${relationshipId}/report`,
    );
    expect(reportResponse.status()).toBe(200);
    const reportBody = await reportResponse.text();
    expectNoPrivateLeak(reportBody, ["attemptId", "userId", "session"]);
  });
});

test.describe("用户资源隔离与生成安全边界", () => {
  test("第二账户无法读取第一账户的关系、答题、报告和生成任务", async ({
    scenario,
  }) => {
    const joinResponse = await scenario.primaryApi.post(
      `/api/featured-learning-maps/${scenario.mapId}/learning-relationship`,
    );
    expect(joinResponse.status()).toBe(200);
    const relationship = (await joinResponse.json()) as {
      learningRelationshipId: string;
    };
    const relationshipId = relationship.learningRelationshipId;

    const submissionResponse = await scenario.primaryApi.post(
      `/api/learning-relationships/${relationshipId}/nodes/e2e-node-1/assessment`,
      {
        headers: { "Idempotency-Key": `e2e-${randomUUID()}` },
        data: { answers: scenario.correctAnswers["e2e-node-1"] },
      },
    );
    expect(submissionResponse.status()).toBe(200);
    const submission = (await submissionResponse.json()) as JsonRecord;
    expect(submission.attemptId).toEqual(expect.any(String));

    const generationResponse = await scenario.primaryApi.post(
      "/api/map-generations",
      { data: { topic: `E2E private generation ${randomUUID()}` } },
    );
    expect(generationResponse.status()).toBe(202);
    const generation =
      (await generationResponse.json()) as GenerationRequestPayload;
    const taskId = generation.snapshot.taskId;

    const forbiddenValues = [
      relationshipId,
      taskId,
      scenario.primary.email,
      scenario.primary.userId,
    ];
    const privatePaths = [
      `/api/learning-relationships/${relationshipId}/map`,
      `/api/learning-relationships/${relationshipId}/progress`,
      `/api/learning-relationships/${relationshipId}/nodes/e2e-node-1/assessment`,
      `/api/learning-relationships/${relationshipId}/report`,
      `/api/map-generations/${taskId}`,
    ];
    for (const path of privatePaths) {
      await expectSecureNotFound(
        await scenario.secondaryApi.get(path),
        forbiddenValues,
      );
    }
    await expectSecureNotFound(
      await scenario.secondaryApi.get(`/api/map-generations/${taskId}/events`, {
        headers: { Accept: "text/event-stream", "Last-Event-ID": "0" },
      }),
      forbiddenValues,
    );

    await scenario.secondaryPage.goto(`/learn/${relationshipId}`);
    await expect(
      scenario.secondaryPage
        .getByRole("alert")
        .filter({ hasText: "这张学习地图暂时不可用" }),
    ).toBeVisible();
    const mapPageText = await scenario.secondaryPage
      .locator("body")
      .innerText();
    expectNoPrivateLeak(mapPageText, [
      relationshipId,
      scenario.primary.email,
      "E2E 精选五节点地图",
    ]);

    await scenario.secondaryPage.goto(`/learn/${relationshipId}/report`);
    await expect(
      scenario.secondaryPage
        .getByRole("alert")
        .filter({ hasText: "报告暂时不可用" }),
    ).toBeVisible();
    const reportPageText = await scenario.secondaryPage
      .locator("body")
      .innerText();
    expectNoPrivateLeak(reportPageText, [
      relationshipId,
      scenario.primary.email,
      "E2E 精选五节点地图",
    ]);
  });

  test("生成任务只返回安全快照并支持 Last-Event-ID 恢复", async ({
    scenario,
  }) => {
    const response = await scenario.primaryApi.post("/api/map-generations", {
      data: { topic: `E2E resumable generation ${randomUUID()}` },
    });
    expect(response.status()).toBe(202);
    const payload = (await response.json()) as GenerationRequestPayload;
    expect(payload.reuse).toBe("created");
    expect(payload.snapshot).toMatchObject({
      status: "queued",
      stage: "queued",
      sequence: 1,
      result: null,
      failure: null,
    });
    const taskId = payload.snapshot.taskId;
    expect(JSON.stringify(payload)).not.toMatch(
      /topic|userId|session|providerPayload|attemptId/i,
    );

    const queuedSnapshotResponse = await scenario.primaryApi.get(
      `/api/map-generations/${taskId}`,
    );
    expect(queuedSnapshotResponse.status()).toBe(200);
    const queuedSnapshotBody = await queuedSnapshotResponse.text();
    expectNoPrivateLeak(queuedSnapshotBody, ["E2E resumable generation"]);

    await scenario.addProgressThenFail(taskId);
    const failedSnapshotResponse = await scenario.primaryApi.get(
      `/api/map-generations/${taskId}`,
    );
    expect(failedSnapshotResponse.status()).toBe(200);
    expect((await failedSnapshotResponse.json()) as JsonRecord).toMatchObject({
      taskId,
      status: "failed",
      failure: {
        code: "source_insufficient",
        retryable: false,
      },
    });

    const highCursorStartedAt = Date.now();
    const highCursorResponse = await scenario.primaryApi.get(
      `/api/map-generations/${taskId}/events`,
      {
        headers: {
          Accept: "text/event-stream",
          "Last-Event-ID": "999999999",
        },
      },
    );
    expect(Date.now() - highCursorStartedAt).toBeLessThan(2_000);
    expect(highCursorResponse.status()).toBe(400);
    expect((await highCursorResponse.json()) as JsonRecord).toMatchObject({
      error: {
        code: "invalid_request",
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "out_of_range" }),
        ]),
      },
    });

    const eventsResponse = await scenario.primaryApi.get(
      `/api/map-generations/${taskId}/events`,
      {
        headers: {
          Accept: "text/event-stream",
          "Last-Event-ID": "1",
        },
      },
    );
    expect(eventsResponse.status()).toBe(200);
    expect(eventsResponse.headers()["content-type"]).toContain(
      "text/event-stream",
    );
    const eventsBody = await eventsResponse.text();
    const events = parseSseRecords(eventsBody);
    expect(events.map(({ id }) => id)).toEqual([2, 3]);
    expect(events.map(({ event }) => event)).toEqual(["progress", "failed"]);
    for (const event of events) {
      expect(event.data).toMatchObject({
        protocolVersion: "1",
        taskId,
        sequence: event.id,
      });
    }
    expectNoPrivateLeak(eventsBody, ["providerPayload", "attemptId"]);
    expect(events[1]?.data).toMatchObject({
      type: "failed",
      data: expect.objectContaining({
        status: "failed",
        code: "source_insufficient",
        failure: {
          code: "source_insufficient",
          retryable: false,
        },
      }),
    });
  });

  test("现场生成 succeeded 事件经本人快照投影到学习地图", async ({
    scenario,
  }) => {
    const page = scenario.primaryPage;
    const joinResponse = await scenario.primaryApi.post(
      `/api/featured-learning-maps/${scenario.mapId}/learning-relationship`,
    );
    expect(joinResponse.status()).toBe(200);
    const relationship = (await joinResponse.json()) as {
      learningRelationshipId: string;
    };
    expect(relationship.learningRelationshipId).toEqual(expect.any(String));

    await page.goto("/generate");
    const topicInput = page.getByRole("textbox", { name: "学习主题" });
    const topic = `E2E succeeded projection ${randomUUID()}`;
    await expect(topicInput).toBeEditable();
    await topicInput.fill(topic);
    await expect(topicInput).toHaveValue(topic);

    const postResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/map-generations") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "开始现场生成" }).click();
    const postResponse = await postResponsePromise;
    expect(postResponse.status()).toBe(202);
    const payload = (await postResponse.json()) as GenerationRequestPayload;
    expect(payload.snapshot).toMatchObject({
      status: "queued",
      stage: "queued",
      sequence: 1,
    });
    const taskId = payload.snapshot.taskId;

    await scenario.succeedGenerationTask(
      taskId,
      relationship.learningRelationshipId,
    );

    const eventsResponse = await scenario.primaryApi.get(
      `/api/map-generations/${taskId}/events`,
      {
        headers: {
          Accept: "text/event-stream",
          "Last-Event-ID": "1",
        },
      },
    );
    expect(eventsResponse.status()).toBe(200);
    const eventsBody = await eventsResponse.text();
    const events = parseSseRecords(eventsBody);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 2,
      event: "succeeded",
      data: {
        protocolVersion: "1",
        taskId,
        sequence: 2,
        type: "succeeded",
        data: {
          status: "succeeded",
          mapId: scenario.mapId,
          versionId: scenario.versionId,
        },
      },
    });
    expect(events[0]?.data.data).not.toHaveProperty("learningRelationshipId");

    const snapshotResponse = await scenario.primaryApi.get(
      `/api/map-generations/${taskId}`,
    );
    expect(snapshotResponse.status()).toBe(200);
    expect((await snapshotResponse.json()) as JsonRecord).toMatchObject({
      taskId,
      status: "succeeded",
      sequence: 2,
      result: {
        mapId: scenario.mapId,
        versionId: scenario.versionId,
        learningRelationshipId: relationship.learningRelationshipId,
      },
    });

    await expect(page).toHaveURL(
      new RegExp(`/learn/${relationship.learningRelationshipId}$`),
      { timeout: 15_000 },
    );
    await expect(
      page.getByRole("heading", { name: "E2E 精选五节点地图" }),
    ).toBeVisible();
  });

  test("现场生成页面显示排队过程并明确呈现安全失败", async ({ scenario }) => {
    const page = scenario.primaryPage;
    await page.goto("/generate");
    await page
      .getByRole("textbox", { name: "学习主题" })
      .fill(`E2E visible failed generation ${randomUUID()}`);

    const postResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/map-generations") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "开始现场生成" }).click();
    const postResponse = await postResponsePromise;
    expect(postResponse.status()).toBe(202);
    const payload = (await postResponse.json()) as GenerationRequestPayload;
    expect(payload.snapshot.status).toBe("queued");
    await scenario.failGenerationTask(payload.snapshot.taskId);

    await expect(page.getByRole("heading", { name: "生成未完成" })).toBeVisible(
      { timeout: 10_000 },
    );
    const failureAlert = page
      .getByRole("region", { name: "生成未完成" })
      .getByRole("alert");
    await expect(failureAlert).toContainText("当前可用材料不足");
    await expect(failureAlert).toContainText(
      "这是一次安全失败，未发布不完整的学习地图。",
    );
    const body = await page
      .getByRole("region", { name: "生成未完成" })
      .innerText();
    expectNoPrivateLeak(body, ["providerPayload", "attemptId"]);
  });
});
