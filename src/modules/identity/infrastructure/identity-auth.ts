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
  emailSender?: VerificationEmailSender;
  emailVerificationEnabled: boolean;
  secret: string;
  baseUrl: string;
  trustedOrigins: readonly string[];
  trustedProxies: readonly string[];
  secureCookies: boolean;
}>;

function createEmailVerificationOptions(
  emailSender: VerificationEmailSender | undefined,
) {
  if (!emailSender) {
    throw new Error("Email verification requires an email sender");
  }

  return {
    sendOnSignUp: true,
    sendOnSignIn: false,
    autoSignInAfterVerification: false,
    expiresIn: ONE_HOUR_SECONDS,
    sendVerificationEmail: async ({
      user,
      url,
    }: {
      user: { email: string };
      url: string;
    }) => {
      await emailSender.sendVerificationEmail({
        recipient: user.email,
        verificationUrl: url,
      });
    },
  };
}

export function createIdentityAuth(options: IdentityAuthOptions) {
  const emailVerification = options.emailVerificationEnabled
    ? createEmailVerificationOptions(options.emailSender)
    : undefined;

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
      requireEmailVerification: options.emailVerificationEnabled,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    ...(emailVerification ? { emailVerification } : {}),
    session: {
      expiresIn: SEVEN_DAYS_SECONDS,
      updateAge: ONE_DAY_SECONDS,
      cookieCache: {
        enabled: false,
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      storage: "database",
      modelName: "rateLimit",
      customRules: {
        "/sign-in/email": { window: 10, max: 3 },
        "/sign-up/email": { window: 60, max: 3 },
        ...(options.emailVerificationEnabled
          ? { "/send-verification-email": { window: 60, max: 3 } }
          : {}),
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
