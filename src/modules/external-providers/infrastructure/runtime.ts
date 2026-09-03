import {
  type ProviderEnvironment as ExternalProviderEnvironment,
  type ProviderRuntime as ExternalProviderRuntime,
} from "../application/providers";
import { createProviderError } from "./provider-http";
import { ZhihuSourceSearch } from "./zhihu-source-search";
import { ZhihuStructuredModel } from "./zhida-structured-model";

export type ExternalProviderRuntimeDependencies = Readonly<{
  environment: ExternalProviderEnvironment;
  fetch?: typeof fetch;
  now?: () => Date | number;
}>;

export function createExternalProviderRuntime({
  environment,
  fetch: fetcher = globalThis.fetch,
  now = () => Date.now(),
}: ExternalProviderRuntimeDependencies): ExternalProviderRuntime {
  if (
    typeof environment.accessSecret !== "string" ||
    environment.accessSecret.trim().length === 0
  ) {
    throw createProviderError("source", "invalid_request");
  }
  if (typeof fetcher !== "function") {
    throw createProviderError("source", "temporarily_unavailable");
  }
  if (environment.model !== "zhida-thinking-1p5") {
    throw createProviderError("model", "invalid_request");
  }
  if (
    !Number.isInteger(environment.sourceTimeoutMs) ||
    environment.sourceTimeoutMs < 1 ||
    environment.sourceTimeoutMs > 600_000 ||
    !Number.isInteger(environment.modelTimeoutMs) ||
    environment.modelTimeoutMs < 1 ||
    environment.modelTimeoutMs > 600_000
  ) {
    throw createProviderError("source", "invalid_request");
  }

  return {
    sourceSearch: new ZhihuSourceSearch(environment, fetcher, now),
    structuredModel: new ZhihuStructuredModel(environment, fetcher, now),
  };
}
