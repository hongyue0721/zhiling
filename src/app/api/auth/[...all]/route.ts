import { getServerRuntime } from "@/bootstrap/server";

const disabledRegistrationPaths: Readonly<Record<string, true>> = {
  "/api/auth/sign-up/email": true,
  "/api/auth/send-verification-email": true,
};

function registrationDisabledResponse(): Response {
  return Response.json(
    {
      code: "REGISTRATION_DISABLED",
      message: "本地演示只开放固定账号登录，不会注册账户或发送验证邮件。",
    },
    {
      status: 403,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/json",
      },
    },
  );
}

export function GET(request: Request): Promise<Response> {
  const { authHandlers } = getServerRuntime();
  return authHandlers.GET(request);
}

export function POST(request: Request): Promise<Response> {
  const { authHandlers, registrationEnabled } = getServerRuntime();
  if (
    !registrationEnabled &&
    disabledRegistrationPaths[new URL(request.url).pathname]
  ) {
    return Promise.resolve(registrationDisabledResponse());
  }
  return authHandlers.POST(request);
}
