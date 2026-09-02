import { z } from "zod";

import { identity, learningAssessment } from "@/bootstrap/server";
import { LearningAssessmentRequestError } from "@/modules/learning-assessment/public/server";

import {
  businessError,
  privateJson,
  unexpectedBusinessError,
} from "../../../../../_shared/business-response";

export const dynamic = "force-dynamic";

const matchingAnswerSchema = z
  .object({
    leftOptionId: z.string().trim().min(1),
    rightOptionId: z.string().trim().min(1),
  })
  .strict();
const answerSchema = z
  .object({
    questionId: z.string().trim().min(1),
    selectedOptionIds: z.array(z.string().trim().min(1)).optional(),
    matches: z.array(matchingAnswerSchema).optional(),
  })
  .strict()
  .refine(
    ({ selectedOptionIds, matches }) =>
      (selectedOptionIds === undefined) !== (matches === undefined),
    { message: "每道题必须提交选项或匹配关系" },
  );
const submissionSchema = z
  .object({ answers: z.array(answerSchema).min(1) })
  .strict();

type RouteContext = Readonly<{
  params: Promise<{ learningRelationshipId: string; nodeId: string }>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const formalIdentity = await identity.require(request.headers);
    const { learningRelationshipId, nodeId } = await context.params;
    const assessment = await learningAssessment.getNodeAssessment(
      formalIdentity.userId,
      learningRelationshipId,
      nodeId,
    );
    if (!assessment) {
      return businessError(404, "resource_not_found", "验证题目不存在");
    }
    return privateJson(assessment);
  } catch (error) {
    return unexpectedBusinessError(error);
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const formalIdentity = await identity.require(request.headers);
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
    if (idempotencyKey.trim().length === 0) {
      return businessError(
        400,
        "invalid_request",
        "请求必须包含 Idempotency-Key",
      );
    }
    const payload = submissionSchema.parse(await request.json());
    const { learningRelationshipId, nodeId } = await context.params;
    const result = await learningAssessment.submit(
      formalIdentity.userId,
      learningRelationshipId,
      nodeId,
      idempotencyKey,
      payload.answers,
    );
    if (!result) {
      return businessError(404, "resource_not_found", "验证题目不存在");
    }
    return privateJson(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return businessError(400, "invalid_request", "请求内容不符合接口要求");
    }
    if (error instanceof LearningAssessmentRequestError) {
      return businessError(400, "invalid_request", "请求内容不符合接口要求");
    }
    return unexpectedBusinessError(error);
  }
}
