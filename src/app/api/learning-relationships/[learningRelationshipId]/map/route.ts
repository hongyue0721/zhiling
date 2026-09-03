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
  const { identity, learningCatalog } = getServerRuntime();
  try {
    const formalIdentity = await identity.require(request.headers);
    const { learningRelationshipId } = await context.params;
    const map = await learningCatalog.findByLearningRelationship(
      formalIdentity.userId,
      learningRelationshipId,
    );
    if (!map) {
      return businessError(404, "resource_not_found", "学习地图不存在");
    }
    return privateJson(map);
  } catch (error) {
    return unexpectedBusinessError(error);
  }
}
