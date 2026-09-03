import { getServerRuntime } from "@/bootstrap/server";

import { notFoundError, mapGenerationError } from "../_shared";
import { privateJson } from "../../_shared/business-response";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ taskId: string }>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { generation, identity } = getServerRuntime();
  try {
    const formalIdentity = await identity.require(request.headers);
    const { taskId } = await context.params;
    const snapshot = await generation.getGeneration(
      formalIdentity.userId,
      taskId,
    );
    if (!snapshot) {
      return notFoundError();
    }
    return privateJson(snapshot);
  } catch (error) {
    return mapGenerationError(error);
  }
}
