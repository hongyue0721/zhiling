import { z } from "zod";

import { parseEnvironment } from "@/platform/config/environment";

import type { ProviderEnvironment } from "../application/providers";

const externalProviderEnvironmentSchema = z.object({
  ZHIHU_ACCESS_SECRET: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0),
  ZHIHU_MODEL: z.literal("zhida-thinking-1p5"),
  ZHIHU_SOURCE_TIMEOUT_MS: z.coerce.number().int().min(1).max(600_000),
  ZHIHU_MODEL_TIMEOUT_MS: z.coerce.number().int().min(1).max(600_000),
});

export function readExternalProviderEnvironment(
  source: Readonly<Record<string, unknown>> = process.env,
): ProviderEnvironment {
  const parsed = parseEnvironment(
    "external provider",
    externalProviderEnvironmentSchema,
    source,
  );

  return {
    accessSecret: parsed.ZHIHU_ACCESS_SECRET,
    model: parsed.ZHIHU_MODEL,
    sourceTimeoutMs: parsed.ZHIHU_SOURCE_TIMEOUT_MS,
    modelTimeoutMs: parsed.ZHIHU_MODEL_TIMEOUT_MS,
  };
}
