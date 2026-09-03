import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { databaseSchema } from "@/platform/database/schema";

export type MapGenerationDatabase = NodePgDatabase<typeof databaseSchema>;
export type GenerationDatabaseExecutor = MapGenerationDatabase;
export type GenerationDatabaseTransaction = Parameters<
  Parameters<MapGenerationDatabase["transaction"]>[0]
>[0];
