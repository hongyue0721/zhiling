import "server-only";

export type AuthRouteHandlers = Readonly<{
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
}>;

const AUTH_BASE_PATH = "/api/auth";
const ENABLED_AUTH_PATHS: Record<
  keyof AuthRouteHandlers,
  Readonly<Record<string, true>>
> = {
  GET: {
    [`${AUTH_BASE_PATH}/get-session`]: true,
    [`${AUTH_BASE_PATH}/verify-email`]: true,
    [`${AUTH_BASE_PATH}/list-sessions`]: true,
  },
  POST: {
    [`${AUTH_BASE_PATH}/sign-up/email`]: true,
    [`${AUTH_BASE_PATH}/sign-in/email`]: true,
    [`${AUTH_BASE_PATH}/send-verification-email`]: true,
    [`${AUTH_BASE_PATH}/sign-out`]: true,
    [`${AUTH_BASE_PATH}/revoke-session`]: true,
  },
};

function limitHandler(
  method: keyof AuthRouteHandlers,
  handler: AuthRouteHandlers[keyof AuthRouteHandlers],
) {
  return (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    if (!ENABLED_AUTH_PATHS[method][pathname]) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }

    return handler(request);
  };
}

export function limitAuthRoutes(
  handlers: AuthRouteHandlers,
): AuthRouteHandlers {
  return {
    GET: limitHandler("GET", handlers.GET),
    POST: limitHandler("POST", handlers.POST),
  };
}
