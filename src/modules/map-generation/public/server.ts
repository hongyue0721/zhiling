import {
  createMapGenerationRuntime as createInternalMapGenerationRuntime,
  createMapGenerationWorkerRuntime as createInternalMapGenerationWorkerRuntime,
  type MapGenerationRuntimeDependencies as InternalRuntimeDependencies,
  type MapGenerationWorkerRuntimeDependencies as InternalWorkerRuntimeDependencies,
} from "../infrastructure/runtime";
import type {
  GenerationAccess,
  GenerationRequestResult,
  GenerationEventsResult,
  GenerationSnapshot,
  GenerationWorkerAccess,
  SourceSearchAccess,
  StructuredModelAccess,
} from "./contracts";
import type {
  GenerationProviderVersionInput,
  GenerationClock,
  GenerationHeartbeatScheduler,
  GenerationIdGenerator,
  GenerationSleeper,
  MapGenerationDatabase,
} from "../infrastructure/drizzle-map-generation";
import type { GenerationRateLimitPolicy } from "../infrastructure/rate-limit";

export type MapGenerationRuntimeDependencies = Readonly<{
  database: MapGenerationDatabase;
  providerVersions: GenerationProviderVersionInput;
  rateLimit: GenerationRateLimitPolicy;
  now?: GenerationClock;
  idGenerator?: GenerationIdGenerator;
}>;
export type MapGenerationWorkerRuntimeDependencies = Omit<
  MapGenerationRuntimeDependencies,
  "rateLimit"
> &
  Readonly<{
    sourceSearch: SourceSearchAccess;
    structuredModel: StructuredModelAccess;
    sleep?: GenerationSleeper;
    scheduleHeartbeat?: GenerationHeartbeatScheduler;
  }>;

export type MapGenerationRuntime = Readonly<{
  generation: GenerationAccess;
}>;

export type MapGenerationWorkerRuntime = Readonly<{
  worker: GenerationWorkerAccess;
}>;

export function createMapGenerationRuntime(
  dependencies: MapGenerationRuntimeDependencies,
): MapGenerationRuntime {
  const runtime = createInternalMapGenerationRuntime(
    dependencies as InternalRuntimeDependencies,
  );
  const generation: GenerationAccess = {
    requestGeneration: async (
      userId,
      topic,
    ): Promise<GenerationRequestResult> =>
      runtime.generation.requestGeneration(userId, topic),
    getGeneration: async (userId, taskId): Promise<GenerationSnapshot | null> =>
      runtime.generation.getGeneration(userId, taskId),
    readEvents: async (
      userId,
      taskId,
      afterSequence,
    ): Promise<GenerationEventsResult | null> =>
      runtime.generation.readEvents(userId, taskId, afterSequence),
  };
  return { generation };
}

export function createMapGenerationWorkerRuntime(
  dependencies: MapGenerationWorkerRuntimeDependencies,
): MapGenerationWorkerRuntime {
  const runtime = createInternalMapGenerationWorkerRuntime(
    dependencies as InternalWorkerRuntimeDependencies,
  );
  const worker: GenerationWorkerAccess = {
    runOnce: (workerId) => runtime.worker.runOnce(workerId),
  };
  return { worker };
}

export type {
  GenerationAccess,
  GenerationDirection,
  GenerationEvent,
  GenerationEventsResult,
  GenerationFailure,
  GenerationProgress,
  GenerationRequestResult,
  GenerationResult,
  GenerationRuntimeVersions,
  GenerationSnapshot,
  GenerationSource,
  GenerationStatus,
  SourceSearchAccess,
  StructuredAssessmentQuestion,
  StructuredMap,
  StructuredModelAccess,
  StructuredViewpoint,
} from "./contracts";

export type { GenerationProviderVersionInput } from "../infrastructure/drizzle-map-generation";

export {
  readGenerationEnvironment,
  type GenerationEnvironment,
} from "../infrastructure/config";
