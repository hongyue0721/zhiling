import { randomUUID } from "node:crypto";

import {
  createExternalProviderRuntime,
  ExternalProviderError,
  readExternalProviderEnvironment,
} from "@/modules/external-providers/public/server";

function readVerificationTopic(
  source: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const topic = source.REAL_API_VERIFY_TOPIC?.trim();
  if (!topic || topic.length > 200) {
    throw new Error(
      "REAL_API_VERIFY_TOPIC must contain between 1 and 200 characters",
    );
  }
  return topic;
}

async function main(): Promise<void> {
  const environment = readExternalProviderEnvironment();
  const providers = createExternalProviderRuntime({ environment });
  const topic = readVerificationTopic();
  const requestId = `real_api_verify_${randomUUID().replaceAll("-", "")}`;

  const search = await providers.sourceSearch.search({
    query: topic,
    count: 3,
    requestId,
    timeoutMs: environment.sourceTimeoutMs,
  });
  const plan = await providers.structuredModel.planDirections({
    topic,
    requestId,
    timeoutMs: environment.modelTimeoutMs,
  });

  console.log(
    JSON.stringify({
      ok: true,
      provider: "zhihu-open-platform",
      sourceCount: search.sources.length,
      directionCount: plan.directions.length,
      versions: providers.versions,
    }),
  );
}

void main().catch((error: unknown) => {
  if (error instanceof ExternalProviderError) {
    console.error(
      JSON.stringify({
        ok: false,
        provider: error.provider,
        code: error.code,
        retryable: error.retryable,
        retryAfterMs: error.retryAfterMs ?? null,
      }),
    );
  } else {
    const errorType =
      error instanceof Error &&
      /^[A-Za-z][A-Za-z0-9_$]{0,63}$/.test(error.constructor.name)
        ? error.constructor.name
        : "UnknownError";
    console.error(JSON.stringify({ ok: false, errorType }));
  }
  process.exitCode = 1;
});
