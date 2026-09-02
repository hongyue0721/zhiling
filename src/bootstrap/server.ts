import "server-only";

import {
  createIdentityRuntime,
  readIdentityEnvironment,
} from "@/modules/identity/public/server";
import { createLearningCatalogRuntime } from "@/modules/learning-catalog/public/server";
import { createPostgresDatabase } from "@/platform/database/postgres";

const environment = readIdentityEnvironment();
const { database } = createPostgresDatabase(environment.databaseUrl);
const identityRuntime = createIdentityRuntime({ database, environment });
const learningCatalogRuntime = createLearningCatalogRuntime({ database });

export const identity = identityRuntime.identity;
export const authHandlers = identityRuntime.authHandlers;
export const learningCatalog = learningCatalogRuntime.catalog;
