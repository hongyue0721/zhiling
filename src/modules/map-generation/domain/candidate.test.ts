import { describe, expect, it } from "vitest";

import {
  GenerationCandidateValidationError,
  validateGenerationCandidate,
  type GenerationCandidate,
} from "./candidate";

function candidate(): GenerationCandidate {
  const sources = Array.from({ length: 5 }, (_, index) => ({
    sourceId: `source-${index}`,
    title: `Source ${index}`,
    excerpt: `Excerpt ${index}`,
    url: `https://www.zhihu.com/question/${index}`,
    authorName: `Author ${index}`,
    contentType: "answer" as const,
    updatedAt: 1_700_000_000 + index,
    authorityLevel: "high" as const,
    rankingScore: 1,
  }));
  const nodes = sources.map((source, index) => ({
    nodeId: `node-${index}`,
    title: `Node ${index}`,
    learningObjective: `Objective ${index}`,
    sourceIds: [source.sourceId],
  }));
  return {
    directions: [0, 1, 2].map((index) => ({
      directionId: `direction-${index}`,
      title: `Direction ${index}`,
      objective: `Objective ${index}`,
      searchQuery: `Search ${index}`,
    })),
    map: {
      title: "Map",
      summary: "Summary",
      nodes,
      prerequisites: nodes.slice(1).map((node, index) => ({
        nodeId: node.nodeId,
        prerequisiteNodeId: nodes[index]!.nodeId,
      })),
    },
    viewpoints: nodes.map((node, index) => ({
      viewpointId: `viewpoint-${index}`,
      nodeId: node.nodeId,
      kind: "consensus" as const,
      statement: `Statement ${index}`,
      conditions: null,
      sourceIds: [node.sourceIds[0]!],
    })),
    questions: nodes.flatMap((node, index) =>
      [0, 1].map((questionIndex) => ({
        questionId: `question-${index}-${questionIndex}`,
        nodeId: node.nodeId,
        type: "single_choice" as const,
        prompt: `Question ${index}-${questionIndex}`,
        explanation: `Explanation ${index}-${questionIndex}`,
        options: [
          { optionId: "yes", label: "Yes" },
          { optionId: "no", label: "No" },
        ],
        correctOptionIds: ["yes"],
        sourceIds: [node.sourceIds[0]!],
      })),
    ),
    sources,
  };
}

describe("generation candidate gate", () => {
  it("accepts a complete DAG with node-local evidence", () => {
    expect(validateGenerationCandidate(candidate()).map.nodes).toHaveLength(5);
  });

  it.each([
    [
      "cyclic_prerequisites",
      (value: GenerationCandidate) => ({
        ...value,
        map: {
          ...value.map,
          prerequisites: value.map.nodes.map((node, index) => ({
            nodeId: node.nodeId,
            prerequisiteNodeId:
              value.map.nodes[(index + 1) % value.map.nodes.length]!.nodeId,
          })),
        },
      }),
    ],
    [
      "question_count_per_node",
      (value: GenerationCandidate) => ({
        ...value,
        questions: value.questions.slice(1),
      }),
    ],
    [
      "model_url",
      (value: GenerationCandidate) => ({
        ...value,
        map: { ...value.map, url: "https://example.invalid" },
      }),
    ],
  ] as const)("rejects %s", (_reason, mutate) => {
    expect(() => validateGenerationCandidate(mutate(candidate()))).toThrow(
      GenerationCandidateValidationError,
    );
  });
  it("accepts matching options with arbitrary IDs when pairs cover both sides", () => {
    const value = candidate();
    const matchingQuestion = {
      ...value.questions[0]!,
      type: "matching" as const,
      options: [
        { optionId: "concept-a", label: "Concept A" },
        { optionId: "concept-b", label: "Concept B" },
        { optionId: "description-a", label: "Description A" },
        { optionId: "description-b", label: "Description B" },
      ],
      correctOptionIds: [],
      correctMatches: [
        { leftOptionId: "concept-a", rightOptionId: "description-b" },
        { leftOptionId: "concept-b", rightOptionId: "description-a" },
      ],
    };
    const validated = validateGenerationCandidate({
      ...value,
      questions: [matchingQuestion, ...value.questions.slice(1)],
    });

    expect(validated.questions[0]).toMatchObject({
      type: "matching",
      correctMatches: [
        { leftOptionId: "concept-a", rightOptionId: "description-b" },
        { leftOptionId: "concept-b", rightOptionId: "description-a" },
      ],
    });
  });

  it.each([
    {
      name: "does not cover every option",
      options: [
        { optionId: "concept-a", label: "Concept A" },
        { optionId: "concept-b", label: "Concept B" },
        { optionId: "description-a", label: "Description A" },
      ],
      correctMatches: [
        { leftOptionId: "concept-a", rightOptionId: "description-a" },
      ],
    },
    {
      name: "does not keep sides disjoint",
      options: [
        { optionId: "concept-a", label: "Concept A" },
        { optionId: "concept-b", label: "Concept B" },
        { optionId: "description-a", label: "Description A" },
        { optionId: "description-b", label: "Description B" },
      ],
      correctMatches: [
        { leftOptionId: "concept-a", rightOptionId: "description-a" },
        { leftOptionId: "description-a", rightOptionId: "description-b" },
      ],
    },
  ])("$name", ({ options, correctMatches }) => {
    const value = candidate();
    const matchingQuestion = {
      ...value.questions[0]!,
      type: "matching" as const,
      options,
      correctOptionIds: [],
      correctMatches,
    };

    expect(() =>
      validateGenerationCandidate({
        ...value,
        questions: [matchingQuestion, ...value.questions.slice(1)],
      }),
    ).toThrow(GenerationCandidateValidationError);
  });

  it("rejects an unknown viewpoint kind at the final candidate gate", () => {
    const malformed = {
      ...candidate(),
      viewpoints: [
        {
          ...candidate().viewpoints[0]!,
          kind: "unsupported",
        },
        ...candidate().viewpoints.slice(1),
      ],
    } as unknown as GenerationCandidate;
    expect(() => validateGenerationCandidate(malformed)).toThrow(
      GenerationCandidateValidationError,
    );
  });
});
