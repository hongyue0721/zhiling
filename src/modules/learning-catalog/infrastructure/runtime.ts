import "server-only";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { databaseSchema } from "@/platform/database/schema";

import { LearningCatalogService } from "../application/learning-catalog";
import { DrizzleLearningCatalogRepository } from "./drizzle-learning-catalog";

export type LearningCatalogRuntimeDependencies = Readonly<{
  database: NodePgDatabase<typeof databaseSchema>;
}>;

export type InternalLearningCatalogRuntime = Readonly<{
  catalog: LearningCatalogService;
}>;

export function createLearningCatalogRuntime({
  database,
}: LearningCatalogRuntimeDependencies): InternalLearningCatalogRuntime {
  const repository = new DrizzleLearningCatalogRepository(database);
  return { catalog: new LearningCatalogService(repository, repository) };
}
