import { describe, expect, it, vi } from "vitest";

import type { LearningMapPublication } from "../domain/learning-map";
import {
  LearningCatalogService,
  PublishFeaturedLearningMap,
  type LearningMapPublisher,
} from "./learning-catalog";
import type {
  LearningCatalogReader,
  LearningRelationshipWriter,
} from "./read-model";

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

describe("learning relationship use case", () => {
  it("delegates featured establishment with the account and stable map identity", async () => {
    const reader: LearningCatalogReader = {
      listFeatured: async () => [],
      listLearningRelationships: async () => [],
      findFeatured: async () => null,
      findByLearningRelationship: async () => null,
    };
    const relationship = {
      learningRelationshipId: "learning-1",
      mapId: "map-1",
      versionId: "version-1",
      questionSetId: "question-set-1",
    };
    const relationshipWriter: LearningRelationshipWriter = {
      establish: async () => null,
      establishFeatured: vi.fn().mockResolvedValue(relationship),
    };
    const service = new LearningCatalogService(reader, relationshipWriter);

    await expect(
      service.establishFeaturedLearningRelationship("user-1", "map-1"),
    ).resolves.toEqual(relationship);
    expect(relationshipWriter.establishFeatured).toHaveBeenCalledWith(
      "user-1",
      "map-1",
    );
  });
});
