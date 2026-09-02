import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to generate or apply migrations");
}

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/platform/database/auth-schema.ts",
    "./src/platform/database/catalog-schema.ts",
    "./src/platform/database/assessment-schema.ts",
    "./src/platform/database/progress-schema.ts",
  ],
  out: "./drizzle",
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
