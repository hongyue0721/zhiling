import "server-only";

import { createProductionIdentityRuntime } from "@/modules/identity/public/server";

const runtime = createProductionIdentityRuntime();

export const identity = runtime.identity;
export const authHandlers = runtime.authHandlers;
