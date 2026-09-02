import "server-only";

import { toNextJsHandler } from "better-auth/next-js";

import { createPostgresDatabase } from "@/platform/database/postgres";

import { IdentityService } from "../application/identity-service";
import { type AuthRouteHandlers, limitAuthRoutes } from "./auth-route-handlers";
import { BetterAuthSessionReader } from "./better-auth-session-reader";
import { readIdentityEnvironment } from "./config";
import { createIdentityAuth } from "./identity-auth";
import { ResendVerificationEmailSender } from "./resend-verification-email-sender";

export type IdentityRuntime = Readonly<{
  identity: IdentityService;
  authHandlers: AuthRouteHandlers;
  close: () => Promise<void>;
}>;

export function createProductionIdentityRuntime(): IdentityRuntime {
  const environment = readIdentityEnvironment();
  const { database, pool } = createPostgresDatabase(environment.databaseUrl);
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
    close: () => pool.end(),
  };
}

export type { AuthRouteHandlers } from "./auth-route-handlers";
