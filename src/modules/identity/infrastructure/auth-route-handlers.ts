import "server-only";

export type AuthRouteHandlers = Readonly<{
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
}>;

const AUTH_BASE_PATH = "/api/auth";

export type AuthRouteOptions = Readonly<{
  emailVerificationEnabled: boolean;
}>;

function createEnabledAuthPaths(
  options: AuthRouteOptions,
): Record<keyof AuthRouteHandlers, Readonly<Record<string, true>>> {
  return {
    GET: {
      [`${AUTH_BASE_PATH}/get-session`]: true,
      [`${AUTH_BASE_PATH}/list-sessions`]: true,
      ...(options.emailVerificationEnabled
        ? { [`${AUTH_BASE_PATH}/verify-email`]: true }
        : {}),
    },
    POST: {
      [`${AUTH_BASE_PATH}/sign-up/email`]: true,
      [`${AUTH_BASE_PATH}/sign-in/email`]: true,
      [`${AUTH_BASE_PATH}/sign-out`]: true,
      [`${AUTH_BASE_PATH}/revoke-session`]: true,
      ...(options.emailVerificationEnabled
        ? { [`${AUTH_BASE_PATH}/send-verification-email`]: true }
        : {}),
    },
  };
}

function limitHandler(
  method: keyof AuthRouteHandlers,
  handler: AuthRouteHandlers[keyof AuthRouteHandlers],
  enabledAuthPaths: Record<
    keyof AuthRouteHandlers,
    Readonly<Record<string, true>>
  >,
) {
  return (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    if (!enabledAuthPaths[method][pathname]) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }

    return handler(request);
  };
}

export function limitAuthRoutes(
  handlers: AuthRouteHandlers,
  options: AuthRouteOptions,
): AuthRouteHandlers {
  const enabledAuthPaths = createEnabledAuthPaths(options);
  return {
    GET: limitHandler("GET", handlers.GET, enabledAuthPaths),
    POST: limitHandler("POST", handlers.POST, enabledAuthPaths),
  };
}
