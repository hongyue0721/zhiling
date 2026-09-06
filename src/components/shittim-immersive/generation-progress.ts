import type {
  GenerationProgress,
  GenerationSnapshot,
} from "@/components/contracts";

/** Stage names the server may report as "reused" for a completed task. */
const generationStages = [
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

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function readServerTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function readResult(
  value: unknown,
): GenerationSnapshot["result"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  if (
    !("mapId" in value) ||
    !("versionId" in value) ||
    !("learningRelationshipId" in value)
  ) {
    return null;
  }
  const mapId = readString(value.mapId);
  const versionId = readString(value.versionId);
  const learningRelationshipId = readString(value.learningRelationshipId);
  return mapId && versionId && learningRelationshipId
    ? { mapId, versionId, learningRelationshipId }
    : null;
}

export function readProgress(value: unknown): GenerationProgress | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const progress: {
    model?: GenerationProgress["model"];
    search?: GenerationProgress["search"];
    supplement?: GenerationProgress["supplement"];
    recovery?: GenerationProgress["recovery"];
    reusedStages?: GenerationProgress["reusedStages"];
  } = {};
  const model =
    typeof record.model === "object" &&
    record.model !== null &&
    !Array.isArray(record.model)
      ? (record.model as Record<string, unknown>)
      : null;
  if (
    model &&
    isSafeInteger(model.attempt) &&
    model.maxAttempts === 3 &&
    model.attempt >= 1 &&
    model.attempt <= model.maxAttempts
  ) {
    progress.model = {
      attempt: model.attempt,
      maxAttempts: model.maxAttempts,
    };
  }
  const readCounts = (
    candidate: unknown,
  ): { completed: number; total: number } | undefined => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      return undefined;
    }
    const counts = candidate as Record<string, unknown>;
    return isSafeInteger(counts.completed) &&
      isSafeInteger(counts.total) &&
      counts.completed >= 0 &&
      counts.total >= counts.completed
      ? { completed: counts.completed, total: counts.total }
      : undefined;
  };
  const search = readCounts(record.search);
  const supplement = readCounts(record.supplement);
  if (search) progress.search = search;
  if (supplement) progress.supplement = supplement;
  const recovery =
    typeof record.recovery === "object" &&
    record.recovery !== null &&
    !Array.isArray(record.recovery)
      ? (record.recovery as Record<string, unknown>)
      : null;
  if (
    recovery &&
    recovery.reason === "model_output_invalid" &&
    (recovery.state === "started" || recovery.state === "exhausted") &&
    isSafeInteger(recovery.attempt) &&
    recovery.maxAttempts === 3 &&
    isSafeInteger(recovery.used) &&
    recovery.limit === 3 &&
    recovery.attempt >= 1 &&
    recovery.attempt <= recovery.maxAttempts &&
    recovery.used >= 0 &&
    recovery.used <= recovery.limit
  ) {
    progress.recovery = {
      reason: "model_output_invalid",
      state: recovery.state,
      attempt: recovery.attempt,
      maxAttempts: recovery.maxAttempts,
      used: recovery.used,
      limit: recovery.limit,
    };
  }
  if (Array.isArray(record.reusedStages)) {
    const reusedStages = record.reusedStages.filter(
      (
        stage,
      ): stage is NonNullable<GenerationProgress["reusedStages"]>[number] =>
        typeof stage === "string" &&
        generationStages.some((knownStage) => knownStage === stage),
    );
    if (reusedStages.length > 0) progress.reusedStages = reusedStages;
  }
  return Object.keys(progress).length > 0 ? progress : null;
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0
    ? `${minutes}分${String(remainder).padStart(2, "0")}秒`
    : `${remainder}秒`;
}
