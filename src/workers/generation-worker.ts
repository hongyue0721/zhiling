import { hostname } from "node:os";
import { z } from "zod";

import {
  createExternalProviderRuntime,
  readExternalProviderEnvironment,
} from "@/modules/external-providers/public/server";
import { createMapGenerationWorkerRuntime } from "@/modules/map-generation/public/server";
import { createPostgresDatabase } from "@/platform/database/postgres";
import { parseEnvironment } from "@/platform/config/environment";

const workerEnvironmentSchema = {
  DATABASE_URL: z.url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "postgres:" || protocol === "postgresql:";
  }),
  GENERATION_WORKER_ID: z.string().trim().min(1).optional(),
} as const;

const idleWaitMs = 1_000;

function readWorkerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Readonly<{
  databaseUrl: string;
  workerId: string;
}> {
  const values = parseEnvironment(
    "generation worker",
    z.object(workerEnvironmentSchema),
    source,
  );
  return {
    databaseUrl: values.DATABASE_URL,
    workerId: values.GENERATION_WORKER_ID ?? `generation-worker-${hostname()}`,
  };
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function errorType(error: unknown): string {
  const constructorName =
    error instanceof Error ? error.constructor.name : "NonError";
  return /^[A-Za-z][A-Za-z0-9_$]{0,63}$/.test(constructorName)
    ? constructorName
    : "UnknownError";
}

export async function runGenerationWorker(): Promise<void> {
  const externalEnvironment = readExternalProviderEnvironment();
  const workerEnvironment = readWorkerEnvironment();
  const { database, pool } = createPostgresDatabase(
    workerEnvironment.databaseUrl,
  );
  const providerRuntime = createExternalProviderRuntime({
    environment: externalEnvironment,
  });
  const { worker } = createMapGenerationWorkerRuntime({
    database,
    providerVersions: providerRuntime.versions,
    sourceSearch: providerRuntime.sourceSearch,
    structuredModel: providerRuntime.structuredModel,
  });

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  try {
    while (!stopping) {
      const didWork = await worker.runOnce(workerEnvironment.workerId);
      if (!didWork && !stopping) {
        await waitFor(idleWaitMs);
      }
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await pool.end();
  }
}

function startedAsEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return (
    entrypoint !== undefined && entrypoint.endsWith("generation-worker.ts")
  );
}

if (startedAsEntrypoint()) {
  runGenerationWorker().catch((error: unknown) => {
    console.error({
      event: "generation_worker_startup_failed",
      errorType: errorType(error),
    });
    process.exitCode = 1;
  });
}
