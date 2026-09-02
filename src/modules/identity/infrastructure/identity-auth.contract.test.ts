import { afterAll, describe, expect, it } from "vitest";

import { createPostgresDatabase } from "@/platform/database/postgres";

import { createIdentityAuth } from "./identity-auth";
import { RecordingVerificationEmailSender } from "./recording-verification-email-sender";

const { database, pool } = createPostgresDatabase(
  "postgresql://unused:unused@127.0.0.1:1/unused",
);
const auth = createIdentityAuth({
  database,
  emailSender: new RecordingVerificationEmailSender(),
  secret: "contract-secret-that-is-at-least-32-characters",
  baseUrl: "http://localhost:3000",
  trustedOrigins: ["http://localhost:3000"],
  trustedProxies: ["127.0.0.1", "10.0.0.0/24"],
  secureCookies: false,
});

afterAll(async () => {
  await pool.end();
});

describe("Better Auth identity policy", () => {
  it("requires verified email and explicit login without password recovery", () => {
    expect(auth.options.emailAndPassword).toMatchObject({
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    });
    expect(auth.options.emailAndPassword).not.toHaveProperty(
      "sendResetPassword",
    );
    expect(auth.options.emailVerification).toMatchObject({
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
    });
  });

  it("uses durable seven-day sessions without cookie caching", () => {
    expect(auth.options.session).toMatchObject({
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false },
    });
    expect(auth.options.advanced?.defaultCookieAttributes).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });
  });

  it("stores global and strict endpoint rate limits in PostgreSQL", () => {
    expect(auth.options.rateLimit).toMatchObject({
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 10, max: 3 },
        "/sign-up/email": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    });
    expect(auth.options.advanced?.ipAddress?.trustedProxies).toEqual([
      "127.0.0.1",
      "10.0.0.0/24",
    ]);
  });
});
