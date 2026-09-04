import { z } from "zod";

import { parseEnvironment } from "@/platform/config/environment";

import type { GenerationRateLimitPolicy } from "./rate-limit";

const positiveInteger = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value > 0);

const generationEnvironmentSchema = {
  GENERATION_RATE_LIMIT_WINDOW_SECONDS: positiveInteger,
  GENERATION_RATE_LIMIT_MAX_REQUESTS: positiveInteger,
} as const;

export type GenerationEnvironment = Readonly<{
  rateLimit: GenerationRateLimitPolicy;
}>;

export function readGenerationEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): GenerationEnvironment {
  const values = parseEnvironment(
    "map generation",
    z.object(generationEnvironmentSchema),
    source,
  );
  return {
    rateLimit: {
      windowSeconds: values.GENERATION_RATE_LIMIT_WINDOW_SECONDS,
      maxRequests: values.GENERATION_RATE_LIMIT_MAX_REQUESTS,
    },
  };
}
