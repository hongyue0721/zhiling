import { z } from "zod";

import { generation, identity } from "@/bootstrap/server";

import { mapGenerationError, validationError } from "./_shared";
import { privateJson } from "../_shared/business-response";

export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    topic: z
      .string({ error: "请输入学习主题" })
      .trim()
      .min(1, "请输入学习主题")
      .max(200, "学习主题不能超过 200 个字符"),
  })
  .strict();

function requestValidationError(error: z.ZodError): Response {
  return validationError(
    error.issues.map((issue) => ({
      path: issue.path,
      code:
        issue.code === "invalid_type" && issue.input === undefined
          ? "required"
          : issue.code,
      message: issue.message,
    })),
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    const formalIdentity = await identity.require(request.headers);

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return validationError([
        {
          path: [],
          code: "invalid_json",
          message: "请求体必须是有效 JSON",
        },
      ]);
    }

    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) {
      return requestValidationError(parsed.error);
    }

    const result = await generation.requestGeneration(
      formalIdentity.userId,
      parsed.data.topic,
    );
    return privateJson(result, 202);
  } catch (error) {
    return mapGenerationError(error);
  }
}
