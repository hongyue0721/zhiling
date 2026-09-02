import { describe, expect, it, vi } from "vitest";

import { type AuthRouteHandlers, limitAuthRoutes } from "./auth-route-handlers";

function createHandlers() {
  const GET = vi.fn<AuthRouteHandlers["GET"]>(async () =>
    Promise.resolve(new Response("delegated", { status: 200 })),
  );
  const POST = vi.fn<AuthRouteHandlers["POST"]>(async () =>
    Promise.resolve(new Response("delegated", { status: 200 })),
  );

  return { handlers: limitAuthRoutes({ GET, POST }), GET, POST };
}

describe("authentication route boundary", () => {
  it.each([
    ["POST", "/api/auth/request-password-reset"],
    ["POST", "/api/auth/reset-password"],
    ["GET", "/api/auth/reset-password/one-time-token"],
    ["POST", "/api/auth/change-password"],
    ["POST", "/api/auth/change-email"],
    ["POST", "/api/auth/delete-user"],
    ["GET", "/api/auth/sign-in/email"],
    ["GET", "/api/auth/unknown"],
  ] as const)("does not expose %s %s", async (method, path) => {
    const { handlers, GET, POST } = createHandlers();

    const response = await handlers[method](
      new Request(`http://localhost:3000${path}`, { method }),
    );

    expect(response.status).toBe(404);
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/api/auth/get-session"],
    ["GET", "/api/auth/verify-email"],
    ["GET", "/api/auth/list-sessions"],
    ["POST", "/api/auth/sign-up/email"],
    ["POST", "/api/auth/sign-in/email"],
    ["POST", "/api/auth/send-verification-email"],
    ["POST", "/api/auth/sign-out"],
    ["POST", "/api/auth/revoke-session"],
  ] as const)("delegates enabled %s %s unchanged", async (method, path) => {
    const { handlers, GET, POST } = createHandlers();
    const request = new Request(`http://localhost:3000${path}`, { method });

    const response = await handlers[method](request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("delegated");
    const delegated = method === "GET" ? GET : POST;
    expect(delegated).toHaveBeenCalledOnce();
    expect(delegated).toHaveBeenCalledWith(request);
  });
});
