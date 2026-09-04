import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { databaseSchema } from "./schema";

export type PostgresDatabase = NodePgDatabase<typeof databaseSchema>;

export function createPostgresDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const database = drizzle(pool, { schema: databaseSchema });

  return { database, pool };
}
