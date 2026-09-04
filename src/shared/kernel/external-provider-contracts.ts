export const EXTERNAL_PROVIDER_VERSIONS = Object.freeze({
  sourceAdapterVersion: "zhihu-http-2026-07-16-v2",
  modelAdapterVersion: "zhida-thinking-1p5-json-2026-09-04-v3",
} as const);

export type ExternalProviderVersions = typeof EXTERNAL_PROVIDER_VERSIONS;
export type ExternalProviderKind = "source" | "model";
export type ExternalProviderErrorCode =
  | "invalid_request"
  | "authentication_failed"
  | "rate_limited"
  | "quota_exhausted"
  | "temporarily_unavailable"
  | "timeout"
  | "protocol_error";

export type ExternalProviderErrorOptions = Readonly<{
  provider: ExternalProviderKind;
  code: ExternalProviderErrorCode;
  retryable: boolean;
  retryAfterMs?: number;
}>;

export class ExternalProviderError extends Error {
  readonly provider: ExternalProviderKind;
  readonly code: ExternalProviderErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(options: ExternalProviderErrorOptions) {
    super(`Provider request failed: ${options.code}`);
    this.name = "ExternalProviderError";
    this.provider = options.provider;
    this.code = options.code;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type ExternalProviderEnvironment = Readonly<{
  accessSecret: string;
  model: "zhida-thinking-1p5";
  sourceTimeoutMs: number;
  modelTimeoutMs: number;
}>;

export const sourceContentTypes = ["answer", "article", "question"] as const;
export type SourceContentType = (typeof sourceContentTypes)[number];

export const sourceAuthorityLevels = [
  "low",
  "medium",
  "high",
  "very_high",
] as const;
export type SourceAuthorityLevel = (typeof sourceAuthorityLevels)[number];

export type NormalizedSource = Readonly<{
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

export type SourceSearchInput = Readonly<{
  query: string;
  count: number;
  requestId: string;
  timeoutMs: number;
}>;

export type SourceSearchResult = Readonly<{
  searchId: string;
  sources: readonly NormalizedSource[];
}>;

export type SourceSearchAccess = Readonly<{
  search(input: SourceSearchInput): Promise<SourceSearchResult>;
}>;

export type GenerationDirection = Readonly<{
  directionId: string;
  title: string;
  objective: string;
  searchQuery: string;
}>;

export type PlanDirectionsResult = Readonly<{
  directions: readonly GenerationDirection[];
}>;

export type StructureMapNode = Readonly<{
  nodeId: string;
  title: string;
  learningObjective: string;
  sourceIds: readonly string[];
}>;

export type StructureMapPrerequisite = Readonly<{
  nodeId: string;
  prerequisiteNodeId: string;
}>;

export type StructuredViewpoint = Readonly<{
  viewpointId: string;
  nodeId: string;
  kind: "consensus" | "disagreement" | "practical_experience" | "supplementary";
  statement: string;
  conditions: string | null;
  sourceIds: readonly string[];
}>;

export type StructuredMap = Readonly<{
  title: string;
  summary: string;
  nodes: readonly StructureMapNode[];
  prerequisites: readonly StructureMapPrerequisite[];
  viewpoints?: readonly StructuredViewpoint[];
}>;

export type ExtractViewpointsResult = Readonly<{
  viewpoints: readonly StructuredViewpoint[];
}>;

export type GeneratedAssessment = Readonly<{
  questionId: string;
  nodeId: string;
  type: "single_choice" | "multiple_choice" | "matching" | "opinion_analysis";
  prompt: string;
  explanation: string;
  options: readonly Readonly<{
    optionId: string;
    label: string;
  }>[];
  correctOptionIds?: readonly string[];
  correctMatches?: readonly Readonly<{
    leftOptionId: string;
    rightOptionId: string;
  }>[];
  sourceIds: readonly string[];
}>;

export type GenerateAssessmentsResult = Readonly<{
  questions: readonly GeneratedAssessment[];
}>;

export type PlanDirectionsInput = Readonly<{
  topic: string;
  requestId: string;
  timeoutMs: number;
}>;

export type StructureMapInput = Readonly<{
  topic: string;
  directions: readonly GenerationDirection[];
  sources: readonly NormalizedSource[];
  requestId: string;
  timeoutMs: number;
}>;

export type ExtractViewpointsInput = Readonly<{
  topic: string;
  map: StructuredMap;
  sources: readonly NormalizedSource[];
  requestId: string;
  timeoutMs: number;
}>;

export type GenerateAssessmentsInput = Readonly<{
  topic: string;
  map: StructuredMap;
  sources: readonly NormalizedSource[];
  requestId: string;
  timeoutMs: number;
}>;

export type StructuredModelAccess = Readonly<{
  planDirections(input: PlanDirectionsInput): Promise<PlanDirectionsResult>;
  structureMap(input: StructureMapInput): Promise<StructuredMap>;
  extractViewpoints(
    input: ExtractViewpointsInput,
  ): Promise<ExtractViewpointsResult>;
  generateAssessments(
    input: GenerateAssessmentsInput,
  ): Promise<GenerateAssessmentsResult>;
}>;

export type ProviderRuntime = Readonly<{
  sourceSearch: SourceSearchAccess;
  structuredModel: StructuredModelAccess;
}>;

export type ExternalProviderRuntime = Readonly<
  ProviderRuntime & { versions: ExternalProviderVersions }
>;
