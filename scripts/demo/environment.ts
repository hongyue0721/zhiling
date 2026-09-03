const LOOPBACK_DATABASE_HOSTS: Readonly<Record<string, true>> = {
  localhost: true,
  "127.0.0.1": true,
  "[::1]": true,
  "demo-postgres": true,
};
const LOOPBACK_AUTH_HOSTS: Readonly<Record<string, true>> = {
  localhost: true,
  "127.0.0.1": true,
  "[::1]": true,
};

export type DemoEnvironment = Readonly<{
  databaseUrl: string;
  authSecret: string;
  authBaseUrl: string;
}>;

function invalid(reason: string): never {
  throw new Error(
    `Demo environment rejected before database access: ${reason}`,
  );
}

export function readDemoEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): DemoEnvironment {
  if (source.NODE_ENV !== "development") {
    invalid("NODE_ENV must be exactly development");
  }
  if (source.ZHIJING_DEMO_MODE !== "1") {
    invalid("ZHIJING_DEMO_MODE must be exactly 1");
  }
  if (source.TEST_DATABASE_URL !== undefined) {
    invalid("TEST_DATABASE_URL must not be present");
  }

  const rawDatabaseUrl = source.DATABASE_URL?.trim();
  if (!rawDatabaseUrl) {
    invalid("DATABASE_URL is required");
  }
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    invalid("DATABASE_URL must be a valid URL");
  }
  if (
    databaseUrl.protocol !== "postgres:" &&
    databaseUrl.protocol !== "postgresql:"
  ) {
    invalid("DATABASE_URL must use PostgreSQL");
  }
  if (!LOOPBACK_DATABASE_HOSTS[databaseUrl.hostname]) {
    invalid(
      "database host must be loopback or the demo-postgres Compose service",
    );
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  } catch {
    invalid("database name must be URL-decodable");
  }
  if (
    databaseName.length === 0 ||
    databaseName.includes("/") ||
    !databaseName.endsWith("_demo")
  ) {
    invalid("database name must end in _demo");
  }

  const rawAuthBaseUrl = source.BETTER_AUTH_URL?.trim();
  if (!rawAuthBaseUrl) {
    invalid("BETTER_AUTH_URL is required");
  }
  let authBaseUrl: URL;
  try {
    authBaseUrl = new URL(rawAuthBaseUrl);
  } catch {
    invalid("BETTER_AUTH_URL must be a valid URL");
  }
  if (
    authBaseUrl.protocol !== "http:" ||
    !LOOPBACK_AUTH_HOSTS[authBaseUrl.hostname] ||
    authBaseUrl.username !== "" ||
    authBaseUrl.password !== "" ||
    authBaseUrl.pathname !== "/" ||
    authBaseUrl.search !== "" ||
    authBaseUrl.hash !== ""
  ) {
    invalid("BETTER_AUTH_URL must be a local HTTP origin");
  }

  const authSecret = source.BETTER_AUTH_SECRET;
  if (!authSecret || authSecret.length < 32) {
    invalid("BETTER_AUTH_SECRET must contain at least 32 characters");
  }

  return {
    databaseUrl: rawDatabaseUrl,
    authSecret,
    authBaseUrl: authBaseUrl.origin,
  };
}
