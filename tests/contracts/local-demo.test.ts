import { describe, expect, it } from "vitest";

import { validateLearningAssessmentQuestionSet } from "@/modules/learning-assessment/domain/assessment";
import { validateLearningMapPublication } from "@/modules/learning-catalog/domain/learning-map";
import {
  classifyExistingDemoObject,
  DEMO_DISCLOSURE,
  DEMO_MAP_PUBLICATION,
  DEMO_QUESTION_SET_PUBLICATION,
} from "../../scripts/demo/content";
import { readDemoEnvironment } from "../../scripts/demo/environment";

const validEnvironment: Readonly<Record<string, string>> = {
  NODE_ENV: "development",
  ZHIJING_DEMO_MODE: "1",
  DATABASE_URL:
    "postgresql://zhijing_demo:local-only@demo-postgres:5432/zhijing_demo",
  BETTER_AUTH_SECRET: "local-demo-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("local Demo environment gate", () => {
  it("accepts only an explicit local development Demo database", () => {
    expect(readDemoEnvironment(validEnvironment)).toEqual({
      databaseUrl: validEnvironment.DATABASE_URL,
      authSecret: validEnvironment.BETTER_AUTH_SECRET,
      authBaseUrl: validEnvironment.BETTER_AUTH_URL,
    });
    expect(
      readDemoEnvironment({
        ...validEnvironment,
        DATABASE_URL:
          "postgresql://zhijing_demo:local-only@127.0.0.1:55432/another_demo",
        BETTER_AUTH_URL: "http://127.0.0.1:3000",
      }),
    ).toMatchObject({ authBaseUrl: "http://127.0.0.1:3000" });
  });

  it("accepts IPv6 loopback database and auth URLs", () => {
    const environment = readDemoEnvironment({
      ...validEnvironment,
      DATABASE_URL:
        "postgresql://zhijing_demo:local-only@[::1]:55432/another_demo",
      BETTER_AUTH_URL: "http://[::1]:3000",
    });

    expect(environment).toMatchObject({
      databaseUrl:
        "postgresql://zhijing_demo:local-only@[::1]:55432/another_demo",
      authBaseUrl: "http://[::1]:3000",
    });
  });

  it.each([
    ["production mode", { NODE_ENV: "production" }],
    ["implicit mode", { ZHIJING_DEMO_MODE: "0" }],
    ["test database variable", { TEST_DATABASE_URL: "" }],
    ["non-PostgreSQL URL", { DATABASE_URL: "mysql://localhost/app_demo" }],
    [
      "non-Demo database name",
      { DATABASE_URL: "postgresql://user:pass@localhost/zhijing" },
    ],
    [
      "remote database IPv6 host",
      {
        DATABASE_URL: "postgresql://user:pass@[2001:db8::1]/zhijing_demo",
      },
    ],
    ["HTTPS auth origin", { BETTER_AUTH_URL: "https://localhost:3000" }],
    ["remote auth origin", { BETTER_AUTH_URL: "http://demo.example:3000" }],
    [
      "remote auth IPv6 origin",
      { BETTER_AUTH_URL: "http://[2001:db8::1]:3000" },
    ],
    ["auth URL path", { BETTER_AUTH_URL: "http://localhost:3000/auth" }],
    ["short auth secret", { BETTER_AUTH_SECRET: "demo" }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      readDemoEnvironment({ ...validEnvironment, ...override }),
    ).toThrow("Demo environment rejected before database access");
  });
});

describe("fixed local Demo content", () => {
  it("is a disclosed five-node linear DAG with two questions per node", () => {
    expect(() =>
      validateLearningMapPublication(DEMO_MAP_PUBLICATION),
    ).not.toThrow();
    expect(() =>
      validateLearningAssessmentQuestionSet(DEMO_QUESTION_SET_PUBLICATION),
    ).not.toThrow();

    expect(DEMO_MAP_PUBLICATION.nodes).toHaveLength(5);
    expect(DEMO_MAP_PUBLICATION.prerequisites).toEqual(
      DEMO_MAP_PUBLICATION.nodes.slice(1).map((node, index) => ({
        nodeId: node.nodeId,
        prerequisiteNodeId: DEMO_MAP_PUBLICATION.nodes[index]?.nodeId,
      })),
    );
    for (const node of DEMO_MAP_PUBLICATION.nodes) {
      expect(
        DEMO_QUESTION_SET_PUBLICATION.questions.filter(
          (question) => question.nodeId === node.nodeId,
        ),
      ).toHaveLength(2);
      expect(node.title).toContain(DEMO_DISCLOSURE);
    }
    expect(DEMO_MAP_PUBLICATION.title).toContain(DEMO_DISCLOSURE);
    expect(DEMO_MAP_PUBLICATION.summary).toContain(DEMO_DISCLOSURE);
    for (const source of DEMO_MAP_PUBLICATION.sources) {
      expect(source.title).toContain(DEMO_DISCLOSURE);
    }
    expect(
      new Set(
        DEMO_QUESTION_SET_PUBLICATION.questions.map(
          (question) => question.type,
        ),
      ),
    ).toEqual(
      new Set([
        "single_choice",
        "multiple_choice",
        "matching",
        "opinion_analysis",
      ]),
    );
  });

  it("uses only the three verified public Zhihu sources and stable non-E2E IDs", () => {
    expect(DEMO_MAP_PUBLICATION.sources.map((source) => source.url)).toEqual([
      "https://www.zhihu.com/education/video-course/1487063048279662592?section_id=1487070022975930368",
      "https://www.zhihu.com/en/article/636152620",
      "https://www.zhihu.com/en/article/636135140",
    ]);
    const stableIds = [
      DEMO_MAP_PUBLICATION.mapId,
      DEMO_MAP_PUBLICATION.versionId,
      DEMO_QUESTION_SET_PUBLICATION.questionSetId,
      ...DEMO_MAP_PUBLICATION.nodes.map((node) => node.nodeId),
      ...DEMO_QUESTION_SET_PUBLICATION.questions.map(
        (question) => question.questionId,
      ),
    ];
    expect(stableIds.every((id) => !id.includes("e2e"))).toBe(true);
  });
});

describe("fixed Demo object reuse", () => {
  it("distinguishes missing and strictly equivalent objects", () => {
    const expected = {
      id: "local-demo-object-v1",
      nested: { label: DEMO_DISCLOSURE },
      ordered: ["first", "second"],
    };
    expect(classifyExistingDemoObject("object", expected, null)).toBe(
      "missing",
    );
    expect(
      classifyExistingDemoObject("object", expected, structuredClone(expected)),
    ).toBe("equivalent");
  });

  it("rejects a conflicting object instead of overwriting it", () => {
    expect(() =>
      classifyExistingDemoObject(
        "object",
        { id: "local-demo-object-v1", value: "fixed" },
        { id: "local-demo-object-v1", value: "changed" },
      ),
    ).toThrow("refusing to overwrite immutable or non-Demo data");
  });
});
