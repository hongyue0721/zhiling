import "server-only";

import { z } from "zod";

import { parseEnvironment } from "./environment";

export function readServerEnvironment<const Shape extends z.ZodRawShape>(
  shape: Shape,
  source: NodeJS.ProcessEnv = process.env,
): z.output<z.ZodObject<Shape>> {
  return parseEnvironment("server", z.object(shape), source);
}
