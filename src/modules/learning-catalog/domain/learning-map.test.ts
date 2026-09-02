import { describe, expect, it } from "vitest";

import {
  LearningMapInvariantError,
  validateLearningMapPublication,
  type LearningMapPublication,
} from "./learning-map";

function publication(nodeCount = 5): LearningMapPublication {
  const sources = Array.from({ length: nodeCount }, (_, index) => ({
    sourceId: `source-${index}`,
    title: `Source ${index}`,
    excerpt: `Evidence excerpt ${index}`,
    url: `https://www.zhihu.com/source/${index}`,
    authorName: `Author ${index}`,
  }));
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    nodeId: `node-${index}`,
    title: `Node ${index}`,
    learningObjective: `Understand ${index}`,
    sourceIds: [`source-${index}`],
    viewpoints: [
      {
        viewpointId: `viewpoint-${index}`,
        kind: "consensus" as const,
        statement: `Statement ${index}`,
        conditions: null,
        sourceIds: [`source-${index}`],
      },
    ],
  }));

  return {
    mapId: "map-1",
    versionId: "version-1",
    title: "Map",
    summary: "Summary",
    featuredPosition: 1,
    nodes,
    sources,
    prerequisites: nodes.slice(1).map((node, index) => ({
      nodeId: node.nodeId,
      prerequisiteNodeId: nodes[index]?.nodeId ?? "",
    })),
  };
}

function expectInvariant(
  candidate: LearningMapPublication,
  code: LearningMapInvariantError["code"],
) {
  try {
    validateLearningMapPublication(candidate);
    throw new Error("Expected publication validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(LearningMapInvariantError);
    expect((error as LearningMapInvariantError).code).toBe(code);
  }
}

describe("learning map publication invariants", () => {
  it.each([5, 7])("accepts a valid %i-node evidence DAG", (nodeCount) => {
    expect(
      validateLearningMapPublication(publication(nodeCount)),
    ).toBeDefined();
  });

  it.each([4, 8])("rejects a %i-node version", (nodeCount) => {
    expectInvariant(publication(nodeCount), "invalid_node_count");
  });

  it("rejects every missing publication fact and non-integer position", () => {
    const candidate = publication();
    expectInvariant({ ...candidate, mapId: " " }, "invalid_map_id");
    expectInvariant({ ...candidate, versionId: "" }, "invalid_version_id");
    expectInvariant({ ...candidate, title: " " }, "invalid_map_title");
    expectInvariant({ ...candidate, summary: "" }, "invalid_map_summary");
    expectInvariant(
      { ...candidate, featuredPosition: 1.5 },
      "invalid_featured_position",
    );
    const firstNode = candidate.nodes[0]!;
    expectInvariant(
      {
        ...candidate,
        nodes: [{ ...firstNode, nodeId: " " }, ...candidate.nodes.slice(1)],
      },
      "invalid_node_id",
    );
    expectInvariant(
      {
        ...candidate,
        nodes: [{ ...firstNode, title: "" }, ...candidate.nodes.slice(1)],
      },
      "invalid_node_title",
    );
    expectInvariant(
      {
        ...candidate,
        nodes: [
          { ...firstNode, learningObjective: " " },
          ...candidate.nodes.slice(1),
        ],
      },
      "invalid_learning_objective",
    );
    expectInvariant(
      {
        ...candidate,
        sources: [
          { ...candidate.sources[0]!, sourceId: "" },
          ...candidate.sources.slice(1),
        ],
      },
      "invalid_source_id",
    );
    const firstViewpoint = firstNode.viewpoints[0]!;
    expectInvariant(
      {
        ...candidate,
        nodes: [
          {
            ...firstNode,
            viewpoints: [{ ...firstViewpoint, viewpointId: " " }],
          },
          ...candidate.nodes.slice(1),
        ],
      },
      "invalid_viewpoint_id",
    );
    expectInvariant(
      {
        ...candidate,
        nodes: [
          {
            ...firstNode,
            viewpoints: [{ ...firstViewpoint, statement: "" }],
          },
          ...candidate.nodes.slice(1),
        ],
      },
      "invalid_viewpoint_statement",
    );
    expectInvariant(
      {
        ...candidate,
        nodes: [
          {
            ...firstNode,
            viewpoints: [
              {
                ...firstViewpoint,
                kind: "unknown" as typeof firstViewpoint.kind,
              },
            ],
          },
          ...candidate.nodes.slice(1),
        ],
      },
      "invalid_viewpoint_kind",
    );
    expectInvariant(
      {
        ...candidate,
        nodes: [
          {
            ...firstNode,
            viewpoints: [{ ...firstViewpoint, conditions: " " }],
          },
          ...candidate.nodes.slice(1),
        ],
      },
      "invalid_viewpoint_conditions",
    );
  });

  it.each([
    "http://www.zhihu.com/question/1",
    "https://example.com/question/1",
    "https://zhihu.com.evil.example/question/1",
    " https://www.zhihu.com/question/1",
    "https://www.zhihu.com/question/1 ",
    "https://user@www.zhihu.com/question/1",
    "https://www.zhihu.com:8443/question/1",
  ])("rejects a non-canonical Zhihu source URL: %s", (url) => {
    const candidate = publication();
    expectInvariant(
      {
        ...candidate,
        sources: [
          { ...candidate.sources[0]!, url },
          ...candidate.sources.slice(1),
        ],
      },
      "invalid_source",
    );
  });

  it("returns a deep snapshot and does not share caller-owned arrays", () => {
    const candidate = publication();
    const snapshot = validateLearningMapPublication(candidate);
    const mutableCandidate = candidate as unknown as {
      nodes: Array<{
        title: string;
        sourceIds: string[];
        viewpoints: Array<{ sourceIds: string[] }>;
      }>;
      sources: Array<{ title: string }>;
    };
    mutableCandidate.nodes[0]!.sourceIds.push("later-source");
    mutableCandidate.nodes[0]!.viewpoints[0]!.sourceIds.push("later-source");
    mutableCandidate.nodes[0]!.title = "Mutated";
    mutableCandidate.sources[0]!.title = "Mutated";

    expect(snapshot.nodes[0]?.title).toBe("Node 0");
    expect(snapshot.nodes[0]?.sourceIds).toEqual(["source-0"]);
    expect(snapshot.nodes[0]?.viewpoints[0]?.sourceIds).toEqual(["source-0"]);
    expect(snapshot.sources[0]?.title).toBe("Source 0");
  });

  it("rejects duplicate and cross-map node references", () => {
    const candidate = publication();
    expectInvariant(
      {
        ...candidate,
        nodes: [
          candidate.nodes[0]!,
          candidate.nodes[0]!,
          ...candidate.nodes.slice(2),
        ],
      },
      "duplicate_node",
    );
    expectInvariant(
      {
        ...candidate,
        prerequisites: [
          { nodeId: "node-1", prerequisiteNodeId: "other-map-node" },
        ],
      },
      "unknown_node_reference",
    );
  });

  it("allows the same viewpointId on different nodes", () => {
    const candidate = publication();
    const secondNode = candidate.nodes[1]!;
    const repeatedId = candidate.nodes[0]!.viewpoints[0]!.viewpointId;
    const firstNode = candidate.nodes[0]!;
    expectInvariant(
      {
        ...candidate,
        nodes: [
          {
            ...firstNode,
            viewpoints: [firstNode.viewpoints[0]!, firstNode.viewpoints[0]!],
          },
          ...candidate.nodes.slice(1),
        ],
      },
      "duplicate_viewpoint",
    );
    expect(() =>
      validateLearningMapPublication({
        ...candidate,
        nodes: [
          candidate.nodes[0]!,
          {
            ...secondNode,
            viewpoints: [
              { ...secondNode.viewpoints[0]!, viewpointId: repeatedId },
            ],
          },
          ...candidate.nodes.slice(2),
        ],
      }),
    ).not.toThrow();
  });

  it("rejects self, duplicate, and cyclic prerequisites", () => {
    const candidate = publication();
    expectInvariant(
      {
        ...candidate,
        prerequisites: [{ nodeId: "node-1", prerequisiteNodeId: "node-1" }],
      },
      "self_prerequisite",
    );
    const edge = { nodeId: "node-1", prerequisiteNodeId: "node-0" };
    expectInvariant(
      { ...candidate, prerequisites: [edge, edge] },
      "duplicate_prerequisite",
    );
    expectInvariant(
      {
        ...candidate,
        prerequisites: [
          { nodeId: "node-1", prerequisiteNodeId: "node-0" },
          { nodeId: "node-0", prerequisiteNodeId: "node-1" },
        ],
      },
      "cyclic_prerequisites",
    );
  });

  it("rejects nodes without real, existing sources", () => {
    const candidate = publication();
    expectInvariant(
      {
        ...candidate,
        nodes: [
          { ...candidate.nodes[0]!, sourceIds: [] },
          ...candidate.nodes.slice(1),
        ],
      },
      "node_without_source",
    );
    expectInvariant(
      {
        ...candidate,
        nodes: [
          { ...candidate.nodes[0]!, sourceIds: ["missing-source"] },
          ...candidate.nodes.slice(1),
        ],
      },
      "unknown_source_reference",
    );
    expectInvariant(
      {
        ...candidate,
        sources: [
          { ...candidate.sources[0]!, url: "not-a-real-http-url" },
          ...candidate.sources.slice(1),
        ],
      },
      "invalid_source",
    );
  });

  it("rejects unsupported viewpoint evidence relationships", () => {
    const candidate = publication();
    const first = candidate.nodes[0]!;
    const viewpoint = first.viewpoints[0]!;
    expectInvariant(
      {
        ...candidate,
        nodes: [
          { ...first, viewpoints: [{ ...viewpoint, sourceIds: [] }] },
          ...candidate.nodes.slice(1),
        ],
      },
      "viewpoint_without_source",
    );
    expectInvariant(
      {
        ...candidate,
        nodes: [
          {
            ...first,
            viewpoints: [{ ...viewpoint, sourceIds: ["missing-source"] }],
          },
          ...candidate.nodes.slice(1),
        ],
      },
      "unknown_source_reference",
    );
    expectInvariant(
      {
        ...candidate,
        nodes: [
          { ...first, viewpoints: [{ ...viewpoint, sourceIds: ["source-1"] }] },
          ...candidate.nodes.slice(1),
        ],
      },
      "unknown_viewpoint_source",
    );
  });

  it("requires disagreement conditions", () => {
    const candidate = publication();
    const first = candidate.nodes[0]!;
    expectInvariant(
      {
        ...candidate,
        nodes: [
          {
            ...first,
            viewpoints: [
              {
                ...first.viewpoints[0]!,
                kind: "disagreement",
                conditions: " ",
              },
            ],
          },
          ...candidate.nodes.slice(1),
        ],
      },
      "invalid_viewpoint_conditions",
    );
    expectInvariant(
      {
        ...candidate,
        nodes: [
          {
            ...first,
            viewpoints: [
              {
                ...first.viewpoints[0]!,
                kind: "disagreement",
                conditions: null,
              },
            ],
          },
          ...candidate.nodes.slice(1),
        ],
      },
      "invalid_viewpoint_conditions",
    );
  });
});
