import {
  ProviderRequestError as ExternalProviderError,
  type ProviderErrorCode as ExternalProviderErrorCode,
  type ProviderKind as ExternalProviderKind,
} from "../application/providers";

export type Clock = () => Date | number;

export class RequestTimeout extends Error {}

export function createProviderError(
  provider: ExternalProviderKind,
  code: ExternalProviderErrorCode,
  retryAfterMs?: number,
): ExternalProviderError {
  const retryable =
    code === "rate_limited" ||
    code === "temporarily_unavailable" ||
    code === "timeout";
  return new ExternalProviderError({
    provider,
    code,
    retryable,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
}

export function mapHttpStatus(
  status: number,
): ExternalProviderErrorCode | undefined {
  if (status === 401 || status === 403) {
    return "authentication_failed";
  }
  if (status === 402) {
    return "quota_exhausted";
  }
  if (status === 408) {
    return "timeout";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 500) {
    return "temporarily_unavailable";
  }
  return undefined;
}

export function retryAfterMilliseconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  return Math.max(0, timestamp - Date.now());
}

export async function readJson(
  response: Response,
): Promise<unknown | undefined> {
  try {
    const text = await response.text();
    if (text.trim().length === 0) {
      return undefined;
    }
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function timestampSeconds(
  clock: Clock,
  provider: ExternalProviderKind,
): string {
  const raw = clock();
  const milliseconds = raw instanceof Date ? raw.getTime() : raw;
  if (!Number.isFinite(milliseconds)) {
    throw createProviderError(provider, "protocol_error");
  }
  const seconds =
    Math.abs(milliseconds) >= 10_000_000_000
      ? Math.floor(milliseconds / 1_000)
      : Math.floor(milliseconds);
  if (seconds < 0) {
    throw createProviderError(provider, "protocol_error");
  }
  return String(seconds);
}

export async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (
      timedOut ||
      (error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError"))
    ) {
      throw new RequestTimeout();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function effectiveTimeout(
  requested: number,
  configured: number,
  provider: ExternalProviderKind,
): number {
  if (
    !Number.isInteger(requested) ||
    requested < 1 ||
    !Number.isInteger(configured) ||
    configured < 1
  ) {
    throw createProviderError(provider, "invalid_request");
  }
  return Math.min(requested, configured);
}
