import { identity, learningCatalog } from "@/bootstrap/server";

import {
  privateJson,
  unexpectedBusinessError,
} from "../_shared/business-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const formalIdentity = await identity.require(request.headers);
    const items = await learningCatalog.listLearningRelationships(
      formalIdentity.userId,
    );
    return privateJson({ items });
  } catch (error) {
    return unexpectedBusinessError(error);
  }
}
