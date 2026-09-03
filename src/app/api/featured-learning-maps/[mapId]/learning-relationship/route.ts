import { identity, learningCatalog } from "@/bootstrap/server";

import {
  businessError,
  privateJson,
  unexpectedBusinessError,
} from "../../../_shared/business-response";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ mapId: string }>;
}>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const formalIdentity = await identity.require(request.headers);
    const { mapId } = await context.params;
    const relationship =
      await learningCatalog.establishFeaturedLearningRelationship(
        formalIdentity.userId,
        mapId,
      );
    if (!relationship) {
      return businessError(404, "resource_not_found", "精选学习地图不存在");
    }
    return privateJson(relationship);
  } catch (error) {
    return unexpectedBusinessError(error);
  }
}
