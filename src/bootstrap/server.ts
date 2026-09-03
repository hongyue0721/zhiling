import "server-only";

import {
  createIdentityRuntime,
  readIdentityEnvironment,
} from "@/modules/identity/public/server";
import { createLearningAssessmentRuntime } from "@/modules/learning-assessment/public/server";
import { createLearningCatalogRuntime } from "@/modules/learning-catalog/public/server";
import { createLearningProgressRuntime } from "@/modules/learning-progress/public/server";
import { createLearningReportRuntime } from "@/modules/learning-report/public/server";
import { createPostgresDatabase } from "@/platform/database/postgres";
import { EXTERNAL_PROVIDER_VERSIONS } from "@/modules/external-providers/public/contracts";
import { createMapGenerationRuntime } from "@/modules/map-generation/public/server";

const environment = readIdentityEnvironment();
const { database } = createPostgresDatabase(environment.databaseUrl);
const identityRuntime = createIdentityRuntime({ database, environment });
const learningCatalogRuntime = createLearningCatalogRuntime({ database });
const learningAssessmentRuntime = createLearningAssessmentRuntime({
  database,
  mapReader: learningCatalogRuntime.catalog,
});
const learningProgressRuntime = createLearningProgressRuntime({
  database,
  mapReader: learningCatalogRuntime.catalog,
});
const learningReportRuntime = createLearningReportRuntime({
  mapReader: learningCatalogRuntime.catalog,
  progressReader: learningProgressRuntime.progress,
});
const mapGenerationRuntime = createMapGenerationRuntime({
  database,
  providerVersions: EXTERNAL_PROVIDER_VERSIONS,
});

export const generation = mapGenerationRuntime.generation;

export const identity = identityRuntime.identity;
export const authHandlers = identityRuntime.authHandlers;
export const learningCatalog = learningCatalogRuntime.catalog;
export const learningAssessment = learningAssessmentRuntime.assessment;
export const learningProgress = learningProgressRuntime.progress;
export const learningReport = learningReportRuntime.report;
