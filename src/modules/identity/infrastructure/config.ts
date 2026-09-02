import "server-only";

import { isIP } from "node:net";

import { z } from "zod";

import { readServerEnvironment } from "@/platform/config/server";

const httpOrigin = z
  .url()
  .transform((value) => new URL(value))
  .refine(
    (url) =>
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "",
  )
  .transform((url) => url.origin);

const emailAddress = z.email();

const emailFrom = z
  .string()
  .trim()
  .min(3)
  .refine((value) => {
    if (value.includes("\r") || value.includes("\n")) {
      return false;
    }

    const addressStart = value.lastIndexOf("<");
    if (addressStart === -1) {
      return emailAddress.safeParse(value).success;
    }

    const displayName = value.slice(0, addressStart).trim();
    const address = value.slice(addressStart + 1, -1).trim();
    return (
      value.endsWith(">") &&
      displayName.length > 0 &&
      !displayName.includes("<") &&
      !displayName.includes(">") &&
      emailAddress.safeParse(address).success
    );
  });

const originList = z
  .string()
  .min(1)
  .transform((value) => value.split(",").map((origin) => origin.trim()))
  .refine(
    (origins) =>
      origins.length > 0 &&
      origins.every((origin) => {
        try {
          const url = new URL(origin);
          return (
            (url.protocol === "http:" || url.protocol === "https:") &&
            url.origin === origin &&
            url.username === "" &&
            url.password === ""
          );
        } catch {
          return false;
        }
      }),
  );

function isValidProxyRange(value: string): boolean {
  const [address, prefix, ...extra] = value.split("/");
  const addressFamily = address ? isIP(address) : 0;
  if (addressFamily === 0 || extra.length > 0) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }

  const prefixLength = Number(prefix);
  const maximumPrefixLength = addressFamily === 4 ? 32 : 128;
  return (
    prefix.length > 0 &&
    Number.isInteger(prefixLength) &&
    prefixLength >= 0 &&
    prefixLength <= maximumPrefixLength
  );
}

const trustedProxyList = z
  .string()
  .min(1)
  .transform((value) => value.split(",").map((proxy) => proxy.trim()))
  .refine(
    (proxies) =>
      proxies.length > 0 && proxies.every((proxy) => isValidProxyRange(proxy)),
  );

export type IdentityEnvironment = Readonly<{
  databaseUrl: string;
  secret: string;
  baseUrl: string;
  trustedOrigins: string[];
  trustedProxies: string[];
  resendApiKey: string;
  emailFrom: string;
  secureCookies: boolean;
}>;

export function readIdentityEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): IdentityEnvironment {
  const values = readServerEnvironment(
    {
      DATABASE_URL: z
        .url()
        .refine((value) =>
          ["postgres:", "postgresql:"].includes(new URL(value).protocol),
        ),
      BETTER_AUTH_SECRET: z.string().min(32),
      BETTER_AUTH_URL: httpOrigin,
      BETTER_AUTH_TRUSTED_ORIGINS: originList,
      BETTER_AUTH_TRUSTED_PROXIES: trustedProxyList,
      RESEND_API_KEY: z.string().min(1),
      AUTH_EMAIL_FROM: emailFrom,
    },
    source,
  );

  return {
    databaseUrl: values.DATABASE_URL,
    secret: values.BETTER_AUTH_SECRET,
    baseUrl: values.BETTER_AUTH_URL,
    trustedOrigins: values.BETTER_AUTH_TRUSTED_ORIGINS,
    trustedProxies: values.BETTER_AUTH_TRUSTED_PROXIES,
    resendApiKey: values.RESEND_API_KEY,
    emailFrom: values.AUTH_EMAIL_FROM,
    secureCookies: source.NODE_ENV === "production",
  } as const;
}
