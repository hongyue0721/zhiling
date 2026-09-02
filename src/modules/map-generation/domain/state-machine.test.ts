import { describe, expect, it } from "vitest";

import {
  assertGenerationTransition,
  canTransitionGenerationState,
  GenerationStateTransitionError,
} from "./state-machine";

describe("generation state machine", () => {
  it("accepts only the ordered pipeline transitions", () => {
    const pipeline = [
      "queued",
      "normalizing",
      "cache_lookup",
      "planning",
      "searching",
      "structuring",
      "supplementing",
      "extracting",
      "assessing",
      "validating",
      "publishing",
    ] as const;
    for (const [index, state] of pipeline.entries()) {
      const next = pipeline[index + 1];
      if (next) {
        expect(canTransitionGenerationState(state, next)).toBe(true);
      }
    }
    expect(canTransitionGenerationState("publishing", "succeeded")).toBe(true);
    expect(canTransitionGenerationState("queued", "failed")).toBe(true);
    expect(canTransitionGenerationState("succeeded", "queued")).toBe(false);
  });

  it.each([
    ["queued", "planning"],
    ["planning", "assessing"],
    ["succeeded", "failed"],
    ["failed", "queued"],
  ] as const)("rejects an illegal transition %s -> %s", (from, to) => {
    expect(() => assertGenerationTransition(from, to)).toThrow(
      GenerationStateTransitionError,
    );
  });
});
