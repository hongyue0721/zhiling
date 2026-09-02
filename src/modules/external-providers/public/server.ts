import {
  createExternalProviderRuntime as createInternalExternalProviderRuntime,
  type ExternalProviderRuntimeDependencies as InternalRuntimeDependencies,
} from "../infrastructure/runtime";
import { readExternalProviderEnvironment as readEnvironment } from "../infrastructure/config";
import {
  EXTERNAL_PROVIDER_VERSIONS,
  ExternalProviderError,
  type ExternalProviderEnvironment,
  type ExternalProviderRuntime,
} from "./contracts";

export type ExternalProviderRuntimeDependencies = Readonly<{
  environment: ExternalProviderEnvironment;
  fetch?: typeof fetch;
  now?: () => Date | number;
}>;

export function readExternalProviderEnvironment(
  source?: Readonly<Record<string, unknown>>,
): ExternalProviderEnvironment {
  return readEnvironment(source);
}

export function createExternalProviderRuntime(
  dependencies: ExternalProviderRuntimeDependencies,
): ExternalProviderRuntime {
  try {
    const runtime = createInternalExternalProviderRuntime(
      dependencies as InternalRuntimeDependencies,
    );
    return { ...runtime, versions: EXTERNAL_PROVIDER_VERSIONS };
  } catch (error) {
    if (error instanceof ExternalProviderError) {
      throw error;
    }
    throw new ExternalProviderError({
      provider: "source",
      code: "temporarily_unavailable",
      retryable: true,
    });
  }
}

export type {
  ExternalProviderEnvironment,
  ExternalProviderErrorCode,
  ExternalProviderErrorOptions,
  ExternalProviderKind,
  ExternalProviderRuntime,
  ExternalProviderVersions,
  ExtractViewpointsInput,
  ExtractViewpointsResult,
  GenerateAssessmentsInput,
  GenerateAssessmentsResult,
  GeneratedAssessment,
  GenerationDirection,
  NormalizedSource,
  PlanDirectionsInput,
  PlanDirectionsResult,
  SourceAuthorityLevel,
  SourceContentType,
  SourceSearchAccess,
  SourceSearchInput,
  SourceSearchResult,
  StructureMapInput,
  StructureMapNode,
  StructureMapPrerequisite,
  StructuredMap,
  StructuredViewpoint,
  StructuredModelAccess,
} from "./contracts";

export {
  EXTERNAL_PROVIDER_VERSIONS,
  ExternalProviderError,
  sourceAuthorityLevels,
  sourceContentTypes,
} from "./contracts";
