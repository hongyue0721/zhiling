export const generationStatuses = [
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
  "succeeded",
  "failed",
] as const;

export type GenerationStatus = (typeof generationStatuses)[number];
export type GenerationStage = Exclude<GenerationStatus, "succeeded" | "failed">;
export type GenerationState = GenerationStatus;
export const generationStates = generationStatuses;

export const GENERATION_LEASE_MS = 60_000;
export const GENERATION_HEARTBEAT_MS = 15_000;
export const GENERATION_DEADLINE_MS = 10 * 60_000;
export const LOCAL_OPERATION_TIMEOUT_MS = 30_000;
export const MAX_EXTERNAL_RETRIES = 2;

export const generationTransitionTable: Readonly<
  Record<GenerationStatus, readonly GenerationStatus[]>
> = {
  queued: ["normalizing", "failed"],
  normalizing: ["cache_lookup", "failed"],
  cache_lookup: ["planning", "succeeded", "failed"],
  planning: ["searching", "failed"],
  searching: ["structuring", "failed"],
  structuring: ["supplementing", "failed"],
  supplementing: ["extracting", "failed"],
  extracting: ["assessing", "failed"],
  assessing: ["validating", "failed"],
  validating: ["publishing", "failed"],
  publishing: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
};

export class GenerationStateTransitionError extends Error {
  readonly code = "invalid_generation_transition" as const;

  constructor(
    readonly from: GenerationStatus,
    readonly to: GenerationStatus,
  ) {
    super(`Generation state cannot transition from ${from} to ${to}`);
    this.name = "GenerationStateTransitionError";
  }
}

export function canTransitionGenerationState(
  from: GenerationStatus,
  to: GenerationStatus,
): boolean {
  return generationTransitionTable[from].includes(to);
}

export function assertGenerationTransition(
  from: GenerationStatus,
  to: GenerationStatus,
): void {
  if (!canTransitionGenerationState(from, to)) {
    throw new GenerationStateTransitionError(from, to);
  }
}

export function transitionGenerationState(
  from: GenerationStatus,
  to: GenerationStatus,
): GenerationStatus {
  assertGenerationTransition(from, to);
  return to;
}

export function isTerminalGenerationState(
  state: GenerationStatus,
): state is "succeeded" | "failed" {
  return state === "succeeded" || state === "failed";
}

export function isGenerationStage(
  state: GenerationStatus,
): state is GenerationStage {
  return !isTerminalGenerationState(state);
}

export function stageForGenerationStatus(
  status: GenerationStatus,
  previousStage: GenerationStage,
): GenerationStage {
  return isGenerationStage(status) ? status : previousStage;
}
