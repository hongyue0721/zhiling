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

export const generationFailureCategories = [
  "invalid_topic",
  "source_unavailable",
  "source_insufficient",
  "model_unavailable",
  "model_output_invalid",
  "candidate_invalid",
  "generation_timeout",
  "internal_failure",
] as const;

export type GenerationFailureCategory =
  (typeof generationFailureCategories)[number];

export type GenerationIdentity = Readonly<{
  normalizedTopic: string;
  pipelineVersion: string;
  sourceAdapterVersion: string;
  modelAdapterVersion: string;
}>;

export type GenerationFailure = Readonly<{
  code: GenerationFailureCategory;
  retryable: boolean;
}>;
export type GenerationProgress = Readonly<{
  model?: Readonly<{ attempt: number; maxAttempts: 3 }>;
  search?: Readonly<{ completed: number; total: number }>;
  supplement?: Readonly<{ completed: number; total: number }>;
  recovery?: Readonly<{
    reason: "model_output_invalid";
    state: "started" | "exhausted";
    attempt: number;
    maxAttempts: 3;
    used: number;
    limit: 3;
  }>;
  reusedStages?: readonly GenerationStage[];
}>;

export type GenerationResult = Readonly<{
  mapId: string;
  versionId: string;
  learningRelationshipId: string;
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
  progress?: GenerationProgress;
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

export type GenerationRuntimeVersions = Readonly<{
  pipelineVersion: string;
  sourceAdapterVersion: string;
  modelAdapterVersion: string;
}>;

export type SourceContentType = "answer" | "article" | "question";
export type SourceAuthorityLevel = "low" | "medium" | "high" | "very_high";

export type GenerationSource = Readonly<{
  sourceId: string;
  title: string;
  excerpt: string;
  url: string;
  authorName: string;
  contentType: SourceContentType;
  updatedAt: number;
  authorityLevel: SourceAuthorityLevel;
  rankingScore: number;
}>;

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

export type GenerationDirection = Readonly<{
  directionId: string;
  title: string;
  objective: string;
  searchQuery: string;
}>;

export type StructuredMapNode = Readonly<{
  nodeId: string;
  title: string;
  learningObjective: string;
  sourceIds: readonly string[];
}>;

export type StructuredMap = Readonly<{
  title: string;
  summary: string;
  nodes: readonly StructuredMapNode[];
  prerequisites: readonly Readonly<{
    nodeId: string;
    prerequisiteNodeId: string;
  }>[];
  viewpoints?: readonly StructuredViewpoint[];
}>;

export type StructuredViewpoint = Readonly<{
  viewpointId: string;
  nodeId: string;
  kind: "consensus" | "disagreement" | "practical_experience" | "supplementary";
  statement: string;
  conditions: string | null;
  sourceIds: readonly string[];
}>;

export type StructuredAssessmentQuestion = Readonly<{
  questionId: string;
  nodeId: string;
  type: "single_choice" | "multiple_choice" | "matching" | "opinion_analysis";
  prompt: string;
  explanation: string;
  options: readonly Readonly<{ optionId: string; label: string }>[];
  correctOptionIds?: readonly string[];
  correctMatches?: readonly Readonly<{
    leftOptionId: string;
    rightOptionId: string;
  }>[];
  sourceIds: readonly string[];
}>;

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
      /** Restrict this request to questions for one assessment batch. */
      targetNodeIds?: readonly string[];
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
