import { beforeEach, describe, expect, it, vi } from "vitest";

const internal = vi.hoisted(() => ({
  listFeatured: vi.fn(),
  listLearningRelationships: vi.fn(),
  findFeatured: vi.fn(),
  findByLearningRelationship: vi.fn(),
  establishLearningRelationship: vi.fn(),
  establishFeaturedLearningRelationship: vi.fn(),
}));

vi.mock("../infrastructure/runtime", () => ({
  createLearningCatalogRuntime: () => ({
    catalog: {
      listFeatured: internal.listFeatured,
      listLearningRelationships: internal.listLearningRelationships,
      findFeatured: internal.findFeatured,
      findByLearningRelationship: internal.findByLearningRelationship,
      establishLearningRelationship: internal.establishLearningRelationship,
      establishFeaturedLearningRelationship:
        internal.establishFeaturedLearningRelationship,
    },
  }),
}));

import { createLearningCatalogRuntime } from "./server";

beforeEach(() => {
  internal.listFeatured.mockReset();
  internal.listLearningRelationships.mockReset();
  internal.findFeatured.mockReset();
  internal.findByLearningRelationship.mockReset();
  internal.establishLearningRelationship.mockReset();
  internal.establishFeaturedLearningRelationship.mockReset();
});

describe("learning catalog public server boundary", () => {
  it("deep-copies internal projections into independent public DTOs", async () => {
    const internalSummary = {
      mapId: "map-1",
      versionId: "version-1",
      title: "Map",
      summary: "Summary",
      nodeCount: 5,
    };
    const internalDetail = {
      mapId: "map-1",
      versionId: "version-1",
      title: "Map",
      summary: "Summary",
      nodes: [
        {
          nodeId: "node-1",
          title: "Node",
          learningObjective: "Objective",
          sourceIds: ["source-1"],
        },
      ],
      prerequisites: [{ nodeId: "node-2", prerequisiteNodeId: "node-1" }],
      sources: [
        {
          sourceId: "source-1",
          title: "Source",
          excerpt: "Excerpt",
          url: "https://www.zhihu.com/question/1",
          authorName: "Author",
        },
      ],
      viewpoints: [
        {
          viewpointId: "viewpoint-1",
          nodeId: "node-1",
          kind: "consensus" as const,
          statement: "Statement",
          conditions: null,
          sourceIds: ["source-1"],
        },
      ],
    };
    internal.listFeatured.mockResolvedValue([internalSummary]);
    internal.findFeatured.mockResolvedValue(internalDetail);
    internal.findByLearningRelationship.mockResolvedValue(internalDetail);
    internal.establishLearningRelationship.mockResolvedValue({
      learningRelationshipId: "learning-1",
      mapId: "map-1",
      versionId: "version-1",
    });

    const internalRelationshipSummary = {
      learningRelationshipId: "learning-1",
      mapId: "map-1",
      versionId: "version-1",
      title: "Map",
      summary: "Summary",
    };
    internal.listLearningRelationships.mockResolvedValue([
      internalRelationshipSummary,
    ]);
    internal.establishFeaturedLearningRelationship.mockResolvedValue({
      learningRelationshipId: "learning-1",
      mapId: "map-1",
      versionId: "version-1",
      questionSetId: "question-set-1",
    });
    const runtime = createLearningCatalogRuntime({
      database: undefined as never,
    });

    const summaries = await runtime.catalog.listFeatured();
    const detail = await runtime.catalog.findFeatured("map-1");
    const relationshipDetail = await runtime.catalog.findByLearningRelationship(
      "user-1",
      "learning-1",
    );
    const relationship = await runtime.catalog.establishLearningRelationship(
      "user-1",
      "version-1",
    );

    const relationshipSummaries =
      await runtime.catalog.listLearningRelationships("user-1");
    const featuredRelationship =
      await runtime.catalog.establishFeaturedLearningRelationship(
        "user-1",
        "map-1",
      );
    expect(summaries[0]).toEqual(internalSummary);
    expect(summaries[0]).not.toBe(internalSummary);
    expect(detail).toEqual(internalDetail);
    expect(detail).not.toBe(internalDetail);
    expect(relationshipDetail).toEqual(internalDetail);
    expect(relationshipDetail).not.toBe(internalDetail);
    expect(relationship).toEqual({
      learningRelationshipId: "learning-1",
      mapId: "map-1",
      versionId: "version-1",
    });
    expect(relationshipSummaries[0]).toEqual(internalRelationshipSummary);
    expect(relationshipSummaries[0]).not.toBe(internalRelationshipSummary);
    expect(featuredRelationship).toEqual({
      learningRelationshipId: "learning-1",
      mapId: "map-1",
      versionId: "version-1",
    });
    expect(detail?.nodes).not.toBe(internalDetail.nodes);
    expect(detail?.nodes[0]?.sourceIds).not.toBe(
      internalDetail.nodes[0]?.sourceIds,
    );
    expect(detail?.sources).not.toBe(internalDetail.sources);
    expect(detail?.viewpoints[0]?.sourceIds).not.toBe(
      internalDetail.viewpoints[0]?.sourceIds,
    );

    (detail?.nodes[0]?.sourceIds as string[]).push("public-only");
    expect(internalDetail.nodes[0]?.sourceIds).toEqual(["source-1"]);
  });

  it("keeps an unavailable featured relationship as a public null result", async () => {
    internal.establishFeaturedLearningRelationship.mockResolvedValue(null);
    const runtime = createLearningCatalogRuntime({
      database: undefined as never,
    });

    await expect(
      runtime.catalog.establishFeaturedLearningRelationship(
        "user-1",
        "map-without-complete-assessment",
      ),
    ).resolves.toBeNull();
    expect(internal.establishFeaturedLearningRelationship).toHaveBeenCalledWith(
      "user-1",
      "map-without-complete-assessment",
    );
  });
});
