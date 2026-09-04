import "server-only";

import { toNextJsHandler } from "better-auth/next-js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { databaseSchema } from "@/platform/database/schema";

import type { VerificationEmailSender } from "../application/ports";
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

function createEmailSender(
  environment: IdentityEnvironment,
): VerificationEmailSender | undefined {
  if (!environment.emailVerificationEnabled) {
    return undefined;
  }
  if (!environment.resendApiKey || !environment.emailFrom) {
    throw new Error("Email verification environment is incomplete");
  }
  return new ResendVerificationEmailSender(
    environment.resendApiKey,
    environment.emailFrom,
  );
}

export function createIdentityRuntime({
  database,
  environment,
}: IdentityRuntimeDependencies): IdentityRuntime {
  const auth = createIdentityAuth({
    database,
    emailSender: createEmailSender(environment),
    emailVerificationEnabled: environment.emailVerificationEnabled,
    secret: environment.secret,
    baseUrl: environment.baseUrl,
    trustedOrigins: environment.trustedOrigins,
    trustedProxies: environment.trustedProxies,
    secureCookies: environment.secureCookies,
  });
  const sessionReader = new BetterAuthSessionReader((headers) =>
    auth.api.getSession({ headers }),
  );

  return {
    identity: new IdentityService(sessionReader, {
      emailVerificationEnabled: environment.emailVerificationEnabled,
    }),
    authHandlers: limitAuthRoutes(toNextJsHandler(auth), {
      emailVerificationEnabled: environment.emailVerificationEnabled,
    }),
  };
}

export type { AuthRouteHandlers } from "./auth-route-handlers";
