import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { databaseSchema } from "./schema";

export function createPostgresDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const database = drizzle(pool, { schema: databaseSchema });

  return { database, pool };
}
