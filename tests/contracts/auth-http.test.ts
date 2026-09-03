import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  registrationEnabled: true,
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/bootstrap/server", () => ({
  getServerRuntime: () => ({
    registrationEnabled: runtime.registrationEnabled,
    authHandlers: {
      GET: runtime.get,
      POST: runtime.post,
    },
  }),
}));

import {
  GET as handleAuthGet,
  POST as handleAuthPost,
} from "@/app/api/auth/[...all]/route";

beforeEach(() => {
  runtime.registrationEnabled = true;
  runtime.get.mockReset();
  runtime.post.mockReset();
});

describe("auth HTTP Demo policy", () => {
  it.each(["/api/auth/sign-up/email", "/api/auth/send-verification-email"])(
    "rejects %s before Better Auth when registration is disabled",
    async (path) => {
      runtime.registrationEnabled = false;
      const request = new Request(`http://localhost:3000${path}`, {
        method: "POST",
      });

      const response = await handleAuthPost(request);

      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({
        code: "REGISTRATION_DISABLED",
        message: "本地演示只开放固定账号登录，不会注册账户或发送验证邮件。",
      });
      expect(runtime.post).not.toHaveBeenCalled();
    },
  );

  it("keeps fixed-account sign-in available in Demo mode", async () => {
    runtime.registrationEnabled = false;
    runtime.post.mockResolvedValue(new Response(null, { status: 200 }));
    const request = new Request(
      "http://localhost:3000/api/auth/sign-in/email",
      { method: "POST" },
    );

    const response = await handleAuthPost(request);

    expect(response.status).toBe(200);
    expect(runtime.post).toHaveBeenCalledWith(request);
  });

  it("keeps registration available outside Demo mode", async () => {
    runtime.post.mockResolvedValue(new Response(null, { status: 200 }));
    const request = new Request(
      "http://localhost:3000/api/auth/sign-up/email",
      { method: "POST" },
    );

    const response = await handleAuthPost(request);

    expect(response.status).toBe(200);
    expect(runtime.post).toHaveBeenCalledWith(request);
  });

  it("does not apply the registration policy to GET handlers", async () => {
    runtime.registrationEnabled = false;
    runtime.get.mockResolvedValue(new Response(null, { status: 200 }));
    const request = new Request("http://localhost:3000/api/auth/get-session");

    const response = await handleAuthGet(request);

    expect(response.status).toBe(200);
    expect(runtime.get).toHaveBeenCalledWith(request);
  });
});
