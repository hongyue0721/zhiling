import {
  businessError,
  privateJson,
  unexpectedBusinessError,
} from "../_shared/business-response";

const generationErrorMessages = {
  invalid_topic: "学习主题无法生成",
  source_unavailable: "知乎来源暂时不可用",
  source_insufficient: "可用学习材料不足",
  model_unavailable: "结构化模型暂时不可用",
  candidate_invalid: "生成内容未通过校验",
  generation_timeout: "生成任务已超时",
  internal_failure: "生成任务失败",
  rate_limited: "生成请求过于频繁",
} as const;

type GenerationErrorCode = keyof typeof generationErrorMessages;

type GenerationErrorLike = Readonly<{
  code?: unknown;
  category?: unknown;
  retryable?: unknown;
  retryAfterMs?: unknown;
}>;

function createRequestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function jsonPointerPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "";
  }

  return `/${path
    .map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1"))
    .join("/")}`;
}

export function validationError(
  issues: readonly Readonly<{
    path: readonly PropertyKey[];
    code: string;
    message: string;
  }>[],
): Response {
  return privateJson(
    {
      error: {
        code: "invalid_request",
        message: "请求内容不符合接口要求",
        requestId: createRequestId(),
        issues: issues.map((issue) => ({
          path: jsonPointerPath(issue.path),
          code: issue.code,
          message: issue.message,
        })),
      },
    },
    400,
  );
}

export function notFoundError(): Response {
  return businessError(404, "resource_not_found", "生成任务不存在");
}
export function generationUnavailableError(): Response {
  return privateJson(
    {
      error: {
        code: "generation_unavailable",
        message: "本地演示未启动现场生成服务",
        requestId: createRequestId(),
      },
    },
    503,
  );
}

function asGenerationErrorCode(error: unknown): GenerationErrorCode | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const candidate = error as GenerationErrorLike;
  const value = candidate.code ?? candidate.category;
  return typeof value === "string" && value in generationErrorMessages
    ? (value as GenerationErrorCode)
    : null;
}

function retryAfterSeconds(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const retryAfterMs = (error as GenerationErrorLike).retryAfterMs;
  if (
    typeof retryAfterMs !== "number" ||
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs <= 0
  ) {
    return null;
  }

  return Math.max(1, Math.ceil(retryAfterMs / 1_000));
}

function generationErrorStatus(
  code: GenerationErrorCode,
): 400 | 429 | 500 | 503 | 504 {
  switch (code) {
    case "invalid_topic":
      return 400;
    case "rate_limited":
      return 429;
    case "source_unavailable":
    case "model_unavailable":
      return 503;
    case "generation_timeout":
      return 504;
    case "source_insufficient":
    case "candidate_invalid":
    case "internal_failure":
      return 500;
  }
}

export function mapGenerationError(error: unknown): Response {
  const code = asGenerationErrorCode(error);
  if (!code) {
    return unexpectedBusinessError(error);
  }

  const response = privateJson(
    {
      error: {
        code,
        message: generationErrorMessages[code],
        requestId: createRequestId(),
      },
    },
    generationErrorStatus(code),
  );
  const retryAfter = retryAfterSeconds(error);
  if (retryAfter !== null) {
    response.headers.set("retry-after", String(retryAfter));
  }
  return response;
}

export type SseEventEnvelope = Readonly<{
  protocolVersion: "1";
  taskId: string;
  sequence: number;
  type: "snapshot" | "progress" | "succeeded" | "failed";
  occurredAt: string;
  data: Readonly<Record<string, unknown>>;
}>;

const safeStatuses: Record<string, true> = {
  queued: true,
  normalizing: true,
  cache_lookup: true,
  planning: true,
  searching: true,
  structuring: true,
  supplementing: true,
  extracting: true,
  assessing: true,
  validating: true,
  publishing: true,
  succeeded: true,
  failed: true,
};
const safeFailureCodes: Record<string, true> = {
  invalid_topic: true,
  source_unavailable: true,
  source_insufficient: true,
  model_unavailable: true,
  candidate_invalid: true,
  generation_timeout: true,
  internal_failure: true,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeResult(value: unknown): Record<string, string> | null | undefined {
  if (value === null) {
    return null;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const mapId = safeIdentifier(record.mapId);
  const versionId = safeIdentifier(record.versionId);
  const learningRelationshipId = safeIdentifier(record.learningRelationshipId);
  return mapId && versionId && learningRelationshipId
    ? { mapId, versionId, learningRelationshipId }
    : undefined;
}

function safeFailure(
  value: unknown,
): Record<string, string | boolean> | null | undefined {
  if (value === null) {
    return null;
  }
  const record = asRecord(value);
  if (!record || typeof record.retryable !== "boolean") {
    return undefined;
  }
  const code = safeIdentifier(record.code);
  return code && safeFailureCodes[code] === true
    ? { code, retryable: record.retryable }
    : undefined;
}

export function safeEventData(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  const record = asRecord(data);
  if (!record) {
    return safe;
  }

  const taskId = safeIdentifier(record.taskId);
  const status = safeIdentifier(record.status);
  const stage = safeIdentifier(record.stage);
  const sequence = record.sequence;
  const createdAt = safeIdentifier(record.createdAt);
  const updatedAt = safeIdentifier(record.updatedAt);
  const deadlineAt = safeIdentifier(record.deadlineAt);
  const mapId = safeIdentifier(record.mapId);
  const versionId = safeIdentifier(record.versionId);
  const code = safeIdentifier(record.code);

  if (taskId) safe.taskId = taskId;
  if (status && safeStatuses[status] === true) safe.status = status;
  if (stage && safeStatuses[stage] === true) safe.stage = stage;
  if (
    typeof sequence === "number" &&
    Number.isSafeInteger(sequence) &&
    sequence >= 0
  ) {
    safe.sequence = sequence;
  }
  if (createdAt) safe.createdAt = createdAt;
  if (updatedAt) safe.updatedAt = updatedAt;
  if (deadlineAt) safe.deadlineAt = deadlineAt;
  if (mapId) safe.mapId = mapId;
  if (versionId) safe.versionId = versionId;
  if (code && safeFailureCodes[code] === true) safe.code = code;

  if ("result" in record) {
    const result = safeResult(record.result);
    if (result !== undefined) safe.result = result;
  }
  if ("failure" in record) {
    const failure = safeFailure(record.failure);
    if (failure !== undefined) safe.failure = failure;
  }
  return safe;
}

export function encodeSseEvent(event: SseEventEnvelope): string {
  return [
    `id: ${event.sequence}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event)}`,
    "",
    "",
  ].join("\n");
}

export function encodeSseKeepAlive(): string {
  return ": keep-alive\n\n";
}

export function isTerminalEventType(type: SseEventEnvelope["type"]): boolean {
  return type === "succeeded" || type === "failed";
}

export function snapshotEvent(
  snapshot: Readonly<{
    taskId: string;
    sequence: number;
    status: string;
    stage: string;
    createdAt: string;
    updatedAt: string;
    deadlineAt: string;
    result: unknown;
    failure: unknown;
  }>,
): SseEventEnvelope {
  return {
    protocolVersion: "1",
    taskId: snapshot.taskId,
    sequence: snapshot.sequence,
    type: "snapshot",
    occurredAt: snapshot.updatedAt,
    data: safeEventData({
      taskId: snapshot.taskId,
      status: snapshot.status,
      stage: snapshot.stage,
      sequence: snapshot.sequence,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      deadlineAt: snapshot.deadlineAt,
      result: snapshot.result,
      failure: snapshot.failure,
    }),
  };
}
