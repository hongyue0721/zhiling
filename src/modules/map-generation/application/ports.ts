import type {
  GenerationDirectionCandidate,
  GenerationMapCandidate,
  GenerationQuestionCandidate,
  GenerationSourceCandidate,
  GenerationViewpointCandidate,
} from "../domain/candidate";

export type GenerationProviderVersions = Readonly<{
  pipelineVersion: string;
  sourceAdapterVersion: string;
  modelAdapterVersion: string;
}>;

export interface GenerationSourceSearchPort {
  search(
    input: Readonly<{
      query: string;
      count: number;
      requestId: string;
      timeoutMs: number;
    }>,
  ): Promise<
    Readonly<{
      searchId: string;
      sources: readonly GenerationSourceCandidate[];
    }>
  >;
}

export interface GenerationStructuredModelPort {
  planDirections(
    input: Readonly<{
      topic: string;
      requestId: string;
      timeoutMs: number;
    }>,
  ): Promise<
    Readonly<{
      directions: readonly GenerationDirectionCandidate[];
    }>
  >;
  structureMap(
    input: Readonly<{
      topic: string;
      directions: readonly GenerationDirectionCandidate[];
      sources: readonly GenerationSourceCandidate[];
      requestId: string;
      timeoutMs: number;
    }>,
  ): Promise<GenerationMapCandidate>;
  extractViewpoints(
    input: Readonly<{
      topic: string;
      map: GenerationMapCandidate;
      sources: readonly GenerationSourceCandidate[];
      requestId: string;
      timeoutMs: number;
    }>,
  ): Promise<
    Readonly<{
      viewpoints: readonly GenerationViewpointCandidate[];
    }>
  >;
  generateAssessments(
    input: Readonly<{
      topic: string;
      map: GenerationMapCandidate;
      sources: readonly GenerationSourceCandidate[];
      requestId: string;
      timeoutMs: number;
    }>,
  ): Promise<
    Readonly<{
      questions: readonly GenerationQuestionCandidate[];
    }>
  >;
}
