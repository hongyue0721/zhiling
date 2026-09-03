import type {
  GenerationClock,
  GenerationHeartbeatScheduler,
  GenerationIdGenerator,
  GenerationProviderVersionInput,
  GenerationProviderVersions,
  GenerationSleeper,
  GenerationProviderBundle,
  GenerationSourceSearchPort,
  GenerationStructuredModelPort,
} from "../application/ports";
import { MapGenerationWorker } from "../application/generation-worker";
import { DrizzleGenerationTaskStore } from "./drizzle-generation-task-store";
import { DrizzleGenerationPublication } from "./drizzle-generation-publication";
import type { MapGenerationDatabase } from "./generation-database";
import {
  createGenerationRateLimitReservation,
  type GenerationRateLimitPolicy,
} from "./rate-limit";

export const DEFAULT_PIPELINE_VERSION = "generation-pipeline-v1";

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
  const versions = runtimeVersions(providerVersions);
  const store = new DrizzleGenerationTaskStore(
    database,
    versions,
    now,
    idGenerator,
    createGenerationRateLimitReservation(rateLimit),
  );
  return {
    generation: {
      requestGeneration: (userId: string, topic: string) =>
        store.requestGeneration(userId, topic),
      getGeneration: (userId: string, taskId: string) =>
        store.getGeneration(userId, taskId),
      readEvents: (userId: string, taskId: string, afterSequence: number) =>
        store.readEvents(userId, taskId, afterSequence),
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
  const versions = runtimeVersions(providerVersions);
  const store = new DrizzleGenerationTaskStore(
    database,
    versions,
    now,
    idGenerator,
  );
  const publication = new DrizzleGenerationPublication(
    database,
    now,
    idGenerator,
  );
  const providers: GenerationProviderBundle = {
    versions,
    sourceSearch,
    structuredModel,
  };
  const worker = new MapGenerationWorker(
    store,
    publication,
    providers,
    now,
    sleep,
    scheduleHeartbeat,
  );
  return { worker };
}
