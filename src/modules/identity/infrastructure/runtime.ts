import "server-only";

import { toNextJsHandler } from "better-auth/next-js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { databaseSchema } from "@/platform/database/schema";

import { IdentityService } from "../application/identity-service";
import { type AuthRouteHandlers, limitAuthRoutes } from "./auth-route-handlers";
import { BetterAuthSessionReader } from "./better-auth-session-reader";
import type { IdentityEnvironment } from "./config";
import { createIdentityAuth } from "./identity-auth";
import { ResendVerificationEmailSender } from "./resend-verification-email-sender";

export type IdentityRuntime = Readonly<{
  identity: IdentityService;
  authHandlers: AuthRouteHandlers;
}>;

export type IdentityRuntimeDependencies = Readonly<{
  database: NodePgDatabase<typeof databaseSchema>;
  environment: IdentityEnvironment;
}>;

export function createIdentityRuntime({
  database,
  environment,
}: IdentityRuntimeDependencies): IdentityRuntime {
  const emailSender = new ResendVerificationEmailSender(
    environment.resendApiKey,
    environment.emailFrom,
  );
  const auth = createIdentityAuth({
    database,
    emailSender,
    secret: environment.secret,
    baseUrl: environment.baseUrl,
    trustedOrigins: environment.trustedOrigins,
    trustedProxies: environment.trustedProxies,
    secureCookies: environment.secureCookies,
  });

  return {
    identity: new IdentityService(
      new BetterAuthSessionReader((headers) =>
        auth.api.getSession({ headers }),
      ),
    ),
    authHandlers: limitAuthRoutes(toNextJsHandler(auth)),
  };
}

export type { AuthRouteHandlers } from "./auth-route-handlers";
