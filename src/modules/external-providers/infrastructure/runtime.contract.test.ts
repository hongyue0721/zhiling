import { describe, expect, it, vi } from "vitest";

import {
  createExternalProviderRuntime,
  ExternalProviderError,
  readExternalProviderEnvironment,
  type ExternalProviderEnvironment,
} from "../public/server";
import {
  OFFICIAL_FIXTURE_PROVENANCE,
  ZHIHU_SEARCH_ADDITIVE_METADATA_FIXTURE,
  REAL_AUTH_FAILURE_FIXTURE,
  ZHIDA_SUCCESS_FIXTURE,
  ZHIHU_SEARCH_EMPTY_FIXTURE,
  ZHIHU_SEARCH_MISSING_FIELD_FIXTURE,
  ZHIHU_SEARCH_SUCCESS_FIXTURE,
  ZHIHU_SEARCH_UNKNOWN_ENUM_FIXTURE,
} from "./fixtures";
import { normalizeModelJsonContent } from "./runtime";

const environment: ExternalProviderEnvironment = {
  accessSecret: "server-secret-that-must-not-escape",
  model: "zhida-thinking-1p5",
  sourceTimeoutMs: 1_000,
  modelTimeoutMs: 1_000,
};

const assessmentSource = {
  sourceId: "source-1",
  title: "Source",
  excerpt: "Evidence",
  url: "https://www.zhihu.com/question/1",
  authorName: "Author",
  contentType: "answer" as const,
  updatedAt: 1_700_000_000,
  authorityLevel: "high" as const,
  rankingScore: 1,
};

const assessmentMap = {
  title: "Map",
  summary: "Summary",
  nodes: [
    {
      nodeId: "node-1",
      title: "Node",
      learningObjective: "Objective",
      sourceIds: [assessmentSource.sourceId],
    },
  ],
  prerequisites: [],
} as const;

function runtimeWith(fetcher: typeof fetch) {
  return createExternalProviderRuntime({
    environment,
    fetch: fetcher,
    now: () => 1_742_822_400,
  });
}

function sourceRequest(fetcher: typeof fetch) {
  return runtimeWith(fetcher).sourceSearch.search({
    query: "RAG",
    count: 5,
    requestId: "request-source-1",
    timeoutMs: 500,
  });
}

function modelRequest(fetcher: typeof fetch) {
  return runtimeWith(fetcher).structuredModel.planDirections({
    topic: "RAG",
    requestId: "request-model-1",
    timeoutMs: 500,
  });
}

function modelFixture(content: string) {
  const choice = ZHIDA_SUCCESS_FIXTURE.choices[0];
  return {
    ...ZHIDA_SUCCESS_FIXTURE,
    choices: [
      {
        ...choice,
        message: { ...choice.message, content },
      },
    ],
  };
}

async function providerError(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    if (!(error instanceof ExternalProviderError)) {
      throw error;
    }
    return error;
  }
  throw new Error("expected provider error");
}

describe("Zhihu source search adapter", () => {
  it("uses the documented fixture provenance", () => {
    expect(OFFICIAL_FIXTURE_PROVENANCE).toContain("not online sampling");
  });

  it("reads required server configuration and rejects an unapproved model", () => {
    expect(
      readExternalProviderEnvironment({
        ZHIHU_ACCESS_SECRET: "secret",
        ZHIHU_MODEL: "zhida-thinking-1p5",
        ZHIHU_SOURCE_TIMEOUT_MS: "15000",
        ZHIHU_MODEL_TIMEOUT_MS: "30000",
      }),
    ).toEqual({
      accessSecret: "secret",
      model: "zhida-thinking-1p5",
      sourceTimeoutMs: 15000,
      modelTimeoutMs: 30000,
    });
    expect(() =>
      readExternalProviderEnvironment({
        ZHIHU_ACCESS_SECRET: "secret",
        ZHIHU_MODEL: "unsupported-model",
        ZHIHU_SOURCE_TIMEOUT_MS: "15000",
        ZHIHU_MODEL_TIMEOUT_MS: "30000",
      }),
    ).toThrow(/Invalid external provider environment configuration/);
  });

  it("derives identity from ContentType and ContentID while preserving URL attribution parameters", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(ZHIHU_SEARCH_SUCCESS_FIXTURE)),
      );

    const result = await sourceRequest(fetcher);

    expect(result.searchId).toBe("fixture-search-123");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      title: "RAG 评测方法综述",
      excerpt: "本文介绍了主流 RAG 评测框架。",
      url: "https://zhuanlan.zhihu.com/p/123456789?utm_medium=openapi_platform&utm_source=fixture",
      authorName: "张三",
      contentType: "article",
      updatedAt: 1710000000,
      authorityLevel: "medium",
      rankingScore: 0.98,
      sourceId: "zhihu_article_123456789",
    });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toContain(
      "https://developer.zhihu.com/api/v1/content/zhihu_search",
    );
    expect(String(url)).toContain("Query=RAG");
    expect(String(url)).toContain("Count=5");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer server-secret-that-must-not-escape",
    );
    expect(new Headers(init?.headers).get("x-request-timestamp")).toBe(
      "1742822400",
    );
  });

  it("accepts known additive provider metadata without exposing it", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(ZHIHU_SEARCH_ADDITIVE_METADATA_FIXTURE)),
      );

    const result = await sourceRequest(fetcher);

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).not.toHaveProperty("authorSignature");
  });

  it("returns a successful empty result without confusing it with auth failure", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(ZHIHU_SEARCH_EMPTY_FIXTURE)),
      );

    await expect(sourceRequest(fetcher)).resolves.toEqual({
      searchId: "fixture-empty-search",
      sources: [],
    });
  });

  it("rejects missing required fields and unknown provider enums", async () => {
    const missing = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(ZHIHU_SEARCH_MISSING_FIELD_FIXTURE)),
      );
    const unknownEnum = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(ZHIHU_SEARCH_UNKNOWN_ENUM_FIXTURE)),
      );

    await expect(providerError(sourceRequest(missing))).resolves.toMatchObject({
      provider: "source",
      code: "protocol_error",
      retryable: false,
    });
    await expect(
      providerError(sourceRequest(unknownEnum)),
    ).resolves.toMatchObject({
      provider: "source",
      code: "protocol_error",
      retryable: false,
    });
    const blankTitle = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...ZHIHU_SEARCH_SUCCESS_FIXTURE,
          Data: {
            ...ZHIHU_SEARCH_SUCCESS_FIXTURE.Data,
            Items: [
              {
                ...ZHIHU_SEARCH_SUCCESS_FIXTURE.Data.Items[0],
                Title: "   ",
              },
            ],
          },
        }),
      ),
    );
    await expect(
      providerError(sourceRequest(blankTitle)),
    ).resolves.toMatchObject({
      provider: "source",
      code: "protocol_error",
      retryable: false,
    });
  });

  it("maps business and HTTP failures without exposing provider payloads", async () => {
    const auth = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(REAL_AUTH_FAILURE_FIXTURE.search.body), {
        status: REAL_AUTH_FAILURE_FIXTURE.search.status,
      }),
    );
    const rate = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ Code: 30001, Message: "rate limited", Data: null }),
          { status: 429, headers: { "Retry-After": "3" } },
        ),
      );
    const quota = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ Code: 30002, Message: "quota", Data: null }),
        ),
      );
    const unavailable = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("provider diagnostic must not escape", { status: 503 }),
      );

    await expect(providerError(sourceRequest(auth))).resolves.toMatchObject({
      provider: "source",
      code: "authentication_failed",
      retryable: false,
    });
    await expect(providerError(sourceRequest(rate))).resolves.toMatchObject({
      provider: "source",
      code: "rate_limited",
      retryable: true,
      retryAfterMs: 3_000,
    });
    await expect(providerError(sourceRequest(quota))).resolves.toMatchObject({
      provider: "source",
      code: "quota_exhausted",
      retryable: false,
    });
    const unavailableError = await providerError(sourceRequest(unavailable));
    expect(unavailableError.code).toBe("temporarily_unavailable");
    expect(unavailableError.message).not.toContain("provider diagnostic");
  });
  it("classifies non-JSON HTTP failures before attempting schema parsing", async () => {
    const rate = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<html>rate limited</html>", {
        status: 429,
        headers: { "Retry-After": "2" },
      }),
    );
    const unavailable = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("<html>unavailable</html>", { status: 503 }),
      );

    await expect(providerError(sourceRequest(rate))).resolves.toMatchObject({
      provider: "source",
      code: "rate_limited",
      retryable: true,
      retryAfterMs: 2_000,
    });
    await expect(
      providerError(modelRequest(unavailable)),
    ).resolves.toMatchObject({
      provider: "model",
      code: "temporarily_unavailable",
      retryable: true,
    });
  });
  it("rejects search content types outside the documented contract", async () => {
    for (const contentType of ["Zvideo", "Pin"] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...ZHIHU_SEARCH_SUCCESS_FIXTURE,
            Data: {
              ...ZHIHU_SEARCH_SUCCESS_FIXTURE.Data,
              Items: [
                {
                  ...ZHIHU_SEARCH_SUCCESS_FIXTURE.Data.Items[0],
                  ContentType: contentType,
                },
              ],
            },
          }),
        ),
      );
      await expect(
        providerError(sourceRequest(fetcher)),
      ).resolves.toMatchObject({
        provider: "source",
        code: "protocol_error",
        retryable: false,
      });
    }
  });

  it("rejects invalid requests and maps aborts to timeout", async () => {
    const request = vi.fn<typeof fetch>();
    const runtime = runtimeWith(request);
    const invalid = await providerError(
      runtime.sourceSearch.search({
        query: " ",
        count: 1,
        requestId: "request-source-1",
        timeoutMs: 500,
      }),
    );
    expect(invalid.code).toBe("invalid_request");

    request.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const timedOut = await providerError(sourceRequest(request));
    expect(timedOut.code).toBe("timeout");
    expect(timedOut.retryable).toBe(true);
  });
});

describe("Zhihu structured model adapter", () => {
  it("advertises the v5 model adapter contract for compact model input", () => {
    expect(
      runtimeWith(vi.fn<typeof fetch>()).versions.modelAdapterVersion,
    ).toBe("zhida-thinking-1p5-json-2026-09-04-v5");
  });

  it("normalizes only a complete, unique JSON Markdown fence", () => {
    expect(normalizeModelJsonContent('\uFEFF  {"ok":true}  ')).toBe(
      '{"ok":true}',
    );
    expect(normalizeModelJsonContent('  ```json\n{"ok":true}\n```  ')).toBe(
      '{"ok":true}',
    );
    expect(normalizeModelJsonContent('plain text {"ok":true}')).toBe(
      'plain text {"ok":true}',
    );
    expect(
      normalizeModelJsonContent('```json\n{"ok":true}\n```\ntrailing'),
    ).toBe('```json\n{"ok":true}\n```\ntrailing');
    expect(normalizeModelJsonContent("```json\n{}\n```\n```")).toBe(
      "```json\n{}\n```\n```",
    );
  });

  it("sends only the documented model fields and ignores reasoning_content", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify(
            modelFixture(ZHIDA_SUCCESS_FIXTURE.choices[0]!.message.content),
          ),
        ),
      );

    const result = await modelRequest(fetcher);
    expect(result.directions).toHaveLength(3);
    expect(result.directions[0]?.directionId).toBe("d1");

    const [, init] = fetcher.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["messages", "model", "stream"]);
    expect(body.model).toBe("zhida-thinking-1p5");
    expect(body.stream).toBe(false);
    expect(String(init?.body)).not.toContain("reasoning_content");
    expect(String(init?.body)).not.toContain(environment.accessSecret);
  });

  it("accepts an empty sourceIds array for unsupported intermediate evidence", async () => {
    const source = {
      sourceId: "source-1",
      title: "Source",
      excerpt: "Evidence",
      url: "https://www.zhihu.com/question/1",
      authorName: "Author",
      contentType: "answer" as const,
      updatedAt: 1_700_000_000,
      authorityLevel: "high" as const,
      rankingScore: 1,
    };
    const map = {
      title: "Map",
      summary: "Summary",
      nodes: [
        {
          nodeId: "node-0",
          title: "Node 0",
          learningObjective: "Objective 0",
          sourceIds: [],
        },
        ...Array.from({ length: 4 }, (_, index) => ({
          nodeId: `node-${index + 1}`,
          title: `Node ${index + 1}`,
          learningObjective: `Objective ${index + 1}`,
          sourceIds: [source.sourceId],
        })),
      ],
      prerequisites: [],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(modelFixture(JSON.stringify(map)))),
      );
    const runtime = runtimeWith(fetcher);
    const result = await runtime.structuredModel.structureMap({
      topic: "RAG",
      directions: [
        {
          directionId: "direction-1",
          title: "Direction",
          objective: "Objective",
          searchQuery: "RAG",
        },
      ],
      sources: [source],
      requestId: "request-structure-1",
      timeoutMs: 500,
    });
    expect(result.nodes[0]?.sourceIds).toEqual([]);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      messages: readonly [{ content: string }];
    };
    const prompt = body.messages[0]?.content ?? "";
    expect(prompt).toContain('"sourceId":"source-1"');
    expect(prompt).toContain('"title":"Source"');
    expect(prompt).not.toContain('"excerpt"');
    expect(prompt).not.toContain('"authorName"');
    expect(prompt).not.toContain('"contentType"');
    expect(prompt).not.toContain('"rankingScore"');
  });

  it("keeps unsupported viewpoint evidence inside the JSON contract", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify(modelFixture(JSON.stringify({ viewpoints: [] }))),
        ),
      );

    const result = await runtimeWith(fetcher).structuredModel.extractViewpoints(
      {
        topic: "RAG",
        map: assessmentMap,
        sources: [assessmentSource],
        requestId: "request-viewpoints-empty",
        timeoutMs: 500,
      },
    );
    expect(result).toEqual({ viewpoints: [] });

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      messages: readonly [{ content: string }];
    };
    const prompt = body.messages[0]?.content ?? "";
    expect(prompt).toContain(
      'If no viewpoint is supported, return {"viewpoints":[]} without an explanation.',
    );
    expect(prompt).toContain(
      "conditions must be a non-empty string for disagreement and null for every other kind.",
    );
    expect(prompt).not.toContain('"authorName"');
    expect(prompt).not.toContain('"prerequisites"');
  });

  it("states the final per-node assessment cardinality in the model prompt", async () => {
    const source = {
      sourceId: "source-1",
      title: "Source",
      excerpt: "Evidence",
      url: "https://www.zhihu.com/question/1",
      authorName: "Author",
      contentType: "answer" as const,
      updatedAt: 1_700_000_000,
      authorityLevel: "high" as const,
      rankingScore: 1,
    };
    const map = {
      title: "Map",
      summary: "Summary",
      nodes: [
        {
          nodeId: "node-1",
          title: "Node",
          learningObjective: "Objective",
          sourceIds: [source.sourceId],
        },
      ],
      prerequisites: [],
    };
    const questions = {
      questions: [
        {
          questionId: "question-1",
          nodeId: "node-1",
          type: "single_choice",
          prompt: "Prompt",
          explanation: "Explanation",
          options: [
            { optionId: "yes", label: "Yes" },
            { optionId: "no", label: "No" },
          ],
          correctOptionIds: ["yes"],
          sourceIds: [source.sourceId],
        },
      ],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(modelFixture(JSON.stringify(questions)))),
      );
    const runtime = runtimeWith(fetcher);
    await runtime.structuredModel.generateAssessments({
      topic: "RAG",
      map,
      sources: [source],
      requestId: "request-assessment-1",
      timeoutMs: 500,
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      messages: readonly [{ content: string }];
    };
    expect(body.messages[0]?.content).toContain(
      "every node represented in the supplied map with 2 to 3 questions per node",
    );
    expect(body.messages[0]?.content).toContain(
      "single_choice|multiple_choice|matching|opinion_analysis",
    );
    expect(body.messages[0]?.content).toContain(
      "For single_choice and opinion_analysis, include exactly one correctOptionIds entry and omit correctMatches.",
    );
    expect(body.messages[0]?.content).toContain(
      "For matching, include one or more correctMatches entries and omit correctOptionIds",
    );
    expect(body.messages[0]?.content).toContain(
      "every option must appear exactly once across the left and right sides",
    );
  });

  it("accepts all four assessment types without losing their answer fields", async () => {
    const questions = {
      questions: [
        {
          questionId: "question-single",
          nodeId: "node-1",
          type: "single_choice",
          prompt: "Which statement is supported?",
          explanation: "The source supports the first statement.",
          options: [
            { optionId: "single-a", label: "Supported" },
            { optionId: "single-b", label: "Unsupported" },
          ],
          correctOptionIds: ["single-a"],
          sourceIds: [assessmentSource.sourceId],
        },
        {
          questionId: "question-multiple",
          nodeId: "node-1",
          type: "multiple_choice",
          prompt: "Which statements are supported?",
          explanation: "The source supports both selected statements.",
          options: [
            { optionId: "multiple-a", label: "First" },
            { optionId: "multiple-b", label: "Second" },
            { optionId: "multiple-c", label: "Third" },
          ],
          correctOptionIds: ["multiple-a", "multiple-c"],
          sourceIds: [assessmentSource.sourceId],
        },
        {
          questionId: "question-matching",
          nodeId: "node-1",
          type: "matching",
          prompt: "Match each concept to its description.",
          explanation:
            "Each concept is paired with the corresponding description.",
          options: [
            { optionId: "concept-a", label: "Concept A" },
            { optionId: "concept-b", label: "Concept B" },
            { optionId: "description-a", label: "Description A" },
            { optionId: "description-b", label: "Description B" },
          ],
          correctMatches: [
            { leftOptionId: "concept-a", rightOptionId: "description-a" },
            { leftOptionId: "concept-b", rightOptionId: "description-b" },
          ],
          sourceIds: [assessmentSource.sourceId],
        },
        {
          questionId: "question-opinion",
          nodeId: "node-1",
          type: "opinion_analysis",
          prompt: "Which interpretation best fits the evidence?",
          explanation: "The first interpretation is supported by the source.",
          options: [
            {
              optionId: "opinion-a",
              label: "Evidence-grounded interpretation",
            },
            { optionId: "opinion-b", label: "Unsupported interpretation" },
          ],
          correctOptionIds: ["opinion-a"],
          sourceIds: [assessmentSource.sourceId],
        },
      ],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(modelFixture(JSON.stringify(questions)))),
      );

    const result = await runtimeWith(
      fetcher,
    ).structuredModel.generateAssessments({
      topic: "RAG",
      map: assessmentMap,
      sources: [assessmentSource],
      requestId: "request-assessment-four-types",
      timeoutMs: 500,
    });

    expect(result.questions.map(({ type }) => type)).toEqual([
      "single_choice",
      "multiple_choice",
      "matching",
      "opinion_analysis",
    ]);
    expect(result.questions[0]).toMatchObject({
      correctOptionIds: ["single-a"],
    });
    expect(result.questions[1]).toMatchObject({
      correctOptionIds: ["multiple-a", "multiple-c"],
    });
    expect(result.questions[2]).toMatchObject({
      correctMatches: [
        { leftOptionId: "concept-a", rightOptionId: "description-a" },
        { leftOptionId: "concept-b", rightOptionId: "description-b" },
      ],
    });
    expect(result.questions[2]).not.toHaveProperty("correctOptionIds");
    expect(result.questions[3]).toMatchObject({
      correctOptionIds: ["opinion-a"],
    });
    expect(result.questions[0]).not.toHaveProperty("correctMatches");
    expect(result.questions[1]).not.toHaveProperty("correctMatches");
    expect(result.questions[3]).not.toHaveProperty("correctMatches");
  });

  it("rejects invalid answer combinations for every assessment type", async () => {
    const commonQuestion = {
      questionId: "question-invalid",
      nodeId: "node-1",
      prompt: "Prompt",
      explanation: "Explanation",
      options: [
        { optionId: "left-a", label: "Left A" },
        { optionId: "right-a", label: "Right A" },
      ],
      sourceIds: [assessmentSource.sourceId],
    };
    const invalidQuestions: readonly Record<string, unknown>[] = [
      {
        ...commonQuestion,
        type: "single_choice",
        correctOptionIds: ["left-a", "right-a"],
      },
      {
        ...commonQuestion,
        type: "multiple_choice",
        correctOptionIds: ["left-a"],
        correctMatches: [{ leftOptionId: "left-a", rightOptionId: "right-a" }],
      },
      {
        ...commonQuestion,
        type: "matching",
        correctOptionIds: [],
        correctMatches: [{ leftOptionId: "left-a", rightOptionId: "right-a" }],
      },
      {
        ...commonQuestion,
        type: "opinion_analysis",
        correctOptionIds: ["left-a", "right-a"],
      },
      {
        ...commonQuestion,
        type: "matching",
        correctMatches: [{ leftOptionId: "left-a", rightOptionId: "left-a" }],
      },
      {
        ...commonQuestion,
        type: "matching",
        options: [
          { optionId: "concept-a", label: "Concept A" },
          { optionId: "concept-b", label: "Concept B" },
          { optionId: "description-a", label: "Description A" },
          { optionId: "description-b", label: "Description B" },
        ],
        correctMatches: [
          { leftOptionId: "concept-a", rightOptionId: "description-a" },
        ],
      },
    ];

    for (const [index, question] of invalidQuestions.entries()) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify(
              modelFixture(JSON.stringify({ questions: [question] })),
            ),
          ),
        );
      const error = await providerError(
        runtimeWith(fetcher).structuredModel.generateAssessments({
          topic: "RAG",
          map: assessmentMap,
          sources: [assessmentSource],
          requestId: `request-assessment-invalid-${index}`,
          timeoutMs: 500,
        }),
      );
      expect(error).toMatchObject({
        provider: "model",
        code: "protocol_error",
        retryable: false,
      });
    }
  });

  it("rejects non-JSON and schema-invalid model content", async () => {
    const nonJson = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(modelFixture("not json"))),
      );
    const invalidSchema = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(modelFixture('{"directions":[]}'))),
      );

    await expect(providerError(modelRequest(nonJson))).resolves.toMatchObject({
      provider: "model",
      code: "protocol_error",
      retryable: false,
    });
    await expect(
      providerError(modelRequest(invalidSchema)),
    ).resolves.toMatchObject({
      provider: "model",
      code: "protocol_error",
      retryable: false,
    });
  });

  it("maps model authentication, temporary, and timeout failures", async () => {
    const auth = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(REAL_AUTH_FAILURE_FIXTURE.model.body), {
        status: REAL_AUTH_FAILURE_FIXTURE.model.status,
      }),
    );
    const unavailable = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("upstream diagnostic", { status: 503 }));
    const timeout = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("aborted", "AbortError"));

    await expect(providerError(modelRequest(auth))).resolves.toMatchObject({
      provider: "model",
      code: "authentication_failed",
      retryable: false,
    });
    const unavailableError = await providerError(modelRequest(unavailable));
    expect(unavailableError.code).toBe("temporarily_unavailable");
    expect(unavailableError.message).not.toContain("upstream diagnostic");
    await expect(providerError(modelRequest(timeout))).resolves.toMatchObject({
      provider: "model",
      code: "timeout",
      retryable: true,
    });
  });
});
