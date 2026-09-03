import type {
  GenerationProviderVersionInput,
  MapGenerationDatabase,
  GenerationClock,
  GenerationHeartbeatScheduler,
  GenerationIdGenerator,
  GenerationSleeper,
} from "./drizzle-map-generation";
import {
  DEFAULT_PIPELINE_VERSION,
  DrizzleMapGenerationRepository,
  MapGenerationWorker,
} from "./drizzle-map-generation";
import type {
  GenerationProviderVersions,
  GenerationSourceSearchPort,
  GenerationStructuredModelPort,
} from "../application/ports";

import {
  createGenerationRateLimitReservation,
  type GenerationRateLimitPolicy,
} from "./rate-limit";
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
    sourceSearch: GenerationSourceSearchPort;
    structuredModel: GenerationStructuredModelPort;
    sleep?: GenerationSleeper;
    scheduleHeartbeat?: GenerationHeartbeatScheduler;
  }>;

function runtimeVersions(
  versions: GenerationProviderVersionInput,
): GenerationProviderVersions {
  return {
    pipelineVersion: versions.pipelineVersion ?? DEFAULT_PIPELINE_VERSION,
    sourceAdapterVersion: versions.sourceAdapterVersion,
    modelAdapterVersion: versions.modelAdapterVersion,
  };
}

function runtimeClock(): Date {
  return new Date();
}

function runtimeId(): string {
  return crypto.randomUUID();
}

function runtimeSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function runtimeScheduleHeartbeat(
  callback: () => void,
  milliseconds: number,
): () => void {
  const timer = setInterval(callback, milliseconds);
  return () => clearInterval(timer);
}

export function createMapGenerationRuntime({
  database,
  providerVersions,
  rateLimit,
  now = runtimeClock,
  idGenerator = runtimeId,
}: MapGenerationRuntimeDependencies) {
  const repository = new DrizzleMapGenerationRepository(
    database,
    runtimeVersions(providerVersions),
    now,
    idGenerator,
    createGenerationRateLimitReservation(rateLimit),
  );
  return {
    generation: {
      requestGeneration: (userId: string, topic: string) =>
        repository.requestGeneration(userId, topic),
      getGeneration: (userId: string, taskId: string) =>
        repository.getGeneration(userId, taskId),
      readEvents: (userId: string, taskId: string, afterSequence: number) =>
        repository.readEvents(userId, taskId, afterSequence),
    },
  };
}

export function createMapGenerationWorkerRuntime({
  database,
  providerVersions,
  sourceSearch,
  structuredModel,
  now = runtimeClock,
  idGenerator = runtimeId,
  sleep = runtimeSleep,
  scheduleHeartbeat = runtimeScheduleHeartbeat,
}: MapGenerationWorkerRuntimeDependencies) {
  const repository = new DrizzleMapGenerationRepository(
    database,
    runtimeVersions(providerVersions),
    now,
    idGenerator,
  );
  const worker = new MapGenerationWorker(
    repository,
    sourceSearch,
    structuredModel,
    now,
    sleep,
    scheduleHeartbeat,
  );
  return { worker };
}
