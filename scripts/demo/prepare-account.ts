import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import { createIdentityAuth } from "@/modules/identity/infrastructure/identity-auth";
import { RecordingVerificationEmailSender } from "@/modules/identity/infrastructure/recording-verification-email-sender";
import { user } from "@/platform/database/auth-schema";
import { databaseSchema } from "@/platform/database/schema";

import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_USER_NAME } from "./content";
import type { DemoEnvironment } from "./environment";

const signInBody = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.string(),
    emailVerified: z.boolean(),
    name: z.string(),
  }),
});

type DemoAuth = Readonly<{
  handler(request: Request): Promise<Response>;
}>;
type DemoUser = z.infer<typeof signInBody>["user"];

async function authRequest(
  auth: DemoAuth,
  baseUrl: string,
  path: string,
  options: Readonly<{
    method: "GET" | "POST";
    body?: Readonly<Record<string, unknown>>;
    cookie?: string;
  }>,
): Promise<Response> {
  const headers = new Headers({ origin: baseUrl });
  if (options.body) {
    headers.set("content-type", "application/json");
  }
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  return auth.handler(
    new Request(`${baseUrl}/api/auth${path}`, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
  );
}

async function signInAndCloseSession(
  auth: DemoAuth,
  baseUrl: string,
): Promise<Readonly<{ user: DemoUser | null; status: number }>> {
  const response = await authRequest(auth, baseUrl, "/sign-in/email", {
    method: "POST",
    body: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  if (response.status !== 200) {
    return { user: null, status: response.status };
  }

  const parsed = signInBody.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Demo account sign-in returned an unexpected response");
  }
  const setCookie = response.headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0];
  if (!cookie) {
    throw new Error("Demo account sign-in did not create a formal session");
  }
  const signOut = await authRequest(auth, baseUrl, "/sign-out", {
    method: "POST",
    cookie,
  });
  if (signOut.status !== 200) {
    throw new Error("Could not close the Demo preparation sign-in session");
  }
  return { user: parsed.data.user, status: response.status };
}

function assertFixedDemoUser(userValue: DemoUser): void {
  if (
    userValue.email !== DEMO_EMAIL ||
    userValue.name !== DEMO_USER_NAME ||
    !userValue.emailVerified
  ) {
    throw new Error(
      "Existing Demo account does not exactly match the fixed verified Demo identity",
    );
  }
}

export async function prepareDemoAccount(
  database: NodePgDatabase<typeof databaseSchema>,
  environment: DemoEnvironment,
): Promise<Readonly<{ state: "created" | "reused"; userId: string }>> {
  const recorder = new RecordingVerificationEmailSender();
  const auth = createIdentityAuth({
    database,
    emailSender: recorder,
    secret: environment.authSecret,
    baseUrl: environment.authBaseUrl,
    trustedOrigins: [environment.authBaseUrl],
    trustedProxies: ["127.0.0.1", "::1"],
    secureCookies: false,
    rateLimitEnabled: false,
  });

  const firstSignIn = await signInAndCloseSession(
    auth,
    environment.authBaseUrl,
  );
  if (firstSignIn.user) {
    assertFixedDemoUser(firstSignIn.user);
    return { state: "reused", userId: firstSignIn.user.id };
  }
  if (firstSignIn.status !== 401) {
    throw new Error(
      `Demo account sign-in failed with status ${firstSignIn.status}; refusing to create or reset an account`,
    );
  }

  const existingUsers = await database
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.email, DEMO_EMAIL))
    .limit(1);
  if (existingUsers[0]) {
    throw new Error(
      "The fixed Demo email already exists but fixed credentials did not sign in; refusing to reset, overwrite, or delete it",
    );
  }

  const signUp = await authRequest(
    auth,
    environment.authBaseUrl,
    "/sign-up/email",
    {
      method: "POST",
      body: {
        name: DEMO_USER_NAME,
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        callbackURL: `${environment.authBaseUrl}/auth`,
      },
    },
  );
  if (signUp.status !== 200) {
    throw new Error(`Demo account sign-up failed with status ${signUp.status}`);
  }
  if (
    recorder.messages.length !== 1 ||
    recorder.messages[0]?.recipient !== DEMO_EMAIL
  ) {
    throw new Error(
      "Demo account sign-up did not produce exactly one local recorded verification URL",
    );
  }

  const verificationUrl = new URL(recorder.messages[0].verificationUrl);
  if (verificationUrl.origin !== environment.authBaseUrl) {
    throw new Error("Recorded Demo verification URL is not local");
  }
  const verification = await auth.handler(new Request(verificationUrl));
  if (verification.status !== 200 && verification.status !== 302) {
    throw new Error(
      `Demo account email verification failed with status ${verification.status}`,
    );
  }

  const verifiedSignIn = await signInAndCloseSession(
    auth,
    environment.authBaseUrl,
  );
  if (!verifiedSignIn.user) {
    throw new Error(
      `Verified Demo account could not sign in with fixed credentials (status ${verifiedSignIn.status})`,
    );
  }
  assertFixedDemoUser(verifiedSignIn.user);
  return { state: "created", userId: verifiedSignIn.user.id };
}
