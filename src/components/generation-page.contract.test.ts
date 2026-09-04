import { describe, expect, it } from "vitest";

import {
  formatElapsed,
  readProgress,
  readServerTimestamp,
} from "./generation-page";

describe("generation page progress contract", () => {
  it("reads server facts needed for the visible recovery state", () => {
    expect(
      readProgress({
        model: { attempt: 2, maxAttempts: 3 },
        search: { completed: 2, total: 3 },
        supplement: { completed: 1, total: 1 },
        recovery: {
          reason: "model_output_invalid",
          state: "started",
          attempt: 2,
          maxAttempts: 3,
          used: 1,
          limit: 3,
        },
        reusedStages: ["planning", "searching", "unknown"],
      }),
    ).toEqual({
      model: { attempt: 2, maxAttempts: 3 },
      search: { completed: 2, total: 3 },
      supplement: { completed: 1, total: 1 },
      recovery: {
        reason: "model_output_invalid",
        state: "started",
        attempt: 2,
        maxAttempts: 3,
        used: 1,
        limit: 3,
      },
      reusedStages: ["planning", "searching"],
    });
  });
  it("uses the server-created timestamp as the active task time base", () => {
    const createdAt = "2026-09-04T00:00:00.000Z";
    expect(readServerTimestamp(createdAt)).toBe(Date.parse(createdAt));
    expect(readServerTimestamp("not-a-timestamp")).toBeNull();
  });

  it("rejects impossible counters and keeps elapsed time human-readable", () => {
    expect(
      readProgress({
        model: { attempt: 4, maxAttempts: 3 },
        search: { completed: 4, total: 3 },
      }),
    ).toBeNull();
    expect(formatElapsed(0)).toBe("0秒");
    expect(formatElapsed(61_000)).toBe("1分01秒");
  });
});
