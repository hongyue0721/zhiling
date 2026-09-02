import { z } from "zod";

import { EnvironmentConfigurationError, parseEnvironment } from "./environment";

type PublicEnvironmentKey = `NEXT_PUBLIC_${string}`;

export function readPublicEnvironment<
  const Shape extends Record<PublicEnvironmentKey, z.ZodType>,
>(
  shape: Shape,
  source: { readonly [Key in keyof Shape]: unknown },
): z.output<z.ZodObject<Shape>> {
  const privateKeys = Object.keys(shape).filter(
    (key) => !key.startsWith("NEXT_PUBLIC_"),
  );

  if (privateKeys.length > 0) {
    throw new EnvironmentConfigurationError(
      "client",
      privateKeys.map((path) => ({ path, code: "private_key" })),
    );
  }

  return parseEnvironment("client", z.object(shape), source);
}
