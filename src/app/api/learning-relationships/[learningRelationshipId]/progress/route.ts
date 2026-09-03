import { getServerRuntime } from "@/bootstrap/server";

import {
  businessError,
  privateJson,
  unexpectedBusinessError,
} from "../../../_shared/business-response";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ learningRelationshipId: string }>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { identity, learningProgress } = getServerRuntime();
  try {
    const formalIdentity = await identity.require(request.headers);
    const { learningRelationshipId } = await context.params;
    const progress = await learningProgress.get(
      formalIdentity.userId,
      learningRelationshipId,
    );
    if (!progress) {
      return businessError(404, "resource_not_found", "学习进度不存在");
    }
    return privateJson(progress);
  } catch (error) {
    return unexpectedBusinessError(error);
  }
}
