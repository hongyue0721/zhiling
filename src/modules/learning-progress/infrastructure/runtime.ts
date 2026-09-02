import "server-only";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { databaseSchema } from "@/platform/database/schema";

import type { LearningProgressMapReader } from "../application/learning-progress";
import { LearningProgressService } from "../application/learning-progress";
import { DrizzleLearningProgressRepository } from "./drizzle-learning-progress";

export type LearningProgressRuntimeDependencies = Readonly<{
  database: NodePgDatabase<typeof databaseSchema>;
  mapReader: LearningProgressMapReader;
}>;

export type InternalLearningProgressRuntime = Readonly<{
  progress: LearningProgressService;
}>;

export function createLearningProgressRuntime({
  database,
  mapReader,
}: LearningProgressRuntimeDependencies): InternalLearningProgressRuntime {
  const repository = new DrizzleLearningProgressRepository(database);
  return { progress: new LearningProgressService(repository, mapReader) };
}
