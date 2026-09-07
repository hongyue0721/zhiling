import { describe, expect, it } from "vitest";

import type {
  GenerationDirectionCandidate,
  GenerationSourceCandidate,
} from "../domain/candidate";
import {
  createModelContextBudget,
  MODEL_CONTEXT_BUDGETS,
  MODEL_MAX_ATTEMPTS,
} from "./context-budget";

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

const directions: readonly GenerationDirectionCandidate[] = [
  {
    directionId: "direction-a",
    title: "A",
    objective: "Objective A",
    searchQuery: "topic A",
  },
  {
    directionId: "direction-b",
    title: "B",
    objective: "Objective B",
    searchQuery: "topic B",
  },
  {
    directionId: "direction-c",
    title: "C",
    objective: "Objective C",
    searchQuery: "topic C",
  },
];

const sources: readonly GenerationSourceCandidate[] = [
  {
    sourceId: "source-a",
    title: "Source A",
    excerpt: "A".repeat(500),
    url: "https://www.zhihu.com/a",
    authorName: "Author A",
    contentType: "answer",
    updatedAt: 1,
    authorityLevel: "high",
    rankingScore: 0.3,
  },
  {
    sourceId: "source-b",
    title: "Source B",
    excerpt: "B".repeat(500),
    url: "https://www.zhihu.com/b",
    authorName: "Author B",
    contentType: "article",
    updatedAt: 2,
    authorityLevel: "medium",
    rankingScore: 0.9,
  },
  {
    sourceId: "source-c",
    title: "Source C",
    excerpt: "C".repeat(500),
    url: "https://www.zhihu.com/c",
    authorName: "Author C",
    contentType: "question",
    updatedAt: 3,
    authorityLevel: "low",
    rankingScore: 0.8,
  },
  {
    sourceId: "source-extra",
    title: "Source extra",
    excerpt: "extra".repeat(300),
    url: "https://www.zhihu.com/extra",
    authorName: "Author extra",
    contentType: "answer",
    updatedAt: 4,
    authorityLevel: "high",
    rankingScore: 1,
  },
];

const balancedSources: readonly GenerationSourceCandidate[] = [
  ...sources,
  { ...sources[0]!, sourceId: "source-a2", rankingScore: 0.99 },
  { ...sources[0]!, sourceId: "source-a3", rankingScore: 0.98 },
  { ...sources[1]!, sourceId: "source-b2", rankingScore: 0.97 },
  { ...sources[2]!, sourceId: "source-c2", rankingScore: 0.96 },
];

describe("model context budget", () => {
  it("keeps the three total-attempt semantics explicit", () => {
    expect(MODEL_MAX_ATTEMPTS).toBe(3);
  });

  it("retains source IDs and at least one source for every planning direction", () => {
    const budget = createModelContextBudget({
      attempt: 1,
      directions,
      sources,
      sourceIdsByDirection: [
        { directionId: "direction-a", sourceIds: ["source-a"] },
        { directionId: "direction-b", sourceIds: ["source-b"] },
        { directionId: "direction-c", sourceIds: ["source-c"] },
      ],
    });

    expect(budget.sources.map((source) => source.sourceId)).toEqual([
      "source-a",
      "source-b",
      "source-c",
      "source-extra",
    ]);
    expect(budget.directionCoverage).toEqual([
      { directionId: "direction-a", sourceIds: ["source-a"] },
      { directionId: "direction-b", sourceIds: ["source-b"] },
      { directionId: "direction-c", sourceIds: ["source-c"] },
    ]);
    expect(
      budget.sources.every((source) => source.url.includes("zhihu.com")),
    ).toBe(true);
    expect(Array.from(budget.sources[0]?.excerpt ?? "")).toHaveLength(320);
    expect(budget.serializedChars).toBeLessThanOrEqual(
      budget.targetSourceChars,
    );
  });

  it("keeps emoji excerpts persistable when the UTF-16 budget boundary splits a pair", () => {
    const emoji = "📘";
    const marker = "手写 AI Agent,完整 Python 教程\n\n";
    const crossingExcerpt = `${marker}${"词".repeat(
      MODEL_CONTEXT_BUDGETS[0].maxExcerptChars - 1 - marker.length,
    )}${emoji}后续内容`;
    const brokenByCodeUnit = crossingExcerpt
      .trim()
      .slice(0, MODEL_CONTEXT_BUDGETS[0].maxExcerptChars);
    expect(brokenByCodeUnit.charCodeAt(brokenByCodeUnit.length - 1)).toBe(
      0xd83d,
    );
    expect(brokenByCodeUnit.at(-1)).not.toBe(emoji);

    const emojiSources: readonly GenerationSourceCandidate[] = sources.map(
      (source, index) => ({
        ...source,
        excerpt: `${crossingExcerpt}${index}`,
      }),
    );
    const budget = createModelContextBudget({
      attempt: 1,
      directions,
      sources: emojiSources,
      sourceIdsByDirection: [
        { directionId: "direction-a", sourceIds: ["source-a"] },
        { directionId: "direction-b", sourceIds: ["source-b"] },
        { directionId: "direction-c", sourceIds: ["source-c"] },
      ],
    });

    expect(
      budget.sources.every((source) => source.excerpt.endsWith(emoji)),
    ).toBe(true);
    expect(Array.from(budget.sources[0]!.excerpt)).toHaveLength(
      MODEL_CONTEXT_BUDGETS[0].maxExcerptChars,
    );
    expect(budget.sources[0]!.excerpt.length).toBeGreaterThan(
      MODEL_CONTEXT_BUDGETS[0].maxExcerptChars,
    );
    for (const source of budget.sources) {
      expect(hasUnpairedSurrogate(source.excerpt)).toBe(false);
      expect(hasUnpairedSurrogate(JSON.stringify(source))).toBe(false);
    }
  });

  it("drops unpaired surrogates already present in a source excerpt", () => {
    const budget = createModelContextBudget({
      attempt: 1,
      directions,
      sources: [
        {
          ...sources[0]!,
          excerpt: `完整摘要\uD83D中间\uDE00以及结尾\uD83D`,
        },
        ...sources.slice(1),
      ],
      sourceIdsByDirection: [
        { directionId: "direction-a", sourceIds: ["source-a"] },
        { directionId: "direction-b", sourceIds: ["source-b"] },
        { directionId: "direction-c", sourceIds: ["source-c"] },
      ],
    });

    const compacted = budget.sources.find(
      (source) => source.sourceId === "source-a",
    );
    expect(compacted?.excerpt).toBe("完整摘要中间以及结尾");
    expect(hasUnpairedSurrogate(JSON.stringify(compacted))).toBe(false);
  });

  it("converges source count and excerpt length on recovery attempts", () => {
    const first = createModelContextBudget({
      attempt: 1,
      directions,
      sources,
      sourceIdsByDirection: directions.map((direction, index) => ({
        directionId: direction.directionId,
        sourceIds: [sources[index]!.sourceId],
      })),
    });
    const third = createModelContextBudget({
      attempt: 3,
      directions,
      sources,
      sourceIdsByDirection: directions.map((direction, index) => ({
        directionId: direction.directionId,
        sourceIds: [sources[index]!.sourceId],
      })),
    });

    expect(third.targetSources).toBeLessThan(first.targetSources);
    expect(third.maxExcerptChars).toBeLessThan(first.maxExcerptChars);
    expect(third.serializedChars).toBeLessThan(first.serializedChars);
    expect(third.sources.map((source) => source.sourceId)).toEqual([
      "source-a",
      "source-b",
      "source-c",
      "source-extra",
    ]);
  });

  it("round-robins ranked sources across directions before global fill", () => {
    const budget = createModelContextBudget({
      attempt: 3,
      directions,
      sources: balancedSources,
      sourceIdsByDirection: [
        {
          directionId: "direction-a",
          sourceIds: ["source-a", "source-a2", "source-a3"],
        },
        { directionId: "direction-b", sourceIds: ["source-b", "source-b2"] },
        { directionId: "direction-c", sourceIds: ["source-c", "source-c2"] },
      ],
    });

    expect(budget.sources.map((source) => source.sourceId)).toEqual([
      "source-a2",
      "source-b2",
      "source-c2",
      "source-a3",
      "source-b",
      "source-c",
      "source-a",
      "source-extra",
    ]);
  });

  it("keeps required map citations even when ranking would omit them", () => {
    const budget = createModelContextBudget({
      attempt: 3,
      directions,
      sources,
      requiredSourceIds: ["source-a"],
      sourceIdsByDirection: [],
    });

    expect(budget.sources.map((source) => source.sourceId)).toContain(
      "source-a",
    );
  });

  it("preserves required citations and every direction beyond size targets", () => {
    const requiredSources = Array.from({ length: 8 }, (_, index) => ({
      ...sources[0]!,
      sourceId: `required-${index}`,
      rankingScore: 1 - index / 100,
    }));
    const directionB = { ...sources[1]!, sourceId: "direction-b-only" };
    const directionC = { ...sources[2]!, sourceId: "direction-c-only" };
    const budget = createModelContextBudget({
      attempt: 3,
      directions,
      sources: [...requiredSources, directionB, directionC],
      requiredSourceIds: requiredSources.map((source) => source.sourceId),
      sourceIdsByDirection: [
        {
          directionId: "direction-a",
          sourceIds: requiredSources.map((source) => source.sourceId),
        },
        { directionId: "direction-b", sourceIds: [directionB.sourceId] },
        { directionId: "direction-c", sourceIds: [directionC.sourceId] },
      ],
    });

    expect(budget.sources).toHaveLength(10);
    expect(budget.sources.map((source) => source.sourceId)).toEqual([
      ...requiredSources.map((source) => source.sourceId),
      directionB.sourceId,
      directionC.sourceId,
    ]);
    expect(
      budget.directionCoverage.every(({ sourceIds }) => sourceIds.length),
    ).toBeTruthy();
  });
});
