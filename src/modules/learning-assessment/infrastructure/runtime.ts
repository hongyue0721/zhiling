import "server-only";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { databaseSchema } from "@/platform/database/schema";

import type { LearningRelationshipMapReader } from "../application/learning-assessment";
import { LearningAssessmentService } from "../application/learning-assessment";
import type { LearningAssessmentRepository } from "../application/read-model";
import { DrizzleLearningAssessmentRepository } from "./drizzle-learning-assessment";

export type LearningAssessmentRuntimeDependencies = Readonly<{
  database: NodePgDatabase<typeof databaseSchema>;
  mapReader: LearningRelationshipMapReader;
}>;

export type InternalLearningAssessmentRuntime = Readonly<{
  assessment: LearningAssessmentService;
  repository: LearningAssessmentRepository;
}>;

export function createLearningAssessmentRuntime({
  database,
  mapReader,
}: LearningAssessmentRuntimeDependencies): InternalLearningAssessmentRuntime {
  const repository = new DrizzleLearningAssessmentRepository(database);
  return {
    assessment: new LearningAssessmentService(repository, mapReader),
    repository,
  };
}
