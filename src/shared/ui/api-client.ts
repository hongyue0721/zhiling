export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly requestId: string | null;

  constructor(
    status: number,
    code: string | null,
    message: string,
    requestId: string | null,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function readErrorDetails(value: unknown): {
  code: string | null;
  message: string;
  requestId: string | null;
} {
  let envelope: unknown = value;
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null
  ) {
    envelope = value.error;
  }
  let code: string | null = null;
  let message = "请求暂时无法完成";
  let requestId: string | null = null;
  if (typeof envelope === "object" && envelope !== null) {
    if ("code" in envelope && typeof envelope.code === "string") {
      code = envelope.code;
    }
    if ("message" in envelope && typeof envelope.message === "string") {
      message = envelope.message;
    }
    if ("requestId" in envelope && typeof envelope.requestId === "string") {
      requestId = envelope.requestId;
    }
  }
  return { code, message, requestId };
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function apiRequest<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new ApiRequestError(
      0,
      "network_error",
      "网络连接失败，请稍后重试",
      null,
    );
  }

  const body = await readJson(response);
  if (!response.ok) {
    const details = readErrorDetails(body);
    throw new ApiRequestError(
      response.status,
      details.code,
      details.message,
      details.requestId,
    );
  }
  return body as T;
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

export function createIdempotencyKey(prefix = "attempt"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
