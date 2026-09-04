/**
 * These fixtures are redacted examples from the official zhihu Skill 0.2.1
 * HTTP contract snapshot dated 2026-07-16. They are documentation fixtures,
 * not online samples captured with this project's Access Secret.
 */
export const OFFICIAL_FIXTURE_PROVENANCE =
  "official zhihu Skill 0.2.1 HTTP contract sample (2026-07-16); not online sampling";

export const ZHIHU_SEARCH_SUCCESS_FIXTURE = {
  Code: 0,
  Message: "success",
  Data: {
    HasMore: false,
    SearchHashId: "fixture-search-123",
    Items: [
      {
        Title: "RAG 评测方法综述",
        ContentType: "Article",
        ContentID: "123456789",
        ContentText: "本文介绍了主流 RAG 评测框架。",
        Url: "https://zhuanlan.zhihu.com/p/123456789?utm_medium=openapi_platform&utm_source=fixture",
        CommentCount: 15,
        VoteUpCount: 128,
        AuthorName: "张三",
        AuthorAvatar: "",
        AuthorBadge: "",
        AuthorBadgeText: "",
        EditTime: 1710000000,
        CommentInfoList: [],
        AuthorityLevel: "2",
        RankingScore: 0.98,
      },
      {
        Title: "RAG 评测方法综述（重复链接）",
        ContentType: "Article",
        ContentID: "123456789",
        ContentText: "相同来源的重复结果。",
        Url: "https://zhuanlan.zhihu.com/p/123456789?utm_source=another",
        CommentCount: 1,
        VoteUpCount: 2,
        AuthorName: "张三",
        AuthorAvatar: "",
        AuthorBadge: "",
        AuthorBadgeText: "",
        EditTime: 1710000001,
        CommentInfoList: [],
        AuthorityLevel: "2",
        RankingScore: 0.4,
      },
    ],
  },
} as const;

/**
 * Live-compatible response with the provider's additive author metadata.
 * `AuthorSignature` is accepted and intentionally omitted from normalized output.
 */
export const ZHIHU_SEARCH_ADDITIVE_METADATA_FIXTURE = {
  ...ZHIHU_SEARCH_SUCCESS_FIXTURE,
  Data: {
    ...ZHIHU_SEARCH_SUCCESS_FIXTURE.Data,
    Items: ZHIHU_SEARCH_SUCCESS_FIXTURE.Data.Items.map((item) => ({
      ...item,
      AuthorSignature: "fixture-author-signature",
    })),
  },
} as const;

/** Official contract shape for a successful search with no items. */
export const ZHIHU_SEARCH_EMPTY_FIXTURE = {
  Code: 0,
  Message: "success",
  Data: {
    HasMore: false,
    SearchHashId: "fixture-empty-search",
    Items: [],
    EmptyReason: "no result",
  },
} as const;

/** Missing required `SearchHashId`; the adapter must reject this fixture. */
export const ZHIHU_SEARCH_MISSING_FIELD_FIXTURE = {
  Code: 0,
  Message: "success",
  Data: { HasMore: false, Items: [] },
} as const;

/** Unknown provider enum; the adapter must reject this fixture. */
export const ZHIHU_SEARCH_UNKNOWN_ENUM_FIXTURE = {
  Code: 0,
  Message: "success",
  Data: {
    HasMore: false,
    SearchHashId: "fixture-unknown-enum",
    Items: [
      {
        ...ZHIHU_SEARCH_SUCCESS_FIXTURE.Data.Items[0],
        ContentType: "UnknownType",
      },
    ],
  },
} as const;

/**
 * Redacted response observed by the project on 2026-09-02 without sending an
 * Access Secret. Dynamic response headers, cookies, and request IDs are
 * intentionally omitted.
 */
export const REAL_AUTH_FAILURE_FIXTURE = {
  provenance:
    "redacted no-secret probe, 2026-09-02; not a successful online sample",
  search: {
    status: 200,
    body: { Code: 20001, Message: "Authorization failed", Data: null },
  },
  model: {
    status: 401,
    body: {
      error: {
        message: "Authorization failed",
        type: "authentication_error",
        param: null,
        code: "invalid_api_key",
      },
    },
  },
} as const;

/** Official non-stream response envelope with synthetic JSON-only content for schema tests. */
export const ZHIDA_SUCCESS_FIXTURE = {
  id: "chatcmpl-fixture",
  object: "chat.completion",
  created: 1740470400,
  model: "zhida-thinking-1p5",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        reasoning_content: "redacted reasoning; ignored by adapter",
        content:
          '{"directions":[{"directionId":"d1","title":"基础","objective":"理解基础","searchQuery":"基础"},{"directionId":"d2","title":"方法","objective":"掌握方法","searchQuery":"方法"},{"directionId":"d3","title":"实践","objective":"完成实践","searchQuery":"实践"}]}',
      },
      finish_reason: "stop",
    },
  ],
} as const;
