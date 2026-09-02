import { describe, expect, it } from "vitest";

import type { LearningMapPublication } from "../domain/learning-map";
import {
  PublishFeaturedLearningMap,
  type LearningMapPublisher,
} from "./learning-catalog";

function publication(): LearningMapPublication {
  const sources = Array.from({ length: 5 }, (_, index) => ({
    sourceId: `source-${index}`,
    title: `Source ${index}`,
    excerpt: `Excerpt ${index}`,
    url: `https://www.zhihu.com/question/${index}`,
    authorName: `Author ${index}`,
  }));
  return {
    mapId: "map-1",
    versionId: "version-1",
    title: "Map",
    summary: "Summary",
    featuredPosition: 1,
    sources,
    nodes: sources.map((source, index) => ({
      nodeId: `node-${index}`,
      title: `Node ${index}`,
      learningObjective: `Objective ${index}`,
      sourceIds: [source.sourceId],
      viewpoints: [
        {
          viewpointId: `viewpoint-${index}`,
          kind: "consensus",
          statement: `Statement ${index}`,
          conditions: null,
          sourceIds: [source.sourceId],
        },
      ],
    })),
    prerequisites: [{ nodeId: "node-1", prerequisiteNodeId: "node-0" }],
  };
}

describe("featured publication use case", () => {
  it("passes an isolated validated snapshot across the async publisher boundary", async () => {
    let persisted: LearningMapPublication | undefined;
    const publisher: LearningMapPublisher = {
      async publishFeatured(snapshot) {
        await Promise.resolve();
        persisted = snapshot;
      },
    };
    const input = publication();
    const operation = new PublishFeaturedLearningMap(publisher).execute(input);
    const mutableInput = input as unknown as {
      nodes: Array<{ title: string; sourceIds: string[] }>;
      sources: Array<{ title: string }>;
    };

    mutableInput.nodes[0]!.title = "Mutated";
    mutableInput.nodes[0]!.sourceIds.push("later-source");
    mutableInput.sources[0]!.title = "Mutated";
    await operation;

    expect(persisted?.nodes[0]?.title).toBe("Node 0");
    expect(persisted?.nodes[0]?.sourceIds).toEqual(["source-0"]);
    expect(persisted?.sources[0]?.title).toBe("Source 0");
  });
});
