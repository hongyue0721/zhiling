import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  requireIdentity: vi.fn(),
  requestGeneration: vi.fn(),
  getGeneration: vi.fn(),
  readEvents: vi.fn(),
}));

vi.mock("@/bootstrap/server", () => ({
  identity: { require: runtime.requireIdentity },
  generation: {
    requestGeneration: runtime.requestGeneration,
    getGeneration: runtime.getGeneration,
    readEvents: runtime.readEvents,
  },
}));

import { POST as requestGeneration } from "@/app/api/map-generations/route";
import { GET as getGeneration } from "@/app/api/map-generations/[taskId]/route";
import { GET as streamGenerationEvents } from "@/app/api/map-generations/[taskId]/events/route";

const queuedSnapshot = {
  taskId: "task-1",
  status: "queued" as const,
  stage: "queued" as const,
  sequence: 1,
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  deadlineAt: "2026-07-16T00:10:00.000Z",
  result: null,
  failure: null,
};

beforeEach(() => {
  runtime.requireIdentity.mockReset().mockResolvedValue({
    userId: "user-1",
    email: "user@example.com",
    emailVerified: true,
  });
  runtime.requestGeneration.mockReset();
  runtime.getGeneration.mockReset();
  runtime.readEvents.mockReset();
});

describe("map generation HTTP contract", () => {
  it("creates a generation request with a private 202 response", async () => {
    const result = { reuse: "created", snapshot: queuedSnapshot } as const;
    runtime.requestGeneration.mockResolvedValue(result);

    const response = await requestGeneration(
      new Request("https://example.test/api/map-generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: "概率论" }),
      }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(await response.json()).toEqual(result);
    expect(runtime.requestGeneration).toHaveBeenCalledWith("user-1", "概率论");
  });

  it("rejects malformed topics before calling the generation service", async () => {
    const response = await requestGeneration(
      new Request("https://example.test/api/map-generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: "   " }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "invalid_request",
        issues: [{ path: "/topic" }],
      },
    });
    expect(runtime.requestGeneration).not.toHaveBeenCalled();
  });

  it("treats an unauthorized task as nonexistent", async () => {
    runtime.getGeneration.mockResolvedValue(null);

    const response = await getGeneration(new Request("https://example.test"), {
      params: Promise.resolve({ taskId: "task-not-visible" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "resource_not_found" },
    });
    expect(runtime.getGeneration).toHaveBeenCalledWith(
      "user-1",
      "task-not-visible",
    );
  });

  it("streams a history-unavailable snapshot and does not expose unsafe fields", async () => {
    runtime.readEvents.mockResolvedValue({
      kind: "snapshot",
      snapshot: {
        ...queuedSnapshot,
        status: "succeeded",
        stage: "publishing",
        sequence: 4,
        result: {
          mapId: "map-1",
          versionId: "version-1",
          learningRelationshipId: "relationship-1",
        },
      },
      events: [],
    });

    const response = await streamGenerationEvents(
      new Request("https://example.test/events", {
        headers: { "last-event-id": "3" },
      }),
      { params: Promise.resolve({ taskId: "task-1" }) },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("id: 4");
    expect(body).toContain("event: snapshot");
    expect(body).toContain('"protocolVersion":"1"');
    expect(body).toContain('"learningRelationshipId":"relationship-1"');
    expect(body).not.toContain("candidate");
    expect(body).not.toContain("https://");
    expect(runtime.readEvents).toHaveBeenCalledWith("user-1", "task-1", 3);
  });

  it("replays a terminal event after Last-Event-ID and closes the stream", async () => {
    runtime.readEvents.mockResolvedValue({
      kind: "events",
      events: [
        {
          taskId: "task-1",
          sequence: 8,
          type: "failed",
          occurredAt: "2026-07-16T00:00:08.000Z",
          data: {
            status: "failed",
            stage: "planning",
            code: "source_unavailable",
            candidate: "should-not-leak",
            url: "https://private.example/source",
          },
        },
      ],
    });

    const response = await streamGenerationEvents(
      new Request("https://example.test/events", {
        headers: { "last-event-id": "7" },
      }),
      { params: Promise.resolve({ taskId: "task-1" }) },
    );
    const body = await response.text();

    expect(body).toContain("id: 8");
    expect(body).toContain("event: failed");
    expect(body).toContain('"code":"source_unavailable"');
    expect(body).not.toContain("should-not-leak");
    expect(body).not.toContain("https://private.example");
    expect(runtime.readEvents).toHaveBeenCalledWith("user-1", "task-1", 7);
  });

  it("closes with a safe succeeded snapshot at the exact terminal cursor", async () => {
    runtime.readEvents.mockResolvedValue({
      kind: "snapshot",
      snapshot: {
        ...queuedSnapshot,
        status: "succeeded",
        stage: "publishing",
        sequence: 8,
        result: {
          mapId: "map-1",
          versionId: "version-1",
          learningRelationshipId: "relationship-for-user-1",
        },
        completedAt: "2026-07-16T00:00:08.000Z",
      },
      events: [],
    });

    const response = await streamGenerationEvents(
      new Request("https://example.test/events", {
        headers: { "last-event-id": "8" },
      }),
      { params: Promise.resolve({ taskId: "task-1" }) },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("id: 8");
    expect(body).toContain("event: snapshot");
    expect(body).toContain('"status":"succeeded"');
    expect(body).toContain(
      '"learningRelationshipId":"relationship-for-user-1"',
    );
    expect(body).not.toContain("candidate");
    expect(body).not.toContain("https://");
    expect(runtime.readEvents).toHaveBeenCalledWith("user-1", "task-1", 8);
    expect(runtime.readEvents).toHaveBeenCalledTimes(1);
  });

  it("closes with a safe failed snapshot at the exact terminal cursor", async () => {
    runtime.readEvents.mockResolvedValue({
      kind: "snapshot",
      snapshot: {
        ...queuedSnapshot,
        status: "failed",
        stage: "planning",
        sequence: 8,
        result: null,
        failure: {
          code: "candidate_invalid",
          retryable: false,
        },
        completedAt: "2026-07-16T00:00:08.000Z",
      },
      events: [],
    });

    const response = await streamGenerationEvents(
      new Request("https://example.test/events", {
        headers: { "last-event-id": "8" },
      }),
      { params: Promise.resolve({ taskId: "task-1" }) },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("id: 8");
    expect(body).toContain("event: snapshot");
    expect(body).toContain('"status":"failed"');
    expect(body).toContain('"code":"candidate_invalid"');
    expect(body).not.toContain("candidate-data");
    expect(body).not.toContain("https://");
    expect(runtime.readEvents).toHaveBeenCalledWith("user-1", "task-1", 8);
    expect(runtime.readEvents).toHaveBeenCalledTimes(1);
  });
});
