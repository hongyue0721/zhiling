import { getServerRuntime } from "@/bootstrap/server";

export function GET(request: Request): Promise<Response> {
  const { authHandlers } = getServerRuntime();
  return authHandlers.GET(request);
}

export function POST(request: Request): Promise<Response> {
  const { authHandlers } = getServerRuntime();
  return authHandlers.POST(request);
}
