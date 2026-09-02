import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { IdentityService } from "@/modules/identity/application/identity-service";
import { limitAuthRoutes } from "@/modules/identity/infrastructure/auth-route-handlers";
import { ResendVerificationEmailSender } from "@/modules/identity/infrastructure/resend-verification-email-sender";
import { BetterAuthSessionReader } from "@/modules/identity/infrastructure/better-auth-session-reader";
import { createIdentityAuth } from "@/modules/identity/infrastructure/identity-auth";
import { RecordingVerificationEmailSender } from "@/modules/identity/infrastructure/recording-verification-email-sender";
import { createPostgresDatabase } from "@/platform/database/postgres";

const baseUrl = "http://localhost:3000";
const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for identity integration tests",
  );
}

const testDatabaseName = decodeURIComponent(
  new URL(databaseUrl).pathname.slice(1),
);
if (!testDatabaseName.endsWith("_test")) {
  throw new Error(
    "TEST_DATABASE_URL must name a disposable database ending in _test",
  );
}

const { database, pool } = createPostgresDatabase(databaseUrl);
const recorder = new RecordingVerificationEmailSender();
const auth = createIdentityAuth({
  database,
  emailSender: recorder,
  secret: "integration-secret-that-is-at-least-32-characters",
  baseUrl,
  trustedOrigins: [baseUrl],
  trustedProxies: ["127.0.0.1"],
  secureCookies: false,
});
const authRouteHandlers = limitAuthRoutes({
  GET: auth.handler,
  POST: auth.handler,
});
const identity = new IdentityService(
  new BetterAuthSessionReader((headers) => auth.api.getSession({ headers })),
);

async function managedRequest(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    cookie?: string;
  } = {},
) {
  const method = options.method ?? "GET";
  const headers = new Headers();
  headers.set("origin", baseUrl);
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  if (options.body) {
    headers.set("content-type", "application/json");
  }

  return auth.handler(
    new Request(`${baseUrl}/api/auth${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
  );
}

async function registerAndVerify(email: string) {
  const signUp = await managedRequest("/sign-up/email", {
    method: "POST",
    body: {
      name: "Integration User",
      email,
      password: "correct horse battery staple",
      callbackURL: `${baseUrl}/verified`,
    },
  });
  expect(signUp.status).toBe(200);
  expect(signUp.headers.get("set-cookie")).toBeNull();

  const message = recorder.messages.at(-1);
  expect(message?.recipient).toBe(email);
  if (!message) {
    throw new Error("Expected a recorded verification email");
  }

  const verification = await auth.handler(new Request(message.verificationUrl));
  expect([200, 302]).toContain(verification.status);
  expect(verification.headers.get("set-cookie")).toBeNull();
}

async function signIn(email: string) {
  const response = await managedRequest("/sign-in/email", {
    method: "POST",
    body: {
      email,
      password: "correct horse battery staple",
    },
  });
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Expected a session cookie after explicit login");
  }

  return setCookie.split(";", 1)[0];
}

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "drizzle" });
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE TABLE "rateLimit", "verification", "session", "account", "user" CASCADE',
  );
  recorder.messages.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe("identity authentication with PostgreSQL", () => {
  it("registers, verifies, explicitly logs in, restores identity, and logs out", async () => {
    const email = "flow@example.com";
    const signUp = await managedRequest("/sign-up/email", {
      method: "POST",
      body: {
        name: "Flow User",
        email,
        password: "correct horse battery staple",
        callbackURL: `${baseUrl}/verified`,
      },
    });
    expect(signUp.status).toBe(200);
    expect(signUp.headers.get("set-cookie")).toBeNull();

    const unverifiedLogin = await managedRequest("/sign-in/email", {
      method: "POST",
      body: { email, password: "correct horse battery staple" },
    });
    expect(unverifiedLogin.status).toBe(403);
    await expect(identity.resolve(new Headers())).resolves.toBeNull();

    expect(recorder.messages).toHaveLength(1);
    const resend = await managedRequest("/send-verification-email", {
      method: "POST",
      body: { email, callbackURL: `${baseUrl}/verified` },
    });
    expect(resend.status).toBe(200);
    expect(recorder.messages).toHaveLength(2);

    const verificationMessage = recorder.messages.at(-1);
    if (!verificationMessage) {
      throw new Error("Expected verification mail after explicit resend");
    }
    const verification = await auth.handler(
      new Request(verificationMessage.verificationUrl),
    );
    expect([200, 302]).toContain(verification.status);
    expect(verification.headers.get("set-cookie")).toBeNull();

    const cookie = await signIn(email);
    const requestHeaders = new Headers({ cookie });
    const formalIdentity = await identity.require(requestHeaders);
    expect(formalIdentity).toEqual({
      userId: expect.any(String),
      email,
      emailVerified: true,
    });
    expect(formalIdentity).not.toHaveProperty("token");
    expect(formalIdentity).not.toHaveProperty("session");

    const restored = await managedRequest("/get-session", { cookie });
    expect(restored.status).toBe(200);
    const restoredBody = (await restored.json()) as {
      user: { id: string; email: string; emailVerified: boolean };
    };
    expect(restoredBody.user.id).toBe(formalIdentity.userId);
    expect(restoredBody.user.emailVerified).toBe(true);

    const signOut = await managedRequest("/sign-out", {
      method: "POST",
      cookie,
    });
    expect(signOut.status).toBe(200);
    await expect(identity.resolve(requestHeaders)).resolves.toBeNull();
  });

  it("invalidates revoked and expired sessions on the next request", async () => {
    const email = "revoke@example.com";
    await registerAndVerify(email);

    const revokedCookie = await signIn(email);
    const sessionsResponse = await managedRequest("/list-sessions", {
      cookie: revokedCookie,
    });
    expect(sessionsResponse.status).toBe(200);
    const sessions = (await sessionsResponse.json()) as Array<{
      token: string;
    }>;
    expect(sessions).toHaveLength(1);

    const revoke = await managedRequest("/revoke-session", {
      method: "POST",
      cookie: revokedCookie,
      body: { token: sessions[0]?.token },
    });
    expect(revoke.status).toBe(200);
    await expect(
      identity.resolve(new Headers({ cookie: revokedCookie })),
    ).resolves.toBeNull();

    const expiredCookie = await signIn(email);
    await pool.query(
      'UPDATE "session" SET "expiresAt" = now() - interval \'1 second\'',
    );
    await expect(
      identity.resolve(new Headers({ cookie: expiredCookie })),
    ).resolves.toBeNull();
  });

  it("does not reveal whether an email already has an account", async () => {
    const email = "enumeration@example.com";
    const requestBody = {
      name: "Enumeration User",
      email,
      password: "correct horse battery staple",
      callbackURL: `${baseUrl}/verified`,
    };
    const created = await managedRequest("/sign-up/email", {
      method: "POST",
      body: requestBody,
    });
    const duplicate = await managedRequest("/sign-up/email", {
      method: "POST",
      body: requestBody,
    });
    const createdBody = (await created.json()) as Record<string, unknown>;
    const duplicateBody = (await duplicate.json()) as Record<string, unknown>;

    expect(created.status).toBe(200);
    expect(duplicate.status).toBe(created.status);
    expect(Object.keys(duplicateBody).sort()).toEqual(
      Object.keys(createdBody).sort(),
    );
    expect(
      Object.keys(duplicateBody.user as Record<string, unknown>).sort(),
    ).toEqual(Object.keys(createdBody.user as Record<string, unknown>).sort());

    const knownEmail = await managedRequest("/sign-in/email", {
      method: "POST",
      body: { email, password: "wrong but long enough password" },
    });
    const unknownEmail = await managedRequest("/sign-in/email", {
      method: "POST",
      body: {
        email: "unknown@example.com",
        password: "wrong but long enough password",
      },
    });
    const knownError = (await knownEmail.json()) as { code?: string };
    const unknownError = (await unknownEmail.json()) as { code?: string };

    expect(knownEmail.status).toBe(401);
    expect(unknownEmail.status).toBe(knownEmail.status);
    expect(unknownError.code).toBe(knownError.code);

    const knownResend = await managedRequest("/send-verification-email", {
      method: "POST",
      body: { email, callbackURL: `${baseUrl}/verified` },
    });
    const unknownResend = await managedRequest("/send-verification-email", {
      method: "POST",
      body: {
        email: "unknown@example.com",
        callbackURL: `${baseUrl}/verified`,
      },
    });

    expect(knownResend.status).toBe(200);
    expect(unknownResend.status).toBe(knownResend.status);
    expect(await unknownResend.text()).toBe(await knownResend.text());
  });

  it("persists the strict sign-in limit in PostgreSQL", async () => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await managedRequest("/sign-in/email", {
        method: "POST",
        body: {
          email: "limited@example.com",
          password: "correct horse battery staple",
        },
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(429);
    const storedLimits = await pool.query(
      'SELECT "key", "count" FROM "rateLimit"',
    );
    expect(storedLimits.rowCount).toBeGreaterThan(0);
    expect(storedLimits.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: expect.stringContaining("/sign-in/email"),
          count: expect.any(Number),
        }),
      ]),
    );
  });

  it("does not expose password recovery routes", async () => {
    const response = await authRouteHandlers.POST(
      new Request(`${baseUrl}/api/auth/request-password-reset`, {
        method: "POST",
        headers: {
          origin: baseUrl,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "nobody@example.com",
          redirectTo: `${baseUrl}/reset-password`,
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(recorder.messages).toHaveLength(0);
  });

  it("keeps mail delivery diagnostics out of responses and logs", async () => {
    const providerDiagnostic = "resend-private-provider-body";
    const apiKey = "re_private_integration_key";
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(providerDiagnostic, { status: 503 }));
    const failingAuth = createIdentityAuth({
      database,
      emailSender: new ResendVerificationEmailSender(
        apiKey,
        "知径 <auth@example.com>",
        request,
      ),
      secret: "integration-secret-that-is-at-least-32-characters",
      baseUrl,
      trustedOrigins: [baseUrl],
      trustedProxies: ["127.0.0.1"],
      secureCookies: false,
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await failingAuth.handler(
        new Request(`${baseUrl}/api/auth/sign-up/email`, {
          method: "POST",
          headers: {
            origin: baseUrl,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Failure User",
            email: "failure@example.com",
            password: "correct horse battery staple",
          }),
        }),
      );
      const responseBody = await response.text();
      const logs = errorLog.mock.calls.flat().map(String).join("\n");

      // Better Auth treats registration and email delivery as separate outcomes:
      // the account remains unverified and can recover through explicit resend.
      expect(response.status).toBe(200);
      expect(responseBody).not.toContain(providerDiagnostic);
      expect(responseBody).not.toContain(apiKey);
      expect(responseBody).not.toContain("token=");
      expect(responseBody).not.toContain("/verify-email");
      expect(logs).not.toContain(providerDiagnostic);
      expect(logs).not.toContain(apiKey);
      expect(logs).not.toContain("token=");
      expect(logs).not.toContain("/verify-email");
    } finally {
      errorLog.mockRestore();
    }
  });
});
