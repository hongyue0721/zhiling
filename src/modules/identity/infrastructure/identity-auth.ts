import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { authSchema } from "@/platform/database/auth-schema";
import { databaseSchema } from "@/platform/database/schema";

import type { VerificationEmailSender } from "../application/ports";

const ONE_HOUR_SECONDS = 60 * 60;
const ONE_DAY_SECONDS = 24 * ONE_HOUR_SECONDS;
const SEVEN_DAYS_SECONDS = 7 * ONE_DAY_SECONDS;

export type IdentityAuthOptions = Readonly<{
  database: NodePgDatabase<typeof databaseSchema>;
  emailSender: VerificationEmailSender;
  secret: string;
  baseUrl: string;
  trustedOrigins: readonly string[];
  trustedProxies: readonly string[];
  secureCookies: boolean;
  rateLimitEnabled?: boolean;
}>;

export function createIdentityAuth(options: IdentityAuthOptions) {
  return betterAuth({
    appName: "知径",
    database: drizzleAdapter(options.database, {
      provider: "pg",
      schema: authSchema,
      camelCase: true,
      transaction: true,
    }),
    secret: options.secret,
    baseURL: options.baseUrl,
    trustedOrigins: [...options.trustedOrigins],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: ONE_HOUR_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        await options.emailSender.sendVerificationEmail({
          recipient: user.email,
          verificationUrl: url,
        });
      },
    },
    session: {
      expiresIn: SEVEN_DAYS_SECONDS,
      updateAge: ONE_DAY_SECONDS,
      cookieCache: {
        enabled: false,
      },
    },
    rateLimit: {
      enabled: options.rateLimitEnabled ?? true,
      window: 60,
      max: 100,
      storage: "database",
      modelName: "rateLimit",
      customRules: {
        "/sign-in/email": { window: 10, max: 3 },
        "/sign-up/email": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },
    advanced: {
      ipAddress: {
        trustedProxies: [...options.trustedProxies],
      },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: options.secureCookies,
        sameSite: "lax",
        path: "/",
      },
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
  });
}
