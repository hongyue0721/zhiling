import { identity, learningReport } from "@/bootstrap/server";

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
  try {
    const formalIdentity = await identity.require(request.headers);
    const { learningRelationshipId } = await context.params;
    const report = await learningReport.get(
      formalIdentity.userId,
      learningRelationshipId,
    );
    if (!report) {
      return businessError(404, "resource_not_found", "结课报告不存在");
    }
    return privateJson(report);
  } catch (error) {
    return unexpectedBusinessError(error);
  }
}
