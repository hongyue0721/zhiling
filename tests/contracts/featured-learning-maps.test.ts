import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormalIdentityRequiredError } from "@/modules/identity/public/server";

const runtime = vi.hoisted(() => ({
  requireIdentity: vi.fn(),
  listFeatured: vi.fn(),
  listLearningRelationships: vi.fn(),
  findFeatured: vi.fn(),
  findByLearningRelationship: vi.fn(),
  establishFeaturedLearningRelationship: vi.fn(),
}));

vi.mock("@/bootstrap/server", () => ({
  getServerRuntime: () => ({
    identity: { require: runtime.requireIdentity },
    learningCatalog: {
      listFeatured: runtime.listFeatured,
      listLearningRelationships: runtime.listLearningRelationships,
      findFeatured: runtime.findFeatured,
      findByLearningRelationship: runtime.findByLearningRelationship,
      establishFeaturedLearningRelationship:
        runtime.establishFeaturedLearningRelationship,
    },
  }),
}));

import { POST as establishFeaturedLearningRelationship } from "@/app/api/featured-learning-maps/[mapId]/learning-relationship/route";
import { GET as getFeaturedDetail } from "@/app/api/featured-learning-maps/[mapId]/route";
import { GET as listFeaturedMaps } from "@/app/api/featured-learning-maps/route";
import { GET as listLearningRelationships } from "@/app/api/learning-relationships/route";
import { GET as getRelationshipMap } from "@/app/api/learning-relationships/[learningRelationshipId]/map/route";

const detail = {
  mapId: "map-1",
  versionId: "version-2",
  title: "Map",
  summary: "Summary",
  nodes: Array.from({ length: 5 }, (_, index) => ({
    nodeId: `node-${index}`,
    title: `Node ${index}`,
    learningObjective: `Learn ${index}`,
    sourceIds: [`source-${index}`],
  })),
  prerequisites: Array.from({ length: 4 }, (_, index) => ({
    nodeId: `node-${index + 1}`,
    prerequisiteNodeId: `node-${index}`,
  })),
  sources: Array.from({ length: 5 }, (_, index) => ({
    sourceId: `source-${index}`,
    title: `Source ${index}`,
    excerpt: `Evidence ${index}`,
    url: `https://www.zhihu.com/question/${index}`,
    authorName: `Author ${index}`,
  })),
  viewpoints: Array.from({ length: 5 }, (_, index) => ({
    viewpointId: `viewpoint-${index}`,
    nodeId: `node-${index}`,
    kind: "consensus" as const,
    statement: `Statement ${index}`,
    conditions: null,
    sourceIds: [`source-${index}`],
  })),
};

beforeEach(() => {
  runtime.requireIdentity.mockReset().mockResolvedValue({
    userId: "user-1",
    email: "user@example.com",
    emailVerified: true,
  });
  runtime.listFeatured.mockReset();
  runtime.listLearningRelationships.mockReset();
  runtime.findFeatured.mockReset();
  runtime.findByLearningRelationship.mockReset();
  runtime.establishFeaturedLearningRelationship.mockReset();
});

describe("featured learning map HTTP contract", () => {
  it("returns the frozen list envelope without internal position", async () => {
    runtime.listFeatured.mockResolvedValue([
      {
        mapId: "map-1",
        versionId: "version-2",
        title: "Map",
        summary: "Summary",
        nodeCount: 5,
      },
    ]);

    const response = await listFeaturedMaps(
      new Request("http://localhost/api/featured-learning-maps"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      items: [
        {
          mapId: "map-1",
          versionId: "version-2",
          title: "Map",
          summary: "Summary",
          nodeCount: 5,
        },
      ],
    });
  });

  it("returns the stable detail DTO for a featured published map", async () => {
    runtime.findFeatured.mockResolvedValue(detail);

    const response = await getFeaturedDetail(
      new Request("http://localhost/api/featured-learning-maps/map-1"),
      { params: Promise.resolve({ mapId: "map-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(detail);
    expect(runtime.findFeatured).toHaveBeenCalledWith("map-1");
  });

  it("uses the same safe 404 for missing, draft, and non-featured maps", async () => {
    runtime.findFeatured.mockResolvedValue(null);

    const response = await getFeaturedDetail(
      new Request("http://localhost/api/featured-learning-maps/hidden"),
      { params: Promise.resolve({ mapId: "hidden" }) },
    );
    const body = (await response.json()) as {
      error: { code: string; requestId: string };
    };

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.error.code).toBe("resource_not_found");
    expect(body.error.requestId).toMatch(/^req_[0-9a-f]{32}$/);
  });

  it("requires formal identity and never reflects a supplied request id", async () => {
    runtime.requireIdentity.mockRejectedValue(
      new FormalIdentityRequiredError(),
    );
    const suppliedRequestId = "attacker-controlled-request-id";

    const response = await listFeaturedMaps(
      new Request("http://localhost/api/featured-learning-maps", {
        headers: { "x-request-id": suppliedRequestId },
      }),
    );
    const body = (await response.json()) as {
      error: { code: string; requestId: string };
    };

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.error.code).toBe("authentication_required");
    expect(body.error.requestId).not.toBe(suppliedRequestId);
    expect(runtime.listFeatured).not.toHaveBeenCalled();
  });

  it("maps unexpected failures to a correlated safe 500 response and log", async () => {
    const sensitiveMessage = "password=secret sql=private-provider-body";
    runtime.listFeatured.mockRejectedValue(new Error(sensitiveMessage));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await listFeaturedMaps(
      new Request("http://localhost/api/featured-learning-maps"),
    );
    const body = (await response.json()) as {
      error: { code: string; requestId: string };
    };
    const logged = log.mock.calls[0]?.[0] as {
      event: string;
      requestId: string;
      errorType: string;
    };

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.error.code).toBe("internal_error");
    expect(logged).toEqual({
      event: "business_api_unexpected_error",
      requestId: body.error.requestId,
      errorType: "Error",
    });
    expect(JSON.stringify(body)).not.toContain(sensitiveMessage);
    expect(JSON.stringify(logged)).not.toContain(sensitiveMessage);
    log.mockRestore();
  });
});

describe("learning relationship HTTP contract", () => {
  it("establishes the current featured version without a client payload", async () => {
    runtime.establishFeaturedLearningRelationship.mockResolvedValue({
      learningRelationshipId: "learning-1",
      mapId: "map-1",
      versionId: "version-2",
    });

    const response = await establishFeaturedLearningRelationship(
      new Request(
        "http://localhost/api/featured-learning-maps/map-1/learning-relationship",
        { method: "POST" },
      ),
      { params: Promise.resolve({ mapId: "map-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      learningRelationshipId: "learning-1",
      mapId: "map-1",
      versionId: "version-2",
    });
    expect(runtime.establishFeaturedLearningRelationship).toHaveBeenCalledWith(
      "user-1",
      "map-1",
    );
  });

  it("hides missing, non-featured, and incomplete question-set joins", async () => {
    runtime.establishFeaturedLearningRelationship.mockResolvedValue(null);

    const response = await establishFeaturedLearningRelationship(
      new Request(
        "http://localhost/api/featured-learning-maps/hidden/learning-relationship",
        { method: "POST" },
      ),
      { params: Promise.resolve({ mapId: "hidden" }) },
    );
    const body = (await response.json()) as {
      error: { code: string; requestId: string };
    };

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.error.code).toBe("resource_not_found");
    expect(body.error.requestId).toMatch(/^req_[0-9a-f]{32}$/);
  });

  it("lists only the current account's relationship summaries", async () => {
    runtime.listLearningRelationships.mockResolvedValue([
      {
        learningRelationshipId: "learning-1",
        mapId: "map-1",
        versionId: "version-2",
        title: "Map",
        summary: "Summary",
      },
    ]);

    const response = await listLearningRelationships(
      new Request("http://localhost/api/learning-relationships"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({
      items: [
        {
          learningRelationshipId: "learning-1",
          mapId: "map-1",
          versionId: "version-2",
          title: "Map",
          summary: "Summary",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("userId");
    expect(runtime.listLearningRelationships).toHaveBeenCalledWith("user-1");
  });
});

describe("learning relationship map HTTP contract", () => {
  it("returns the relationship map for its account", async () => {
    runtime.findByLearningRelationship.mockResolvedValue(detail);

    const response = await getRelationshipMap(
      new Request("http://localhost/api/learning-relationships/learning-1/map"),
      {
        params: Promise.resolve({
          learningRelationshipId: "learning-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
    expect(runtime.findByLearningRelationship).toHaveBeenCalledWith(
      "user-1",
      "learning-1",
    );
  });

  it("returns resource_not_found when the account has no matching relationship", async () => {
    runtime.findByLearningRelationship.mockResolvedValue(null);

    const response = await getRelationshipMap(
      new Request(
        "http://localhost/api/learning-relationships/learning-other/map",
      ),
      {
        params: Promise.resolve({
          learningRelationshipId: "learning-other",
        }),
      },
    );
    const body = (await response.json()) as {
      error: { code: string };
    };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("resource_not_found");
  });
});
