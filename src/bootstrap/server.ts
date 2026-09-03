import "server-only";

import {
  createIdentityRuntime,
  readIdentityEnvironment,
  type AuthRouteHandlers,
  type IdentityAccess,
} from "@/modules/identity/public/server";
import {
  createLearningAssessmentRuntime,
  type LearningAssessmentAccess,
} from "@/modules/learning-assessment/public/server";
import {
  createLearningCatalogRuntime,
  type LearningCatalogAccess,
} from "@/modules/learning-catalog/public/server";
import {
  createLearningProgressRuntime,
  type LearningProgressAccess,
} from "@/modules/learning-progress/public/server";
import {
  createLearningReportRuntime,
  type LearningReportAccess,
} from "@/modules/learning-report/public/server";
import { EXTERNAL_PROVIDER_VERSIONS } from "@/modules/external-providers/public/contracts";
import {
  createMapGenerationRuntime,
  readGenerationEnvironment,
  type GenerationAccess,
} from "@/modules/map-generation/public/server";
import { createPostgresDatabase } from "@/platform/database/postgres";

export type ServerRuntime = Readonly<{
  generation: GenerationAccess;
  generationRequestsEnabled: boolean;
  registrationEnabled: boolean;
  identity: IdentityAccess;
  authHandlers: AuthRouteHandlers;
  learningCatalog: LearningCatalogAccess;
  learningAssessment: LearningAssessmentAccess;
  learningProgress: LearningProgressAccess;
  learningReport: LearningReportAccess;
}>;

let serverRuntime: ServerRuntime | undefined;

function createServerRuntime(): ServerRuntime {
  const environment = readIdentityEnvironment();
  const generationEnvironment = readGenerationEnvironment();
  const localDemoMode = process.env.ZHIJING_DEMO_MODE === "1";
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
    rateLimit: generationEnvironment.rateLimit,
  });

  return {
    generation: mapGenerationRuntime.generation,
    generationRequestsEnabled: !localDemoMode,
    registrationEnabled: !localDemoMode,
    identity: identityRuntime.identity,
    authHandlers: identityRuntime.authHandlers,
    learningCatalog: learningCatalogRuntime.catalog,
    learningAssessment: learningAssessmentRuntime.assessment,
    learningProgress: learningProgressRuntime.progress,
    learningReport: learningReportRuntime.report,
  };
}

export function getServerRuntime(): ServerRuntime {
  if (!serverRuntime) {
    serverRuntime = createServerRuntime();
  }
  return serverRuntime;
}
