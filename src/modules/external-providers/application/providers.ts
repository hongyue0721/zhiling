import {
  ExternalProviderError,
  sourceAuthorityLevels,
  sourceContentTypes,
} from "../../../shared/kernel/external-provider-contracts";
import type {
  ExternalProviderEnvironment,
  ExternalProviderErrorCode,
  ExternalProviderErrorOptions,
  ExternalProviderKind,
  ExtractViewpointsInput,
  ExtractViewpointsResult,
  GenerateAssessmentsInput,
  GenerateAssessmentsResult,
  GenerationDirection,
  NormalizedSource,
  PlanDirectionsInput,
  PlanDirectionsResult,
  ProviderRuntime as ProviderRuntimeContract,
  SourceAuthorityLevel,
  SourceContentType,
  SourceSearchAccess,
  SourceSearchInput,
  SourceSearchResult,
  StructuredMap,
  StructuredModelAccess,
  StructuredViewpoint,
  StructureMapInput,
  StructureMapNode,
  StructureMapPrerequisite,
} from "../../../shared/kernel/external-provider-contracts";

export type ProviderKind = ExternalProviderKind;
export type ProviderErrorCode = ExternalProviderErrorCode;
export type ProviderErrorOptions = ExternalProviderErrorOptions;

/** Internal error used by infrastructure; public/server.ts translates it. */
export { ExternalProviderError as ProviderRequestError };

export type ProviderEnvironment = ExternalProviderEnvironment;

export const providerSourceContentTypes = sourceContentTypes;
export type ProviderSourceContentType = SourceContentType;
export const providerSourceAuthorityLevels = sourceAuthorityLevels;
export type ProviderSourceAuthorityLevel = SourceAuthorityLevel;

export type ProviderSource = NormalizedSource;
export type ProviderSourceSearchInput = SourceSearchInput;
export type ProviderSourceSearchResult = SourceSearchResult;
export type ProviderSourceSearchAccess = SourceSearchAccess;

export type ProviderGenerationDirection = GenerationDirection;
export type ProviderPlanDirectionsResult = PlanDirectionsResult;
export type ProviderStructureMapNode = StructureMapNode;
export type ProviderStructureMapPrerequisite = StructureMapPrerequisite;
export type ProviderStructuredViewpoint = StructuredViewpoint;
export type ProviderStructuredMap = StructuredMap;
export type ProviderExtractViewpointsResult = ExtractViewpointsResult;
export type ProviderGeneratedAssessment =
  GenerateAssessmentsResult["questions"][number];
export type ProviderGenerateAssessmentsResult = GenerateAssessmentsResult;

export type ProviderPlanDirectionsInput = PlanDirectionsInput;
export type ProviderStructureMapInput = StructureMapInput;
export type ProviderExtractViewpointsInput = ExtractViewpointsInput;
export type ProviderGenerateAssessmentsInput = GenerateAssessmentsInput;
export type ProviderStructuredModelAccess = StructuredModelAccess;
export type ProviderRuntime = ProviderRuntimeContract;
