import { describe, expect, it } from "vitest";

import { EnvironmentConfigurationError } from "@/platform/config/environment";

import { readIdentityEnvironment } from "./config";

const validEnvironment: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/zhijing",
  BETTER_AUTH_SECRET: "a-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_TRUSTED_ORIGINS:
    "http://localhost:3000,https://preview.example.com",
  BETTER_AUTH_TRUSTED_PROXIES: "127.0.0.1,10.0.0.0/24",
  EMAIL_VERIFICATION_ENABLED: "true",
  RESEND_API_KEY: "re_private",
  AUTH_EMAIL_FROM: "知径 <auth@example.com>",
  NODE_ENV: "production",
};

describe("identity server environment", () => {
  it.each([
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_TRUSTED_ORIGINS",
    "BETTER_AUTH_TRUSTED_PROXIES",
    "EMAIL_VERIFICATION_ENABLED",
    "RESEND_API_KEY",
    "AUTH_EMAIL_FROM",
  ] as const)("fails explicitly when %s is absent", (key) => {
    const source = { ...validEnvironment };
    delete source[key];

    expect(() => readIdentityEnvironment(source)).toThrowError(
      EnvironmentConfigurationError,
    );
  });

  it("allows disabled email verification without Resend configuration", () => {
    const source: NodeJS.ProcessEnv = {
      ...validEnvironment,
      EMAIL_VERIFICATION_ENABLED: "false",
    };
    delete source.RESEND_API_KEY;
    delete source.AUTH_EMAIL_FROM;

    const environment = readIdentityEnvironment(source);

    expect(environment.emailVerificationEnabled).toBe(false);
    expect(environment.resendApiKey).toBeUndefined();
    expect(environment.emailFrom).toBeUndefined();
  });

  it("rejects non-PostgreSQL databases and non-origin trust entries", () => {
    expect(() =>
      readIdentityEnvironment({
        ...validEnvironment,
        DATABASE_URL: "mysql://localhost/zhijing",
        BETTER_AUTH_TRUSTED_ORIGINS: "https://example.com/path",
      }),
    ).toThrowError(EnvironmentConfigurationError);
  });

  it.each([
    { EMAIL_VERIFICATION_ENABLED: "yes" },
    { BETTER_AUTH_URL: "https://example.com/application" },
    { AUTH_EMAIL_FROM: "not-an-email@" },
    { AUTH_EMAIL_FROM: "知径 <not-an-email>" },
    { AUTH_EMAIL_FROM: "知径 <auth@example.com>\r\nBcc: attacker@example.com" },
    { BETTER_AUTH_TRUSTED_PROXIES: "not-an-ip" },
    { BETTER_AUTH_TRUSTED_PROXIES: "10.0.0.0/33" },
  ])(
    "rejects malformed base URLs, sender addresses, policies, and proxies",
    (override) => {
      expect(() =>
        readIdentityEnvironment({
          ...validEnvironment,
          ...override,
        }),
      ).toThrowError(EnvironmentConfigurationError);
    },
  );

  it("returns explicit origins, proxies, and production cookie policy", () => {
    const environment = readIdentityEnvironment(validEnvironment);

    expect(environment.trustedOrigins).toEqual([
      "http://localhost:3000",
      "https://preview.example.com",
    ]);
    expect(environment.trustedProxies).toEqual(["127.0.0.1", "10.0.0.0/24"]);
    expect(environment.emailVerificationEnabled).toBe(true);
    expect(environment.secureCookies).toBe(true);
  });

  it("never includes rejected secret values in the configuration error", () => {
    const rejectedSecret = "short-secret";

    let caught: unknown;

    try {
      readIdentityEnvironment({
        ...validEnvironment,
        BETTER_AUTH_SECRET: rejectedSecret,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvironmentConfigurationError);
    expect(String(caught)).not.toContain(rejectedSecret);
  });
});
