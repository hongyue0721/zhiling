import { getServerRuntime } from "@/bootstrap/server";

import {
  privateJson,
  unexpectedBusinessError,
} from "../_shared/business-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { identity, learningCatalog } = getServerRuntime();
  try {
    await identity.require(request.headers);
    const items = await learningCatalog.listFeatured();
    return privateJson({ items });
  } catch (error) {
    return unexpectedBusinessError(error);
  }
}
