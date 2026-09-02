import { z } from "zod";

export type EnvironmentIssue = Readonly<{
  path: string;
  code: string;
}>;

export class EnvironmentConfigurationError extends Error {
  readonly issues: readonly EnvironmentIssue[];

  constructor(scope: string, issues: readonly EnvironmentIssue[]) {
    const locations = issues.map(({ path }) => path).join(", ");
    super(`Invalid ${scope} environment configuration: ${locations}`);
    this.name = "EnvironmentConfigurationError";
    this.issues = issues;
  }
}

export function parseEnvironment<Schema extends z.ZodType>(
  scope: string,
  schema: Schema,
  source: unknown,
): z.output<Schema> {
  const result = schema.safeParse(source);

  if (result.success) {
    return result.data;
  }

  throw new EnvironmentConfigurationError(
    scope,
    result.error.issues.map((issue) => ({
      path: issue.path.length === 0 ? "<root>" : issue.path.join("."),
      code: issue.code,
    })),
  );
}
