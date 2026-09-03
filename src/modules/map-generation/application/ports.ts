import type {
  GenerationCandidate,
  GenerationDirectionCandidate,
  GenerationMapCandidate,
  GenerationQuestionCandidate,
  GenerationSourceAuthorityLevel,
  GenerationSourceCandidate,
  GenerationSourceContentType,
  GenerationViewpointCandidate,
} from "../domain/candidate";
import {
  generationStates,
  generationStatuses,
  type GenerationStage,
  type GenerationState,
  type GenerationStatus,
} from "../domain/state-machine";
import type { GenerationIdentity } from "../domain/identity";

export { generationStates, generationStatuses };
export type { GenerationStage, GenerationState, GenerationStatus };

export const generationFailureCategories = [
  "invalid_topic",
  "source_unavailable",
  "source_insufficient",
  "model_unavailable",
  "candidate_invalid",
  "generation_timeout",
  "internal_failure",
] as const;

export type GenerationFailureCategory =
  (typeof generationFailureCategories)[number];

export type GenerationFailure = Readonly<{
  code: GenerationFailureCategory;
  retryable: boolean;
}>;

export type GenerationResult = Readonly<{
  mapId: string;
  versionId: string;
  learningRelationshipId: string;
}>;

export type GenerationEventType =
  "snapshot" | "progress" | "succeeded" | "failed";

export type GenerationEvent = Readonly<{
  taskId: string;
  sequence: number;
  type: GenerationEventType;
  occurredAt: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type GenerationSnapshot = Readonly<{
  taskId: string;
  status: GenerationStatus;
  stage: GenerationStage;
  sequence: number;
  createdAt: string;
  updatedAt: string;
  deadlineAt: string;
  result: GenerationResult | null;
  failure: GenerationFailure | null;
  completedAt: string | null;
}>;

export type GenerationEventsResult = Readonly<
  | {
      kind: "events";
      events: readonly GenerationEvent[];
    }
  | {
      kind: "snapshot";
      snapshot: GenerationSnapshot;
      events: readonly GenerationEvent[];
    }
>;

export type GenerationRequestResult = Readonly<{
  reuse: "created" | "active_task" | "cache";
  snapshot: GenerationSnapshot;
}>;

export type GenerationSource = GenerationSourceCandidate;
export type SourceContentType = GenerationSourceContentType;
export type SourceAuthorityLevel = GenerationSourceAuthorityLevel;

export type SourceSearchAccess = Readonly<{
  search(
    input: Readonly<{
      query: string;
      count: number;
      requestId: string;
      timeoutMs: number;
    }>,
  ): Promise<
    Readonly<{ searchId: string; sources: readonly GenerationSource[] }>
  >;
}>;

export type GenerationDirection = GenerationDirectionCandidate;
export type StructuredMapNode = GenerationMapCandidate["nodes"][number];
export type StructuredMap = GenerationMapCandidate;
export type StructuredViewpoint = GenerationViewpointCandidate;
export type StructuredAssessmentQuestion = GenerationQuestionCandidate;

export type StructuredModelAccess = Readonly<{
  planDirections(
    input: Readonly<{
      topic: string;
      requestId: string;
      timeoutMs: number;
    }>,
  ): Promise<Readonly<{ directions: readonly GenerationDirection[] }>>;
  structureMap(
    input: Readonly<{
      topic: string;
      directions: readonly GenerationDirection[];
      sources: readonly GenerationSource[];
      requestId: string;
      timeoutMs: number;
    }>,
  ): Promise<StructuredMap>;
  extractViewpoints(
    input: Readonly<{
      topic: string;
      map: StructuredMap;
      sources: readonly GenerationSource[];
      requestId: string;
      timeoutMs: number;
    }>,
  ): Promise<Readonly<{ viewpoints: readonly StructuredViewpoint[] }>>;
  generateAssessments(
    input: Readonly<{
      topic: string;
      map: StructuredMap &
        Readonly<{ viewpoints?: readonly StructuredViewpoint[] }>;
      sources: readonly GenerationSource[];
      requestId: string;
      timeoutMs: number;
    }>,
  ): Promise<Readonly<{ questions: readonly StructuredAssessmentQuestion[] }>>;
}>;

export type GenerationAccess = Readonly<{
  requestGeneration(
    userId: string,
    topic: string,
  ): Promise<GenerationRequestResult>;
  getGeneration(
    userId: string,
    taskId: string,
  ): Promise<GenerationSnapshot | null>;
  readEvents(
    userId: string,
    taskId: string,
    afterSequence: number,
  ): Promise<GenerationEventsResult | null>;
}>;

export type GenerationWorkerAccess = Readonly<{
  runOnce(workerId: string): Promise<boolean>;
}>;

export type GenerationProviderVersions = Readonly<{
  pipelineVersion: string;
  sourceAdapterVersion: string;
  modelAdapterVersion: string;
}>;

export type GenerationRuntimeVersions = GenerationProviderVersions;

export type GenerationProviderVersionInput = Readonly<{
  pipelineVersion?: string;
  sourceAdapterVersion: string;
  modelAdapterVersion: string;
}>;

export type GenerationSourceSearchPort = SourceSearchAccess;
export type GenerationStructuredModelPort = StructuredModelAccess;

export type GenerationProviderBundle = Readonly<{
  versions: GenerationProviderVersions;
  sourceSearch: GenerationSourceSearchPort;
  structuredModel: GenerationStructuredModelPort;
}>;

export type GenerationIdGenerator = () => string;
export type GenerationClock = () => Date;
export type GenerationSleeper = (milliseconds: number) => Promise<void>;
export type GenerationHeartbeatScheduler = (
  callback: () => void,
  milliseconds: number,
) => () => void;

export type GenerationTask = Readonly<{
  id: string;
  topic: string;
  normalizedTopic: string;
  pipelineVersion: string;
  sourceAdapterVersion: string;
  modelAdapterVersion: string;
  status: GenerationStatus;
  stage: GenerationStage;
  sequence: number;
  deadlineAt: Date;
  nextAttemptAt: Date;
  retryCount: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  heartbeatAt: Date | null;
  mapId: string | null;
  versionId: string | null;
  questionSetId: string | null;
  failureCode: GenerationFailureCategory | null;
  failureRetryable: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}>;

export type GenerationCheckpoint = Readonly<{
  taskId: string;
  stage: GenerationStage;
  operationKey: string;
  input: unknown;
  output: unknown;
  attemptCount: number;
  completedAt: Date | null;
  updatedAt: Date;
}>;

export type GenerationCache = Readonly<{
  taskId: string;
  mapId: string;
  versionId: string;
  questionSetId: string;
}>;

export interface GenerationRequestPort {
  requestGeneration(
    userId: string,
    topic: string,
  ): Promise<GenerationRequestResult>;
}

export interface GenerationReadPort {
  getGeneration(
    userId: string,
    taskId: string,
  ): Promise<GenerationSnapshot | null>;
  readEvents(
    userId: string,
    taskId: string,
    afterSequence: number,
  ): Promise<GenerationEventsResult | null>;
}

export interface GenerationExecutionPort {
  claimTask(workerId: string): Promise<GenerationTask | null>;
  renewLease(taskId: string, workerId: string): Promise<void>;
  failTask(
    taskId: string,
    workerId: string,
    failure: GenerationTaskFailure,
  ): Promise<void>;
  recordAttempt(
    taskId: string,
    workerId: string,
    stage: GenerationStage,
    operationKey: string,
    input: unknown,
  ): Promise<number>;
  resetAttempt(
    taskId: string,
    workerId: string,
    stage: GenerationStage,
    operationKey: string,
  ): Promise<void>;
  completeStage(
    taskId: string,
    workerId: string,
    from: GenerationStatus,
    to: GenerationStatus,
    stage: GenerationStage,
    input: unknown,
    output: unknown,
  ): Promise<void>;
  getCheckpoints(
    taskId: string,
  ): Promise<ReadonlyMap<string, GenerationCheckpoint>>;
  findReusableCache(
    identity: GenerationIdentity,
  ): Promise<GenerationCache | null>;
}

export type GenerationTaskStore = GenerationRequestPort &
  GenerationReadPort &
  GenerationExecutionPort;

export type GenerationPublicationResult = Readonly<{
  mapId: string;
  versionId: string;
  questionSetId: string;
}>;

export interface GenerationPublicationPort {
  publishCandidate(
    taskId: string,
    workerId: string,
    candidate: GenerationCandidate,
  ): Promise<GenerationPublicationResult>;
  completeCachedTask(
    taskId: string,
    workerId: string,
    cache: GenerationCache,
  ): Promise<void>;
}

export class GenerationLeaseLostError extends Error {
  readonly code = "generation_lease_lost" as const;

  constructor() {
    super("Generation task lease is no longer held");
    this.name = "GenerationLeaseLostError";
  }
}

export class GenerationTaskFailure extends Error {
  constructor(
    readonly category: GenerationFailureCategory,
    readonly retryable: boolean,
    message = category,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "GenerationTaskFailure";
  }
}

export type {
  GenerationDirectionCandidate,
  GenerationMapCandidate,
  GenerationQuestionCandidate,
  GenerationSourceCandidate,
  GenerationViewpointCandidate,
};
export type { GenerationIdentity } from "../domain/identity";
