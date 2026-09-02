import { FormalIdentityRequiredError } from "@/modules/identity/public/server";

const privateHeaders = {
  "cache-control": "private, no-store",
  "content-type": "application/json",
} as const;

type BusinessErrorCode =
  "authentication_required" | "resource_not_found" | "internal_error";

export function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

function createRequestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function businessErrorWithRequestId(
  status: 401 | 404 | 500,
  code: BusinessErrorCode,
  message: string,
  requestId: string,
): Response {
  return privateJson(
    {
      error: {
        code,
        message,
        requestId,
      },
    },
    status,
  );
}

export function businessError(
  status: 401 | 404 | 500,
  code: BusinessErrorCode,
  message: string,
): Response {
  return businessErrorWithRequestId(status, code, message, createRequestId());
}

export function unexpectedBusinessError(error: unknown): Response {
  if (error instanceof FormalIdentityRequiredError) {
    return businessError(
      401,
      "authentication_required",
      "需要登录正式账户后才能访问",
    );
  }

  const requestId = createRequestId();
  const constructorName =
    error instanceof Error ? error.constructor.name : "NonError";
  const errorType = /^[A-Za-z][A-Za-z0-9_$]{0,63}$/.test(constructorName)
    ? constructorName
    : "UnknownError";
  console.error({
    event: "business_api_unexpected_error",
    requestId,
    errorType,
  });
  return businessErrorWithRequestId(
    500,
    "internal_error",
    "服务暂时无法完成请求",
    requestId,
  );
}
